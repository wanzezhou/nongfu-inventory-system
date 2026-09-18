/**
 * UI 冒烟：真实 Chrome + CDP（零依赖，仅用 Node 22 内置 WebSocket 与 fetch）
 * ---------------------------------------------------------------------------
 * 背景：组件编译通过 ≠ 交互可用。「悬浮新建订单按钮点击无效」这类 bug
 *       （指针捕获导致 click 目标被重定向到容器）在编译/构建阶段完全看不出来。
 *       本脚本拉起一个真实 Chromium，用 **真实输入事件**（Input.dispatchMouseEvent）
 *       驱动页面，断言交互结果。
 *
 * 依赖：本机已安装 Chrome 或 Edge（自动探测）+ 后端(:3000) + 前端(:5173) 已启动。
 * 用法：node frontend/scripts/ui-smoke.mjs [--headful]
 * 退出码：0 = 全部通过；1 = 有断言失败
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HEADFUL = process.argv.includes('--headful')
const PORT = 9223
const APP = 'http://localhost:5173/'
const API = 'http://localhost:3000/api'
const CDP = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const ok = (c, n, extra = '') => {
  if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + ' ' + extra) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowser() {
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ]
  return cands.find((p) => fs.existsSync(p)) || null
}

/** 极简 CDP 客户端 */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = [] }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true })
    })
    const c = new Cdp(ws)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && c.waiting.has(msg.id)) {
        const { resolve, reject } = c.waiting.get(msg.id)
        c.waiting.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      } else if (msg.method) {
        c.events.push(msg)
      }
    })
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error(method + ' 超时')) }
      }, 30000)
    })
  }
  /** 在页面里求值（返回结构化值） */
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expr} })()`,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  /** 派发真实鼠标事件（Chromium 会据此合成 pointer 事件） */
  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
      buttons: type === 'mouseMoved' ? 0 : 1, ...extra
    })
  }
  /** 完整点击：按下 + 抬起（与真人一致的事件序列） */
  async click(x, y) {
    await this.mouse('mouseMoved', x, y, { buttons: 0 })
    await this.mouse('mousePressed', x, y)
    await this.mouse('mouseReleased', x, y)
  }
  /** 完整拖动：按下 → 分步移动 → 抬起 */
  async drag(x, y, dx, dy, steps = 6) {
    await this.mouse('mouseMoved', x, y, { buttons: 0 })
    await this.mouse('mousePressed', x, y)
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', x + (dx * i) / steps, y + (dy * i) / steps)
      await sleep(16)
    }
    await this.mouse('mouseReleased', x + dx, y + dy)
  }
}

async function waitFor(fn, { timeout = 15000, interval = 200, desc = '条件' } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true } catch (e) { /* 继续等 */ }
    await sleep(interval)
  }
  console.log(`  （等待「${desc}」超时 ${timeout}ms）`)
  return false
}

const FAB_BOX = `
  const el = document.querySelector('.float-entry')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, w: r.width, h: r.height }
`
const DIALOG_OPEN = `
  const ds = [...document.querySelectorAll('.el-dialog')].filter(d => getComputedStyle(d).display !== 'none')
  const titles = ds.map(d => (d.querySelector('.el-dialog__title')?.textContent || '').trim())
  return { count: ds.length, titles }
`

let browser = null
let cdp = null
let profile = null

try {
  console.log('=== 0) 前置检查 ===')
  const bin = findBrowser()
  ok(!!bin, '找到本机浏览器', bin || '(未找到 Chrome/Edge)')
  if (!bin) throw new Error('无浏览器可用')

  const feOk = await fetch(APP).then((r) => r.ok).catch(() => false)
  ok(feOk, '前端 :5173 可访问')
  if (!feOk) throw new Error('前端未启动')

  const login = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then((r) => r.json())
  ok(!!login?.data?.token, '后端登录成功')
  if (!login?.data?.token) throw new Error('登录失败')

  console.log('\n=== 1) 启动真实 Chromium（CDP）===')
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-prof-'))
  const args = [
    HEADFUL ? '--headless=false' : '--headless=new',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1440,900', 'about:blank'
  ].filter((a) => a !== '--headless=false')
  browser = spawn(bin, args, { stdio: 'ignore', windowsHide: true })

  const ready = await waitFor(async () => (await fetch(CDP + '/json/version')).ok, { desc: 'CDP 就绪' })
  ok(ready, 'CDP 调试端口就绪')
  if (!ready) throw new Error('CDP 未就绪')

  const targets = await fetch(CDP + '/json/list').then((r) => r.json())
  const page = targets.find((t) => t.type === 'page')
  ok(!!page?.webSocketDebuggerUrl, '取得页面 target')
  cdp = await Cdp.connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  // 网络域：用于断言「下拉必须走 /xxx/options 全量接口」这类取数行为
  await cdp.send('Network.enable')

  console.log('\n=== 2) 登录态注入并加载应用 ===')
  await cdp.send('Page.navigate', { url: APP })
  await waitFor(() => cdp.eval("return !!document.querySelector('#app')"), { desc: '#app 挂载' })
  await cdp.eval(`
    localStorage.setItem('token', ${JSON.stringify(login.data.token)})
    localStorage.setItem('userInfo', ${JSON.stringify(JSON.stringify(login.data.user || {}))})
    return true
  `)
  await cdp.send('Page.reload', { ignoreCache: true })
  const fabReady = await waitFor(async () => !!(await cdp.eval(FAB_BOX)), { desc: '悬浮按钮出现', timeout: 25000 })
  ok(fabReady, '登录后悬浮「新建订单」按钮已渲染')
  if (!fabReady) throw new Error('悬浮按钮未渲染')

  // 埋点：记录真实 click / pointerup 的落点，用于验证「click 被重定向到容器」这一根因
  await cdp.eval(`
    window.__evt = []
    document.addEventListener('click', (e) => {
      window.__evt.push({ t: 'click', target: e.target?.className || e.target?.tagName })
    }, true)
    document.addEventListener('pointerup', (e) => {
      window.__evt.push({ t: 'pointerup', target: e.target?.className || e.target?.tagName })
    }, true)
    return true
  `)

  console.log('\n=== 3) 单击悬浮按钮 → 应打开新建订单表单 ===')
  let box = await cdp.eval(FAB_BOX)
  console.log(`    按钮中心 (${Math.round(box.x)}, ${Math.round(box.y)})，尺寸 ${Math.round(box.w)}×${Math.round(box.h)}`)
  await cdp.click(box.x, box.y)
  const opened = await waitFor(async () => {
    const d = await cdp.eval(DIALOG_OPEN)
    return d.count > 0
  }, { desc: '订单表单弹窗出现', timeout: 10000 })
  const dlg = await cdp.eval(DIALOG_OPEN)
  ok(opened, '单击后弹窗出现', JSON.stringify(dlg))
  if (opened) console.log('    弹窗标题：', dlg.titles.join(' / ') || '(无标题)')

  // 弹窗是改动面积最大的组件（头部/底部/圆角/动画），截图留档便于目视复核
  if (opened) {
    await sleep(500) // 等淡入动画结束再拍，避免截到半透明的中间态
    const dlgShot = path.join(os.tmpdir(), `ui-smoke-dialog-${Date.now()}.png`)
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(dlgShot, Buffer.from(s.data, 'base64'))
    console.log('    弹窗截图：', dlgShot)
  }

  const evtLog = await cdp.eval('return window.__evt')
  const clickEvt = evtLog.find((e) => e.t === 'click')
  const upEvt = evtLog.find((e) => e.t === 'pointerup')
  console.log('    事件埋点：pointerup →', upEvt?.target, '｜ click →', clickEvt?.target)
  ok(!!clickEvt, '确实收到了 click 事件（说明不是事件没派发）')

  // ---- 下拉取数必须走专用全量接口（2026-09-18 代码审查 #1 的回归防线）----
  // 背景：开单表单曾用 getProductList({ pageSize: 100 }) 拉商品下拉，而本库有 159 个商品
  //       → 下拉里静默缺 59 个（选不到，且不报错）。此处直接断言实际发出的请求：
  //       必须命中 /products/options，且不得再出现带 pageSize 上限的列表式取数。
  const openedReqs = cdp.events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params?.request?.url || '')
  const optionReqs = openedReqs.filter((u) => /\/products\/options/.test(u))
  const cappedListReqs = openedReqs.filter((u) => /\/products\?[^\s]*pageSize=/.test(u))
  ok(optionReqs.length > 0, '开单表单的商品下拉走专用全量接口 /products/options', '命中 ' + optionReqs.length + ' 次')
  ok(cappedListReqs.length === 0, '开单表单不再用「分页列表 + pageSize 上限」拉下拉', cappedListReqs.join(' | ') || '(无)')

  // 关掉弹窗，便于后续测试
  await cdp.eval(`
    const btns = [...document.querySelectorAll('.el-dialog__footer button, .el-dialog__headerbtn')]
    const close = btns.find(b => /取消|关闭/.test(b.textContent)) || document.querySelector('.el-dialog__headerbtn')
    if (close) close.click()
    return true
  `)
  await waitFor(async () => (await cdp.eval(DIALOG_OPEN)).count === 0, { desc: '弹窗关闭' })

  console.log('\n=== 4) 拖动 → 只移位、不应打开表单 ===')
  box = await cdp.eval(FAB_BOX)
  const before = { left: Math.round(box.left), top: Math.round(box.top) }
  await cdp.drag(box.x, box.y, -260, -160)
  await sleep(300)
  const after = await cdp.eval(FAB_BOX)
  const moved = { left: Math.round(after.left), top: Math.round(after.top) }
  console.log(`    位置 ${JSON.stringify(before)} → ${JSON.stringify(moved)}`)
  ok(Math.abs(moved.left - before.left) > 100 && Math.abs(moved.top - before.top) > 60, '拖动生效（位置发生明显位移）')
  const dlgAfterDrag = await cdp.eval(DIALOG_OPEN)
  ok(dlgAfterDrag.count === 0, '拖动后未误开表单', JSON.stringify(dlgAfterDrag))

  const posSaved = await cdp.eval(`return localStorage.getItem('floating_order_btn_pos')`)
  ok(!!posSaved, '位置已写入 localStorage', String(posSaved))
  const posParsed = JSON.parse(posSaved || '{}')
  ok(Math.abs(posParsed.x - moved.left) < 2 && Math.abs(posParsed.y - moved.top) < 2, 'localStorage 位置与实际位置一致')

  console.log('\n=== 5) 拖动后再单击 → 仍应打开表单 ===')
  const box2 = await cdp.eval(FAB_BOX)
  await cdp.click(box2.x, box2.y)
  const opened2 = await waitFor(async () => (await cdp.eval(DIALOG_OPEN)).count > 0, { desc: '再次打开表单', timeout: 8000 })
  ok(opened2, '拖动后单击仍能打开表单')

  console.log('\n=== 6) 刷新后位置保持 ===')
  await cdp.eval(`
    const btns = [...document.querySelectorAll('.el-dialog__footer button, .el-dialog__headerbtn')]
    const close = btns.find(b => /取消|关闭/.test(b.textContent)) || document.querySelector('.el-dialog__headerbtn')
    if (close) close.click()
    return true
  `)
  await sleep(300)
  await cdp.send('Page.reload', { ignoreCache: false })
  await waitFor(async () => !!(await cdp.eval(FAB_BOX)), { desc: '刷新后按钮出现' })
  const box3 = await cdp.eval(FAB_BOX)
  ok(Math.abs(Math.round(box3.left) - moved.left) < 2 && Math.abs(Math.round(box3.top) - moved.top) < 2,
    '刷新后按钮回到拖动后的位置', JSON.stringify({ left: Math.round(box3.left), top: Math.round(box3.top) }))

  await cdp.eval(`localStorage.removeItem('floating_order_btn_pos'); return true`)

  console.log('\n=== 7) 页面底色为纯白（--page-bg）===')
  const bg = await cdp.eval(`
    const g = (el) => el ? getComputedStyle(el) : null
    const bodyS = g(document.body)
    const mainS = g(document.querySelector('.main-content'))
    return {
      bodyBg: bodyS?.backgroundColor,
      bodyImage: bodyS?.backgroundImage,
      mainBg: mainS?.backgroundColor,
      pageBgToken: getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim(),
      subBgToken: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      thBg: getComputedStyle(document.querySelector('.el-table th') || document.body).backgroundColor
    }
  `)
  console.log('    计算样式：', JSON.stringify(bg))
  ok(bg.bodyBg === 'rgb(255, 255, 255)', 'body 底色为纯白', String(bg.bodyBg))
  ok(bg.mainBg === 'rgb(255, 255, 255)', '.main-content 底色为纯白', String(bg.mainBg))
  ok(bg.bodyImage === 'none', 'body 无装饰性渐变叠色（纯色）', String(bg.bodyImage))
  ok(bg.pageBgToken.toUpperCase() === '#FFFFFF', '--page-bg token = #FFFFFF', bg.pageBgToken)
  ok(bg.subBgToken.toUpperCase() === '#F7F7F7', '--bg token 为中性浅灰 #F7F7F7（次级浅底）', bg.subBgToken)

  // 截图留档，便于人工目视确认整体观感（默认写入系统临时目录，避免污染仓库）
  const shotPath = path.join(os.tmpdir(), `ui-smoke-${Date.now()}.png`)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
  ok(fs.existsSync(shotPath) && fs.statSync(shotPath).size > 10000, '截图已生成', shotPath)

  console.log('\n=== 8) 次级浅底不应被页面底色改动牵连（列表页表头）===')
  await cdp.send('Page.navigate', { url: APP + 'worker' })
  const tableReady = await waitFor(async () => !!(await cdp.eval("return !!document.querySelector('.el-table th')")), { desc: '员工列表表头', timeout: 20000 })
  ok(tableReady, '进入员工列表并渲染出表头')
  const listBg = await cdp.eval(`
    const th = document.querySelector('.el-table th')
    const main = document.querySelector('.main-content')
    return {
      thBg: th ? getComputedStyle(th).backgroundColor : null,
      mainBg: main ? getComputedStyle(main).backgroundColor : null
    }
  `)
  console.log('    计算样式：', JSON.stringify(listBg))
  ok(listBg.thBg === 'rgb(247, 247, 247)', '表头为中性浅灰 #F7F7F7（次级浅底）', String(listBg.thBg))
  ok(listBg.mainBg === 'rgb(255, 255, 255)', '列表页页面底色仍为纯白', String(listBg.mainBg))

  const shot2 = path.join(os.tmpdir(), `ui-smoke-list-${Date.now()}.png`)
  const shotList = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(shot2, Buffer.from(shotList.data, 'base64'))
  console.log('    列表页截图已保存：', shot2)

  console.log('\n=== 9) 中性极简体系：装饰已移除 / 红色仍是唯一强调色 ===')
  const deco = await cdp.eval(`
    const root = getComputedStyle(document.documentElement)
    const card = document.querySelector('.el-card')
    const btn = [...document.querySelectorAll('.el-button')].find(b => b.classList.contains('el-button--primary'))
    return {
      primary: root.getPropertyValue('--primary').trim(),
      radiusXl: root.getPropertyValue('--radius-xl').trim(),
      cardTransform: card ? getComputedStyle(card).transform : null,
      btnShine: btn ? getComputedStyle(btn, '::before').content : null,
      btnTransform: btn ? getComputedStyle(btn).transform : null
    }
  `)
  console.log('    计算样式：', JSON.stringify(deco))
  ok(deco.primary.toUpperCase() === '#A8201A', '强调色仍为品牌红 #A8201A', deco.primary)
  ok(deco.radiusXl === '12px', '圆角收紧为 12px（--radius-xl）', deco.radiusXl)
  ok(deco.cardTransform === 'none', '卡片无 hover 位移基线（transform: none）', String(deco.cardTransform))
  ok(deco.btnTransform === 'none', '按钮无缩放基线（transform: none）', String(deco.btnTransform))
  ok(deco.btnShine === 'none' || deco.btnShine === null || deco.btnShine === 'normal',
    '按钮扫光装饰已移除（::before 无内容）', String(deco.btnShine))

  console.log('\n=== 10) 侧边栏：一级（章节）与二级（页面）样式可区分 ===')
  // 展开全部一级分组，才能同时取到一级标题与二级项
  await cdp.eval(`
    const titles = [...document.querySelectorAll('.sidebar-menu > .el-sub-menu > .el-sub-menu__title')]
    for (const t of titles) {
      if (t.closest('.el-sub-menu')?.classList.contains('is-opened')) continue
      t.click()
    }
    return titles.length
  `)
  await sleep(700)
  const menu = await cdp.eval(`
    const lv1Title = document.querySelector('.sidebar-menu > .el-sub-menu > .el-sub-menu__title')
    const lv1Item = document.querySelector('.sidebar-menu > .el-menu-item')
    const subWrap = document.querySelector('.el-sub-menu .el-menu')
    const lv2 = document.querySelector('.el-sub-menu .el-menu .el-menu-item')
    const actTitle = document.querySelector('.sidebar-menu > .el-sub-menu.is-active > .el-sub-menu__title')
    if (!lv1Title || !lv2) return null
    const s1 = getComputedStyle(lv1Title), s1i = getComputedStyle(lv1Item), s2 = getComputedStyle(lv2)
    const sw = subWrap ? getComputedStyle(subWrap) : null
    const pick = (s, h, l) => ({ fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, height: h, left: l })
    return {
      lv1: pick(s1, s1.height, Math.round(lv1Title.getBoundingClientRect().left)),
      lv1Item: pick(s1i, s1i.height, Math.round(lv1Item.getBoundingClientRect().left)),
      lv2: pick(s2, s2.height, Math.round(lv2.getBoundingClientRect().left)),
      subBorderLeft: sw ? sw.borderLeftWidth : null,
      actBarBg: actTitle ? getComputedStyle(actTitle, '::before').backgroundColor : null,
      actBarW: actTitle ? getComputedStyle(actTitle, '::before').width : null
    }
  `)
  ok(!!menu, '取到一级与二级菜单节点')
  if (menu) {
    console.log('    一级：', JSON.stringify(menu.lv1))
    console.log('    一级独立项：', JSON.stringify(menu.lv1Item))
    console.log('    二级：', JSON.stringify(menu.lv2))
    ok(menu.lv1.fontWeight === '500' && menu.lv2.fontWeight === '400',
      '字重区分：一级 500 / 二级 400', `${menu.lv1.fontWeight} / ${menu.lv2.fontWeight}`)
    ok(menu.lv1.color !== menu.lv2.color && menu.lv1.color === 'rgb(23, 23, 23)',
      '字色区分：一级深色（--text）/ 二级浅色（--text-2）', `${menu.lv1.color} vs ${menu.lv2.color}`)
    ok(menu.lv1.height === '38px' && menu.lv2.height === '32px',
      '高度区分：一级 38px / 二级 32px', `${menu.lv1.height} / ${menu.lv2.height}`)
    ok(parseFloat(menu.lv1.fontSize) > parseFloat(menu.lv2.fontSize),
      '字号区分：一级大于二级', `${menu.lv1.fontSize} vs ${menu.lv2.fontSize}`)
    ok(menu.subBorderLeft === '1px', '二级容器带竖向引导线（border-left 1px）', String(menu.subBorderLeft))
    ok(menu.lv2.left > menu.lv1.left + 20, '二级整体右移缩进（嵌套关系可见）', `${menu.lv1.left} → ${menu.lv2.left}`)
    ok(menu.actBarW === '3px' && menu.actBarBg === 'rgb(168, 32, 26)',
      '一级选中为左缘红色竖条', `${menu.actBarW} / ${menu.actBarBg}`)
    ok(menu.lv1Item.fontWeight === '500' && menu.lv1Item.color === 'rgb(23, 23, 23)',
      '一级独立项（仪表盘/水站账户）与分组标题观感一致', JSON.stringify(menu.lv1Item))
  }
  const menuShot = path.join(os.tmpdir(), `ui-smoke-menu-${Date.now()}.png`)
  const sidebarBox = await cdp.eval(`
    const r = document.querySelector('.sidebar').getBoundingClientRect()
    return { x: 0, y: 0, width: Math.round(r.width), height: Math.round(r.height), scale: 1 }
  `)
  const mShot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: sidebarBox })
  fs.writeFileSync(menuShot, Buffer.from(mShot.data, 'base64'))
  console.log('    侧边栏截图已保存：', menuShot)

  console.log('\n=== 11) 仪表盘趋势图：4 张图各带粒度切换且互不影响 ===')
  await cdp.send('Page.navigate', { url: APP + 'dashboard' })
  const dashReady = await waitFor(
    async () => !!(await cdp.eval("return !!document.querySelector('.trend-card')")),
    { desc: '仪表盘趋势卡片', timeout: 20000 }
  )
  ok(dashReady, '进入仪表盘并渲染出趋势卡片')
  // 等 4 张图完成渲染。两种合法终态：
  //   ① 有数据 → ECharts 初始化，出现 canvas
  //   ② 数据全为 0（如系统初始化后）→ 按设计显示空态占位，**不**初始化 ECharts
  // 断言必须对两种状态都成立，否则「全 0 数据」会变成假失败（2026-09-18 踩到）
  await waitFor(async () => {
    const r = await cdp.eval(`
      return {
        canvases: document.querySelectorAll('.trend-card canvas').length,
        empties: document.querySelectorAll('.trend-card .trend-empty').length
      }
    `)
    return r.canvases === 4 || r.empties === 4
  }, { desc: '4 张趋势图完成渲染（canvas 或空态）', timeout: 15000 })
  const tr = await cdp.eval(`
    const cards = [...document.querySelectorAll('.trend-card')]
    return {
      count: cards.length,
      canvases: document.querySelectorAll('.trend-card canvas').length,
      empties: document.querySelectorAll('.trend-card .trend-empty').length,
      titles: cards.map(c => (c.querySelector('.trend-title') || {}).textContent || ''),
      buckets: cards.map(c => Number(c.dataset.buckets)),
      granularities: cards.map(c => c.dataset.granularity),
      switchers: cards.map(c => c.querySelectorAll('.granularity-switch .el-radio-button').length)
    }
  `)
  console.log('    趋势卡片：', JSON.stringify(tr))
  ok(tr.count === 4, '趋势图共 4 张（销售 / 营收 / 成本 / 利润）', String(tr.count))
  ok(tr.canvases === 4 || tr.empties === 4,
    tr.canvases === 4
      ? '4 张图均完成 ECharts 初始化（存在 canvas）'
      : '数据全为 0 → 4 张图均显示空态占位（按设计不初始化 ECharts）',
    JSON.stringify({ canvases: tr.canvases, empties: tr.empties }))
  ok(tr.titles.join(',').includes('销售趋势') && tr.titles.join(',').includes('总营收趋势')
    && tr.titles.join(',').includes('总成本趋势') && tr.titles.join(',').includes('总利润趋势'),
    '4 张图标题正确', tr.titles.join(' / '))
  ok(tr.switchers.every((n) => n === 5), '每张图都有 5 个粒度按钮（日/周/月/季/年）', tr.switchers.join(','))
  ok(tr.buckets.every((n) => n === 12) && tr.granularities.every((g) => g === 'month'),
    '默认粒度为月（每图 12 个桶）', JSON.stringify({ buckets: tr.buckets, g: tr.granularities }))

  // 只切第 1 张图 → 年（5 桶），其余 3 张必须保持月（12 桶）
  const switched = await cdp.eval(`
    const first = document.querySelectorAll('.trend-card')[0]
    const btns = [...first.querySelectorAll('.granularity-switch .el-radio-button')]
    const year = btns.find(b => b.textContent.trim() === '年')
    if (!year) return { clicked: false }
    ;(year.querySelector('input') || year).click()
    return { clicked: true, labels: btns.map(b => b.textContent.trim()) }
  `)
  ok(switched.clicked, '找到并点击第 1 张图的「年」粒度', JSON.stringify(switched.labels))
  await waitFor(async () => (await cdp.eval(`
    return document.querySelectorAll('.trend-card')[0].dataset.buckets === '5'
  `)), { desc: '第 1 张图切到年粒度（5 桶）', timeout: 10000 })
  const trendAfter = await cdp.eval(`
    const cards = [...document.querySelectorAll('.trend-card')]
    return {
      buckets: cards.map(c => Number(c.dataset.buckets)),
      granularities: cards.map(c => c.dataset.granularity),
      stored: localStorage.getItem('dashboard_trend_granularities')
    }
  `)
  console.log('    切换后：', JSON.stringify(trendAfter))
  ok(trendAfter.granularities[0] === 'year' && trendAfter.buckets[0] === 5,
    '第 1 张图已切为年粒度（5 桶）', JSON.stringify({ g: trendAfter.granularities[0], b: trendAfter.buckets[0] }))
  ok(trendAfter.granularities.slice(1).every((g) => g === 'month') && trendAfter.buckets.slice(1).every((b) => b === 12),
    '其余 3 张图不受影响（仍为月 / 12 桶）', JSON.stringify(trendAfter.granularities.slice(1)))
  let storedOk = false
  try {
    const parsed = JSON.parse(trendAfter.stored || '{}')
    storedOk = parsed.salesQty === 'year' && parsed.revenue === 'month'
      && parsed.cost === 'month' && parsed.profit === 'month'
  } catch (e) { /* ignore */ }
  ok(storedOk, '粒度按图独立记忆到 localStorage', String(trendAfter.stored))

  const dashShot = path.join(os.tmpdir(), `ui-smoke-dashboard-${Date.now()}.png`)
  const dShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(dashShot, Buffer.from(dShot.data, 'base64'))
  console.log('    仪表盘截图已保存：', dashShot)
  // 还原记忆，避免影响后续手动浏览
  await cdp.eval(`localStorage.removeItem('dashboard_trend_granularities'); return true`)

  console.log('\n=== 12) 主数据页删除交互（机台 / 零售机 / 供应商 / 水站）===')
  const PAGES = [
    { route: 'bulk-machine', name: '量贩机', must: /停用/ },
    { route: 'retail-machine', name: '零售机', must: /停用/ },
    { route: 'supplier', name: '供应商', must: /停用|采购入库/ },
    { route: 'station', name: '水站', must: /停用|欠款/ }
  ]
  for (const p of PAGES) {
    await cdp.send('Page.navigate', { url: APP + p.route })
    const ready = await waitFor(
      async () => !!(await cdp.eval("return !!document.querySelector('.el-table__row')")),
      { desc: p.name + '列表', timeout: 20000 }
    )
    ok(ready, `${p.name}页渲染出列表行`)
    if (!ready) continue

    const clicked = await cdp.eval(`
      const rows = [...document.querySelectorAll('.el-table__row')]
      if (!rows.length) return { ok: false }
      const row = rows[rows.length - 1]
      const del = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === '删除')
      if (!del) return { ok: false }
      del.click()
      return { ok: true }
    `)
    ok(clicked.ok, `${p.name}页找到并点击「删除」`)
    if (!clicked.ok) continue

    await sleep(400)
    const box = await cdp.eval(`
      const mb = document.querySelector('.el-message-box')
      if (!mb) return null
      return {
        title: (mb.querySelector('.el-message-box__title') || {}).textContent || '',
        msg: (mb.querySelector('.el-message-box__message') || {}).textContent || ''
      }
    `)
    ok(!!box, `${p.name}页弹出删除确认框`, JSON.stringify(box))
    if (box) {
      ok(p.must.test(box.msg), `${p.name}确认框说明了「有引用则转停用」`, box.msg.slice(0, 70))
      ok(!/不可恢复/.test(box.msg), `${p.name}确认框不再写「删除后不可恢复」`, box.msg.slice(0, 40))
    }
    // 取消，避免真的改动数据
    await cdp.eval(`
      const btns = [...document.querySelectorAll('.el-message-box__btns button')]
      const cancel = btns.find(b => /取消/.test(b.textContent))
      if (cancel) cancel.click()
      return true
    `)
    await sleep(300)
  }

  console.log('\n=== 13) 客户端路由切换：共用组件的页面必须按新参数重新加载 ===')
  // 机台（量贩机/零售机）、成本/利润的类型明细页都由「同一组件 + 不同 props」承载：
  // 若 router-view 复用实例且组件不 watch props，则切换后 props 变了但数据不重查 →
  // 页面显示并操作的是上一个类型的数据（曾导致「在零售机页删掉了量贩机」）。
  const READ_TABLE = `
    const t = document.querySelector('.el-table')
    if (!t) return null
    const head = (t.querySelector('thead th') || {}).textContent || ''
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => {
      const td = tr.querySelector('td')
      return td ? td.textContent.trim() : ''
    })
    return { head: head.trim(), rows }
  `
  await cdp.send('Page.navigate', { url: APP + 'bulk-machine' })
  await waitFor(async () => !!(await cdp.eval("return !!document.querySelector('.el-table__row')")),
    { desc: '量贩机列表', timeout: 20000 })
  const bulkDirect = await cdp.eval(READ_TABLE)
  console.log('    ① 整页进入 /bulk-machine：', JSON.stringify(bulkDirect))
  ok(!!bulkDirect && /量贩机/.test(bulkDirect.head), '量贩机页表头为「量贩机名称」', bulkDirect?.head)

  // 展开侧边栏「基础信息管理」，点击「零售机管理」（客户端路由，不刷新页面）
  await cdp.eval(`
    const titles = [...document.querySelectorAll('.sidebar-menu > .el-sub-menu > .el-sub-menu__title')]
    const g = titles.find(t => /基础信息/.test(t.textContent))
    if (g) g.click()
    return true
  `)
  await sleep(600)
  const navOk = await cdp.eval(`
    const items = [...document.querySelectorAll('.sidebar-menu .el-menu-item')]
    const target = items.find(i => /零售机管理/.test(i.textContent))
    if (!target) return false
    target.click()
    return true
  `)
  ok(navOk, '点击侧边栏「零售机管理」（客户端路由切换）')
  await waitFor(async () => (await cdp.eval('return location.pathname')) === '/retail-machine',
    { desc: '路由切到 /retail-machine', timeout: 10000 })
  await sleep(1500)
  const clientSwitched = await cdp.eval(READ_TABLE)
  console.log('    ② 客户端切到 /retail-machine：', JSON.stringify(clientSwitched))
  ok(!!clientSwitched && /零售机/.test(clientSwitched.head), '切换后表头更新为「零售机名称」', clientSwitched?.head)
  ok(!!clientSwitched && !clientSwitched.rows.some((r) => /量贩机/.test(r)),
    '⚠️ 切换后列表已按零售机重新加载（不得残留量贩机数据）', JSON.stringify(clientSwitched?.rows))

  // 与「整页刷新」的结果必须完全一致
  await cdp.send('Page.navigate', { url: APP + 'retail-machine' })
  await waitFor(async () => !!(await cdp.eval("return !!document.querySelector('.el-table__row')")),
    { desc: '零售机列表', timeout: 20000 })
  const retailDirect = await cdp.eval(READ_TABLE)
  console.log('    ③ 整页进入 /retail-machine：', JSON.stringify(retailDirect))
  ok(JSON.stringify(clientSwitched?.rows) === JSON.stringify(retailDirect?.rows),
    '客户端切换结果 == 整页刷新结果（数据完全一致）',
    `${JSON.stringify(clientSwitched?.rows)} vs ${JSON.stringify(retailDirect?.rows)}`)
} catch (e) {
  fail++
  console.log('\n❌ 执行异常: ' + e.message)
} finally {
  try { cdp?.ws.close() } catch (e) { /* ignore */ }
  // ⚠️ 只结束「本脚本拉起的这棵进程树」，绝不按镜像名批量杀（否则会连带干掉用户自己的 Chrome）
  try {
    if (browser?.pid) execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch (e) {
    try { browser?.kill('SIGKILL') } catch (e2) { /* ignore */ }
  }
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`)
  process.exit(fail ? 1 : 0)
}

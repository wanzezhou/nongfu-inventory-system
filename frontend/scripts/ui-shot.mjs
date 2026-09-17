/**
 * UI 截图工具：真实 Chrome + CDP 批量截取页面（零依赖）
 * ---------------------------------------------------------------------------
 * 用途：界面改造/视觉回归时留底图（before/after 对比），比在浏览器里手动截图省事。
 * 用法：
 *   node frontend/scripts/ui-shot.mjs --out .ui-shots/before
 *   node frontend/scripts/ui-shot.mjs --out .ui-shots/after --routes /dashboard,/order,/worker
 * 前置：后端 :3000 + 前端 :5173 已启动。
 * 说明：截图写入指定目录（目录会被自动创建），并打印每张图的路径与大小。
 */
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const OUT_DIR = path.resolve(argOf('--out', '.ui-shots/shot'))
const ROUTES = argOf('--routes', '/dashboard,/order,/worker,/cost/summary').split(',').map((s) => s.trim()).filter(Boolean)
const PORT = Number(argOf('--port', '9224'))
const APP = argOf('--app', 'http://localhost:5173/')
const API = argOf('--api', 'http://localhost:3000/api')
const WIDTH = Number(argOf('--width', '1440'))
const HEIGHT = Number(argOf('--height', '900'))
const CDP = `http://127.0.0.1:${PORT}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findBrowser() {
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ].find((p) => fs.existsSync(p))
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map() }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true })
    })
    const c = new Cdp(ws)
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && c.waiting.has(m.id)) {
        const { resolve, reject } = c.waiting.get(m.id)
        c.waiting.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      }
    })
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error(method + ' 超时')) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: `(() => { ${expr} })()`, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
}

async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await fn()) return true } catch (e) { /* 继续等 */ }
    await sleep(interval)
  }
  return false
}

let browser = null, cdp = null, profile = null
try {
  const bin = findBrowser()
  if (!bin) throw new Error('未找到 Chrome/Edge')
  const login = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then((r) => r.json())
  if (!login?.data?.token) throw new Error('后端登录失败（确认 :3000 已启动）')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'))
  browser = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true })

  if (!await waitFor(async () => (await fetch(CDP + '/json/version')).ok, { timeout: 30000 })) throw new Error('CDP 未就绪')
  const targets = await fetch(CDP + '/json/list').then((r) => r.json())
  cdp = await Cdp.connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })

  await cdp.send('Page.navigate', { url: APP })
  await waitFor(() => cdp.eval("return !!document.querySelector('#app')"))
  await cdp.eval(`
    localStorage.setItem('token', ${JSON.stringify(login.data.token)})
    localStorage.setItem('userInfo', ${JSON.stringify(JSON.stringify(login.data.user || {}))})
    return true
  `)

  console.log(`输出目录：${OUT_DIR}`)
  for (const route of ROUTES) {
    const url = APP.replace(/\/$/, '') + route
    await cdp.send('Page.navigate', { url })
    await waitFor(() => cdp.eval("return !!document.querySelector('.main-content')"))
    await sleep(1200) // 等图表/异步数据落定
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const name = (route === '/' ? 'root' : route.replace(/\//g, '_').replace(/^_/, '')) + '.png'
    const file = path.join(OUT_DIR, name)
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`  ✓ ${route.padEnd(20)} → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`)
  }
} catch (e) {
  console.error('截图失败: ' + e.message)
  process.exitCode = 1
} finally {
  try { cdp?.ws.close() } catch (e) { /* ignore */ }
  try { if (browser?.pid) execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }) } catch (e) { /* ignore */ }
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }) } catch (e) { /* ignore */ }
}

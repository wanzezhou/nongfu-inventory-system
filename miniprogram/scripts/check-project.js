#!/usr/bin/env node
/**
 * 小程序工程结构校验（本地门禁，无外部依赖）
 * ===========================================================================
 * 为什么需要它：小程序工程没有「编译期类型检查」帮你兜住引用错误，
 * 而最常见的两类低级错误恰恰只有真机点一下才会暴露：
 *   ① app.json 里声明了页面、但目录里没有对应文件（一进首页就白屏）
 *   ② WXML 里 bindtap 绑了一个 JS 里根本不存在的方法（点了没反应、控制台报错）
 * 本脚本把这两类问题在提交前静态查出来。
 *
 * 校验项：
 *   1. app.json / project.config.json / sitemap.json / 各页 index.json 是否为合法 JSON
 *   2. app.json 的 pages 每一项是否存在 .js / .json / .wxml 三件套
 *   3. tabBar.list 的 pagePath 是否都在 pages 里（否则 wx.switchTab 必然失败）
 *   4. custom-tab-bar 组件是否齐备（custom:true 时微信要求该目录存在）
 *   5. 每个 WXML 里的 bind / catch 事件处理函数是否在同名 JS 中存在
 *   6. wx:for 是否带 wx:key（缺 key 会导致列表复用错乱，属于典型隐性 bug）
 *   7. JS 文件语法（交给 node --check 的等价实现：new Function / vm 编译）
 *   8. 是否误把密钥类变量写进小程序（文档 §26 的安全红线）
 *   9. WXML 标签闭合错位（**硬错误**）、幂等键 acquireKey 的入参契约（第 9 项见函数注释）
 *   10. WXSS 注释完整性 —— 注释内若出现「星号紧邻斜杠」会把注释提前闭合，
 *       其后的中文注释文本落到代码位 → WXSS 编译失败 → **整个小程序白屏**
 *       （2026-09-22 实测：admin-mini-accounts 首注释里的类名清单正好包含这组字符）
 *
 * 用法：node miniprogram/scripts/check-project.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const warnings = [];
let checks = 0;

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}
function ok() {
  checks++;
}

/** 1. JSON 合法性 */
function checkJson(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    fail(`缺少文件：${file}`);
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    ok();
    return data;
  } catch (e) {
    fail(`JSON 解析失败：${file} —— ${e.message}`);
    return null;
  }
}

/** 7. JS 语法编译（不执行，只编译） */
function checkJsSyntax(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    fail(`缺少文件：${file}`);
    return false;
  }
  const src = fs.readFileSync(full, 'utf8');
  try {
    new vm.Script(src, { filename: file });
    ok();
    return true;
  } catch (e) {
    fail(`JS 语法错误：${file} —— ${e.message}`);
    return false;
  }
}

/** 5+6. WXML 处理函数与 wx:key 检查 */
function checkWxml(pagePath, jsFile) {
  const full = path.join(ROOT, pagePath);
  if (!fs.existsSync(full)) {
    fail(`缺少文件：${pagePath}`);
    return;
  }
  const rawWxml = fs.readFileSync(full, 'utf8');
  // ⚠️ 先剥掉 WXML 注释再扫描：否则「注释里写的示例代码」会被当成真实代码判定
  //    （本项目已实测踩到：注释里的 bindtap="{{cond ? 'a' : 'b'}}" 被误报为动态绑定）。
  //    门禁的构造性误报会训练人忽略告警，最终让规则失效 —— 必须修掉而不是加豁免。
  const wxml = rawWxml.replace(/<!--[\s\S]*?-->/g, '');
  const jsFull = path.join(ROOT, jsFile);
  const js = fs.existsSync(jsFull) ? fs.readFileSync(jsFull, 'utf8') : '';

  // 抽取 bind*/catch* 的处理函数名（排除动态绑定与内置行为）
  const handlerRe = /\b(?:bind|catch|capture-bind|capture-catch)[:-]?([a-zA-Z]+)\s*=\s*"([^"]*)"/g;
  let m;
  const seen = new Set();
  while ((m = handlerRe.exec(wxml)) !== null) {
    const handler = m[2].trim();
    if (!handler) continue;
    if (handler.includes('{{')) {
      // 动态事件绑定在部分基础库版本上行为不可靠，且难以静态校验 —— 明确提示改写
      warn(`${pagePath}: 使用了动态事件绑定 ${m[0]}，建议改为固定 handler 在内部判断`);
      continue;
    }
    if (seen.has(handler)) continue;
    seen.add(handler);
    // JS 里允许两种写法：`handler(` 方法简写，或 `handler:` 属性赋值
    const exists =
      new RegExp(`(^|[^\\w])${handler}\\s*\\(`, 'm').test(js) || new RegExp(`(^|[^\\w])${handler}\\s*:`, 'm').test(js);
    if (exists) ok();
    else fail(`${pagePath}: 事件处理函数 ${handler} 在 ${path.basename(jsFile)} 中不存在`);
  }

  // wx:for 必须带 wx:key
  const forCount = (wxml.match(/\bwx:for\s*=/g) || []).length;
  const keyCount = (wxml.match(/\bwx:key\s*=/g) || []).length;
  if (forCount > keyCount) {
    warn(`${pagePath}: wx:for × ${forCount} 但 wx:key × ${keyCount}（缺 key 会导致列表复用错乱）`);
  } else if (forCount > 0) {
    ok();
  }

  // WXML 标签闭合**硬检**（2026-09-22 由 warn 提升为 fail）
  // ---------------------------------------------------------------------------
  // ⚠️ 这里曾经只打警告，代价是被实测抓到一次真实事故：
  //    `pages/home/index.wxml` 的一次编辑漏了开标签、又多出一个 </view> ——
  //    后果是「主数据」整行失去 bindtap（点了没反应，该域在手机上完全不可达），
  //    且其后的卡片被挤出容器、`<block>` 提前闭合（非管理员看到的区块跟着错位）。
  //    而当时门禁**确实看见了**，却只输出一行警告 + 一句「✅ 结构校验通过」，
  //    缺陷就这样活过了一整个交付批次。
  //    WXML 没有编译期检查，闭合错位不会报错、只会静默渲染错乱 ——
  //    正是最该被门禁硬拦的一类问题（对照 docs §5.8 第 ⑭ 条「可静态校验性」）。
  const selfClose = new Set(['input', 'image', 'icon', 'progress', 'slider', 'switch', 'textarea']);
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const stack = []; // {name, line}
  const lineAt = idx => wxml.slice(0, idx).split('\n').length;
  let t;
  let broken = false;
  while ((t = tagRe.exec(wxml)) !== null) {
    const closing = t[1] === '/';
    const name = t[2];
    const selfClosed = t[4] === '/';
    if (selfClose.has(name) && !closing) continue;
    if (selfClosed) continue;
    if (closing) {
      const top = stack[stack.length - 1];
      if (!top || top.name !== name) {
        fail(
          `${pagePath}:${lineAt(t.index)}: 标签闭合错位 —— 遇到 </${name}>，期望 </${top ? top.name : '(空)'}>` +
            `${top ? `（<${top.name}> 开于第 ${top.line} 行）` : ''}`
        );
        broken = true;
        break;
      }
      stack.pop();
    } else {
      stack.push({ name, line: lineAt(t.index) });
    }
  }
  if (!broken && stack.length) {
    fail(`${pagePath}: 存在未闭合标签 ${stack.map(s => `<${s.name}>（第 ${s.line} 行）`).join(', ')}`);
    broken = true;
  }
  if (!broken) ok();
}

/** 8. 密钥红线：小程序包里不得出现任何服务端凭据（文档 §26） */
function checkNoSecrets(files) {
  const forbidden =
    /(WX_SECRET|WX_MCHID|WX_API_V3_KEY|WX_PRIVATE_KEY|WX_CERT_SERIAL_NO|JWT_SECRET)\s*[:=]\s*['"][^'"]+['"]/;
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (forbidden.test(src)) {
      fail(`${f}: 出现疑似服务端密钥赋值（文档 §26：密钥只能存在服务端）`);
    }
  }
  ok();
}

/**
 * 9. 幂等键契约：`acquireKey()` 的首参必须是**对象**，不能是字符串
 * ---------------------------------------------------------------------------
 * 这是一类「只有真机连做两次才会暴露」的错误，实测发生过：
 *     acquireKey('account-xfer-' + fromId + '-' + toId + '-' + amt)   // ✗
 * 传字符串时 `utils/idempotency.js` 解构出的 scope / ownerKey 全是 undefined，
 * 内容指纹退化成常量 `hash({})` —— 于是「内容没变就复用同一个键」这条正常逻辑
 * 被**永久触发**：同一台设备 24h 内的第二次操作（金额、账户都不同）会复用上一次的键，
 * 服务端 requestHash 对不上 → 400「重复提交的请求内容不一致，请刷新后重试」。
 * 用户完全联想不到是幂等键，只会认为「转账坏了」；而接口冒烟（脚本直连 API）
 * 永远测不到它 —— 因为脚本自己生成键，根本不走页面这段代码。
 *
 * 规则：`acquireKey(` 之后若出现引号/模板串，直接判错（对象字面量或变量都放行）。
 */
function checkIdemKeyContract(files) {
  const bad = /acquireKey\s*\(\s*['"`]/;
  let hits = 0;
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    // 注释里出现示例代码不算（本项目已因「注释被当代码」踩过一次构造性误报）
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    code.split('\n').forEach((line, i) => {
      if (bad.test(line)) {
        fail(
          `${f}:${i + 1}: acquireKey() 传了字符串 —— 契约是 {scope, ownerKey, payload}（详见 utils/idempotency.js）`
        );
        hits++;
      }
    });
  }
  if (!hits) ok();
}

/**
 * 10. WXSS 注释完整性（2026-09-22 实测白屏事故）
 * ---------------------------------------------------------------------------
 * 头注释里写类名清单时出现了「星号紧邻斜杠」（如 `.banner` 后面直接跟闭合符），
 * 注释在中间被炸开 → 其后的中文注释文本被当成 CSS 代码 →
 * 微信 WXSS 编译器报 `unexpected character` → **整个小程序编译失败 → 模拟器白屏**。
 * 工程结构校验（当时 483 项）全部测不到它，因为这是「WXSS 编译器」这一层的错误。
 *
 * 规则：剥掉注释与字符串后，代码位上出现中日韩文字 / 全角标点 → 判错。
 * WXSS 里合法的中文只会出现在注释或字符串（content / font-family）里。
 */
function checkWxssCommentIntegrity(files) {
  let hits = 0;
  for (const f of files) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    let code = '';
    let i = 0;
    while (i < src.length) {
      if (src[i] === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end === -1) {
          fail(`${f}: 注释只有开头没有闭合（WXSS 编译必失败）`);
          hits++;
          i = src.length;
          continue;
        }
        i = end + 2;
        continue;
      }
      code += src[i];
      i++;
    }
    // 字符串里的中文（content / font-family）是合法的，先剥掉再判
    const noStr = code.replace(/"[^"\n]*"/g, '""').replace(/'[^'\n]*'/g, "''");
    const badLine = noStr.split('\n').findIndex(l => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(l));
    if (badLine !== -1) {
      fail(
        `${f}:${badLine + 1}: 注释外出现中文 —— 极可能是注释里写了「星号紧邻斜杠」被提前闭合（同 2026-09-22 白屏事故形态）`
      );
      hits++;
    }
  }
  if (!hits) ok();
}

function walk(dir, out) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
console.log('小程序工程结构校验\n');

const appJson = checkJson('app.json');
checkJson('project.config.json');
checkJson('sitemap.json');

if (!appJson) {
  console.error('app.json 不可用，终止');
  process.exit(1);
}

// 2. 页面三件套
const pages = appJson.pages || [];
console.log(`app.json 声明页面 ${pages.length} 个`);
for (const page of pages) {
  const base = page;
  const hasJs = fs.existsSync(path.join(ROOT, base + '.js'));
  const hasJson = fs.existsSync(path.join(ROOT, base + '.json'));
  const hasWxml = fs.existsSync(path.join(ROOT, base + '.wxml'));
  const hasWxss = fs.existsSync(path.join(ROOT, base + '.wxss'));
  if (hasJs && hasJson && hasWxml) ok();
  else {
    fail(`页面 ${page} 文件不全：js=${hasJs} json=${hasJson} wxml=${hasWxml}（wxss=${hasWxss}）`);
  }
  if (hasJson) checkJson(base + '.json');
  if (hasJs) checkJsSyntax(base + '.js');
  if (hasWxml) checkWxml(base + '.wxml', base + '.js');
}

// 3. tabBar 与 pages 一致性
const tabBar = appJson.tabBar || {};
if (tabBar.custom) {
  const compFiles = ['index.js', 'index.json', 'index.wxml', 'index.wxss'];
  const missing = compFiles.filter(f => !fs.existsSync(path.join(ROOT, 'custom-tab-bar', f)));
  if (missing.length) fail(`custom tabBar 缺少文件：${missing.join(', ')}`);
  else ok();
  checkJsSyntax('custom-tab-bar/index.js');
  checkJson('custom-tab-bar/index.json');
  checkWxml('custom-tab-bar/index.wxml', 'custom-tab-bar/index.js');
}
for (const item of tabBar.list || []) {
  if (pages.includes(item.pagePath)) ok();
  else fail(`tabBar.list 的 ${item.pagePath} 不在 pages 中 —— wx.switchTab 会失败`);
}

// 7. 根级 JS 语法 + 8. 密钥红线
checkJsSyntax('app.js');
checkNoSecrets(['app.js', 'config/index.js', 'utils/request.js', 'project.config.json']);

// 非页面 JS（utils）也过一遍语法
const all = walk('.', []).filter(f => f.endsWith('.js') && !f.startsWith('scripts/'));
for (const f of all) {
  if (!pages.some(p => f === p + '.js') && f !== 'app.js' && f !== 'custom-tab-bar/index.js') {
    checkJsSyntax(f);
  }
}

// 9. 幂等键契约（页面也一起查 —— 误用恰恰都发生在页面里）
checkIdemKeyContract(all);

// 10. WXSS 注释完整性（注释被提前闭合 → 编译失败 → 白屏）
checkWxssCommentIntegrity(walk('.', []).filter(f => f.endsWith('.wxss')));

// config 常量导出检查（页面大量依赖，漏导出会运行时报 undefined）
try {
  const cfg = require(path.join(ROOT, 'config', 'index.js'));
  const need = [
    'API_ORIGIN',
    'API_PREFIX',
    'ROLES',
    'ROLE_LABEL',
    'FULFILLMENT',
    'ORDER_SCENE',
    'STATUS_FILTERS_SALESMAN',
    'STATUS_FILTERS_STATION',
    'STORAGE_KEYS',
    'REQUEST_TIMEOUT'
  ];
  const miss = need.filter(k => cfg[k] === undefined);
  if (miss.length) fail(`config/index.js 缺少导出：${miss.join(', ')}`);
  else ok();
  if (/^(https:\/\/)/.test(cfg.API_ORIGIN)) ok();
  else warn(`API_ORIGIN = ${cfg.API_ORIGIN}（本地调试用 http，正式发布前须改为已备案的 https 域名）`);
} catch (e) {
  fail(`config/index.js 无法加载：${e.message}`);
}

// ── 结果 ────────────────────────────────────────────────────────────────────
console.log(`\n通过检查项：${checks}`);
if (warnings.length) {
  console.log(`\n⚠️  警告 ${warnings.length} 条：`);
  warnings.forEach(w => console.log('   - ' + w));
}
if (errors.length) {
  console.log(`\n❌ 错误 ${errors.length} 条：`);
  errors.forEach(e => console.log('   - ' + e));
  process.exit(1);
}
console.log('\n✅ 结构校验通过');

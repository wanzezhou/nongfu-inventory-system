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

  // WXML 标签闭合粗检：统计成对标签的开闭数量（自闭合与单标签排除）
  const selfClose = new Set(['input', 'image', 'icon', 'progress', 'slider', 'switch', 'textarea']);
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  const stack = [];
  let t;
  while ((t = tagRe.exec(wxml)) !== null) {
    const closing = t[1] === '/';
    const name = t[2];
    const selfClosed = t[4] === '/';
    if (selfClose.has(name) && !closing) continue;
    if (selfClosed) continue;
    if (closing) {
      if (!stack.length || stack[stack.length - 1] !== name) {
        warn(`${pagePath}: 标签闭合可疑 —— 遇到 </${name}>，栈顶为 ${stack[stack.length - 1] || '(空)'}`);
        break;
      }
      stack.pop();
    } else {
      stack.push(name);
    }
  }
  if (stack.length) {
    warn(`${pagePath}: 存在未闭合标签 ${stack.join(', ')}`);
  } else {
    ok();
  }
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

#!/usr/bin/env node
/**
 * 小程序 → 后端 接口路径交叉校验
 * ===========================================================================
 * 为什么需要它：小程序里写错一个路径段（例如 /wallet/transaction 少了 s），
 * 微信开发者工具不会报错，直到用户点下去才发现「接口不存在」。
 * 本脚本把「小程序实际引用的路径」与「后端路由表注册的路径」做静态比对，
 * 在提交前就把这类笔误挡掉。
 *
 * 顺带输出「后端已注册但小程序未调用」的清单 —— 便于确认
 * 是否有遗漏的页面功能（当前期望为空集，因为 miniRoutes 是按 §21 精简注册的）。
 *
 * 用法：node miniprogram/scripts/check-api-paths.js
 *   ⚠️ 需与 backend/ 处于同一仓库根目录下运行（脚本会去读 backend/src/routes/miniRoutes.js）
 */
const fs = require('fs');
const path = require('path');

const MP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MP_ROOT, '..');
const ROUTES_FILE = path.join(REPO_ROOT, 'backend', 'src', 'routes', 'miniRoutes.js');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── 1. 抽取小程序侧引用的路径 ────────────────────────────────────────────────
const calls = new Map(); // path -> 首个引用文件
const nonLiteral = []; // 无法被静态抽取的调用点（见 findNonLiteralCalls）
const jsFiles = walk(MP_ROOT).filter(f => f.endsWith('.js') && !f.includes(path.sep + 'scripts' + path.sep));

const TPL_VAR = /\$\{[^}]*\}/g;

/**
 * 去掉注释（**保留换行与字符偏移**，便于继续用偏移换算行号）
 * ---------------------------------------------------------------------------
 * 为什么必须去注释：本仓库的注释里大量出现「正确写法 / 反例」示例
 * （例如库存域就写了一段 `ui.request.get(isPurchase ? …)` 的反例说明），
 * 不去注释会让这些示例被当成真实调用 —— 而门禁的误报会训练人忽略告警。
 * ⚠️ `://` 不当作行注释起点（否则 `'https://…'` 会被截断，藏掉同一行后半段的调用）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/**
 * 盲区探测：调用点**第一个实参不是字符串字面量**的写法
 * ---------------------------------------------------------------------------
 * 上面的抽取全是正则，只能认「紧跟在 `(` 后的字符串字面量」。于是下面这类写法
 * **一条都抽不到**，而它们看起来完全正常：
 *
 *     ui.request.get(isPurchase ? '/admin/purchases' : '/admin/stock-out-records', q)
 *     ui.request.get(path, q)            // path 是上面算出来的
 *     ui.request.get(`${base}/:id`, q)
 *
 * 实测代价：整个库存域的两个列表接口在门禁里消失，交叉校验反过来报
 * 「后端已注册但小程序未调用」—— 排查方向会被引到「是不是忘了写页面」。
 *
 * 处置：**不试图去正则解析表达式**（那会引入更隐蔽的误判），而是把这类调用点
 * 原样列出来交给人工确认。约定（定式 ⑭）是「接口路径必须写成字面量」，
 * 所以这里出现条目本身就是待修项 —— 但**不阻断**提交（存量代码可能已若干处）。
 *
 * ⚠️ 两类**已被其它规则覆盖**的写法要排除，否则本清单会长期挂着固定几条噪声，
 *    而「长期存在的告警」等于没有告警：
 *      ① 配置驱动页面的 `domain.routes.list` 等 —— 路径在 config 里，已被
 *         `list|detail|create|update|remove` 那条规则读到（主数据四域就是这种写法）；
 *      ② `upload(...)` —— 它的第一个参数是**本地文件路径**，接口地址在第二个参数的
 *         `url:` 字段里，已被 `url:` 那条规则读到（商品图片上传就是这种写法）。
 */
function findNonLiteralCalls(src) {
  const callRe = /\b(?:request|req|ui\.request)\.(get|post|put|del|delete|upload)\(\s*([^\s)]*)/g;
  const out = [];
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const method = m[1];
    const arg = m[2];
    if (method === 'upload') continue; // 见上方 ②
    if (/\.routes\./.test(arg)) continue; // 见上方 ①（配置驱动的路径）
    // 首字符是引号 = 字面量，已被主规则抽取，不在此列
    if (arg === '' || /^['"`]/.test(arg)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({
      line,
      snippet: src
        .slice(m.index, m.index + 90)
        .split('\n')[0]
        .trim()
    });
  }
  return out;
}

for (const f of jsFiles) {
  // 先剥注释再抽取：注释里的示例路径/反例写法都不是真实调用
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(MP_ROOT, f);
  for (const hit of findNonLiteralCalls(src)) {
    nonLiteral.push({ file: rel, line: hit.line, snippet: hit.snippet });
  }
  // request.get('/x') / request.post('/x', ...) / req.get(
  const patterns = [
    // ⚠️ 方法名必须列全：早期只认 get/post，于是 put/del/upload 的调用**完全不被检查**。
    //    实测：主数据四域全部用 put/del，若只认 get/post 会一条都看不到。
    //
    // ⚠️ `(?!\s*\+)` 负向先行断言是**必须的**（2026-09-22 补）：紧跟 `+` 的字符串字面量
    //    是「拼接前缀」，不是一条独立调用 —— 它由下面第 5/6 条规则还原成 `/:id` 形态。
    //    没有它时同一个调用点会**同时**产出两条路径：`/admin/salary/payments`（前缀被去了尾斜杠）
    //    与 `/admin/salary/payments/:id`（正确还原）；前者在后端没有同长度路由 → 门禁报
    //    「后端未注册同名路由」，而**代码完全正确**。实测在工资域（payments / worker 两个动态段）
    //    一次踩出 2 条纯误报 —— 而误报会训练人忽略告警，等于让这条门禁失效。
    //    （历史上没暴露是因为账户域的拼接前缀 `/admin/accounts` 恰好也是真实存在的列表路由。）
    /\b(?:request|req|ui\.request)\.(?:get|post|put|del|delete|upload)\(\s*['"`]([^'"`]+)['"`](?!\s*\+)/g,
    /\burl:\s*['"`]([^'"`]+)['"`]/g,
    // 配置驱动的接口路径（如主数据四域共用一套页面，路径写在 config/masterData.js 的 routes 里）。
    // ⚠️ 不认这类写法会让**整个域**的接口在门禁里静默消失 —— 实测发生过，且因为后端侧
    //    同时用了模板字符串挂载（同样抽不到），交叉校验会显示「0 条未调用」的**假通过**。
    //    修法两侧一起：路径写成字面量 + 这里能读配置里的字面量。
    /\b(?:list|detail|create|update|remove|endpoint|apiPath)\s*:\s*['"`](\/[^'"`]+)['"`]/g,
    // 字符串拼接出动态段：`'/admin/orders/' + id + '/fulfillment'`。
    // ⚠️ 这是拼接写法里**可静态复原**的一种（字面量 + 表达式 + 字面量）：中段必然是
    //    一个动态 id，重构为 `/:id` 后即可与后端模板比对。实测订单域三条动态路由
    //    因这种写法被当成「未调用」。更复杂的表达式（三元/函数调用）仍走盲区清单。
    /\b(?:request|req|ui\.request)\.(?:get|post|put|del|delete)\(\s*['"`](\/[^'"`]+?)['"`]\s*\+\s*[^+]+?\+\s*['"`](\/[^'"`]+)['"`]/g,
    // 两段拼接（动态段在末尾）：`'/admin/orders/' + id` → `/admin/orders/:id`。
    // ⚠️ `+` 后面必须不是引号 —— 否则 `'​/x/' + '/y'` 这种纯字面量拼接会被误加 :id。
    // ⚠️ 三段拼接 `'/a/' + id + '/b'` 会**同时**命中本规则与本条 —— 判据不放在正则里
    //    （试过负向先行断言 `(?!\s*\+\s*['"`]\/)`：会被正则回溯绕过 —— 贪心捕获缩短一位
    //    就能让先行断言成立，于是照样多产出一条 `/a/:id`），改在下面的归一化里显式跳过。
    /\b(?:request|req|ui\.request)\.(?:get|post|put|del|delete)\(\s*['"`](\/[^'"`]+?)['"`]\s*\+\s*[^'"`\s)][^)]*?[,)]/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      // 拼接模式的重构：三段（前段 + expr + 尾段）→ 前段/:id/尾段；
      // 两段（前段以 / 结尾 + expr）→ 前段:id（动态段在末尾）。
      // ⚠️ 判断依据是匹配文本里含 `+`（纯字面量模式不会带 +），避免误伤普通路径。
      let raw;
      // ⚠️ 两条拼接规则都用 m[2] 承载不同的东西，必须靠**首字符**区分：
      //    · 三段拼接（第 5 条）：m[2] 是*尾段路径*（以 / 开头）→ 还原成 `/a/:id/b`
      //    · 两段拼接（第 6 条）：m[2] 是*中间表达式*（标识符，不以 / 开头）→ 还原成 `/a/:id`
      //    混用的后果实测过：把表达式当成尾段拼上去，产出 `/x/:idi` 这种谁也认不出的路径。
      if (m[2] !== undefined && m[2].startsWith('/')) {
        raw = m[1].endsWith('/') ? `${m[1]}:id${m[2]}` : `${m[1]}/:id${m[2]}`;
      } else if (m[0].includes('+') && m[1].endsWith('/')) {
        // ⚠️ 三段拼接（`'/a/' + id + '/b'`）也会命中本规则：那种情况上面第 5 条已经
        //    正确还原为 `/a/:id/b`，这里若再产出一条 `/a/:id`，后端没有同长度路由 →
        //    门禁报「后端未注册」而代码完全正确（2026-09-22 实测，第三种误报形态）。
        //    判据：匹配文本里出现了**另一个以 / 开头的路径段字面量**（`+ '/…'`）。
        //    尾段是查询串（`+ '?…'`）时不算 —— 那种情况只有本条能还原，必须保留。
        if (/\+ *['"`]\//.test(m[0])) continue;
        raw = `${m[1]}:id`;
      } else {
        raw = m[1];
      }
      // 只保留相对 API_PREFIX 的路径（以 / 开头）；绝对地址或外部链接跳过
      if (!raw.startsWith('/')) continue;
      raw = raw.replace(/\/+$/, ''); // 去尾斜杠：拼接前段常带尾 / ，与注册表比对的段数才一致
      // ⚠️ 排除页面路由：`wx.navigateTo({ url: '/pages/xxx' })` 里的 url 不是接口路径。
      //    不排除会产生纯误报，而门禁的误报会训练人忽略告警。
      if (raw.startsWith('/pages/') || raw.startsWith('/custom-tab-bar/')) continue;
      const normalized = raw.replace(TPL_VAR, '*').split('?')[0];
      if (!calls.has(normalized)) calls.set(normalized, rel);
    }
  }
}

// ── 2. 抽取后端注册的路由 ────────────────────────────────────────────────────
if (!fs.existsSync(ROUTES_FILE)) {
  console.error(`找不到后端路由文件：${ROUTES_FILE}`);
  process.exit(1);
}
const routeSrc = fs.readFileSync(ROUTES_FILE, 'utf8');
const registered = [];
const routeRe = /router\.(get|post|put|delete|patch)\(\s*'([^']+)'/g;
let rm;
while ((rm = routeRe.exec(routeSrc)) !== null) {
  registered.push({ method: rm[1].toUpperCase(), path: rm[2] });
}

// ── 3. 比对 ──────────────────────────────────────────────────────────────────
function matches(callPath, routePath) {
  const c = callPath.split('/').filter(Boolean);
  const r = routePath.split('/').filter(Boolean);
  if (c.length !== r.length) return false;
  for (let i = 0; i < r.length; i++) {
    if (r[i].startsWith(':')) continue; // 路由参数匹配任意段
    if (c[i] === '*') continue; // 小程序侧模板变量
    if (r[i] !== c[i]) return false;
  }
  return true;
}

console.log('小程序 ↔ 后端 接口路径交叉校验\n');
console.log(`小程序引用路径 ${calls.size} 条 · 后端注册路由 ${registered.length} 条\n`);

let bad = 0;
for (const [p, file] of [...calls.entries()].sort()) {
  const hit = registered.filter(r => matches(p, r.path));
  if (hit.length) {
    console.log(`  ✅ ${p.padEnd(36)} → ${hit.map(h => h.method + ' ' + h.path).join(', ')}`);
  } else {
    bad++;
    console.log(`  ❌ ${p.padEnd(36)} → 后端未注册同名路由（引用自 ${file}）`);
  }
}

const unused = registered.filter(r => ![...calls.keys()].some(c => matches(c, r.path)));
console.log(`\n后端已注册但小程序未调用 ${unused.length} 条：`);
if (unused.length) unused.forEach(r => console.log(`   - ${r.method} ${r.path}`));
else console.log('   （无）');

// ── 4. 盲区提示：抽不到的调用点 ──────────────────────────────────────────────
// ⚠️ 这一段的存在意义：上面的 ✅/未调用清单都可能**因为抽不到而失真**。
//    只要这里非空，上面两段结论就都不完整 —— 所以必须显式打印，不能静默跳过。
if (nonLiteral.length) {
  console.log(`\n⚠️  有 ${nonLiteral.length} 处调用点的路径**不是字面量**，本脚本抽不到：`);
  nonLiteral.forEach(n => console.log(`   - ${n.file}:${n.line}  ${n.snippet}`));
  console.log('   → 这些接口不会被计入上面的校验结果。请改为字面量写法（定式 ⑭）。');
} else {
  console.log('\n（无「非字面量调用点」—— 上面的清单是完整的）');
}

if (bad) {
  console.log(`\n❌ ${bad} 条路径在后端不存在，小程序点击后会报「接口不存在」`);
  process.exit(1);
}
console.log('\n✅ 全部路径均有对应后端路由');

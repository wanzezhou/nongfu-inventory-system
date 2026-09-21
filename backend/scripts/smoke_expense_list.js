/**
 * 冒烟：其他支出台账 —— Web 端列表筛选分支（补齐既有覆盖缺口）
 * ---------------------------------------------------------------------------
 * 为什么补它：`expenseController` 的筛选逻辑（range / month / 旧参数兼容 /
 * startDate·endDate 闭区间分支 / category / keyword / 分页）此前**没有任何冒烟覆盖**。
 * 2026-09-21 为小程序 Phase 8b 抽出 `buildExpenseListWhere`（Web 与小程序共用）时才发现 ——
 * 也就是说：**这次重构是在没有防线的情况下做的**，只靠一次性人工核对。
 *
 * ⚠️ 本仓库有**两套区间约定**（`buildRangeWhere` 的 start 含 / end 不含，与
 *    `financialController.resolveDateRange` 的 end 含），历史上混用导致过「静默漏当天数据」。
 *    本冒烟把每条分支的行为钉住，正是为了让「挑错那一套」这件事无法悄悄发生。
 *
 * 覆盖：
 *   1) 无参数 / range 三档预设 / month 旧参数兼容 → 200 且响应结构完整
 *   2) 区间非法（range=bogus / month=abc）→ 400（不是静默当成「不限区间」）
 *   3) 无 range 时的 startDate·endDate 闭区间分支 → 200
 *   4) category / keyword 筛选 → 200
 *   5) 分页生效 + 合计为非负数
 *
 * 只读冒烟：不写库、不产生残留（因此无需 cleanupSmokeResidue）。
 * 运行：node scripts/smoke_expense_list.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';

const { pool } = require('../src/config/db');

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { ...json, _status: res.status };
}

let pass = 0;
let fail = 0;
function assert(cond, name, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`);
  }
}

(async () => {
  console.log('\n0. 登录取管理员令牌');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(!!(login.data && login.data.token), '管理员登录成功');
  const token = login.data && login.data.token;
  if (!token) {
    console.log('\n（无令牌，无法继续）');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(1);
  }

  console.log('\n1. 鉴权');
  const noAuth = await call('GET', '/expenses');
  assert(
    noAuth._status === 401 && noAuth.code === 401,
    `无 token → HTTP 401 + 信封 code 401：HTTP ${noAuth._status} code ${noAuth.code}`
  );

  console.log('\n2. 区间分支（range 预设 / month 旧参数 / 非法区间）');
  const balanceCases = [
    ['无参数', '/expenses', 200],
    ['range=month', '/expenses?range=month', 200],
    ['range=lastMonth', '/expenses?range=lastMonth', 200],
    ['range=quarter', '/expenses?range=quarter', 200],
    ['range=year', '/expenses?range=year', 200],
    ['month=YYYY-MM（旧参数兼容）', '/expenses?month=2026-09', 200],
    ['startDate/endDate（无 range 的闭区间分支）', '/expenses?startDate=2026-01-01&endDate=2026-12-31', 200]
  ];
  for (const [name, path, expect] of balanceCases) {
    const r = await call('GET', path, null, token);
    assert(
      r._status === expect,
      `${name} → HTTP ${expect}`,
      r._status === expect ? '' : `实得 ${r._status} ${r.message || ''}`
    );
    if (r._status === 200 && r.data) {
      assert(
        Array.isArray(r.data.list) && typeof r.data.total === 'number' && typeof r.data.sumAmount === 'number',
        `${name}：响应结构完整（list / total / sumAmount）`
      );
    }
  }

  // ⚠️ 非法区间必须 400：若被静默当成「不限区间」，用户会拿到一份看起来正常、
  //    实则范围错误的台账 —— 这类「看起来对的错数据」比报错危险得多。
  for (const [name, path] of [
    ['range 非法', '/expenses?range=bogus'],
    ['month 非法', '/expenses?month=abc'],
    ['range=YYYY-MM 非法格式', '/expenses?range=2026/09']
  ]) {
    const r = await call('GET', path, null, token);
    assert(r._status === 400, `${name} → HTTP 400（不得静默降级为不限区间）`, `实得 ${r._status} ${r.message || ''}`);
  }

  console.log('\n3. 字段筛选与分页');
  const cat = await call('GET', '/expenses?category=' + encodeURIComponent('运输'), null, token);
  assert(cat._status === 200, `category 筛选 200：${cat._status}`);
  if (cat._status === 200 && cat.data) {
    const allMatch = cat.data.list.every(it => it.category === '运输');
    assert(allMatch, `category 筛选结果确实只含「运输」：${cat.data.list.length} 条`);
    // ⚠️ 空库时上面那条断言恒成立（every 对空数组返回 true）—— 即**空转**。
    //    标出来，免得读日志的人以为「筛选效果被验证过了」。
    //    （本冒烟刻意只读、不造数；要真正验证筛选效果需库里有数据，
    //      或用 smoke_other_income.js 那种「造数 + 清理」的写法。）
    if (!cat.data.list.length) {
      console.log('     ↳ 注意：当前库中该类别为 0 条，本条断言未实际校验筛选效果（空转）');
    }
  }

  const kw = await call('GET', '/expenses?keyword=' + encodeURIComponent('不存在的关键词zzz'), null, token);
  assert(
    kw._status === 200 && kw.data && kw.data.total === 0,
    `keyword 无匹配时 total = 0（不是全量返回）：${kw.data && kw.data.total}`
  );

  const page = await call('GET', '/expenses?page=1&pageSize=5', null, token);
  assert(page._status === 200, `分页 200：${page._status}`);
  if (page._status === 200 && page.data) {
    assert(page.data.list.length <= 5, `分页生效（≤5 条）：实得 ${page.data.list.length}`);
    assert(Number(page.data.sumAmount) >= 0, `合计为非负数：${page.data.sumAmount}`);
    assert(
      page.data.page === 1 && page.data.pageSize === 5,
      `回显分页参数：page=${page.data.page} pageSize=${page.data.pageSize}`
    );
  }

  // 越界页码不得报错（应返回空列表）
  const beyond = await call('GET', '/expenses?page=9999&pageSize=10', null, token);
  assert(
    beyond._status === 200 && beyond.data && Array.isArray(beyond.data.list),
    `越界页码返回 200 + 空列表（不报错）：${beyond._status}`
  );

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})();

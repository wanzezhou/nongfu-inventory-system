/**
 * 冒烟：小程序管理端写操作（文档 §5.3 / §43 Phase 8b，逐域追加）
 * ---------------------------------------------------------------------------
 * ⚠️ **本文件按业务域分节**，不按域拆成多个脚本：17 个域各起一个进程，
 *    `run_smokes.js` 的清单会失控，且每个域都要重复一遍登录/建账号/清理。
 *    分节保留「逐域验收」的能力（跑通即该域验收通过），又不会让脚本数量爆炸。
 *
 * 已覆盖的域：
 *   · 第 1 域 支出/费用 —— 第 3~8 节
 *   · 第 2 域 收入     —— 第 9 节
 *
 * 为什么需要它：Phase 8b 是「管理员在手机上改资金台账」，这类接口错的代价很实在 ——
 *   ① 没有幂等键 → 弱网连点两次「保存」就记两笔账，两笔都合法、账面看不出异常；
 *   ② 编辑时若先记账再撤销（顺序反了）→ 余额多出「旧值 + 新值」的差额且不报错；
 *   ③ 删除的方向**按域相反**：删支出是**回补**余额（钱没花出去），
 *      删收入是**扣回**余额（钱没进来）。抄反会变成「删一条收入反而多一笔钱」；
 *   ④ 权限若复用了 Web 的 requireAdmin → 小程序非管理员令牌能改公司账本。
 * 本冒烟把这四类逐条钉死，并顺带验证「审计落库」与「复用账务原语」两件事。
 *
 * 覆盖：
 *   1) 权限：无令牌 401 / 业务员令牌 403 / 管理员 200（读与写各自校验）
 *   2) 列表与表单选项：字段齐备、账户仅列启用、预置类别存在
 *   3) 支出新增：入参校验 4 条 + 幂等键必填 + 记账方向（余额 −amount、流水 tx_type=2）
 *      + 审计 CREATE_EXPENSE
 *   4) 幂等：同键重放 → 同一 ID、余额只动一次、流水只 1 条；同键不同参数 → 400
 *   5) 不选账户 → 只登记台账，**不动任何账户余额**、不产生流水
 *   6) 编辑：余额净变化 = 新值 − 旧值（不是叠加）+ 审计 UPDATE_EXPENSE
 *   7) 删除：余额回补到基线、流水被清除 + 审计 DELETE_EXPENSE
 *   8) 资金恒等式（本冒烟自建账户）：余额 = 期初 + 流水净额
 *   9) 收入域：**方向与支出相反**（新增余额 +amount、删除余额 −amount），
 *      其余同构验收（校验/幂等/审计/不选账户）
 *
 * ⚠️ 测试对象**全部自建**（冒烟账户 / SMKEXP·SMKINC 前缀台账），不碰任何真实账户与台账：
 *    资金类冒烟最忌讳拿真实账户试，余额一旦被改就会污染对账。
 *
 * 运行：node scripts/smoke_mini_admin.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';

const { pool } = require('../src/config/db');
const { signMiniToken } = require('../src/services/miniAccountService');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');

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
function section(t) {
  console.log(`\n${t}`);
}

const TS = Date.now().toString().slice(-8);
const PREFIX = 'SMKEXP' + TS;
// 收入域用独立前缀：两个域的清理互不影响，也不会因为一个域的前缀匹配到另一个域的数据
const PREFIX_INC = 'SMKINC' + TS;
const ACCOUNT_NAME = '冒烟账户' + TS;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const today = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function main() {
  let conn = await pool.getConnection();

  // ── 0. 自建测试数据：mini 账号（管理员 + 业务员）+ 一个专用资金账户 ──────────
  section('0. 准备冒烟数据（mini 管理员/业务员账号 + 专用资金账户）');

  const [users] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const adminTargetId = String(users[0].id);

  await conn.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, ?, 'admin', ?, '冒烟管理员', 1, NOW())`,
    [`smoke_admin_${TS}`, '13500000000', adminTargetId]
  );
  const [adRows] = await conn.query('SELECT id FROM mini_accounts WHERE openid = ?', [`smoke_admin_${TS}`]);
  const adminAccountId = adRows[0].id;

  await conn.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, ?, 'salesman', ?, '冒烟业务员', 1, NOW())`,
    [`smoke_salesman_${TS}`, '13911112222', 'smoke_worker_na']
  );
  const [smRows] = await conn.query('SELECT id FROM mini_accounts WHERE openid = ?', [`smoke_salesman_${TS}`]);
  const salesmanAccountId = smRows[0].id;

  const accountId = 'SMKACC' + TS;
  await conn.query(
    `INSERT INTO finance_accounts (account_id, account_name, account_type, initial_balance, current_balance, status, created_at, updated_at)
     VALUES (?, ?, 1, 1000, 1000, 1, NOW(), NOW())`,
    [accountId, ACCOUNT_NAME]
  );
  conn.release();
  conn = null;

  const adminToken = signMiniToken({ id: adminAccountId, role: 'admin', target_id: adminTargetId });
  const salesmanToken = signMiniToken({ id: salesmanAccountId, role: 'salesman', target_id: 'smoke_worker_na' });

  const balanceOf = async () => {
    const [r] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accountId]);
    return r.length ? Number(r[0].current_balance) : null;
  };
  const txRows = async () =>
    (
      await pool.query(
        "SELECT tx_id, tx_type, tx_category, amount, balance_before, balance_after, related_module, related_id, handler FROM finance_transactions WHERE related_module = 'other_expense' AND account_id = ?",
        [accountId]
      )
    )[0];
  const auditActions = async () =>
    (
      await pool.query(
        // ⚠️ 主键列名是 log_id（不是 id）—— 别照惯例猜
        'SELECT action FROM mini_audit_logs WHERE actor_id = ? ORDER BY log_id',
        [`mini:${adminAccountId}`]
      )
    )[0].map(r => r.action);
  // 收入流水（related_module = 'other_income'，与支出的 'other_expense' 是两个值，别混）
  const txRowsIncome = async () =>
    (
      await pool.query(
        "SELECT tx_id, tx_type, tx_category, amount, balance_before, balance_after, related_module, related_id, handler FROM finance_transactions WHERE related_module = 'other_income' AND account_id = ?",
        [accountId]
      )
    )[0];

  // ── 1. 权限（§22.4：小程序侧必须另设 requireMiniAdmin）──────────────────────
  section('1. 权限与令牌隔离');

  const noToken = await call('GET', '/mini/admin/expenses');
  assert(noToken._status === 401 || noToken.code === 401, `无令牌读支出台账被拒（401）：实得 ${noToken._status}`);

  const salesmanRead = await call('GET', '/mini/admin/expenses', null, salesmanToken);
  assert(
    salesmanRead._status === 403 || salesmanRead.code === 403,
    `业务员令牌读支出台账被拒（403，requireMiniAdmin）：实得 ${salesmanRead._status} ${salesmanRead.message || ''}`
  );
  // ⚠️ 同时断言**拒绝原因**是角色不足，而非「主体停用 / 账号不存在」等其它 403/401 ——
  //    否则这条断言可能在别的原因下也「通过」，把权限回归掩盖过去。
  assert(
    /管理员角色/.test(String(salesmanRead.message || '')),
    `拒绝原因确为「需要管理员角色」：${salesmanRead.message}`
  );

  const salesmanWrite = await call(
    'POST',
    '/mini/admin/expenses',
    {
      clientRequestId: `smk_${TS}_perm`,
      expenseName: PREFIX + '越权',
      amount: 1,
      expenseDate: today(),
      category: '其他'
    },
    salesmanToken
  );
  assert(
    salesmanWrite._status === 403 || salesmanWrite.code === 403,
    `业务员令牌**写**支出台账被拒（403）：实得 ${salesmanWrite._status}`
  );

  const adminRead = await call('GET', '/mini/admin/expenses', null, adminToken);
  assert(adminRead.code === 200, `管理员令牌读支出台账成功：${adminRead.code}`);
  assert(
    Array.isArray(adminRead.data.list) && adminRead.data.list.length === 0,
    `新建账户下台账为空（证明前面的越权请求确实没落库）：${adminRead.data.list.length} 条`
  );

  // ── 2. 表单选项 ────────────────────────────────────────────────────────────
  section('2. 表单选项（账户 + 类别）');

  const opts = await call('GET', '/mini/admin/expenses/options', null, adminToken);
  assert(opts.code === 200, `选项接口 200：${opts.code}`);
  assert(
    (opts.data.accounts || []).some(a => a.accountId === accountId),
    '可用账户列表包含自建账户'
  );
  assert(
    (opts.data.accounts || []).every(a => a.currentBalance !== undefined),
    '账户项带余额（供前端展示，非计算依据）'
  );
  assert(
    (opts.data.presetCategories || []).includes('运输'),
    `预置类别存在：${JSON.stringify(opts.data.presetCategories)}`
  );
  assert(Array.isArray(opts.data.customCategories), '自定义类别字段存在（可为空数组）');

  // ── 3. 新增：入参校验 + 记账方向 + 审计 ────────────────────────────────────
  section('3. 新增支出（校验 / 记账方向 / 审计）');

  const badCases = [
    [{ amount: 10, expenseDate: today(), category: '其他' }, '支出名称不能为空'],
    [{ expenseName: PREFIX + 'a', expenseDate: today(), category: '其他' }, '金额必须为大于 0 的数字'],
    [{ expenseName: PREFIX + 'a', amount: -5, expenseDate: today(), category: '其他' }, '金额必须为大于 0 的数字'],
    [
      { expenseName: PREFIX + 'a', amount: 10, expenseDate: '2026/09/20', category: '其他' },
      '支出日期格式应为 YYYY-MM-DD'
    ],
    [{ expenseName: PREFIX + 'a', amount: 10, expenseDate: today() }, '支出类别不能为空']
  ];
  for (const [body, expectMsg] of badCases) {
    const r = await call(
      'POST',
      '/mini/admin/expenses',
      Object.assign({ clientRequestId: `smk_${TS}_bad${Math.random().toString(36).slice(2, 7)}` }, body),
      adminToken
    );
    assert(
      r.code === 400 && String(r.message || '').includes(expectMsg.slice(0, 6)),
      `入参校验拒绝「${expectMsg}」（400）：实得 ${r.code} ${r.message || ''}`
    );
  }

  const noIdem = await call(
    'POST',
    '/mini/admin/expenses',
    {
      expenseName: PREFIX + '无幂等键',
      amount: 10,
      expenseDate: today(),
      category: '其他'
    },
    adminToken
  );
  assert(
    noIdem.code === 400 && /clientRequestId/.test(String(noIdem.message || '')),
    `缺幂等键被拒（400）且文案指向 clientRequestId：${noIdem.message}`
  );

  const balanceBefore = await balanceOf();
  const createKey = `smk_${TS}_create`;
  const createBody = {
    clientRequestId: createKey,
    expenseName: PREFIX + '运输费',
    amount: 100,
    expenseDate: today(),
    category: '运输',
    accountId,
    remark: '冒烟新增'
  };
  const created = await call('POST', '/mini/admin/expenses', createBody, adminToken);
  assert(
    created.code === 200 && created.data && created.data.expenseId,
    `带账户新增成功：${created.code} expenseId=${created.data && created.data.expenseId}`
  );

  const expenseId = created.data && created.data.expenseId;
  const balanceAfterCreate = await balanceOf();
  assert(
    near(balanceAfterCreate, balanceBefore - 100),
    `记账方向正确：余额 ${balanceBefore} − 100 = ${balanceBefore - 100}，实得 ${balanceAfterCreate}`
  );

  const tx1 = await txRows();
  assert(tx1.length === 1, `生成 1 条资金流水：实得 ${tx1.length}`);
  if (tx1.length) {
    const t = tx1[0];
    assert(Number(t.tx_type) === 2, `支出流水 tx_type = 2（支出方向）：${t.tx_type}`);
    assert(t.tx_category === '其他支出', `流水类别 = 其他支出：${t.tx_category}`);
    assert(near(t.amount, 100), `流水金额 = 100：${t.amount}`);
    assert(
      near(t.balance_before, balanceBefore) && near(t.balance_after, balanceBefore - 100),
      `流水前后余额正确：${t.balance_before} → ${t.balance_after}`
    );
    assert(/^mini:/.test(String(t.handler || '')), `流水 handler 记录小程序操作人：${t.handler}`);
  }

  const audit1 = await auditActions();
  assert(audit1.includes('CREATE_EXPENSE'), `审计落库 CREATE_EXPENSE：${audit1.join(',')}`);

  // ── 4. 幂等（§23.1）────────────────────────────────────────────────────────
  section('4. 幂等：重放合并、同键不同参数拒绝');

  const replay = await call('POST', '/mini/admin/expenses', createBody, adminToken);
  assert(
    replay.code === 200 && replay.data && replay.data.expenseId === expenseId,
    `同键重放返回**同一** expenseId：${replay.data && replay.data.expenseId}`
  );
  assert(replay.data && replay.data.replayed === true, '重放被标记 replayed = true');
  assert(
    near(await balanceOf(), balanceBefore - 100),
    `重放**没有**再扣一次：余额仍为 ${balanceBefore - 100}，实得 ${await balanceOf()}`
  );
  assert((await txRows()).length === 1, `重放后流水仍为 1 条：${(await txRows()).length}`);
  const [expenseCount] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_name = ?', [
    PREFIX + '运输费'
  ]);
  assert(Number(expenseCount[0].n) === 1, `重放后台账仍为 1 条：${expenseCount[0].n}`);

  const conflict = await call(
    'POST',
    '/mini/admin/expenses',
    Object.assign({}, createBody, { amount: 999 }),
    adminToken
  );
  assert(
    conflict.code === 400 && /不一致/.test(String(conflict.message || '')),
    `同键不同参数被拒（400）：${conflict.code} ${conflict.message}`
  );

  // ── 5. 不选账户 → 只登记台账，不动账 ──────────────────────────────────────
  section('5. 不选账户：只登记台账，不动账户余额');

  const balBeforeNoAcc = await balanceOf();
  const txBeforeNoAcc = (await txRows()).length;
  const noAcc = await call(
    'POST',
    '/mini/admin/expenses',
    {
      clientRequestId: `smk_${TS}_noacc`,
      expenseName: PREFIX + '未走账',
      amount: 77,
      expenseDate: today(),
      category: '其他'
    },
    adminToken
  );
  assert(noAcc.code === 200, `不带账户新增成功：${noAcc.code}`);
  assert(near(await balanceOf(), balBeforeNoAcc), `不带账户**不动余额**：${balBeforeNoAcc} → ${await balanceOf()}`);
  assert((await txRows()).length === txBeforeNoAcc, '不带账户**不产生流水**');

  // ── 6. 编辑：净变化（先撤销再重记）────────────────────────────────────────
  section('6. 编辑：余额净变化 = 新值 − 旧值（不是叠加）');

  const editRes = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update`,
      expenseName: PREFIX + '运输费（改）',
      amount: 250,
      expenseDate: today(),
      category: '运输',
      accountId,
      remark: '冒烟编辑'
    },
    adminToken
  );
  assert(editRes.code === 200, `编辑成功：${editRes.code} ${editRes.message || ''}`);
  assert(
    near(await balanceOf(), balanceBefore - 250),
    `编辑后余额 = ${balanceBefore} − 250 = ${balanceBefore - 250}（**净变化**而非叠加），实得 ${await balanceOf()}`
  );
  const tx2 = await txRows();
  assert(tx2.length === 1, `编辑后流水仍为 1 条（撤销旧的 + 记新的）：实得 ${tx2.length}`);
  if (tx2.length) assert(near(tx2[0].amount, 250), `流水金额已更新为 250：${tx2[0].amount}`);
  const audit2 = await auditActions();
  assert(audit2.includes('UPDATE_EXPENSE'), `审计落库 UPDATE_EXPENSE：${audit2.join(',')}`);

  // 编辑成「不带账户」→ 余额应完全回退
  const editDrop = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update2`,
      expenseName: PREFIX + '运输费（去掉账户）',
      amount: 250,
      expenseDate: today(),
      category: '运输'
    },
    adminToken
  );
  assert(editDrop.code === 200, `编辑去掉账户成功：${editDrop.code}`);
  assert(
    near(await balanceOf(), balanceBefore),
    `去掉账户后余额回退到基线 ${balanceBefore}：实得 ${await balanceOf()}`
  );
  assert((await txRows()).length === 0, '去掉账户后该记录的流水被清除');

  // 再挂回账户，便于验证删除回补
  const editBack = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update3`,
      expenseName: PREFIX + '运输费（挂回）',
      amount: 250,
      expenseDate: today(),
      category: '运输',
      accountId
    },
    adminToken
  );
  assert(
    editBack.code === 200 && near(await balanceOf(), balanceBefore - 250),
    `挂回账户后余额回到 ${balanceBefore - 250}：实得 ${await balanceOf()}`
  );

  // ── 7. 删除：回补余额 + 清流水 + 审计 ─────────────────────────────────────
  section('7. 删除：回补账户余额（钱没花出去）');

  const delRes = await call(
    'DELETE',
    `/mini/admin/expenses/${expenseId}?clientRequestId=smk_${TS}_del`,
    null,
    adminToken
  );
  assert(delRes.code === 200, `删除成功：${delRes.code} ${delRes.message || ''}`);
  assert(near(await balanceOf(), balanceBefore), `删除**回补**余额到基线 ${balanceBefore}：实得 ${await balanceOf()}`);
  assert((await txRows()).length === 0, '删除后关联流水被清除');
  const [gone] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_id = ?', [expenseId]);
  assert(Number(gone[0].n) === 0, '台账记录已删除');
  const audit3 = await auditActions();
  assert(audit3.includes('DELETE_EXPENSE'), `审计落库 DELETE_EXPENSE：${audit3.join(',')}`);

  // 删除幂等：同键重放返回成功（不因「记录已不存在」而误报失败）
  const delReplay = await call(
    'DELETE',
    `/mini/admin/expenses/${expenseId}?clientRequestId=smk_${TS}_del`,
    null,
    adminToken
  );
  assert(
    delReplay.code === 200 && delReplay.data && delReplay.data.replayed === true,
    `删除同键重放返回成功且标记 replayed（避免网络重试被误报为失败）：${delReplay.code}`
  );
  assert(near(await balanceOf(), balanceBefore), `删除重放**没有**二次回补：实得 ${await balanceOf()}`);

  // ═════════════════ 9. 收入域（Phase 8b 第 2 域）═════════════════════════════
  section('9. 收入域：方向与支出相反（入账 + / 删除扣回 −）');

  // 9.1 列表字段齐备
  const incList = await call('GET', '/mini/admin/incomes', null, adminToken);
  assert(incList.code === 200, `收入台账列表 200：${incList.code}`);
  assert(
    incList.data && Array.isArray(incList.data.list) && typeof incList.data.sumAmount === 'number',
    '收入列表返回 { list, total, sumAmount, page, pageSize }',
    JSON.stringify(incList.data).slice(0, 200)
  );

  // 9.2 表单选项：预置类别非空 + 账户下拉含自建账户（仅启用账户）
  const incOpts = await call('GET', '/mini/admin/incomes/options', null, adminToken);
  assert(incOpts.code === 200, `收入表单选项 200：${incOpts.code}`);
  assert(
    incOpts.data && Array.isArray(incOpts.data.presetCategories) && incOpts.data.presetCategories.length > 0,
    '收入预置类别非空（与 Web 端 PRESET_CATEGORIES 同源）'
  );
  assert(
    (incOpts.data.accounts || []).some(a => a.accountId === accountId),
    '收入表单账户下拉包含本冒烟自建账户'
  );

  // 9.3 明细不存在 → 404（编辑页直接输 id 进来时要有明确反馈）
  const incMiss = await call('GET', '/mini/admin/incomes/SMOKE_NOT_EXIST', null, adminToken);
  assert(incMiss.code === 404, `不存在的收入记录返回 404：${incMiss.code}`);

  // 9.4 ⚠️ 幂等键必填 —— 同时断言**拒绝文案指向 clientRequestId**。
  //     本仓库有真实教训：一条「缺幂等键被拒」的断言曾因构造请求用了非法前置参数，
  //     实际是被前一道校验拦下的（长期假通过）。只看 code=400 是不够的。
  const incNoIdem = await call(
    'POST',
    '/mini/admin/incomes',
    { incomeName: PREFIX_INC + '缺键', amount: 10, incomeDate: today(), category: '废品回收' },
    adminToken
  );
  assert(incNoIdem.code === 400, `缺幂等键被拒（400）：${incNoIdem.code}`);
  assert(
    String(incNoIdem.message || '').includes('clientRequestId'),
    `缺幂等键的拒绝文案指向 clientRequestId：${incNoIdem.message}`
  );

  // 9.5 金额必须 > 0
  const incZero = await call(
    'POST',
    '/mini/admin/incomes',
    {
      clientRequestId: `${PREFIX_INC}_zero`,
      incomeName: PREFIX_INC + '零元',
      amount: 0,
      incomeDate: today(),
      category: '废品回收'
    },
    adminToken
  );
  assert(incZero.code === 400, `金额 0 被拒（400）：${incZero.code}`);

  // 9.6 账户不存在 → 400（文案含「账户」，证明是账务校验拦下的，而非别的字段）
  const incBadAcc = await call(
    'POST',
    '/mini/admin/incomes',
    {
      clientRequestId: `${PREFIX_INC}_badacc`,
      incomeName: PREFIX_INC + '坏账户',
      amount: 10,
      incomeDate: today(),
      category: '废品回收',
      accountId: 'SMOKE_NO_ACCOUNT'
    },
    adminToken
  );
  assert(incBadAcc.code === 400, `不存在的账户被拒（400）：${incBadAcc.code}`);
  assert(String(incBadAcc.message || '').includes('账户'), `拒绝文案说明是账户问题：${incBadAcc.message}`);

  // ── 9.7 新增：**余额 +amount**（与支出相反 —— 本域最关键的一条）──────────────
  const incAmount = 60;
  const balBeforeInc = await balanceOf();
  const incKey = `${PREFIX_INC}_create`;
  const incBody = {
    clientRequestId: incKey,
    incomeName: PREFIX_INC + '回收款',
    amount: incAmount,
    incomeDate: today(),
    category: '废品回收',
    accountId,
    remark: '冒烟收入'
  };
  const incCreate = await call('POST', '/mini/admin/incomes', incBody, adminToken);
  assert(incCreate.code === 200, `新增收入成功：${incCreate.code} ${incCreate.message || ''}`);
  const incomeId = incCreate.data && incCreate.data.incomeId;
  assert(!!incomeId, `返回 incomeId：${incomeId}`);
  assert(
    near(await balanceOf(), balBeforeInc + incAmount),
    `⚠️ 新增收入 → 账户余额【增加】${incAmount}（与支出相反）：${balBeforeInc} → ${await balanceOf()}`
  );

  const incTx = await txRowsIncome();
  assert(incTx.length === 1, `收入流水只 1 条：${incTx.length}`);
  if (incTx.length === 1) {
    assert(Number(incTx[0].tx_type) === 1, `收入流水 tx_type = 1（收入方向）：${incTx[0].tx_type}`);
    assert(near(incTx[0].amount, incAmount), `流水金额 = ${incAmount}：${incTx[0].amount}`);
    assert(
      near(incTx[0].balance_before, balBeforeInc) && near(incTx[0].balance_after, balBeforeInc + incAmount),
      `流水前后余额连续：${incTx[0].balance_before} → ${incTx[0].balance_after}`
    );
  }

  // 9.8 幂等重放：同键 → 同一 ID、余额不再变、流水不增
  const incReplay = await call('POST', '/mini/admin/incomes', incBody, adminToken);
  assert(
    incReplay.code === 200 && incReplay.data && incReplay.data.replayed === true,
    `同键重放被识别（replayed=true）：${incReplay.code} ${JSON.stringify(incReplay.data || {})}`
  );
  assert(near(await balanceOf(), balBeforeInc + incAmount), '重放**没有**二次入账');
  assert((await txRowsIncome()).length === 1, '重放没有多出流水');

  // 9.9 同键不同参数 → 400（客户端异常，不能被当成重放吞掉）
  const incConflict = await call(
    'POST',
    '/mini/admin/incomes',
    Object.assign({}, incBody, { amount: incAmount + 1 }),
    adminToken
  );
  assert(incConflict.code === 400, `同键不同参数被拒（400）：${incConflict.code}`);

  // 9.10 编辑：余额净变化 = 新值 − 旧值（不是叠加）
  const incNewAmount = 45;
  const incUpdate = await call(
    'PUT',
    `/mini/admin/incomes/${incomeId}`,
    {
      clientRequestId: `${PREFIX_INC}_update`,
      incomeName: PREFIX_INC + '回收款改',
      amount: incNewAmount,
      incomeDate: today(),
      category: '废品回收',
      accountId,
      remark: '冒烟收入改'
    },
    adminToken
  );
  assert(incUpdate.code === 200, `编辑收入成功：${incUpdate.code} ${incUpdate.message || ''}`);
  assert(
    near(await balanceOf(), balBeforeInc + incNewAmount),
    `⚠️ 编辑后余额 = 基线 + 新值 ${incNewAmount}（净变化，非叠加）：实得 ${await balanceOf()}`
  );
  const incTx2 = await txRowsIncome();
  assert(incTx2.length === 1, `编辑后收入流水仍 1 条（旧流水已撤销）：${incTx2.length}`);
  if (incTx2.length === 1) {
    assert(near(incTx2[0].amount, incNewAmount), `流水金额已更新为新值：${incTx2[0].amount}`);
  }

  // 9.11 删除：**余额 −amount**（扣回；与「删除支出回补」正好相反）
  const incDelKey = `${PREFIX_INC}_del`;
  const incDelete = await call(
    'DELETE',
    `/mini/admin/incomes/${incomeId}?clientRequestId=${encodeURIComponent(incDelKey)}`,
    null,
    adminToken
  );
  assert(incDelete.code === 200, `删除收入成功：${incDelete.code} ${incDelete.message || ''}`);
  assert(
    near(await balanceOf(), balBeforeInc),
    `⚠️ 删除收入 → 余额【扣回】到基线 ${balBeforeInc}（与删除支出相反）：实得 ${await balanceOf()}`
  );
  assert((await txRowsIncome()).length === 0, '删除收入后关联流水被清除');
  const [incGone] = await pool.query('SELECT COUNT(*) n FROM other_incomes WHERE income_id = ?', [incomeId]);
  assert(Number(incGone[0].n) === 0, '收入记录已删除');

  // 9.12 删除重放：不二次扣回（否则重试会让账户余额越删越少）
  const incDelReplay = await call(
    'DELETE',
    `/mini/admin/incomes/${incomeId}?clientRequestId=${encodeURIComponent(incDelKey)}`,
    null,
    adminToken
  );
  assert(
    incDelReplay.code === 200 && incDelReplay.data && incDelReplay.data.replayed === true,
    `删除同键重放返回成功且标记 replayed：${incDelReplay.code}`
  );
  assert(near(await balanceOf(), balBeforeInc), `删除重放**没有**二次扣回：实得 ${await balanceOf()}`);

  // 9.13 不选账户：只登记台账，不动余额、不产生流水
  const balBeforeIncNoAcc = await balanceOf();
  const incNoAcc = await call(
    'POST',
    '/mini/admin/incomes',
    {
      clientRequestId: `${PREFIX_INC}_noacc`,
      incomeName: PREFIX_INC + '不进账',
      amount: 33,
      incomeDate: today(),
      category: '废品回收'
    },
    adminToken
  );
  assert(incNoAcc.code === 200, `不选账户也能登记收入台账：${incNoAcc.code}`);
  assert(near(await balanceOf(), balBeforeIncNoAcc), '不选账户时余额不变（只登记台账）');

  // 9.14 审计：收入三动作落库（§40）
  const actionsAfter = await auditActions();
  ['CREATE_INCOME', 'UPDATE_INCOME', 'DELETE_INCOME'].forEach(a => assert(actionsAfter.includes(a), `审计含 ${a}`));

  // ── 10. 资金恒等式（针对本冒烟自建账户；此时已含**支出与收入两个域**的流水）──
  section('10. 资金恒等式（余额 = 期初 + 流水净额）');

  const [ident] = await pool.query(
    `SELECT a.initial_balance, a.current_balance,
            COALESCE(SUM(CASE WHEN t.tx_type = 1 THEN t.amount
                              WHEN t.tx_type = 2 THEN -t.amount
                              WHEN t.tx_type = 3 THEN -t.amount
                              WHEN t.tx_type = 4 THEN t.amount ELSE 0 END), 0) AS tx_net
       FROM finance_accounts a
       LEFT JOIN finance_transactions t ON t.account_id = a.account_id
      WHERE a.account_id = ?
      GROUP BY a.account_id`,
    [accountId]
  );
  assert(ident.length === 1, '自建账户存在');
  if (ident.length) {
    const expected = Number(ident[0].initial_balance) + Number(ident[0].tx_net);
    assert(
      near(ident[0].current_balance, expected),
      `恒等式成立：期初 ${ident[0].initial_balance} + 流水净额 ${ident[0].tx_net} = ${expected}，实得余额 ${ident[0].current_balance}`
    );
  }

  return { accountId, adminAccountId, salesmanAccountId };
}

const ctx = { accountId: null, adminAccountId: null, salesmanAccountId: null };

main()
  .then(r => Object.assign(ctx, r))
  .catch(e => {
    console.error('冒烟执行异常:', e);
    fail++;
  })
  .finally(async () => {
    // ── 清理：按冒烟标记删除，不碰任何真实数据 ────────────────────────────────
    try {
      const ids = (
        await pool.query('SELECT expense_id FROM other_expenses WHERE expense_name LIKE ?', [PREFIX + '%'])
      )[0].map(r => r.expense_id);
      for (const id of ids) {
        await pool.query("DELETE FROM finance_transactions WHERE related_module = 'other_expense' AND related_id = ?", [
          id
        ]);
      }
      await pool.query('DELETE FROM other_expenses WHERE expense_name LIKE ?', [PREFIX + '%']);
      // 收入域：同样先删流水再删台账（related_module 是另一个值）
      const incIds = (
        await pool.query('SELECT income_id FROM other_incomes WHERE income_name LIKE ?', [PREFIX_INC + '%'])
      )[0].map(r => r.income_id);
      for (const id of incIds) {
        await pool.query("DELETE FROM finance_transactions WHERE related_module = 'other_income' AND related_id = ?", [
          id
        ]);
      }
      await pool.query('DELETE FROM other_incomes WHERE income_name LIKE ?', [PREFIX_INC + '%']);
      if (ctx.accountId) {
        await pool.query('DELETE FROM finance_transactions WHERE account_id = ?', [ctx.accountId]);
        await pool.query('DELETE FROM finance_accounts WHERE account_id = ?', [ctx.accountId]);
      }
      const accIds = [ctx.adminAccountId, ctx.salesmanAccountId].filter(Boolean);
      if (accIds.length) {
        await pool.query('DELETE FROM mini_audit_logs WHERE actor_id IN (?)', [accIds.map(i => `mini:${i}`)]);
        await pool.query('DELETE FROM mini_idempotency WHERE mini_account_id IN (?)', [accIds]);
        await pool.query('DELETE FROM mini_accounts WHERE id IN (?)', [accIds]);
      }
      await cleanupSmokeResidue(pool, { log: console.log });
      const [left] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_name LIKE ?', [
        PREFIX + '%'
      ]);
      const [leftInc] = await pool.query('SELECT COUNT(*) n FROM other_incomes WHERE income_name LIKE ?', [
        PREFIX_INC + '%'
      ]);
      console.log(
        `\n清理：残留台账 支出 ${left[0].n} 行 / 收入 ${leftInc[0].n} 行` +
          `${Number(left[0].n) === 0 && Number(leftInc[0].n) === 0 ? ' ✓' : ' ✗'}`
      );
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

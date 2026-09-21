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
 *   · 第 3 域 商品     —— 第 11 节（第 10 节是资金恒等式）
 *   · 第 4~7 域 主数据（供应商/员工/水站/机台）—— 第 12~13 节
 *     四域由同一工厂构造，故用**一份数据驱动的用例**覆盖四处（逐域手写四遍
 *     只会让「某个域少测了一条」变得不可见）。第 13 节专门验证删除语义：
 *     无引用→物理删（hard）、有引用→停用（soft），并断言
 *     **停用没有触发 machine_sales 的 ON DELETE CASCADE**（否则历史销量会被静默删掉）。
 *   · 第 8 域 库存 —— 第 14 节。**资金类**域（入库=库存+进货记录+扣款+流水同事务；
 *     作废=回退库存+原路退回）。核心事务体从 Web 端 `inventoryController` 抽出后
 *     由两端共用（`applyStockIn/applyStockOut/applyPurchaseVoid`），Web 端的
 *     既有守护冒烟（入库账户扣款 41、出库台账 15、body 归一 26）是重构的保险。
 *   · 第 9 域 订单 —— 第 15 节。履约状态机（**全系统唯一推进入口**，此前下单后
 *     永远停在 PAID）+ 管理员取消（钱包单完整退款 / Web 现金单账务回冲，两条链都验）。
 *     测试订单用业务员令牌走真实下单链路产生（复用第 0 节的 mini 账号 + 新建 worker/钱包）。
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
 *  11) 商品域：⚠️ **业务员可售闸门**（§8.5 是「开关 ∧ 最低价」两个条件的与）——
 *      含「开启但缺最低价」「最低价高于零售价」两条硬校验、
 *      以及**跨端联动**（业务员端商品列表能否看到本商品，这是唯一能证明闸门真的联通的断言）；
 *      另有编码唯一（DB 唯一键不能漏成 500）、部分更新（不传即不动）、
 *      图片上传（multipart 真上传 + 落盘 + 静态可访问）
 *
 * ⚠️ 测试对象**全部自建**（冒烟账户 / SMKEXP·SMKINC 前缀台账），不碰任何真实账户与台账：
 *    资金类冒烟最忌讳拿真实账户试，余额一旦被改就会污染对账。
 *
 * 运行：node scripts/smoke_mini_admin.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');
const { signMiniToken } = require('../src/services/miniAccountService');
const walletService = require('../src/services/walletService');
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

/**
 * 订单域冒烟数据的清理（预清理与 finally 共用）。
 * 识别键：buyer_id 前缀（SMKWKORD%）+ Web 测试单号（SMKWEB%）。
 * ⚠️ 刻意**不通过 worker 表反查**：worker 先被删时（历史轮的清理顺序）订单会变成
 *    孤儿单（buyer_id 指向不存在的 worker），按 worker 反查永远找不到它们 ——
 *    而 buyer_id 本身就带着前缀，直接 LIKE 才是可靠的。
 * 顺序受外键/账务约束：营收流水与明细先删，再删订单；钱包按 owner 删。
 */
async function cleanupOrderSmokeData() {
  const webIds = (await pool.query("SELECT order_id FROM orders WHERE order_id LIKE 'SMKWEB%'"))[0].map(
    r => r.order_id
  );
  const miniIds = (await pool.query("SELECT order_id FROM orders WHERE buyer_id LIKE 'SMKWKORD%'"))[0].map(
    r => r.order_id
  );
  const orderIds = webIds.concat(miniIds);
  if (orderIds.length) {
    const ph = orderIds.map(() => '?').join(',');
    await pool.query(
      `DELETE FROM finance_transactions WHERE related_module = 'order' AND related_id IN (${ph})`,
      orderIds
    );
    await pool.query(`DELETE FROM order_items WHERE order_id IN (${ph})`, orderIds);
    await pool.query(`DELETE FROM orders WHERE order_id IN (${ph})`, orderIds);
  }
  // 业务员钱包（下单支付/取消退款都在这个钱包上）；同样按 owner_id 前缀找，不依赖 worker 存活
  const wallets = (
    await pool.query(
      "SELECT wallet_id FROM wallet_accounts WHERE owner_type = 'SALESMAN' AND owner_id LIKE 'SMKWKORD%'"
    )
  )[0].map(r => r.wallet_id);
  if (wallets.length) {
    const wph = wallets.map(() => '?').join(',');
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_id IN (${wph})`, wallets);
    await pool.query(`DELETE FROM wallet_accounts WHERE wallet_id IN (${wph})`, wallets);
  }
}

async function main() {
  // ── 启动前预清理：上一次若在清理阶段中断（外键、网络、断言抛错…），残留会让本轮以
  //    「Duplicate entry 'admin-1' for key 'mini_accounts.uk_role_active'」这种**看起来
  //    毫不相关**的错误开头，排查方向还容易被带偏到唯一键设计上去。
  //    ⚠️ 冒烟必须能自愈 —— 一次中断不该污染后续所有运行（实测踩到）。
  //    ⚠️ 顺序同样受外键约束：mini_audit_logs / mini_idempotency 引用 mini_accounts。
  await pool.query(
    "DELETE FROM mini_audit_logs WHERE actor_id IN (SELECT CONCAT('mini:', id) FROM mini_accounts WHERE openid LIKE ?)",
    ['smoke_%']
  );
  await pool.query(
    'DELETE FROM mini_idempotency WHERE mini_account_id IN (SELECT id FROM mini_accounts WHERE openid LIKE ?)',
    ['smoke_%']
  );
  await pool.query('DELETE FROM mini_accounts WHERE openid LIKE ?', ['smoke_%']);

  // ── 预清理（续）：跨轮残留的台账/商品/主数据 ────────────────────────────────
  // ⚠️ 收尾清理按「本轮 TS 前缀」过滤 —— 若某轮被 SIGTERM（finally 不执行），
  //    它的残留带着**那轮的 TS**，之后每一轮的清理都匹配不到它，永远留在库里。
  //    实测后果：第 1 节「新建账户下台账为空」断言读到历史轮的 5 条「未走账」台账，
  //    看起来像权限回归，其实是数据残留（排查方向极易被带偏）。
  //    所以预清理必须按**不带 TS 的域前缀**（SMKEXP/SMKINC/SMKPRD/…）扫全量。
  //    ⚠️ 顺序仍受外键约束：流水 → 台账；销量 → 商品；库存三表 → 商品。
  {
    const ids = async (sql, col) => (await pool.query(sql))[0].map(r => r[col]);
    const exIds = await ids("SELECT expense_id FROM other_expenses WHERE expense_name LIKE 'SMKEXP%'", 'expense_id');
    if (exIds.length) {
      await pool.query(
        "DELETE FROM finance_transactions WHERE related_module = 'other_expense' AND related_id IN (?)",
        [exIds]
      );
      await pool.query("DELETE FROM other_expenses WHERE expense_name LIKE 'SMKEXP%'");
    }
    const inIds = await ids("SELECT income_id FROM other_incomes WHERE income_name LIKE 'SMKINC%'", 'income_id');
    if (inIds.length) {
      await pool.query("DELETE FROM finance_transactions WHERE related_module = 'other_income' AND related_id IN (?)", [
        inIds
      ]);
      await pool.query("DELETE FROM other_incomes WHERE income_name LIKE 'SMKINC%'");
    }
    // ⚠️ 订单清理必须排在「库存三表 + SMKINV 商品」之前：order_items.product_id →
    //    products 是 ON DELETE RESTRICT，残留订单不先删，商品就删不掉（实测中断整轮清理）。
    await cleanupOrderSmokeData();
    await pool.query('DELETE FROM machine_sales WHERE sale_id LIKE ?', ['SMKSALE%']);
    const invPids = (await pool.query("SELECT product_id FROM products WHERE product_code LIKE 'SMKINV%'"))[0].map(
      r => r.product_id
    );
    if (invPids.length) {
      const ph = invPids.map(() => '?').join(',');
      await pool.query(
        `DELETE FROM finance_transactions WHERE related_module IN ('purchase', 'purchase_void')
           AND related_id IN (SELECT purchase_id FROM purchase_records WHERE product_id IN (${ph}))`,
        invPids
      );
      await pool.query(`DELETE FROM stock_out_records WHERE product_id IN (${ph})`, invPids);
      await pool.query(`DELETE FROM purchase_records WHERE product_id IN (${ph})`, invPids);
      await pool.query(`DELETE FROM inventory WHERE product_id IN (${ph})`, invPids);
    }
    for (const like of ['SMKINV%', 'SMKPRD%']) {
      await pool.query('DELETE FROM products WHERE product_code LIKE ?', [like]);
    }
    await pool.query('DELETE FROM machine_stations WHERE station_name LIKE ?', ['SMKM%']);
    await pool.query('DELETE FROM suppliers WHERE supplier_name LIKE ?', ['SMKSUP%']);
    await pool.query('DELETE FROM workers WHERE worker_name LIKE ?', ['SMKWK%']);
    await pool.query('DELETE FROM sub_stations WHERE station_name LIKE ?', ['SMKST%']);
    // 订单域（第 9 域）的跨轮残留：明细/营收流水 → 订单 → 业务员钱包
    await cleanupOrderSmokeData();
  }

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

  // ═════════════════ 11. 商品域（Phase 8b 第 3 域）═══════════════════════════
  section('11. 商品域：业务员可售闸门（§8.5 两条件的与）+ 编码唯一 + 图片上传 + 部分更新');

  const PCODE = 'SMKPRD' + TS;
  let uploadedImageName = '';

  // 11.1 列表与选项
  const prList = await call('GET', '/mini/admin/products', null, adminToken);
  assert(prList.code === 200, `商品列表 200：${prList.code}`);
  assert(
    prList.data && Array.isArray(prList.data.list) && typeof prList.data.total === 'number',
    '商品列表返回 { list, total, page, pageSize }',
    JSON.stringify(prList.data).slice(0, 200)
  );
  const prOpts = await call('GET', '/mini/admin/products/options', null, adminToken);
  assert(prOpts.code === 200 && Array.isArray(prOpts.data.categories), `商品类别选项 200：${prOpts.code}`);

  // 11.2 明细不存在 → 404
  const prMiss = await call('GET', '/mini/admin/products/SMOKE_NOT_EXIST', null, adminToken);
  assert(prMiss.code === 404, `不存在的商品返回 404：${prMiss.code}`);

  // 11.3 基础校验（每条都同时断言拒绝文案指向具体字段，避免"因别的原因 400 也算过"）
  const prNoCode = await call(
    'POST',
    '/mini/admin/products',
    { clientRequestId: PCODE + '_nocode', productName: '冒烟缺编码', retailPrice: 10 },
    adminToken
  );
  assert(prNoCode.code === 400 && /编码/.test(prNoCode.message || ''), `缺编码被拒且文案指向编码：${prNoCode.message}`);

  const prNoName = await call(
    'POST',
    '/mini/admin/products',
    { clientRequestId: PCODE + '_noname', productCode: PCODE + 'NN', retailPrice: 10 },
    adminToken
  );
  assert(prNoName.code === 400 && /名称/.test(prNoName.message || ''), `缺名称被拒且文案指向名称：${prNoName.message}`);

  const prNeg = await call(
    'POST',
    '/mini/admin/products',
    { clientRequestId: PCODE + '_neg', productCode: PCODE + 'NEG', productName: '冒烟负价', retailPrice: -1 },
    adminToken
  );
  assert(prNeg.code === 400 && /零售价/.test(prNeg.message || ''), `负数零售价被拒：${prNeg.message}`);

  // ── 11.4 ⚠️ 本域核心：业务员可售的两条硬校验 ─────────────────────────────
  // ① 开启开关但没给最低价 → 必须拒绝。
  //    放行它等于制造一个「界面显示已开启、业务员端却买不了」的静默失效开关。
  const prNoMin = await call(
    'POST',
    '/mini/admin/products',
    {
      clientRequestId: PCODE + '_nomin',
      productCode: PCODE + 'NM',
      productName: '冒烟缺最低价',
      retailPrice: 20,
      salesmanMiniEnabled: 1
    },
    adminToken
  );
  assert(prNoMin.code === 400, `开启可否但未填最低价被拒（400）：${prNoMin.code}`);
  assert(/最低成交价/.test(prNoMin.message || ''), `拒绝文案说明是缺最低成交价（而不是别的字段）：${prNoMin.message}`);

  // ② 最低价 > 零售价 → 必须拒绝。
  //    业务员不手填成交价时会回退按零售价下单，这个组合下商品**永远卖不出去**，但界面看起来正常。
  const prOver = await call(
    'POST',
    '/mini/admin/products',
    {
      clientRequestId: PCODE + '_over',
      productCode: PCODE + 'OV',
      productName: '冒烟最低价高于零售价',
      retailPrice: 20,
      salesmanMiniEnabled: 1,
      salesmanMinPrice: 30
    },
    adminToken
  );
  assert(prOver.code === 400, `最低价高于零售价被拒（400）：${prOver.code}`);
  assert(/不能高于/.test(prOver.message || ''), `拒绝文案说明高于零售价：${prOver.message}`);

  // 11.5 新增成功（开启可售）
  const prCreateKey = PCODE + '_create';
  const PR_CREATE_BODY = {
    clientRequestId: prCreateKey,
    productCode: PCODE + 'OK',
    productName: PCODE + ' 冒烟商品',
    specification: '550ml*24瓶',
    unit: '箱',
    category: '冒烟类别',
    purchasePrice: 10,
    wholesalePrice: 15,
    retailPrice: 20,
    machinePrice: 18,
    salesmanMiniEnabled: 1,
    salesmanMinPrice: 18
  };
  const prCreate = await call('POST', '/mini/admin/products', PR_CREATE_BODY, adminToken);
  assert(prCreate.code === 200, `新增商品成功：${prCreate.code} ${prCreate.message || ''}`);
  const productId = prCreate.data && prCreate.data.productId;
  assert(!!productId, `返回 productId：${productId}`);

  const prDetail = await call('GET', `/mini/admin/products/${productId}`, null, adminToken);
  assert(prDetail.code === 200, `商品详情 200：${prDetail.code}`);
  assert(
    Number(prDetail.data.purchasePrice) === 10 && Number(prDetail.data.retailPrice) === 20,
    `详情价格落库正确（进 10 / 零 20）：${prDetail.data.purchasePrice} / ${prDetail.data.retailPrice}`
  );
  assert(
    Number(prDetail.data.salesmanMiniEnabled) === 1 && Number(prDetail.data.salesmanMinPrice) === 18,
    `可售配置落库正确（开关 1 / 最低 18）：${prDetail.data.salesmanMiniEnabled} / ${prDetail.data.salesmanMinPrice}`
  );
  assert(prDetail.data.salesmanReady === true, `派生字段 salesmanReady = true：${prDetail.data.salesmanReady}`);

  // 11.6 编码唯一（DB 有 uk_product_code；文案必须是可读的，不能是 500）
  const prDup = await call(
    'POST',
    '/mini/admin/products',
    { clientRequestId: PCODE + '_dup', productCode: PCODE + 'OK', productName: '冒烟重复编码', retailPrice: 5 },
    adminToken
  );
  assert(prDup.code === 400, `重复编码被拒（400，不是 500）：${prDup.code}`);
  assert(String(prDup.message || '').includes(PCODE + 'OK'), `重复编码文案带上具体编码：${prDup.message}`);

  // ── 11.7 ★ 闸门联动：业务员端到底能不能看到这个商品 ──────────────────────
  // 前面的断言只证明「管理员端写对了」，这条才证明**业务员端真的可用** ——
  // 否则可能出现「管理端显示已开启、业务员端列表里却没有」的整条链路断裂。
  const seeOn = await call('GET', '/mini/products?keyword=' + encodeURIComponent(PCODE + 'OK'), null, salesmanToken);
  assert(seeOn.code === 200, `业务员端商品列表 200：${seeOn.code}`);
  assert(
    (seeOn.data.list || []).some(p => p.productId === productId),
    `★ 开启且配价后，业务员端能看到该商品（闸门真的联通）：命中 ${(seeOn.data.list || []).length} 条`
  );

  // 11.8 关闭开关 → 业务员端立即看不到（闸门可关）
  const prOff = await call(
    'PUT',
    `/mini/admin/products/${productId}`,
    { clientRequestId: PCODE + '_off', salesmanMiniEnabled: 0 },
    adminToken
  );
  assert(prOff.code === 200, `关闭可售成功：${prOff.code} ${prOff.message || ''}`);
  const seeOff = await call('GET', '/mini/products?keyword=' + encodeURIComponent(PCODE + 'OK'), null, salesmanToken);
  assert(
    !(seeOff.data.list || []).some(p => p.productId === productId),
    '★ 关闭开关后业务员端立即看不到（无需重启服务）'
  );
  // 恢复开启，供后续断言继续用
  await call(
    'PUT',
    `/mini/admin/products/${productId}`,
    { clientRequestId: PCODE + '_on', salesmanMiniEnabled: 1 },
    adminToken
  );

  // ── 11.9 部分更新：只改名称，其余字段必须**原样不动** ─────────────────────
  // 「不传就不动」是后端刻意的语义。若被写成「不传即清空」，用户改个名字就会把
  // 最低价和图片一起清掉 —— 而界面（只显示名称变了）看不出任何异常。
  const prRename = await call(
    'PUT',
    `/mini/admin/products/${productId}`,
    { clientRequestId: PCODE + '_rename', productName: PCODE + ' 改名后' },
    adminToken
  );
  assert(prRename.code === 200, `只改名称成功：${prRename.code} ${prRename.message || ''}`);
  const afterRename = await call('GET', `/mini/admin/products/${productId}`, null, adminToken);
  assert(afterRename.data.productName === PCODE + ' 改名后', `名称已改：${afterRename.data.productName}`);
  assert(
    Number(afterRename.data.salesmanMinPrice) === 18,
    `未提交的最低价保持原值 18（不是被清空）：${afterRename.data.salesmanMinPrice}`
  );
  assert(
    Number(afterRename.data.salesmanMiniEnabled) === 1,
    `未提交的开关保持开启：${afterRename.data.salesmanMiniEnabled}`
  );
  assert(Number(afterRename.data.retailPrice) === 20, `未提交的零售价保持 20：${afterRename.data.retailPrice}`);
  assert(afterRename.data.salesmanReady === true, '改名后仍可售（派生字段未被误算）');

  // ── 11.10 编辑时必须按「合并后的值」校验（只改最低价也要撞上零售价上界）──
  const prBadMin = await call(
    'PUT',
    `/mini/admin/products/${productId}`,
    { clientRequestId: PCODE + '_badmin', salesmanMinPrice: 99 },
    adminToken
  );
  assert(prBadMin.code === 400, `只提交最低价 99（> 库中零售价 20）被拒（400）：${prBadMin.code}`);
  assert(
    /不能高于/.test(prBadMin.message || ''),
    `编辑时用的是「合并后的值」而非本次入参（否则这条会静默通过）：${prBadMin.message}`
  );
  // 合法改动：最低价 18 → 16
  const prMin = await call(
    'PUT',
    `/mini/admin/products/${productId}`,
    { clientRequestId: PCODE + '_min', salesmanMinPrice: 16 },
    adminToken
  );
  assert(prMin.code === 200, `合法降低最低价成功：${prMin.code} ${prMin.message || ''}`);

  // 11.11 幂等：重放合并 / 同键不同参数 400
  const prReplay = await call('POST', '/mini/admin/products', PR_CREATE_BODY, adminToken);
  assert(
    prReplay.code === 200 && prReplay.data && prReplay.data.replayed === true,
    `新增同键重放被识别（replayed=true）：${prReplay.code} ${JSON.stringify(prReplay.data || {})}`
  );
  const prConflict = await call(
    'POST',
    '/mini/admin/products',
    Object.assign({}, PR_CREATE_BODY, { productName: PCODE + ' 换了名字' }),
    adminToken
  );
  assert(prConflict.code === 400, `同键不同参数被拒（400）：${prConflict.code}`);
  const [prCount] = await pool.query('SELECT COUNT(*) n FROM products WHERE product_code LIKE ?', [PCODE + '%']);
  assert(Number(prCount[0].n) === 1, `重放没有多建商品（仍 1 条）：${prCount[0].n}`);

  // ── 11.12 图片上传（multipart）────────────────────────────────────────────
  // 用 1×1 PNG 真实走一遍上传：验证的是「小程序端能用、落盘路径对、静态可访问」三件事。
  // fetch + FormData 由 Node 内置提供（与小程序 wx.uploadFile 的请求形态一致）。
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  let uploadRes = null;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'smoke.png');
    const resp = await fetch(BASE + '/mini/admin/products/upload-image', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + adminToken },
      body: fd
    });
    uploadRes = { _status: resp.status, ...(await resp.json()) };
  } catch (e) {
    uploadRes = { _status: 0, message: e.message };
  }
  assert(
    uploadRes._status === 200 && uploadRes.code === 200,
    `图片上传成功：${uploadRes._status} ${uploadRes.message || ''}`
  );
  const imgPath = uploadRes.data && uploadRes.data.path;
  assert(
    typeof imgPath === 'string' && imgPath.startsWith('/product_images/'),
    `返回站内相对路径（库里不写域名）：${imgPath}`
  );
  if (typeof imgPath === 'string' && imgPath.startsWith('/product_images/')) {
    uploadedImageName = imgPath.replace('/product_images/', '');
    const abs = path.join(__dirname, '../../商品档案/商品图片', uploadedImageName);
    assert(fs.existsSync(abs), `图片已落盘：${abs}`);
    // 静态服务可直接访问（商品照片是公开资产）
    const staticResp = await fetch(BASE.replace('/api', '') + imgPath);
    assert(staticResp.status === 200, `静态路径可直接访问（HTTP 200）：${staticResp.status}`);

    // 把图片写进商品并回读，验证「上传 → 存路径 → 显示」的完整链路
    const setImg = await call(
      'PUT',
      `/mini/admin/products/${productId}`,
      { clientRequestId: PCODE + '_img', imageUrl: imgPath },
      adminToken
    );
    assert(setImg.code === 200, `把图片路径写入商品成功：${setImg.code}`);
    const withImg = await call('GET', `/mini/admin/products/${productId}`, null, adminToken);
    assert(withImg.data.imageUrl === imgPath, `详情能读回图片路径：${withImg.data.imageUrl}`);
  }

  // 11.13 停用（软删除）+ 幂等重放
  const prDisableKey = PCODE + '_disable';
  const prDisable = await call(
    'DELETE',
    `/mini/admin/products/${productId}?clientRequestId=${encodeURIComponent(prDisableKey)}`,
    null,
    adminToken
  );
  assert(prDisable.code === 200, `停用商品成功：${prDisable.code} ${prDisable.message || ''}`);
  const [prGone] = await pool.query('SELECT status FROM products WHERE product_id = ?', [productId]);
  assert(prGone.length === 1, '商品记录仍在（软删除，不物理删除 —— 历史订单要引用它）');
  assert(Number(prGone[0].status) === 0, `status 已置 0（停用）：${prGone[0].status}`);
  const prDisableReplay = await call(
    'DELETE',
    `/mini/admin/products/${productId}?clientRequestId=${encodeURIComponent(prDisableKey)}`,
    null,
    adminToken
  );
  assert(
    prDisableReplay.code === 200 && prDisableReplay.data && prDisableReplay.data.replayed === true,
    `停用同键重放标记 replayed：${prDisableReplay.code}`
  );
  // 停用后业务员端也看不到（闸门的第三档：状态过滤）
  const seeDisabled = await call(
    'GET',
    '/mini/products?keyword=' + encodeURIComponent(PCODE + 'OK'),
    null,
    salesmanToken
  );
  assert(!(seeDisabled.data.list || []).some(p => p.productId === productId), '★ 停用后业务员端看不到该商品');

  // 11.14 审计：商品四动作（含"改最低价额外记一条"）
  const prActions = await auditActions();
  ['CREATE_PRODUCT', 'UPDATE_PRODUCT', 'DISABLE_PRODUCT', 'SET_PRODUCT_MIN_PRICE'].forEach(a =>
    assert(prActions.includes(a), `审计含 ${a}`)
  );

  // ═════════════ 12. 主数据四域（Phase 8b 第 4~7 域）═════════════════════════
  // 四域由同一个工厂（`_masterFactory.js`）构造，故用一份数据驱动的用例覆盖四处 ——
  // 逐域手写四遍只会让「某个域少测了一条」变得不可见。
  section('12. 主数据四域：供应商 / 员工 / 水站 / 机台');

  const MASTER_CASES = [
    {
      key: 'suppliers',
      label: '供应商',
      nameField: 'supplierName',
      prefix: 'SMKSUP',
      extra: { contactName: '冒烟联系人', phone: '13900001111' }
    },
    {
      key: 'workers',
      label: '员工',
      nameField: 'workerName',
      prefix: 'SMKWK',
      extra: { employeeType: 3, phone: '13900002222' }
    },
    {
      key: 'stations',
      label: '水站',
      nameField: 'stationName',
      prefix: 'SMKST',
      extra: { contactName: '冒烟联系人', phone: '13900003333', area: '冒烟区' }
    },
    {
      key: 'machines',
      label: '机台',
      nameField: 'stationName',
      prefix: 'SMKM',
      extra: { machineType: 1, manager: '冒烟负责人' }
    }
  ];
  const masterCases = [];

  for (const c of MASTER_CASES) {
    const NAME = c.prefix + TS;
    const base = `/mini/admin/${c.key}`;

    // 列表 / 详情 404
    const lst = await call('GET', base, null, adminToken);
    assert(lst.code === 200 && Array.isArray(lst.data.list), `${c.label}：列表 200 且返回 list`);
    const miss = await call('GET', `${base}/SMOKE_NOT_EXIST`, null, adminToken);
    assert(miss.code === 404, `${c.label}：不存在返回 404（${miss.code}）`);

    // 必填校验（断言文案指向具体字段，防"因别的原因 400 也算过"）
    const noName = await call('POST', base, { clientRequestId: NAME + '_nn' }, adminToken);
    assert(noName.code === 400, `${c.label}：缺名称被拒（400）`);
    assert(/不能为空/.test(noName.message || ''), `${c.label}：拒绝文案说明是必填问题（${noName.message}）`);

    // 幂等键必填
    const noIdem = await call('POST', base, Object.assign({ [c.nameField]: NAME }, c.extra), adminToken);
    assert(noIdem.code === 400, `${c.label}：缺幂等键被拒（400）`);
    assert(
      String(noIdem.message || '').includes('clientRequestId'),
      `${c.label}：拒绝文案指向 clientRequestId（${noIdem.message}）`
    );

    // 新增
    const body = Object.assign({ clientRequestId: NAME + '_create', [c.nameField]: NAME }, c.extra);
    const created = await call('POST', base, body, adminToken);
    assert(created.code === 200, `${c.label}：新增成功（${created.code} ${created.message || ''}）`);
    const id = created.data && created.data.id;
    assert(!!id, `${c.label}：返回 id（${id}）`);

    // 详情回读
    const detail = await call('GET', `${base}/${id}`, null, adminToken);
    assert(detail.code === 200 && detail.data[c.nameField] === NAME, `${c.label}：详情回读名称一致`);

    // 幂等：重放 / 同键不同参数
    const replay = await call('POST', base, body, adminToken);
    assert(
      replay.code === 200 && replay.data && replay.data.replayed === true,
      `${c.label}：新增重放标记 replayed=true`
    );
    const conflict = await call('POST', base, Object.assign({}, body, { [c.nameField]: NAME + 'X' }), adminToken);
    assert(conflict.code === 400, `${c.label}：同键不同参数被拒（400）`);

    // 部分更新：只改名称，其余字段保持
    const upd = await call(
      'PUT',
      `${base}/${id}`,
      { clientRequestId: NAME + '_upd', [c.nameField]: NAME + '改' },
      adminToken
    );
    assert(upd.code === 200, `${c.label}：编辑成功（${upd.code}）`);
    const after = await call('GET', `${base}/${id}`, null, adminToken);
    assert(after.data[c.nameField] === NAME + '改', `${c.label}：名称已改为新值`);
    if (c.extra.phone) {
      assert(
        after.data.phone === c.extra.phone,
        `${c.label}：未提交的 phone 保持原值（部分更新语义）→ ${after.data.phone}`
      );
    }
    assert(Number(after.data.status) === 1, `${c.label}：未提交 status 时保持启用`);

    // 枚举校验（一域一条，验证 enum 白名单不是摆设）
    if (c.key === 'workers') {
      const badEnum = await call(
        'PUT',
        `${base}/${id}`,
        { clientRequestId: NAME + '_enum', employeeType: 9 },
        adminToken
      );
      assert(badEnum.code === 400, `员工：非法员工类型被拒（400，实际 ${badEnum.code}）`);
      assert(/取值不合法|员工类型/.test(badEnum.message || ''), `员工：拒绝文案指向类型取值（${badEnum.message}）`);
    }
    if (c.key === 'machines') {
      const badEnum = await call(
        'POST',
        base,
        { clientRequestId: NAME + '_enum2', [c.nameField]: NAME + 'E', machineType: 7 },
        adminToken
      );
      assert(badEnum.code === 400, `机台：非法机台类型被拒（400，实际 ${badEnum.code}）`);
    }

    masterCases.push({ ...c, id, name: NAME + '改' });
  }

  // ═════════════ 13. 删除语义：无引用物理删 / 有引用转停用 ════════════════════
  section('13. 删除语义：无引用→物理删（hard），有引用→停用（soft）+ CASCADE 保护');

  for (const c of masterCases) {
    const base = `/mini/admin/${c.key}`;
    const delKey = c.prefix + TS + '_del';
    const del = await call('DELETE', `${base}/${c.id}?clientRequestId=${encodeURIComponent(delKey)}`, null, adminToken);
    assert(del.code === 200, `${c.label}：删除成功（${del.code} ${del.message || ''}）`);
    assert(
      del.data && del.data.mode === 'hard',
      `${c.label}：本冒烟新建的实体无引用 → 应物理删除（mode=hard，实际 ${del.data && del.data.mode}）`
    );
    const gone = await call('GET', `${base}/${c.id}`, null, adminToken);
    assert(gone.code === 404, `${c.label}：物理删除后详情 404（真的没了）`);
    // 删除重放（弱网重试不该报错，也不该二次动作）
    const delReplay = await call(
      'DELETE',
      `${base}/${c.id}?clientRequestId=${encodeURIComponent(delKey)}`,
      null,
      adminToken
    );
    assert(
      delReplay.code === 200 && delReplay.data && delReplay.data.replayed === true,
      `${c.label}：删除重放标记 replayed=true`
    );
  }

  // ── 机台：造一条销量记录，验证「有引用 → 停用」且**销量不被级联删除**──────────
  const machineCase = MASTER_CASES.find(c => c.key === 'machines');
  const MNAME = machineCase.prefix + TS + 'REF';
  const mCreated = await call(
    'POST',
    '/mini/admin/machines',
    Object.assign({ clientRequestId: MNAME + '_create', [machineCase.nameField]: MNAME }, machineCase.extra),
    adminToken
  );
  assert(mCreated.code === 200, `机台（有引用用例）：新增成功（${mCreated.code}）`);
  const refMachineId = mCreated.data && mCreated.data.id;

  // 直接插一条销量记录制造引用（走接口的话要跑完整的销量入账链路，过重）
  const [anyProduct] = await pool.query('SELECT product_id FROM products LIMIT 1');
  const saleId = 'SMKSALE' + TS;
  let saleInserted = false;
  if (anyProduct.length) {
    await pool.query(
      `INSERT INTO machine_sales (sale_id, machine_id, machine_type, product_id, quantity, sale_price, sale_date, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, '冒烟销量', 'smoke', NOW(), NOW())`,
      [saleId, refMachineId, 1, anyProduct[0].product_id, today()]
    );
    saleInserted = true;
  }
  assert(saleInserted, '机台（有引用用例）：已插入一条销量记录作为引用');

  const delSoft = await call(
    'DELETE',
    `/mini/admin/machines/${refMachineId}?clientRequestId=${encodeURIComponent(MNAME + '_del')}`,
    null,
    adminToken
  );
  assert(delSoft.code === 200, `机台（有引用用例）：删除请求返回 200（${delSoft.code}）`);
  assert(
    delSoft.data && delSoft.data.mode === 'soft',
    `⚠️ 有引用 → 必须转停用而不是真删（mode=soft，实际 ${delSoft.data && delSoft.data.mode}）`
  );
  assert(
    Array.isArray(delSoft.data.references) && delSoft.data.references.length > 0,
    `返回里带上引用清单（便于管理员知道为什么没删掉）：${JSON.stringify(delSoft.data.references)}`
  );
  assert(
    Array.isArray(delSoft.data.references) && delSoft.data.references.some(r => /销量/.test(r.label || '')),
    '引用清单里含「销量记录」（与 Web 端同一判据）'
  );

  // ★ 关键：转停用**没有**触发 machine_sales 的 ON DELETE CASCADE
  const [saleStill] = await pool.query('SELECT COUNT(*) n FROM machine_sales WHERE sale_id = ?', [saleId]);
  assert(
    Number(saleStill[0].n) === 1,
    '★ 停用机台后，销量记录**仍在**（若误走物理删除，CASCADE 会把历史销量一起删掉）'
  );
  const [machineAfter] = await pool.query('SELECT status FROM machine_stations WHERE machine_id = ?', [refMachineId]);
  assert(machineAfter.length === 1 && Number(machineAfter[0].status) === 0, '机台记录保留且 status 已置 0（停用）');

  // 审计：四域的增/改/删动作都要落库
  const masterActions = await auditActions();
  for (const a of [
    'CREATE_SUPPLIER',
    'UPDATE_SUPPLIER',
    'DISABLE_SUPPLIER',
    'CREATE_WORKER',
    'UPDATE_WORKER',
    'DISABLE_WORKER',
    'CREATE_STATION',
    'UPDATE_STATION',
    'DISABLE_STATION',
    'CREATE_MACHINE',
    'UPDATE_MACHINE',
    'DISABLE_MACHINE'
  ]) {
    assert(masterActions.includes(a), `审计含 ${a}`);
  }

  // ═════════════ 14. 库存域（Phase 8b 第 8 域）═══════════════════════════════
  // ⚠️ 这是**资金类**域：入库 = 库存+ + 进货记录 + 账户扣款 + 流水（同事务）；
  //    作废 = 回退库存 + 原路退回（方向不能抄反）。第 14.7 步把「入库→作废」整链
  //    走一遍并断言余额回到基线，是本节最值钱的一条断言。
  section('14. 库存域：入库三联事务 / 作废原路退回 / 出库不动资金 / 整数数量');

  // ── 14.1 权限：业务员令牌一律 403（读与写都试）────────────────────────────
  const invDenied = await call('GET', '/mini/admin/inventory', null, salesmanToken);
  assert(
    invDenied.code === 403 && /需要管理员角色/.test(String(invDenied.message)),
    `14.1 业务员读库存被拒 403 且文案指向角色（实得 ${invDenied.code} ${invDenied.message || ''}）`
  );
  const invWriteDenied = await call('POST', '/mini/admin/inventory/in', { clientRequestId: 'x' }, salesmanToken);
  assert(invWriteDenied.code === 403, `14.1 业务员写入库被拒 403（实得 ${invWriteDenied.code}）`);

  // ── 14.2 自建测试商品（SMKINV 前缀，清理独立）──────────────────────────────
  const invCode = 'SMKINV' + TS;
  const invCreate = await call(
    'POST',
    '/mini/admin/products',
    {
      clientRequestId: invCode + '_create',
      productCode: invCode,
      productName: '冒烟库存测试商品',
      category: '冒烟',
      unit: '箱',
      retailPrice: 10,
      purchasePrice: 2.5
    },
    adminToken
  );
  assert(invCreate.code === 200, `14.2 测试商品创建成功（${invCreate.code} ${invCreate.message || ''}）`);
  const invPid = invCreate.data && invCreate.data.productId;
  assert(!!invPid, '14.2 返回 productId');

  // ── 14.3 列表 / 详情 / 表单选项 ───────────────────────────────────────────
  const invList = await call(
    'GET',
    '/mini/admin/inventory?keyword=' + encodeURIComponent('冒烟库存测试'),
    null,
    adminToken
  );
  assert(invList.code === 200, `14.3 库存列表 200（${invList.code}）`);
  const invSelf = (invList.data.list || []).find(r => String(r.id) === String(invPid));
  assert(!!invSelf, '14.3 列表能按关键词找到测试商品（formatInventory 的主键字段是 id）');
  if (invSelf) {
    assert(Number(invSelf.stock) === 0, `14.3 新商品库存为 0（实际 ${invSelf.stock}）`);
  }
  const invOptions = await call('GET', '/mini/admin/inventory/options', null, adminToken);
  assert(invOptions.code === 200, `14.3 表单选项 200（${invOptions.code}）`);
  if (invOptions.code === 200) {
    assert(
      (invOptions.data.products || []).some(p => String(p.productId) === String(invPid)),
      '14.3 商品下拉含测试商品（分页拉下拉会静默缺项，故用全量接口）'
    );
    assert(
      (invOptions.data.accounts || []).some(a => String(a.accountId) === String(accountId)),
      '14.3 账户下拉含冒烟账户且只含启用账户'
    );
  }

  // ── 14.4 入库校验（每条断言拒绝文案指向具体字段）────────────────────────────
  const invNoIdem = await call('POST', '/mini/admin/inventory/in', { productId: invPid, quantity: 1 }, adminToken);
  assert(
    invNoIdem.code === 400 && /clientRequestId/.test(String(invNoIdem.message)),
    `14.4 缺幂等键被拒且文案指向幂等键（${invNoIdem.code} ${invNoIdem.message || ''}）`
  );
  const invZero = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: invCode + '_z', productId: invPid, quantity: 0 },
    adminToken
  );
  assert(invZero.code === 400 && /正数/.test(String(invZero.message)), `14.4 数量 0 被拒（${invZero.message}）`);
  const invFrac = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: invCode + '_f', productId: invPid, quantity: 1.5 },
    adminToken
  );
  assert(
    invFrac.code === 400 && /整数/.test(String(invFrac.message)),
    `14.4 非整数数量被拒（INT 列会静默四舍五入，必须显式拦）：${invFrac.message}`
  );
  const invNoProd = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: invCode + '_np', productId: 'SMKNOPE999', quantity: 1, accountId },
    adminToken
  );
  assert(invNoProd.code === 404, `14.4 商品不存在 → 404（实得 ${invNoProd.code} ${invNoProd.message || ''}）`);

  // ── 14.5 入库成功：三联事务（库存+ 进货记录+ 扣款+ 流水）──────────────────
  const [bal0] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  const B0 = Number(bal0[0].b);
  const p1Key = invCode + '_in1';
  const p1 = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: p1Key, productId: invPid, quantity: 10, unitPrice: 2.5, accountId, remark: '冒烟入库' },
    adminToken
  );
  assert(p1.code === 200, `14.5 入库成功（${p1.code} ${p1.message || ''}）`);
  assert(p1.data && near(p1.data.paidAmount, 25), `14.5 应付 10×2.5=25（实际 ${p1.data && p1.data.paidAmount}）`);
  const [inv1] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [invPid]);
  assert(Number(inv1[0] && inv1[0].q) === 10, `14.5 库存 = 10（实际 ${inv1[0].q}）`);
  const [bal1] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  assert(near(bal1[0] && bal1[0].b, B0 - 25), `14.5 余额 = 基线−25（${B0} → ${bal1[0].b}）`);
  const [pr1] = await pool.query(
    'SELECT quantity, unit_price, paid_amount, status, account_id FROM purchase_records WHERE purchase_id = ?',
    [p1.data.purchaseId]
  );
  assert(
    pr1.length === 1 &&
      Number(pr1[0].quantity) === 10 &&
      near(Number(pr1[0].paid_amount), 25) &&
      Number(pr1[0].status) === 1,
    '14.5 进货记录落库（数量/实付/状态=1）'
  );
  const [txIn1] = await pool.query(
    "SELECT tx_type, tx_category, amount FROM finance_transactions WHERE related_module = 'purchase' AND related_id = ?",
    [p1.data.purchaseId]
  );
  assert(
    txIn1.length === 1 &&
      Number(txIn1[0].tx_type) === 2 &&
      txIn1[0].tx_category === '采购入库' &&
      near(Number(txIn1[0].amount), 25),
    `14.5 资金流水 1 条（tx_type=2 支出、采购入库、金额 25）：实得 ${JSON.stringify(txIn1)}`
  );
  const invAudit1 = await auditActions();
  assert(invAudit1.filter(a => a === 'STOCK_IN').length >= 1, '14.5 审计含 STOCK_IN');

  // ── 14.6 入库幂等：同键重放合并 / 同键不同参数拒绝 ─────────────────────────
  const p1Replay = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: p1Key, productId: invPid, quantity: 10, unitPrice: 2.5, accountId, remark: '冒烟入库' },
    adminToken
  );
  assert(p1Replay.code === 200 && p1Replay.data.replayed === true, '14.6 同键重放标记 replayed=true');
  assert(String(p1Replay.data.purchaseId) === String(p1.data.purchaseId), '14.6 重放返回同一入库单号');
  const [inv2] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [invPid]);
  assert(Number(inv2[0] && inv2[0].q) === 10, '14.6 重放后库存仍为 10（没有重复入库）');
  const p1Conflict = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: p1Key, productId: invPid, quantity: 11, unitPrice: 2.5, accountId },
    adminToken
  );
  assert(p1Conflict.code === 400, `14.6 同键不同参数被拒 400（${p1Conflict.code}）`);

  // ── 14.7 ★ 作废入库单：原路退回 + 回退库存（整链回到基线）──────────────────
  const voidKey = invCode + '_void1';
  const v1 = await call(
    'POST',
    '/mini/admin/purchases/' + p1.data.purchaseId + '/void',
    { clientRequestId: voidKey, reason: '冒烟作废' },
    adminToken
  );
  assert(v1.code === 200, `14.7 作废成功（${v1.code} ${v1.message || ''}）`);
  assert(v1.data && near(v1.data.refundAmount, 25), `14.7 退回金额 = 25（实际 ${v1.data && v1.data.refundAmount}）`);
  const [bal2] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  assert(near(bal2[0] && bal2[0].b, B0), `14.7 余额回到基线 ${B0}（实际 ${bal2[0].b}）—— 入库扣的 25 原路退回`);
  const [inv3] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [invPid]);
  assert(Number(inv3[0] && inv3[0].q) === 0, `14.7 库存回退到 0（实际 ${inv3[0].q}）`);
  const [pr1b] = await pool.query('SELECT status, void_reason FROM purchase_records WHERE purchase_id = ?', [
    p1.data.purchaseId
  ]);
  assert(Number(pr1b[0].status) === 2, '14.7 进货记录 status=2（作废标记）');
  const [txVoid] = await pool.query(
    "SELECT tx_type, tx_category, amount FROM finance_transactions WHERE related_module = 'purchase_void' AND related_id = ?",
    [p1.data.purchaseId]
  );
  assert(
    txVoid.length === 1 &&
      Number(txVoid[0].tx_type) === 1 &&
      txVoid[0].tx_category === '入库退回' &&
      near(Number(txVoid[0].amount), 25),
    '14.7 作废流水（tx_type=1 收入方向、入库退回）落库'
  );
  const v1Replay = await call(
    'POST',
    '/mini/admin/purchases/' + p1.data.purchaseId + '/void',
    { clientRequestId: voidKey, reason: '冒烟作废' },
    adminToken
  );
  assert(v1Replay.code === 200 && v1Replay.data.replayed === true, '14.7 作废重放 replayed=true（不重复退钱）');
  const [bal2b] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  assert(near(bal2b[0] && bal2b[0].b, B0), '14.7 作废重放后余额仍 = 基线（只退一次）');
  const v1Dup = await call(
    'POST',
    '/mini/admin/purchases/' + p1.data.purchaseId + '/void',
    { clientRequestId: invCode + '_void1b', reason: '再作废' },
    adminToken
  );
  assert(v1Dup.code === 400 && /已作废/.test(String(v1Dup.message)), `14.7 换键重复作废被拒（${v1Dup.message}）`);

  // ── 14.8 再入库 + 出库：出库**不动资金** ──────────────────────────────────
  const p2Key = invCode + '_in2';
  const p2 = await call(
    'POST',
    '/mini/admin/inventory/in',
    { clientRequestId: p2Key, productId: invPid, quantity: 10, unitPrice: 2.5, accountId },
    adminToken
  );
  assert(p2.code === 200, `14.8 第二次入库成功（${p2.code}）`);
  const outKey = invCode + '_out1';
  const o1 = await call(
    'POST',
    '/mini/admin/inventory/out',
    { clientRequestId: outKey, productId: invPid, quantity: 3, outType: 1, remark: '冒烟出库' },
    adminToken
  );
  assert(o1.code === 200, `14.8 出库成功（${o1.code} ${o1.message || ''}）`);
  const [inv4] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [invPid]);
  assert(Number(inv4[0] && inv4[0].q) === 7, `14.8 库存 = 10−3 = 7（实际 ${inv4[0].q}）`);
  const [bal3] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  assert(near(bal3[0] && bal3[0].b, B0 - 25), '14.8 出库不动资金（余额仍 = 基线−25）');
  const [so1] = await pool.query(
    'SELECT quantity, out_type, stock_after FROM stock_out_records WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [invPid]
  );
  assert(
    so1.length === 1 && Number(so1[0].quantity) === 3 && Number(so1[0].stock_after) === 7,
    '14.8 出库台账落库（数量 3、stock_after=7）'
  );
  const invAudit2 = await auditActions();
  assert(invAudit2.filter(a => a === 'STOCK_OUT').length >= 1, '14.8 审计含 STOCK_OUT');

  // ── 14.9 出库幂等：同键重放不再扣库存 ──────────────────────────────────────
  const o1Replay = await call(
    'POST',
    '/mini/admin/inventory/out',
    { clientRequestId: outKey, productId: invPid, quantity: 3, outType: 1 },
    adminToken
  );
  assert(o1Replay.code === 200 && o1Replay.data.replayed === true, '14.9 出库重放 replayed=true');
  const [inv5] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [invPid]);
  assert(Number(inv5[0] && inv5[0].q) === 7, `14.9 重放后库存仍为 7（实际 ${inv5[0].q}）`);

  // ── 14.10 超量出库被拒 ────────────────────────────────────────────────────
  const o2 = await call(
    'POST',
    '/mini/admin/inventory/out',
    { clientRequestId: invCode + '_out9', productId: invPid, quantity: 100, outType: 1 },
    adminToken
  );
  assert(o2.code === 400 && /库存不足/.test(String(o2.message)), `14.10 超量出库被拒（${o2.message}）`);

  // ── 14.11 ⚠️ 有出库历史的入库单不能作废（回退会击穿库存）──────────────────
  const v2 = await call(
    'POST',
    '/mini/admin/purchases/' + p2.data.purchaseId + '/void',
    { clientRequestId: invCode + '_void2', reason: '冒烟作废2' },
    adminToken
  );
  assert(
    v2.code === 400 && /库存不足，无法回退/.test(String(v2.message)),
    `14.11 库存 7 < 需回退 10 → 作废被拒（${v2.message}）：这条保护防止「作废把库存打成负数」`
  );

  // ── 14.12 资金恒等式复算（库存域动作之后）─────────────────────────────────
  const [txAll] = await pool.query(
    'SELECT tx_type, amount FROM finance_transactions WHERE account_id = ? AND related_module IN (?, ?)',
    [accountId, 'purchase', 'purchase_void']
  );
  const net = txAll.reduce((a, t) => a + (Number(t.tx_type) === 1 ? Number(t.amount) : -Number(t.amount)), 0);
  const [balEnd] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [accountId]);
  assert(
    near(Number(balEnd[0].b), B0 + net),
    `14.12 库存域资金恒等式：余额(${balEnd[0].b}) = 基线(${B0}) + 净额(${Number(net).toFixed(2)})`
  );

  // ═════════════ 15. 订单域（Phase 8b 第 9 域）═══════════════════════════════
  // ⚠️ 在此之前全系统没有任何推进 fulfillment_status 的路径 —— 本域是「备货/配送/
  //    完成」状态机的唯一入口。取消分两条链：钱包单走完整退款（settleOrderReversal），
  //    Web 现金单走账务回冲（restoreSalesEffects 等）—— 两条都要验。
  section('15. 订单域：全来源列表 / 履约状态机 / 管理员取消（钱包单退款 + 现金单回冲）');

  // ── 15.0 准备：给业务员补 worker 主体 + 钱包 + 测试商品，然后用业务员身份下两单 ──
  const ordWorkerId = 'SMKWKORD' + TS; // SMKWK% 前缀 → 被既有主数据清理覆盖
  const ordCode = 'SMKINVORD' + TS; // SMKINV% 前缀 → 被库存域清理覆盖（下单会写 inventory）
  await pool.query(
    `INSERT INTO workers (worker_id, worker_name, phone, employee_type, commission_rate, status, created_at, updated_at)
     VALUES (?, '冒烟订单业务员', '13800000001', 3, 0.00, 1, NOW(), NOW())`,
    [ordWorkerId]
  );
  await pool.query('UPDATE mini_accounts SET target_id = ? WHERE id = ?', [ordWorkerId, salesmanAccountId]);
  // ⚠️ target_id 变更后**必须重签令牌**：miniAuth 每请求比对令牌里的 target_id 与库中值，
  //    不一致直接 401「绑定关系已变更」—— 不重签的话 15.0 之后所有业务员请求都会 401，
  //    表现像「下单接口坏了」，实为测试自身的令牌失效（实测踩到）。
  const ordSalesmanToken = signMiniToken({ id: salesmanAccountId, role: 'salesman', target_id: ordWorkerId });
  const ordWalletConn = await pool.getConnection();
  let ordWalletId;
  try {
    await ordWalletConn.beginTransaction();
    const w = await walletService.ensureWallet(ordWalletConn, {
      ownerType: 'SALESMAN',
      ownerId: ordWorkerId,
      ownerName: '冒烟订单业务员'
    });
    ordWalletId = w.wallet_id;
    const wRow = await walletService.loadWalletForUpdate(ordWalletConn, ordWalletId);
    await walletService.creditWallet(ordWalletConn, wRow, {
      txType: 'ADJUST_IN',
      amount: 500,
      relatedType: 'MANUAL_ADJUST',
      operatorId: 'smoke',
      remark: '订单域冒烟注入'
    });
    await ordWalletConn.commit();
  } catch (e) {
    await ordWalletConn.rollback();
    throw e;
  } finally {
    ordWalletConn.release();
  }
  await pool.query(
    `INSERT INTO products (product_id, product_code, product_name, specification, unit,
       purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
       distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
       worker_machine_delivery_fee, category, status,
       salesman_mini_enabled, salesman_min_price, created_at, updated_at)
     SELECT CONCAT('PROORD', ?), ?, '冒烟订单商品', '箱', '箱', 2, 5, 5, 0, 1, 1, 1, 0.5, 0, '冒烟', 1, 1, 4, NOW(), NOW()`,
    [TS, ordCode]
  );
  const [ordProd] = await pool.query('SELECT product_id FROM products WHERE product_code = ?', [ordCode]);
  const ordPid = ordProd[0].product_id;
  // ⚠️ 下单扣库存（deductInventoryForSale）要求 inventory 行**必须存在**（FOR UPDATE 校验），
  //    没有库存记录的商品连 1 件都下不了单 —— 必须先插一条库存（实测踩到）。
  await pool.query(
    `INSERT INTO inventory (product_id, quantity, last_in_time, updated_at) VALUES (?, 100, NOW(), NOW())`,
    [ordPid]
  );

  const placeOrder = async key =>
    call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: key,
        fulfillmentType: 'DELIVERY',
        orderScene: 'CUSTOMER_ORDER',
        customerName: '冒烟订单客户',
        customerPhone: '13700000000',
        customerAddress: '南京市冒烟订单路1号',
        items: [{ productId: ordPid, quantity: 2, unitPrice: 5 }]
      },
      ordSalesmanToken
    );
  const ord1 = await placeOrder('smkord_' + TS + '_o1');
  const ord2 = await placeOrder('smkord_' + TS + '_o2');
  assert(
    ord1.code === 200 && ord2.code === 200,
    `15.0 两笔测试订单下单成功（${ord1.code} ${ord1.message || ''} / ${ord2.code} ${ord2.message || ''}）`
  );
  const ord1Id = ord1.data && ord1.data.orderId;
  const ord2Id = ord2.data && ord2.data.orderId;

  // ── 15.1 权限：业务员令牌一律 403 ─────────────────────────────────────────
  const ordDenied = await call('GET', '/mini/admin/orders', null, ordSalesmanToken);
  assert(
    ordDenied.code === 403 && /需要管理员角色/.test(String(ordDenied.message)),
    `15.1 业务员读管理端订单被拒 403（实得 ${ordDenied.code} ${ordDenied.message || ''}）`
  );
  const ordAdvDenied = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'x', to: 'PROCESSING' },
    ordSalesmanToken
  );
  assert(ordAdvDenied.code === 403, `15.1 业务员推进被拒 403（实得 ${ordAdvDenied.code}）`);

  // ── 15.2 全来源列表 + 关键词筛选 ──────────────────────────────────────────
  const ordList = await call(
    'GET',
    '/mini/admin/orders?keyword=' + encodeURIComponent('冒烟订单客户'),
    null,
    adminToken
  );
  assert(ordList.code === 200, `15.2 管理员列表 200（${ordList.code}）`);
  const found1 = (ordList.data.list || []).filter(r => r.orderId === ord1Id || r.orderId === ord2Id);
  assert(found1.length === 2, `15.2 关键词能找到两笔测试订单（找到 ${found1.length}）`);
  assert(
    found1.every(r => r.source === 'MINI_PROGRAM'),
    '15.2 列表含来源标记'
  );

  // ── 15.3 履约推进：逐级 PAID→PROCESSING→DELIVERING→COMPLETED ──────────────
  const adv1 = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_a1', to: 'PROCESSING' },
    adminToken
  );
  assert(
    adv1.code === 200 && adv1.data.from === 'PAID' && adv1.data.to === 'PROCESSING',
    `15.3 PAID → PROCESSING（${adv1.code} ${adv1.message || ''}）`
  );
  const adv2 = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_a2', to: 'DELIVERING' },
    adminToken
  );
  assert(adv2.code === 200, `15.3 PROCESSING → DELIVERING（${adv2.code}）`);
  const adv3 = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_a3', to: 'COMPLETED' },
    adminToken
  );
  assert(adv3.code === 200, `15.3 DELIVERING → COMPLETED（${adv3.code}）`);
  const [st1] = await pool.query('SELECT fulfillment_status FROM orders WHERE order_id = ?', [ord1Id]);
  assert(st1[0].fulfillment_status === 'COMPLETED', '15.3 落库状态 = COMPLETED');

  // ── 15.4 状态机守卫：回退 / 同值 / 终态 / 已取消 ──────────────────────────
  const advBack = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_b1', to: 'PAID' },
    adminToken
  );
  assert(advBack.code === 400 && /回退/.test(String(advBack.message)), `15.4 回退被拒（${advBack.message}）`);
  const advSame = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_b2', to: 'COMPLETED' },
    adminToken
  );
  assert(advSame.code === 400 && /无需重复/.test(String(advSame.message)), `15.4 同值被拒（${advSame.message}）`);
  const advBad = await call(
    'PUT',
    '/mini/admin/orders/' + ord1Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_b3', to: 'NOT_A_STATE' },
    adminToken
  );
  assert(advBad.code === 400, `15.4 非法状态被拒（${advBad.code}）`);
  const advMiss = await call(
    'PUT',
    '/mini/admin/orders/SMKNOORDER/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_b4', to: 'PROCESSING' },
    adminToken
  );
  assert(advMiss.code === 404, `15.4 订单不存在 → 404（实得 ${advMiss.code}）`);

  // ── 15.5 推进幂等：同键重放合并 / 同键不同参数拒绝 ─────────────────────────
  const advKey = 'smkord_' + TS + '_adv2';
  const advR1 = await call(
    'PUT',
    '/mini/admin/orders/' + ord2Id + '/fulfillment',
    { clientRequestId: advKey, to: 'PROCESSING' },
    adminToken
  );
  assert(advR1.code === 200, `15.5 第二单推进成功（${advR1.code}）`);
  const advR2 = await call(
    'PUT',
    '/mini/admin/orders/' + ord2Id + '/fulfillment',
    { clientRequestId: advKey, to: 'PROCESSING' },
    adminToken
  );
  assert(advR2.code === 200 && advR2.data.replayed === true, '15.5 同键重放 replayed=true');
  const advR3 = await call(
    'PUT',
    '/mini/admin/orders/' + ord2Id + '/fulfillment',
    { clientRequestId: advKey, to: 'COMPLETED' },
    adminToken
  );
  assert(advR3.code === 400, `15.5 同键不同参数被拒（${advR3.code}）`);

  // ── 15.6 ★ 管理员取消（钱包单）：积分原路退回 + 库存恢复 + 状态落库 ────────
  const [wBefore] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [ordWalletId]);
  const wB = Number(wBefore[0].balance);
  // 第二单当前 PROCESSING：先取消（未完成 → 库存应恢复）
  const [invBefore] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [ordPid]);
  const invB = invBefore.length ? Number(invBefore[0].q) : 0;
  const cKey = 'smkord_' + TS + '_cancel2';
  const c1 = await call(
    'POST',
    '/mini/admin/orders/' + ord2Id + '/cancel',
    { clientRequestId: cKey, reason: '冒烟取消' },
    adminToken
  );
  assert(c1.code === 200 && c1.data.walletRefunded === true, `15.6 钱包单取消成功（${c1.code} ${c1.message || ''}）`);
  const [wAfter] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [ordWalletId]);
  assert(near(Number(wAfter[0].balance), wB + 10), `15.6 钱包退回 10 积分（${wB} → ${wAfter[0].balance}）`);
  const [invAfter] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [ordPid]);
  assert(Number(invAfter[0].q) === invB + 2, `15.6 库存恢复 +2（${invB} → ${invAfter[0].q}）`);
  const [ord2After] = await pool.query(
    'SELECT canceled_at, fulfillment_status, refund_status FROM orders WHERE order_id = ?',
    [ord2Id]
  );
  assert(
    !!ord2After[0].canceled_at &&
      ord2After[0].fulfillment_status === 'CANCELED' &&
      ord2After[0].refund_status === 'REFUNDED',
    '15.6 订单落库：canceled_at + CANCELED + REFUNDED'
  );
  const c1Replay = await call(
    'POST',
    '/mini/admin/orders/' + ord2Id + '/cancel',
    { clientRequestId: cKey, reason: '冒烟取消' },
    adminToken
  );
  assert(c1Replay.code === 200 && c1Replay.data.replayed === true, '15.6 取消重放 replayed=true');
  const [wAfter2] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [ordWalletId]);
  assert(near(Number(wAfter2[0].balance), wB + 10), '15.6 取消重放后钱包不变（只退一次）');
  const c1Dup = await call(
    'POST',
    '/mini/admin/orders/' + ord2Id + '/cancel',
    { clientRequestId: 'smkord_' + TS + '_c2' },
    adminToken
  );
  assert(c1Dup.code === 400, `15.6 换键重复取消被拒（${c1Dup.code}）`);

  // ── 15.7 Web 现金单取消：只回冲账务，不涉及钱包 ────────────────────────────
  const webOrderId = 'SMKWEB' + TS;
  await pool.query(
    `INSERT INTO orders (order_id, order_type, order_source, customer_name, customer_phone, customer_address,
        order_amount, paid_amount, payment_method, payment_status, fulfillment_status, refund_status, created_at, updated_at)
     VALUES (?, 1, 'WEB', '冒烟Web客户', '13600000000', '南京市冒烟Web路1号', 20, 20, 'CASH', 1, 'PAID', 'NONE', NOW(), NOW())`,
    [webOrderId]
  );
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, 4, 5, 20)`,
    [webOrderId, ordPid]
  );
  const c2 = await call(
    'POST',
    '/mini/admin/orders/' + webOrderId + '/cancel',
    { clientRequestId: 'smkord_' + TS + '_wc', reason: '冒烟取消Web单' },
    adminToken
  );
  assert(
    c2.code === 200 && c2.data.walletRefunded === false,
    `15.7 Web 现金单取消成功（${c2.code} walletRefunded=false）`
  );
  const [webAfter] = await pool.query('SELECT canceled_at, fulfillment_status FROM orders WHERE order_id = ?', [
    webOrderId
  ]);
  assert(!!webAfter[0].canceled_at && webAfter[0].fulfillment_status === 'CANCELED', '15.7 Web 单落库取消');
  const [invWeb] = await pool.query('SELECT quantity q FROM inventory WHERE product_id = ?', [ordPid]);
  assert(Number(invWeb[0].q) === invB + 2 + 4, `15.7 Web 单库存也恢复 +4（当前 ${invWeb[0].q}）`);

  // ── 15.8 已取消的单不能再推进 ─────────────────────────────────────────────
  const advCanceled = await call(
    'PUT',
    '/mini/admin/orders/' + ord2Id + '/fulfillment',
    { clientRequestId: 'smkord_' + TS + '_b5', to: 'DELIVERING' },
    adminToken
  );
  assert(
    advCanceled.code === 400 && /已取消/.test(String(advCanceled.message)),
    `15.8 已取消单推进被拒（${advCanceled.message}）`
  );

  // ── 15.9 审计 ─────────────────────────────────────────────────────────────
  const ordAudit = await auditActions();
  assert(ordAudit.includes('ADVANCE_ORDER'), '15.9 审计含 ADVANCE_ORDER');
  assert(ordAudit.includes('CANCEL_ORDER_ADMIN'), '15.9 审计含 CANCEL_ORDER_ADMIN');

  return {
    accountId,
    adminAccountId,
    salesmanAccountId,
    uploadedImageName,
    refMachineId,
    saleInserted,
    invPid,
    ordWalletId,
    ordWorkerId,
    ordPid,
    ord1Id,
    webOrderId
  };
}

const ctx = { accountId: null, adminAccountId: null, salesmanAccountId: null, uploadedImageName: '' };

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
      // 商品域：**物理**删除冒烟商品（软删除是业务语义，冒烟必须把测试数据清干净），
      // 并删掉上传的测试图片（否则每跑一次就往商品图片目录里留一个孤儿文件）
      // ⚠️⚠️ 清理顺序是被外键**硬约束**的，不能随意调换：
      //    `machine_sales.product_id → products.product_id` 是 **ON DELETE RESTRICT**，
      //    所以只要还有销量记录指着某个商品，那个商品就删不掉 —— 而销量记录正好是
      //    本冒烟第 12 节插的（它取的是库里第一条商品）。第一版把「删商品」写在「删销量」
      //    前面，结果整个清理中途抛错、残留一路留到下一轮（下一轮又因此失败）。
      //    教训：子表永远先删。宁可多看一眼外键，也别按"直觉顺序"写清理。
      await pool.query('DELETE FROM machine_sales WHERE sale_id LIKE ?', ['SMKSALE%']);
      // 订单域：先删订单明细/流水/订单（order_items.product_id 引用商品），
      // 再走下面的 SMKINV 库存与商品清理，否则外键 RESTRICT 会中断整个清理。
      await cleanupOrderSmokeData();
      // 库存域：三张库存表都外键指向 products，必须**先删它们**再删商品
      //（否则「删商品」撞 RESTRICT → 整个清理中断，残留留到下一轮）
      const invPids = (await pool.query("SELECT product_id FROM products WHERE product_code LIKE 'SMKINV%'"))[0].map(
        r => r.product_id
      );
      if (invPids.length) {
        const ph = invPids.map(() => '?').join(',');
        await pool.query(
          `DELETE FROM finance_transactions WHERE related_module IN ('purchase', 'purchase_void')
             AND related_id IN (SELECT purchase_id FROM purchase_records WHERE product_id IN (${ph}))`,
          invPids
        );
        await pool.query(`DELETE FROM stock_out_records WHERE product_id IN (${ph})`, invPids);
        await pool.query(`DELETE FROM purchase_records WHERE product_id IN (${ph})`, invPids);
        await pool.query(`DELETE FROM inventory WHERE product_id IN (${ph})`, invPids);
      }
      await pool.query("DELETE FROM products WHERE product_code LIKE 'SMKINV%'");
      await pool.query('DELETE FROM products WHERE product_code LIKE ?', ['SMKPRD%']);
      // 主数据四域：按冒烟前缀清除（软删除是业务语义，冒烟必须把测试数据清干净）
      await pool.query('DELETE FROM machine_stations WHERE station_name LIKE ?', ['SMKM%']);
      await pool.query('DELETE FROM suppliers WHERE supplier_name LIKE ?', ['SMKSUP%']);
      await pool.query('DELETE FROM workers WHERE worker_name LIKE ?', ['SMKWK%']);
      await pool.query('DELETE FROM sub_stations WHERE station_name LIKE ?', ['SMKST%']);
      if (ctx.uploadedImageName) {
        try {
          const imgAbs = path.join(__dirname, '../../商品档案/商品图片', ctx.uploadedImageName);
          if (fs.existsSync(imgAbs)) {
            fs.unlinkSync(imgAbs);
            console.log(`清理：已删除测试图片 ${ctx.uploadedImageName}`);
          }
        } catch (e) {
          console.log('清理测试图片失败：' + e.message);
        }
      }
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
      const [leftPrd] = await pool.query('SELECT COUNT(*) n FROM products WHERE product_code LIKE ?', ['SMKPRD%']);
      const [leftInvPrd] = await pool.query("SELECT COUNT(*) n FROM products WHERE product_code LIKE 'SMKINV%'");
      const [leftInv] = await pool.query(
        "SELECT COUNT(*) n FROM inventory i JOIN products p ON p.product_id = i.product_id WHERE p.product_code LIKE 'SMKINV%'"
      );
      const [leftPur] = await pool.query(
        "SELECT COUNT(*) n FROM purchase_records pr JOIN products p ON p.product_id = pr.product_id WHERE p.product_code LIKE 'SMKINV%'"
      );
      const [leftOut] = await pool.query(
        "SELECT COUNT(*) n FROM stock_out_records so JOIN products p ON p.product_id = so.product_id WHERE p.product_code LIKE 'SMKINV%'"
      );
      const invTotal = Number(leftInvPrd[0].n) + Number(leftInv[0].n) + Number(leftPur[0].n) + Number(leftOut[0].n);
      // 主数据五张表（含机台销量）的残留核对
      const masterLeft = {};
      for (const [t, col, like] of [
        ['suppliers', 'supplier_name', 'SMKSUP%'],
        ['workers', 'worker_name', 'SMKWK%'],
        ['sub_stations', 'station_name', 'SMKST%'],
        ['machine_stations', 'station_name', 'SMKM%'],
        ['machine_sales', 'sale_id', 'SMKSALE%']
      ]) {
        // hazard-allow: 表名/列名来自本脚本内的字面量清单（非外部输入）
        const [r] = await pool.query(`SELECT COUNT(*) n FROM \`${t}\` WHERE \`${col}\` LIKE ?`, [like]);
        masterLeft[t] = Number(r[0].n);
      }
      const masterTotal = Object.values(masterLeft).reduce((a, b) => a + b, 0);
      // 订单域残留：订单（含 Web 测试单）与业务员钱包
      const ordLeft = (
        await pool.query(
          "SELECT COUNT(*) n FROM orders WHERE order_id LIKE 'SMKWEB%' OR buyer_id IN (SELECT worker_id FROM workers WHERE worker_name LIKE 'SMKWKORD%')"
        )
      )[0];
      const walLeft = (
        await pool.query(
          "SELECT COUNT(*) n FROM wallet_accounts WHERE owner_id IN (SELECT worker_id FROM workers WHERE worker_name LIKE 'SMKWKORD%')"
        )
      )[0];
      const ordTotal = Number(ordLeft[0].n) + Number(walLeft[0].n);
      const clean =
        Number(left[0].n) === 0 &&
        Number(leftInc[0].n) === 0 &&
        Number(leftPrd[0].n) === 0 &&
        invTotal === 0 &&
        masterTotal === 0 &&
        ordTotal === 0;
      console.log(
        `\n清理：残留 支出 ${left[0].n} 行 / 收入 ${leftInc[0].n} 行 / 商品 ${leftPrd[0].n} 条 / 库存域 ${invTotal} 条 / 主数据 ${masterTotal} 条 / 订单域 ${ordTotal} 条` +
          `${clean ? ' ✓' : ' ✗ ' + JSON.stringify({ masterLeft, invTotal, ordTotal })}`
      );
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

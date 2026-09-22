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
 *   · 第 10 域 公司账户 —— 第 16 节。余额只读（不接受入参改余额）、删除规则
 *     （余额≠0 或有流水 → 拒绝并提示可停用）、★ 转账双边记账（双边余额 + 双流水同批次
 *     号 + 总额守恒 + 幂等重放不得转两次）。核心用 Web 端抽出的 applyTransfer 单源。
 *   · 第 11 域 工资 —— 第 17 节。唯一「公司 → 个人」的资金动作。★ 四个必须钉死的点：
 *     实发 = 应发 − 待扣预支（按**实发**扣账户，不是应发）；实发为负**不动账户不写流水**；
 *     撤销发放账户 **+** 回补且预支反向还原；★ 预支**没有同月唯一约束** ——
 *     所以它才是幂等键最该保护的地方（重试一次 = 真的再预支一笔，两笔都合法）。
 *     另含余额不足「被拒后余额未变 + 不留半张发放单」与**个人信息红线**
 *     （汇总列表不得出现 phone —— loadSalarySummary 会带出，必须逐字段挡掉）。
 *     核心用 Web 端抽出的 services/salaryLedger 四个原语（两端共用）。
 *   · 第 16 域 回桶 —— 第 19 节。押金是**资金动作**（收取=账户 + / 退回=账户 −），
 *     且与桶型配置**跨端联动**：配置停用/删除后，押金登记必须被拒（定式 ⑫ 的联动断言）。
 *     ⚠️ 押金**没有编辑/删除接口**：记错要开反向流水，不能改历史（同「入库单只能作废」）。
 *   · 第 17 域 系统设置 —— 第 20 节。目前只有「销售单打印店长」一项。
 *     ⚠️ 这是**全局配置**：冒烟会把原值快照下来并在清理时还原（否则会污染真实打印配置）；
 *     另断言「配置指向已停用员工时**不静默换人**，只把状态透出」这条业务口径。
 *   · 第 15 域 水票 —— 第 21 节。**只读 + 作废单张**，且带一条**范围反向断言**：
 *     发行 / 批次删除 / 调整类接口必须**不存在**（docs §7.2 划给 Phase 7；§12.10 要求
 *     配送费积分由服务端重取，而现发行接口信任客户端传入值）。
 *     范围决定也要被断言 —— 否则将来有人「顺手」加上接口，就等于把定价权交给了公网客户端。
 *   · 第 12~14 域 营收 / 成本 / 利润 —— 第 18 节。**只读报表**，三个域共用一个页面。
 *     本节的断言重点不是「接口通不通」，而是 ★★ **跨端逐行一致**：
 *     同一区间下小程序与 Web 的同一个数必须逐位相等（这是「取数单源」唯一的可验证证明；
 *     只验 200 的话，两边各写一套 SQL 也能全绿）。另含 ★ **区间白名单**：
 *     营收实现里的 resolveDateRange 曾对未知 key 静默退化成「今天」（2026-09-22 已修为 400）。
 *     本节对 Web 与小程序**两侧**都断言「非法区间一律 400」—— 修复前后断言方向相反，
 *     照抄旧写法会变成守着错误行为。
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
    // 账户域（第 10 域）的跨轮残留：流水 → 账户（按 SMKA% 前缀，与收尾同一口径）
    await pool.query("DELETE FROM finance_transactions WHERE account_id LIKE 'SMKA%'");
    await pool.query("DELETE FROM finance_accounts WHERE account_id LIKE 'SMKA%'");
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

  // ═════════════ 16. 公司账户域（Phase 8b 第 10 域）════════════════════════════
  // ⚠️ 这个域是支出/收入/库存/工资四个域的地基（都靠账户下拉）。两条硬纪律要钉死：
  //    ① **余额不可直接编辑**（本域刻意不开放 Web 的人工调账）；
  //    ② 转账是**双边余额 + 双流水同批次**，且必须幂等（弱网重试不得转两次）。
  section('16. 公司账户域：余额只读 / 删除规则 / ★ 转账双边记账与幂等');

  const accA = 'SMKACCA' + TS;
  const accB = 'SMKACCB' + TS;
  const accC = 'SMKACCC' + TS; // 用于「余额 0 无流水 → 可物理删」
  const accNameA = '冒烟账户甲' + TS;
  const accNameB = '冒烟账户乙' + TS;
  const accNameC = '冒烟账户丙' + TS;
  const accBal = async id => {
    const [r] = await pool.query('SELECT current_balance b, status s FROM finance_accounts WHERE account_id = ?', [id]);
    return r.length ? { balance: Number(r[0].b), status: Number(r[0].s) } : null;
  };
  const accTx = async id =>
    (await pool.query('SELECT COUNT(*) n FROM finance_transactions WHERE account_id = ?', [id]))[0][0].n;

  // ── 16.1 权限 ─────────────────────────────────────────────────────────────
  const accDenied = await call('GET', '/mini/admin/accounts', null, ordSalesmanToken);
  assert(
    accDenied.code === 403 && /管理员角色/.test(String(accDenied.message)),
    `16.1 业务员读账户被拒 403（实得 ${accDenied.code} ${accDenied.message || ''}）`
  );
  const accXferDenied = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'x', fromId: accA, toId: accB, amount: 1 },
    ordSalesmanToken
  );
  assert(accXferDenied.code === 403, `16.1 业务员转账被拒 403（实得 ${accXferDenied.code}）`);

  // ── 16.2 选项与新增校验 ───────────────────────────────────────────────────
  const accOpts = await call('GET', '/mini/admin/accounts/options', null, adminToken);
  assert(accOpts.code === 200, `16.2 账户选项 200（${accOpts.code}）`);
  if (accOpts.code === 200) {
    assert(
      (accOpts.data.types || []).length === 10,
      `16.2 账户类型 10 类（实得 ${(accOpts.data.types || []).length}）`
    );
    assert(
      (accOpts.data.activeAccounts || []).every(a => a.currentBalance !== undefined),
      '16.2 转账下拉只列启用账户且带余额'
    );
  }
  const accNoIdem = await call('POST', '/mini/admin/accounts', { accountName: accNameA, accountType: 1 }, adminToken);
  assert(
    accNoIdem.code === 400 && /clientRequestId/.test(String(accNoIdem.message)),
    `16.2 缺幂等键被拒（${accNoIdem.message}）`
  );
  const accBadType = await call(
    'POST',
    '/mini/admin/accounts',
    { clientRequestId: 'smkacc_' + TS + '_bt', accountName: accNameA, accountType: 99 },
    adminToken
  );
  assert(
    accBadType.code === 400 && /类型/.test(String(accBadType.message)),
    `16.2 非法类型被拒（${accBadType.message}）`
  );
  const accNegInit = await call(
    'POST',
    '/mini/admin/accounts',
    { clientRequestId: 'smkacc_' + TS + '_ni', accountName: accNameA, accountType: 1, initialBalance: -1 },
    adminToken
  );
  assert(
    accNegInit.code === 400 && /期初/.test(String(accNegInit.message)),
    `16.2 负期初被拒（${accNegInit.message}）`
  );

  // ── 16.3 新增成功 + 幂等 ──────────────────────────────────────────────────
  const createAcc = async (id, name, init, key) =>
    call(
      'POST',
      '/mini/admin/accounts',
      { clientRequestId: key, accountName: name, accountType: 1, initialBalance: init },
      adminToken
    );
  const cA = await createAcc(accA, accNameA, 1000, 'smkacc_' + TS + '_a');
  assert(cA.code === 200 && cA.data.accountId, `16.3 新增账户甲成功（${cA.code} ${cA.message || ''}）`);
  assert(String(cA.data.accountId) === accA || cA.data.accountId.length > 3, '16.3 返回 accountId');
  // ⚠️ 服务端自己生成 accountId（不接受客户端指定），这里用返回的 ID 作为后续操作对象
  const idA = cA.data.accountId;
  const aBal = await accBal(idA);
  assert(
    aBal && near(aBal.balance, 1000) && aBal.status === 1,
    `16.3 期初=当前余额=1000 且启用（实得 ${JSON.stringify(aBal)}）`
  );
  const cAReplay = await createAcc(accA, accNameA, 1000, 'smkacc_' + TS + '_a');
  assert(cAReplay.code === 200 && cAReplay.data.replayed === true, '16.3 新增幂等重放 replayed=true');
  assert(String(cAReplay.data.accountId) === String(idA), '16.3 重放返回同一账户');
  const cADup = await createAcc(accA, accNameA, 1, 'smkacc_' + TS + '_a2');
  assert(cADup.code === 400 && /已存在/.test(String(cADup.message)), `16.3 重名被拒（${cADup.message}）`);
  const auditA1 = await auditActions();
  assert(auditA1.includes('CREATE_ACCOUNT'), '16.3 审计含 CREATE_ACCOUNT');

  // ── 16.4 编辑：余额不受入参影响 + 停用/启用 ───────────────────────────────
  const cB = await createAcc(accB, accNameB, 500, 'smkacc_' + TS + '_b');
  const idB = cB.data.accountId;
  const cC = await createAcc(accC, accNameC, 0, 'smkacc_' + TS + '_c');
  const idC = cC.data.accountId;
  const editA = await call(
    'PUT',
    '/mini/admin/accounts/' + idA,
    // ⚠️ 故意带上余额字段：服务端必须**忽略**它（只改开户信息/备注/状态）
    {
      clientRequestId: 'smkacc_' + TS + '_ea',
      remark: '冒烟备注',
      bankName: '冒烟银行',
      currentBalance: 999999,
      status: 1
    },
    adminToken
  );
  assert(editA.code === 200, `16.4 编辑账户成功（${editA.code} ${editA.message || ''}）`);
  const aBal2 = await accBal(idA);
  assert(
    near(aBal2.balance, 1000),
    `16.4 ★ 余额未被入参改动（仍 1000，实得 ${aBal2.balance}）—— 余额只能由业务单据/转账变动`
  );
  const editAReplay = await call(
    'PUT',
    '/mini/admin/accounts/' + idA,
    { clientRequestId: 'smkacc_' + TS + '_ea', remark: '冒烟备注', bankName: '冒烟银行', status: 1 },
    adminToken
  );
  assert(editAReplay.code === 200 && editAReplay.data.replayed === true, '16.4 编辑幂等重放 replayed=true');
  const disableA = await call(
    'PUT',
    '/mini/admin/accounts/' + idA,
    { clientRequestId: 'smkacc_' + TS + '_da', remark: '冒烟备注', bankName: '冒烟银行', status: 0 },
    adminToken
  );
  assert(disableA.code === 200, '16.4 停用账户成功');
  const aBal3 = await accBal(idA);
  assert(aBal3.status === 0, '16.4 status 已置 0');
  const auditA2 = await auditActions();
  assert(auditA2.includes('UPDATE_ACCOUNT'), '16.4 审计含 UPDATE_ACCOUNT');

  // ── 16.5 删除规则：余额≠0 拒绝 / 有流水拒绝 / 干净账户物理删 ──────────────
  const delWithBal = await call(
    'DELETE',
    '/mini/admin/accounts/' + idB + '?clientRequestId=' + encodeURIComponent('smkacc_' + TS + '_db1'),
    null,
    adminToken
  );
  assert(
    delWithBal.code === 400 && /余额不为 0/.test(String(delWithBal.message)),
    `16.5 余额≠0 拒绝删除并提示可停用（${delWithBal.message}）`
  );
  // 丙账户：余额 0，但先转一笔进来再转出去 → 留下流水，验证「有流水也不许删」
  const xferC = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'smkacc_' + TS + '_tc1', fromId: idB, toId: idC, amount: 50 },
    adminToken
  );
  assert(xferC.code === 200, `16.5 先转账给丙账户以制造流水（${xferC.code}）`);
  const xferCBack = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'smkacc_' + TS + '_tc2', fromId: idC, toId: idB, amount: 50 },
    adminToken
  );
  assert(xferCBack.code === 200, '16.5 再转回（丙余额回到 0）');
  const cBal = await accBal(idC);
  assert(near(cBal.balance, 0), `16.5 丙账户余额回到 0（实得 ${cBal.balance}）`);
  assert(Number(await accTx(idC)) === 2, `16.5 丙账户留下 2 条流水（一进一出）—— 这正是它不能删的原因`);
  const delWithTx = await call(
    'DELETE',
    '/mini/admin/accounts/' + idC + '?clientRequestId=' + encodeURIComponent('smkacc_' + TS + '_dc1'),
    null,
    adminToken
  );
  assert(
    delWithTx.code === 400 && /流水/.test(String(delWithTx.message)),
    `16.5 有流水拒绝删除（即使余额为 0）（${delWithTx.message}）`
  );
  // 干净账户：丁（新建后无任何流水、余额 0）→ 物理删
  const cD = await createAcc('SMKACCD' + TS, '冒烟账户丁' + TS, 0, 'smkacc_' + TS + '_d');
  const idD = cD.data.accountId;
  const delClean = await call(
    'DELETE',
    '/mini/admin/accounts/' + idD + '?clientRequestId=' + encodeURIComponent('smkacc_' + TS + '_dd'),
    null,
    adminToken
  );
  assert(
    delClean.code === 200,
    `16.5 干净账户（余额 0 无流水）物理删除成功（${delClean.code} ${delClean.message || ''}）`
  );
  const [goneD] = await pool.query('SELECT account_id FROM finance_accounts WHERE account_id = ?', [idD]);
  assert(goneD.length === 0, '16.5 账户记录已消失（物理删除）');
  const accDelReplay = await call(
    'DELETE',
    '/mini/admin/accounts/' + idD + '?clientRequestId=' + encodeURIComponent('smkacc_' + TS + '_dd'),
    null,
    adminToken
  );
  assert(accDelReplay.code === 200 && accDelReplay.data.replayed === true, '16.5 删除幂等重放 replayed=true');
  const auditA3 = await auditActions();
  assert(auditA3.includes('DELETE_ACCOUNT'), '16.5 审计含 DELETE_ACCOUNT');

  // ── 16.6 ★ 转账整链：双边余额 + 双流水同批次 + 总额守恒 ───────────────────
  // 启用甲账户（前面停用了）以便参与转账
  await call(
    'PUT',
    '/mini/admin/accounts/' + idA,
    { clientRequestId: 'smkacc_' + TS + '_ea2', remark: '冒烟备注', bankName: '冒烟银行', status: 1 },
    adminToken
  );
  const balA0 = (await accBal(idA)).balance;
  const balB0 = (await accBal(idB)).balance;
  const xKey = 'smkacc_' + TS + '_x1';
  const x1 = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: xKey, fromId: idA, toId: idB, amount: 300, remark: '冒烟转账' },
    adminToken
  );
  assert(x1.code === 200 && x1.data.txNo, `16.6 转账成功（${x1.code} ${x1.message || ''}）`);
  assert(
    near((await accBal(idA)).balance, balA0 - 300),
    `16.6 转出方 ${balA0} − 300（实际 ${(await accBal(idA)).balance}）`
  );
  assert(
    near((await accBal(idB)).balance, balB0 + 300),
    `16.6 转入方 ${balB0} + 300（实际 ${(await accBal(idB)).balance}）`
  );
  assert(near((await accBal(idA)).balance + (await accBal(idB)).balance, balA0 + balB0), '16.6 ★ 两账户总额守恒');
  const xRows = (
    await pool.query(
      `SELECT account_id, tx_type, amount FROM finance_transactions
        WHERE related_module = 'account_transfer' AND related_id = ? AND tx_no = ?`,
      ['XFER' + x1.data.txNo, x1.data.txNo]
    )
  )[0];
  assert(xRows.length === 2, `16.6 生成 2 条流水（同批次号）（实得 ${xRows.length}）`);
  if (xRows.length === 2) {
    const out = xRows.find(r => Number(r.tx_type) === 2);
    const inn = xRows.find(r => Number(r.tx_type) === 1);
    assert(!!out && !!inn && near(out.amount, 300) && near(inn.amount, 300), '16.6 一出一进、金额一致');
  }
  const auditA4 = await auditActions();
  assert(auditA4.includes('TRANSFER_ACCOUNT'), '16.6 审计含 TRANSFER_ACCOUNT');

  // ── 16.7 转账幂等：同键重放不得转两次 ─────────────────────────────────────
  const beforeA = (await accBal(idA)).balance;
  const beforeB = (await accBal(idB)).balance;
  const xReplay = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: xKey, fromId: idA, toId: idB, amount: 300, remark: '冒烟转账' },
    adminToken
  );
  assert(xReplay.code === 200 && xReplay.data.replayed === true, '16.7 同键重放 replayed=true');
  assert(near((await accBal(idA)).balance, beforeA), '16.7 ★ 重放后转出方余额未变（没转第二次）');
  assert(near((await accBal(idB)).balance, beforeB), '16.7 ★ 重放后转入方余额未变');
  const xConflict = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: xKey, fromId: idA, toId: idB, amount: 301 },
    adminToken
  );
  assert(xConflict.code === 400, `16.7 同键不同金额被拒（${xConflict.code}）`);

  // ── 16.8 转账拒绝路径 ─────────────────────────────────────────────────────
  const xSame = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'smkacc_' + TS + '_x2', fromId: idA, toId: idA, amount: 10 },
    adminToken
  );
  assert(xSame.code === 400 && /不能相同/.test(String(xSame.message)), `16.8 同账户转账被拒（${xSame.message}）`);
  const xOver = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'smkacc_' + TS + '_x3', fromId: idA, toId: idB, amount: 99999999 },
    adminToken
  );
  assert(xOver.code === 400 && /余额不足/.test(String(xOver.message)), `16.8 余额不足被拒（${xOver.message}）`);
  assert(near((await accBal(idA)).balance, beforeA), '16.8 ★ 被拒后余额未变（校验在扣款之前）');
  // 停用账户不能作为转出方
  const cE = await createAcc('SMKACCE' + TS, '冒烟账户戊' + TS, 100, 'smkacc_' + TS + '_e');
  const idE = cE.data.accountId;
  await call(
    'PUT',
    '/mini/admin/accounts/' + idE,
    { clientRequestId: 'smkacc_' + TS + '_de', remark: '', bankName: '', status: 0 },
    adminToken
  );
  const xDisabled = await call(
    'POST',
    '/mini/admin/accounts/transfer',
    { clientRequestId: 'smkacc_' + TS + '_x4', fromId: idE, toId: idB, amount: 10 },
    adminToken
  );
  assert(
    xDisabled.code === 400 && /停用/.test(String(xDisabled.message)),
    `16.8 停用账户转出被拒（${xDisabled.message}）`
  );

  // ── 16.9 详情含近期流水 ───────────────────────────────────────────────────
  const accDetail = await call('GET', '/mini/admin/accounts/' + idA, null, adminToken);
  assert(accDetail.code === 200 && accDetail.data.account, `16.9 详情 200（${accDetail.code}）`);
  assert(
    Array.isArray(accDetail.data.transactions) && accDetail.data.transactions.length >= 1,
    `16.9 详情返回近期流水（实得 ${(accDetail.data.transactions || []).length} 条）`
  );
  const accMissing = await call('GET', '/mini/admin/accounts/SMKNOACC', null, adminToken);
  assert(accMissing.code === 404, `16.9 不存在的账户 → 404（实得 ${accMissing.code}）`);

  // ═════════════ 17. 工资域（Phase 8b 第 11 域）════════════════════════════════
  // ⚠️ 本域是**唯一「公司 → 个人」**的资金动作，也是最容易「静默错账」的一个：
  //    ① 实发 = 应发 − 待扣预支，**可为负**（挂账下月继续扣）——负的时候不能动账户；
  //    ② 撤销发放要账户 **+** 回补（支出方向的撤销是加，抄成减 = 撤一次反而再扣一笔，
  //       而恒等式看起来仍然成立）；
  //    ③ 预支登记**即扣款**、发放时才抵扣 —— 两件事分开，别混成一个动作；
  //    ④ ★ 预支**没有「同员工同月唯一」约束**（发放有），所以它才是幂等键最该保护的地方：
  //       重试一次就是真的再预支一笔、账户再扣一次，两笔都合法、账面看不出来。
  section('17. 工资域：实发=应发−待扣预支 / 撤销方向 / 负数挂账 / 预支幂等');

  const dl = new Date();
  const curMonth = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, '0')}`;

  // ── 17.1 权限（§22.4：小程序侧必须另设 requireMiniAdmin）────────────────────
  const salNoToken = await call('GET', '/mini/admin/salary/summary?month=' + curMonth);
  assert(
    salNoToken._status === 401 || salNoToken.code === 401,
    `17.1 无令牌读工资汇总被拒 401（实得 ${salNoToken._status}）`
  );
  const salDenied = await call('GET', '/mini/admin/salary/summary?month=' + curMonth, null, ordSalesmanToken);
  assert(
    salDenied.code === 403 && /管理员角色/.test(String(salDenied.message)),
    `17.1 业务员读工资汇总被拒 403（实得 ${salDenied.code} ${salDenied.message || ''}）`
  );
  const salPayDenied = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'x', workerId: 'w', month: curMonth, amount: 1 },
    ordSalesmanToken
  );
  assert(salPayDenied.code === 403, `17.1 业务员发放工资被拒 403（实得 ${salPayDenied.code}）`);

  // ── 17.2 表单选项与入参校验 ───────────────────────────────────────────────
  // 测试员工用 SMKSLR 前缀（清理按它识别）。workers.worker_id 无默认值 → 必须显式给。
  const slWorkerId = 'SMKSLR' + TS;
  await pool.query(
    'INSERT INTO workers (worker_id, worker_name, phone, employee_type, status, created_at, updated_at) VALUES (?, ?, ?, 2, 1, NOW(), NOW())',
    [slWorkerId, slWorkerId, '13900001111']
  );
  const salOpts = await call('GET', '/mini/admin/salary/options', null, adminToken);
  assert(salOpts.code === 200, `17.2 工资表单选项 200（${salOpts.code} ${salOpts.message || ''}）`);
  if (salOpts.code === 200) {
    assert(/^\d{4}-\d{2}$/.test(String(salOpts.data.month)), `17.2 下发默认月份（${salOpts.data.month}）`);
    assert(
      (salOpts.data.workers || []).some(w => w.workerId === slWorkerId),
      '17.2 员工下拉含新建的在职员工'
    );
    assert(
      (salOpts.data.activeAccounts || []).every(a => a.currentBalance !== undefined),
      '17.2 账户下拉只列启用账户且带余额'
    );
  }
  const salNoIdem = await call(
    'POST',
    '/mini/admin/salary/pay',
    { workerId: slWorkerId, month: curMonth, amount: 100 },
    adminToken
  );
  assert(
    salNoIdem.code === 400 && /clientRequestId/.test(String(salNoIdem.message)),
    `17.2 缺幂等键被拒（${salNoIdem.message}）`
  );
  const salBadMonth = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'smksal_' + TS + '_bm', workerId: slWorkerId, month: '2026/09', amount: 100 },
    adminToken
  );
  assert(
    salBadMonth.code === 400 && /月份/.test(String(salBadMonth.message)),
    `17.2 月份格式非法被拒（${salBadMonth.message}）`
  );
  const salGhost = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'smksal_' + TS + '_gw', workerId: 'SMKNOWORKER', month: curMonth, amount: 100 },
    adminToken
  );
  assert(salGhost.code === 400 && /员工/.test(String(salGhost.message)), `17.2 员工不存在被拒（${salGhost.message}）`);

  // ── 17.3 预支登记：**登记即扣账户**（公司先把钱给出去了）──────────────────
  const balStart = await balanceOf();
  const adv1Key = 'smksal_' + TS + '_adv1';
  const adv1Body = { clientRequestId: adv1Key, workerId: slWorkerId, amount: 300, advanceDate: today(), accountId };
  const slAdv1 = await call('POST', '/mini/admin/salary/advances', adv1Body, adminToken);
  assert(slAdv1.code === 200 && slAdv1.data.advanceId, `17.3 预支登记成功（${slAdv1.code} ${slAdv1.message || ''}）`);
  const adv1Id = slAdv1.data.advanceId;
  assert(near(await balanceOf(), balStart - 300), `17.3 ★ 账户 −300（${balStart} → ${await balanceOf()}）`);
  const advTx = (
    await pool.query(
      "SELECT tx_type, tx_category, amount FROM finance_transactions WHERE related_module = 'salary_advance' AND related_id = ?",
      [adv1Id]
    )
  )[0];
  assert(
    advTx.length === 1 && Number(advTx[0].tx_type) === 2 && advTx[0].tx_category === '工资预支',
    `17.3 支出流水（tx_type=2 / 工资预支）：${JSON.stringify(advTx[0] || null)}`
  );
  const salAudit1 = await auditActions();
  assert(salAudit1.includes('CREATE_SALARY_ADVANCE'), '17.3 审计含 CREATE_SALARY_ADVANCE');
  const advReplay = await call('POST', '/mini/admin/salary/advances', adv1Body, adminToken);
  assert(
    advReplay.code === 200 && advReplay.data.replayed === true,
    `17.3 ★ 预支幂等重放 replayed=true（${JSON.stringify(advReplay.data || advReplay.message)}）`
  );
  assert(
    near(await balanceOf(), balStart - 300),
    '17.3 ★ 重放后账户未被再扣一次 —— 预支没有同月唯一约束，全靠幂等键挡'
  );
  const advConflict = await call(
    'POST',
    '/mini/admin/salary/advances',
    Object.assign({}, adv1Body, { amount: 301 }),
    adminToken
  );
  assert(advConflict.code === 400, `17.3 同键不同金额被拒（${advConflict.code}）`);
  const advList = await call('GET', '/mini/admin/salary/advances?workerId=' + slWorkerId, null, adminToken);
  assert(
    advList.code === 200 &&
      (advList.data.list || []).some(a => a.advanceId === adv1Id && near(a.pendingAmount, 300) && a.canRevoke === true),
    `17.3 台账含该笔：待扣 300 且 canRevoke=true（实得 ${JSON.stringify((advList.data.list || [])[0] || null)}）`
  );

  // ── 17.4 撤销预支：账户回补（★ 方向 = 加）────────────────────────────────
  const revAdv1 = await call(
    'DELETE',
    '/mini/admin/salary/advances/' + adv1Id + '?clientRequestId=' + encodeURIComponent('smksal_' + TS + '_radv1'),
    null,
    adminToken
  );
  assert(revAdv1.code === 200, `17.4 撤销预支成功（${revAdv1.code} ${revAdv1.message || ''}）`);
  assert(near(await balanceOf(), balStart), `17.4 ★ 账户回补 +300（回到 ${balStart}，实得 ${await balanceOf()}）`);
  const advTxGone = (
    await pool.query(
      "SELECT COUNT(*) n FROM finance_transactions WHERE related_module = 'salary_advance' AND related_id = ?",
      [adv1Id]
    )
  )[0];
  assert(Number(advTxGone[0].n) === 0, '17.4 预支流水已删除');
  const salAudit2 = await auditActions();
  assert(salAudit2.includes('DELETE_SALARY_ADVANCE'), '17.4 审计含 DELETE_SALARY_ADVANCE');

  // ── 17.5 预览与「无应发」拒绝路径 ────────────────────────────────────────
  const prev0 = await call('GET', '/mini/admin/salary/worker/' + slWorkerId + '?month=' + curMonth, null, adminToken);
  assert(
    prev0.code === 200 && near(prev0.data.calcFee, 0),
    `17.5 预览：无订单 → 当月配送费 0（实得 ${prev0.data && prev0.data.calcFee}）`
  );
  const payNoDue = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'smksal_' + TS + '_nd', workerId: slWorkerId, month: curMonth },
    adminToken
  );
  assert(payNoDue.code === 400 && /应发/.test(String(payNoDue.message)), `17.5 无应发工资被拒（${payNoDue.message}）`);
  const prevMissing = await call('GET', '/mini/admin/salary/worker/SMKNOWORKER?month=' + curMonth, null, adminToken);
  assert(prevMissing.code === 404, `17.5 不存在的员工预览 → 404（实得 ${prevMissing.code}）`);

  // ── 17.6 ★ 发放：实发 = 应发（手动 800）− 待扣预支（500）──────────────────
  const slAdv2 = await call(
    'POST',
    '/mini/admin/salary/advances',
    { clientRequestId: 'smksal_' + TS + '_adv2', workerId: slWorkerId, amount: 500, advanceDate: today(), accountId },
    adminToken
  );
  assert(slAdv2.code === 200, `17.6 再记预支 500（${slAdv2.code} ${slAdv2.message || ''}）`);
  const adv2Id = slAdv2.data.advanceId;
  const balBeforePay = await balanceOf();
  const prev1 = await call('GET', '/mini/admin/salary/worker/' + slWorkerId + '?month=' + curMonth, null, adminToken);
  assert(
    prev1.code === 200 && near(prev1.data.pendingAdvance, 500) && near(prev1.data.net, -500),
    `17.6 预览：待扣 500 / 实发 −500（${prev1.data && prev1.data.pendingAdvance} / ${prev1.data && prev1.data.net}）`
  );
  assert(
    prev1.data.pendingAdvances &&
      prev1.data.pendingAdvances.length === 1 &&
      near(prev1.data.pendingAdvances[0].remaining, 500),
    '17.6 预览给出**逐笔**待抵扣明细（提交前能看清这笔钱抵掉了哪几笔预支）'
  );
  const payKey = 'smksal_' + TS + '_pay1';
  const pay1Body = {
    clientRequestId: payKey,
    workerId: slWorkerId,
    month: curMonth,
    amount: 800,
    accountId,
    remark: '冒烟发放'
  };
  const pay1 = await call('POST', '/mini/admin/salary/pay', pay1Body, adminToken);
  assert(pay1.code === 200 && pay1.data.paymentId, `17.6 ★ 发放成功（${pay1.code} ${pay1.message || ''}）`);
  const pay1Id = pay1.data.paymentId;
  assert(
    near(pay1.data.amount, 300) && near(pay1.data.due, 800) && near(pay1.data.pendingAdvance, 500),
    `17.6 ★ 实发 = 800 − 500 = 300（实得 ${pay1.data.amount}，应发 ${pay1.data.due}）`
  );
  assert(
    near(await balanceOf(), balBeforePay - 300),
    `17.6 ★ 账户按**实发**扣款 −300（不是应发 800，实得 ${await balanceOf()}）`
  );
  const payTx = (
    await pool.query(
      "SELECT tx_type, tx_category, amount FROM finance_transactions WHERE related_module = 'salary_payment' AND related_id = ?",
      [pay1Id]
    )
  )[0];
  assert(
    payTx.length === 1 &&
      Number(payTx[0].tx_type) === 2 &&
      payTx[0].tx_category === '工资发放' &&
      near(payTx[0].amount, 300),
    `17.6 支出流水（tx_type=2 / 工资发放 / 300）：${JSON.stringify(payTx[0] || null)}`
  );
  const adv2Row = (
    await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2Id])
  )[0];
  assert(
    near(adv2Row[0].deducted_amount, 500) && Number(adv2Row[0].status) === 1,
    `17.6 预支被抵扣并结清（deducted=${adv2Row[0].deducted_amount}, status=${adv2Row[0].status}）`
  );
  const link1 = (
    await pool.query('SELECT deducted_amount FROM salary_payment_advances WHERE payment_id = ?', [pay1Id])
  )[0];
  assert(link1.length === 1 && near(link1[0].deducted_amount, 500), '17.6 抵扣明细已落库（撤销时按它还原）');
  const salAudit3 = await auditActions();
  assert(salAudit3.includes('PAY_SALARY'), '17.6 审计含 PAY_SALARY');
  const payReplay = await call('POST', '/mini/admin/salary/pay', pay1Body, adminToken);
  assert(
    payReplay.code === 200 && payReplay.data.replayed === true,
    `17.6 ★ 发放幂等重放 replayed=true（${JSON.stringify(payReplay.data || payReplay.message)}）`
  );
  assert(near(await balanceOf(), balBeforePay - 300), '17.6 ★ 重放后账户未再扣款');
  const payDup = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'smksal_' + TS + '_pay2', workerId: slWorkerId, month: curMonth, amount: 800, accountId },
    adminToken
  );
  assert(payDup.code === 400 && /已发放/.test(String(payDup.message)), `17.6 同月重复发放被拒（${payDup.message}）`);
  const prev2 = await call('GET', '/mini/admin/salary/worker/' + slWorkerId + '?month=' + curMonth, null, adminToken);
  assert(
    prev2.data.paid === true && near(prev2.data.payment.amount, 300),
    `17.6 预览转为已发放态（${JSON.stringify(prev2.data.payment || null)}）`
  );

  // ── 17.7 ★ 撤销发放：账户 + 回补 / 流水删除 / 预支反向还原 ────────────────
  const revKey = 'smksal_' + TS + '_rev1';
  const rev1 = await call(
    'DELETE',
    '/mini/admin/salary/payments/' + pay1Id + '?clientRequestId=' + encodeURIComponent(revKey),
    null,
    adminToken
  );
  assert(rev1.code === 200, `17.7 撤销发放成功（${rev1.code} ${rev1.message || ''}）`);
  assert(
    near(await balanceOf(), balBeforePay),
    `17.7 ★ 账户回补 +300（回到 ${balBeforePay}，实得 ${await balanceOf()}）—— 支出方向的撤销是加`
  );
  const payTxGone = (
    await pool.query(
      "SELECT COUNT(*) n FROM finance_transactions WHERE related_module = 'salary_payment' AND related_id = ?",
      [pay1Id]
    )
  )[0];
  assert(Number(payTxGone[0].n) === 0, '17.7 发放流水已删除');
  const adv2Back = (
    await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2Id])
  )[0];
  assert(
    near(adv2Back[0].deducted_amount, 0) && Number(adv2Back[0].status) === 0,
    '17.7 ★ 预支抵扣已反向还原（deducted 回到 0、未结清）'
  );
  const revReplay = await call(
    'DELETE',
    '/mini/admin/salary/payments/' + pay1Id + '?clientRequestId=' + encodeURIComponent(revKey),
    null,
    adminToken
  );
  assert(
    revReplay.code === 200 && revReplay.data.replayed === true,
    `17.7 撤销幂等重放 replayed=true（${JSON.stringify(revReplay.data || revReplay.message)}）`
  );
  assert(near(await balanceOf(), balBeforePay), '17.7 ★ 重放后余额未变 —— 否则就是「撤一次反而再多一笔钱」');
  const salAudit4 = await auditActions();
  assert(salAudit4.includes('REVOKE_SALARY_PAYMENT'), '17.7 审计含 REVOKE_SALARY_PAYMENT');
  const revMissing = await call(
    'DELETE',
    '/mini/admin/salary/payments/SMKNOPAY' + TS + '?clientRequestId=' + encodeURIComponent('smksal_' + TS + '_revx'),
    null,
    adminToken
  );
  assert(revMissing.code === 404, `17.7 撤销不存在的发放 → 404（实得 ${revMissing.code}）`);

  // ── 17.8 ★ 负数挂账：预支 > 应发 → 实发为负，**不动账户、不写流水**─────────
  const balBeforeNeg = await balanceOf();
  const payNeg = await call(
    'POST',
    '/mini/admin/salary/pay',
    { clientRequestId: 'smksal_' + TS + '_pn', workerId: slWorkerId, month: curMonth, amount: 200, accountId },
    adminToken
  );
  assert(
    payNeg.code === 200 && near(payNeg.data.amount, -300),
    `17.8 ★ 实发 = 200 − 500 = −300（挂账下月继续扣，实得 ${payNeg.data && payNeg.data.amount}）`
  );
  const payNegId = payNeg.data.paymentId;
  assert(near(await balanceOf(), balBeforeNeg), `17.8 ★ 负数发放**不动账户**（仍 ${balBeforeNeg}）`);
  const negTx = (
    await pool.query(
      "SELECT COUNT(*) n FROM finance_transactions WHERE related_module = 'salary_payment' AND related_id = ?",
      [payNegId]
    )
  )[0];
  assert(Number(negTx[0].n) === 0, '17.8 负数发放不写流水（本次不涉及资金）');
  const adv2Mid = (
    await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2Id])
  )[0];
  assert(
    near(adv2Mid[0].deducted_amount, 200) && Number(adv2Mid[0].status) === 0,
    `17.8 预支部分抵扣（${adv2Mid[0].deducted_amount}/500，未结清）`
  );

  // ── 17.9 已参与结算的预支不可撤销（★ 必须给出可执行的下一步）──────────────
  const advDelBlocked = await call(
    'DELETE',
    '/mini/admin/salary/advances/' + adv2Id + '?clientRequestId=' + encodeURIComponent('smksal_' + TS + '_radv2'),
    null,
    adminToken
  );
  assert(
    advDelBlocked.code === 400 && /撤销对应月份工资发放/.test(String(advDelBlocked.message)),
    `17.9 已抵扣预支撤销被拒且给出指引（${advDelBlocked.message}）`
  );
  const negRev = await call(
    'DELETE',
    '/mini/admin/salary/payments/' + payNegId + '?clientRequestId=' + encodeURIComponent('smksal_' + TS + '_revneg'),
    null,
    adminToken
  );
  assert(negRev.code === 200, `17.9 撤销负数发放成功（${negRev.code}）`);
  assert(near(await balanceOf(), balBeforeNeg), '17.9 撤销负数发放不动账户');
  const adv2Full = (
    await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2Id])
  )[0];
  assert(
    near(adv2Full[0].deducted_amount, 0) && Number(adv2Full[0].status) === 0,
    '17.9 预支全额还原（可再次参与抵扣）'
  );

  // ── 17.10 余额不足：被拒且**余额未变**（校验在扣款之前）───────────────────
  const poorAccId = 'SMKACCQ' + TS;
  await pool.query(
    'INSERT INTO finance_accounts (account_id, account_name, account_type, initial_balance, current_balance, status, created_at, updated_at) VALUES (?, ?, 1, 10, 10, 1, NOW(), NOW())',
    [poorAccId, '冒烟账户穷' + TS]
  );
  const payPoor = await call(
    'POST',
    '/mini/admin/salary/pay',
    {
      clientRequestId: 'smksal_' + TS + '_poor',
      workerId: slWorkerId,
      month: curMonth,
      amount: 1000,
      accountId: poorAccId
    },
    adminToken
  );
  assert(
    payPoor.code === 400 && /余额不足/.test(String(payPoor.message)),
    `17.10 发放余额不足被拒（${payPoor.message}）`
  );
  const poorBal = (
    await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [poorAccId])
  )[0];
  assert(near(poorBal[0].b, 10), `17.10 ★ 被拒后余额未变（仍 10，实得 ${poorBal[0].b}）`);
  const payLeft = (await pool.query('SELECT COUNT(*) n FROM salary_payments WHERE worker_id = ?', [slWorkerId]))[0];
  assert(Number(payLeft[0].n) === 0, '17.10 ★ 被拒不留痕：事务整体回滚，没有半张发放单');
  const advPoor = await call(
    'POST',
    '/mini/admin/salary/advances',
    {
      clientRequestId: 'smksal_' + TS + '_poora',
      workerId: slWorkerId,
      amount: 1000,
      advanceDate: today(),
      accountId: poorAccId
    },
    adminToken
  );
  assert(
    advPoor.code === 400 && /余额不足/.test(String(advPoor.message)),
    `17.10 预支余额不足被拒（${advPoor.message}）`
  );

  // ── 17.11 汇总口径与个人信息红线 ──────────────────────────────────────────
  const salSum = await call('GET', '/mini/admin/salary/summary?month=' + curMonth, null, adminToken);
  assert(
    salSum.code === 200 && Array.isArray(salSum.data.list),
    `17.11 工资汇总 200（${salSum.code} ${salSum.message || ''}）`
  );
  const slRow = (salSum.data.list || []).find(x => x.workerId === slWorkerId);
  assert(
    !!slRow && slRow.due !== undefined && slRow.net !== undefined && slRow.paid !== undefined,
    `17.11 汇总行含 应发/实发/发放状态（${JSON.stringify(slRow || null)}）`
  );
  // ★ 个人信息：loadSalarySummary 会带出 w.phone（Web 统计页要用），
  //   小程序接口必须**逐字段映射**把它挡掉（文档 §八：一律不下发明文手机号）
  assert(slRow && slRow.phone === undefined, '17.11 ★ 汇总行不含手机号（脱敏）');
  assert(
    (salSum.data.list || []).every(x => x.phone === undefined),
    '17.11 ★ 整个列表均无 phone 字段'
  );
  const salBadRange = await call('GET', '/mini/admin/salary/summary?range=bogus', null, adminToken);
  assert(salBadRange.code === 400, `17.11 非法区间 → 400（不得静默降级为「不限区间」，实得 ${salBadRange.code}）`);

  // ═════════════ 18. 报表三域（Phase 8b 第 12~14 域：营收 / 成本 / 利润）══════
  // ⚠️ 报表域的风险面只有一条：**数字与 Web 端不一致**。所以本节的核心不是「接口通不通」，
  //    而是「同一区间下小程序与 Web 的同一个数必须逐位相等」—— 这是「取数单源」这件事
  //    唯一的可验证证明（只验接口 200 的话，两边各写一套 SQL 也能全绿）。
  // ⚠️ 另一条硬断言：**区间白名单**。营收用的 financialController.resolveDateRange 曾对未知 key
  //    走 default 分支**静默退化成「今天」**（不报错、数字还像模像样）；2026-09-22 已修：
  //    未知区间返回 null → 400。本节对 Web 与小程序**两侧**都断言「非法区间必须 400」。
  section('18. 报表三域：取数单源跨端一致 + 区间白名单（不做静默退化）');

  // 跨端比对需要 Web 令牌（Web 侧报表接口挂的是 Web 鉴权）
  const webLogin = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(
    webLogin.code === 200 && !!(webLogin.data && webLogin.data.token),
    `18.0 取 Web 管理员令牌（${webLogin.code}）`
  );
  const webToken = webLogin.data && webLogin.data.token;
  const web = async p => {
    const r = await fetch('http://localhost:3000/api' + p, { headers: { Authorization: 'Bearer ' + webToken } });
    return r.json().catch(() => ({}));
  };

  // ── 18.1 权限（只读报表同样只给管理员）─────────────────────────────────
  const repNoToken = await call('GET', '/mini/admin/reports/revenue');
  assert(
    repNoToken._status === 401 || repNoToken.code === 401,
    `18.1 无令牌读报表被拒 401（实得 ${repNoToken._status}）`
  );
  for (const p of ['revenue', 'cost', 'profit']) {
    const denied = await call('GET', '/mini/admin/reports/' + p, null, ordSalesmanToken);
    assert(
      denied.code === 403 && /管理员角色/.test(String(denied.message)),
      `18.1 业务员读 ${p} 被拒 403（实得 ${denied.code} ${denied.message || ''}）`
    );
  }

  // ── 18.2 三域 200 + 形状与选项 ──────────────────────────────────────────
  const repRev = await call('GET', '/mini/admin/reports/revenue?range=month', null, adminToken);
  const repCost = await call('GET', '/mini/admin/reports/cost?range=month', null, adminToken);
  const repProfit = await call('GET', '/mini/admin/reports/profit?range=month', null, adminToken);
  assert(
    repRev.code === 200 && Array.isArray(repRev.data.list),
    `18.2 营收概览 200（${repRev.code} ${repRev.message || ''}）`
  );
  assert(
    repCost.code === 200 && Array.isArray(repCost.data.list),
    `18.2 成本概览 200（${repCost.code} ${repCost.message || ''}）`
  );
  assert(
    repProfit.code === 200 && Array.isArray(repProfit.data.list),
    `18.2 利润概览 200（${repProfit.code} ${repProfit.message || ''}）`
  );
  assert(
    [repRev, repCost, repProfit].every(x => x.code === 200 && (x.data.list || []).length === 6),
    '18.2 三域明细均恰好 6 行（6 个订单类型维度；其他收入只进总额、不进 list）'
  );
  assert(
    (repRev.data.rangeOptions || []).some(o => o.value === 'all') &&
      !(repRev.data.rangeOptions || []).some(o => o.value === 'quarter'),
    '18.2 ★ 营收下发 month/year/all 且**不含 quarter**（与其实现的分支一致）'
  );
  assert(
    (repCost.data.rangeOptions || []).some(o => o.value === 'quarter') &&
      !(repCost.data.rangeOptions || []).some(o => o.value === 'all'),
    '18.2 ★ 成本下发含 quarter 且不含 all（dateRange 的 RANGE_KEYS 无 all）'
  );

  // ── 18.3 ★★ 取数单源：同一区间下小程序与 Web 逐行相等 ─────────────────────
  const wRev = await web('/finance/summary?range=month');
  const wCost = await web('/cost/overview?range=month');
  const wProfit = await web('/profit/overview?range=month');
  assert(
    wRev.code === 200 && wCost.code === 200 && wProfit.code === 200,
    `18.3 Web 侧三个报表接口可达（比对前提：${wRev.code}/${wCost.code}/${wProfit.code}）`
  );
  assert(
    near(repRev.data.totalRevenue, wRev.data.overall.totalRevenue),
    `18.3 ★ 营收总额一致（小程序 ${repRev.data.totalRevenue} vs Web ${wRev.data.overall.totalRevenue}）`
  );
  assert(
    near(repRev.data.otherIncome, wRev.data.overall.otherIncome),
    `18.3 ★ 其他收入一致（${repRev.data.otherIncome} vs ${wRev.data.overall.otherIncome}）`
  );
  // 逐行比对 6 个订单类型 —— 只比总额是不够的：总额相等但某一行错位完全可能
  assert(
    repRev.data.list.every(x => {
      const w = (wRev.data.list || []).find(y => y.orderType === x.orderType);
      return (
        w && near(x.revenue, w.revenue) && near(x.goodsAmount, w.goodsAmount) && near(x.deliveryFee, w.deliveryFee)
      );
    }),
    '18.3 ★ 营收 6 行逐行一致（货款 / 配送费 / 营收）'
  );
  assert(
    near(repCost.data.orderCostTotal, wCost.data.orderCostTotal),
    `18.3 ★ 成本合计一致（${repCost.data.orderCostTotal} vs ${wCost.data.orderCostTotal}）`
  );
  assert(
    repCost.data.list.every(x => {
      const w = (wCost.data.list || []).find(y => y.orderType === x.orderType);
      return w && near(x.costTotal, w.costTotal);
    }),
    '18.3 ★ 成本 6 行逐行一致'
  );
  assert(
    near(repProfit.data.overall.profit, wProfit.data.overall.profit),
    `18.3 ★ 利润一致（${repProfit.data.overall.profit} vs ${wProfit.data.overall.profit}）`
  );
  assert(
    near(repProfit.data.overall.profit, repProfit.data.overall.revenue - repProfit.data.overall.costTotal),
    `18.3 ★ 利润恒等式成立：profit === revenue − costTotal（${repProfit.data.overall.profit}）`
  );
  assert(
    repProfit.data.list.every(x => {
      const w = (wProfit.data.list || []).find(y => y.orderType === x.orderType);
      return w && near(x.profit, w.profit) && near(x.costTotal, w.costTotal);
    }),
    '18.3 ★ 利润 6 行逐行一致'
  );

  // ── 18.4 ★ 区间白名单：未知区间一律 400，绝不静默退化 ────────────────────
  const revQuarter = await call('GET', '/mini/admin/reports/revenue?range=quarter', null, adminToken);
  assert(
    revQuarter.code === 400,
    `18.4 ★ 营收 range=quarter → 400（该实现无此分支；静默退化会返回单日数字，实得 ${revQuarter.code}）`
  );
  const wRevQuarter = await web('/finance/summary?range=quarter');
  assert(
    wRevQuarter.code === 400,
    `18.4 ★ Web 侧 /finance/summary?range=quarter → 400（2026-09-22 修复：不再静默按「今天」算，实得 ${wRevQuarter.code}）`
  );
  const wRevBogus = await web('/finance/summary?range=bogus');
  assert(
    wRevBogus.code === 400,
    `18.4 ★ Web 侧未知区间一律 400（range=bogus 实得 ${wRevBogus.code}）—— 静默退化的表现是「200 + 一个像正常结果的单日数」`
  );
  const wRevDay = await web('/finance/summary?range=day');
  assert(wRevDay.code === 200, `18.4 Web 侧合法区间不受影响（range=day 实得 ${wRevDay.code}）`);
  const wRevCustomLack = await web('/finance/summary?range=custom');
  assert(
    wRevCustomLack.code === 400,
    `18.4 ★ custom 缺起止日期 → 400（给一半不再被静默忽略，实得 ${wRevCustomLack.code}）`
  );
  for (const p of ['revenue', 'cost', 'profit']) {
    const bogus = await call('GET', '/mini/admin/reports/' + p + '?range=bogus', null, adminToken);
    assert(bogus.code === 400, `18.4 ${p} range=bogus → 400（实得 ${bogus.code}）`);
  }
  const costAll = await call('GET', '/mini/admin/reports/cost?range=all', null, adminToken);
  assert(costAll.code === 400, `18.4 成本 range=all → 400（dateRange 的 RANGE_KEYS 里没有 all，实得 ${costAll.code}）`);

  // ═════════════ 19. 回桶域（Phase 8b 第 16 域：押金台账 + 桶型配置）═════════
  // ⚠️ 两个断言重点：
  //    ① **方向**：收取押金 = 账户 **+** / 退回押金 = 账户 **−**；抄反了台账照样能对上
  //       （两类流水都在 barrel_deposit 下），只有余额会错。
  //    ② **跨端联动**（定式 ⑫）：桶型配置停用后，押金登记必须被拒 ——
  //       「配置改对了」不等于「下游看见了」，配置类写操作只验自己等于没验。
  section('19. 回桶域：押金方向 / 桶型配置跨端联动 / 不可编辑历史');

  const bcBarrelType = 'SMKBC' + TS;
  const bcBarrelType2 = 'SMKBC2' + TS;
  const barrelCfgKey = 'smkbc_' + TS + '_c1';
  const bcAudit = () => auditActions();

  // ── 19.1 权限 ────────────────────────────────────────────────────────────
  const bcNoToken = await call('GET', '/mini/admin/barrels/summary');
  assert(
    bcNoToken._status === 401 || bcNoToken.code === 401,
    `19.1 无令牌读押金台账被拒 401（实得 ${bcNoToken._status}）`
  );
  const bcDenied = await call('GET', '/mini/admin/barrels/summary', null, ordSalesmanToken);
  assert(
    bcDenied.code === 403 && /管理员角色/.test(String(bcDenied.message)),
    `19.1 业务员读押金台账被拒 403（实得 ${bcDenied.code}）`
  );
  const bcWriteDenied = await call(
    'POST',
    '/mini/admin/barrels/deposits',
    { clientRequestId: 'x', accountId: accountId, barrelType: bcBarrelType, quantity: 1, unitPrice: 30 },
    ordSalesmanToken
  );
  assert(bcWriteDenied.code === 403, `19.1 业务员登记押金被拒 403（实得 ${bcWriteDenied.code}）`);

  // ── 19.2 选项 ────────────────────────────────────────────────────────────
  const bcOpts = await call('GET', '/mini/admin/barrels/options', null, adminToken);
  assert(bcOpts.code === 200, `19.2 回桶选项 200（${bcOpts.code} ${bcOpts.message || ''}）`);
  assert(
    Array.isArray(bcOpts.data.barrelTypes) &&
      Array.isArray(bcOpts.data.stations) &&
      Array.isArray(bcOpts.data.activeAccounts),
    '19.2 选项含 桶型/水站/启用账户'
  );

  // ── 19.3 桶型配置：新增 / 幂等 / 重名 / 改价（含审计）────────────────────
  const bcNoIdem = await call(
    'POST',
    '/mini/admin/barrels/configs',
    { barrelType: bcBarrelType, depositPrice: 30 },
    adminToken
  );
  assert(
    bcNoIdem.code === 400 && /clientRequestId/.test(String(bcNoIdem.message)),
    `19.3 缺幂等键被拒（${bcNoIdem.message}）`
  );
  const bcCreate = await call(
    'POST',
    '/mini/admin/barrels/configs',
    { clientRequestId: barrelCfgKey, barrelType: bcBarrelType, depositPrice: 30, sortOrder: 900 },
    adminToken
  );
  assert(bcCreate.code === 200 && bcCreate.data.id, `19.3 新增桶型成功（${bcCreate.code} ${bcCreate.message || ''}）`);
  const bcId = bcCreate.data.id;
  const bcReplay = await call(
    'POST',
    '/mini/admin/barrels/configs',
    { clientRequestId: barrelCfgKey, barrelType: bcBarrelType, depositPrice: 30, sortOrder: 900 },
    adminToken
  );
  assert(bcReplay.code === 200 && bcReplay.data.replayed === true, '19.3 新增幂等重放 replayed=true');
  const bcDup = await call(
    'POST',
    '/mini/admin/barrels/configs',
    { clientRequestId: 'smkbc_' + TS + '_dup', barrelType: bcBarrelType, depositPrice: 30 },
    adminToken
  );
  assert(bcDup.code === 400 && /已存在/.test(String(bcDup.message)), `19.3 重名被拒（${bcDup.message}）`);
  const bcList1 = await call('GET', '/mini/admin/barrels/configs', null, adminToken);
  assert(
    (bcList1.data.list || []).some(c => c.id === bcId && Number(c.depositPrice) === 30 && c.status === true),
    '19.3 列表含新桶型且押金价 30'
  );
  const bcPriceUp = await call(
    'PUT',
    '/mini/admin/barrels/configs/' + bcId,
    { clientRequestId: 'smkbc_' + TS + '_up1', barrelType: bcBarrelType, depositPrice: 50, status: 1, sortOrder: 900 },
    adminToken
  );
  assert(bcPriceUp.code === 200, `19.3 改押金价成功（${bcPriceUp.code} ${bcPriceUp.message || ''}）`);
  const bcList2 = await call('GET', '/mini/admin/barrels/configs', null, adminToken);
  assert(
    (bcList2.data.list || []).some(c => c.id === bcId && Number(c.depositPrice) === 50),
    '19.3 列表反映新价 50'
  );
  const bcAudit1 = await bcAudit();
  assert(
    bcAudit1.includes('CREATE_BARREL_CONFIG') && bcAudit1.includes('UPDATE_BARREL_CONFIG'),
    '19.3 审计含 CREATE_BARREL_CONFIG / UPDATE_BARREL_CONFIG'
  );

  // ── 19.4 ★ 押金登记（资金动作）：收取 = 账户 + ─────────────────────────────
  const bcAccBefore = await balanceOf();
  const bcDepKey = 'smkbc_' + TS + '_d1';
  const bcDepBody = {
    clientRequestId: bcDepKey,
    depositType: 'collect',
    partyType: 'customer',
    customerName: '冒烟零售客户' + TS,
    // 留一个**能精确搜索的**手机号：断言响应里搜不到它（比正则猜数字更可靠 ——
    // 测试数据本身带时间戳数字，用 /\d{7,}/ 判定会误报）
    customerPhone: '13900008888',
    barrelType: bcBarrelType,
    quantity: 2,
    unitPrice: 50,
    accountId,
    remark: '冒烟-收押金'
  };
  const bcDep = await call('POST', '/mini/admin/barrels/deposits', bcDepBody, adminToken);
  assert(bcDep.code === 200 && bcDep.data.depositNo, `19.4 押金收取成功（${bcDep.code} ${bcDep.message || ''}）`);
  const bcDepNo = bcDep.data.depositNo;
  assert(near(bcDep.data.amount, 100), `19.4 金额 = 2 × 50 = 100（实得 ${bcDep.data.amount}）`);
  assert(near(await balanceOf(), bcAccBefore + 100), `19.4 ★ **账户 +**100（${bcAccBefore} → ${await balanceOf()}）`);
  const bcTx = (
    await pool.query(
      "SELECT tx_type, tx_category, amount FROM finance_transactions WHERE related_module = 'barrel_deposit' AND related_id = ?",
      [bcDepNo]
    )
  )[0];
  assert(
    bcTx.length === 1 &&
      Number(bcTx[0].tx_type) === 1 &&
      bcTx[0].tx_category === '押金收取' &&
      near(bcTx[0].amount, 100),
    `19.4 收入流水（tx_type=1 / 押金收取 / 100）：${JSON.stringify(bcTx[0] || null)}`
  );
  const bcAudit2 = await bcAudit();
  assert(bcAudit2.includes('CREATE_BARREL_DEPOSIT'), '19.4 审计含 CREATE_BARREL_DEPOSIT');

  // 幂等重放：不得收两次
  const bcDepReplay = await call('POST', '/mini/admin/barrels/deposits', bcDepBody, adminToken);
  assert(
    bcDepReplay.code === 200 && bcDepReplay.data.replayed === true,
    `19.4 ★ 押金幂等重放 replayed=true（${JSON.stringify(bcDepReplay.data || bcDepReplay.message)}）`
  );
  assert(near(await balanceOf(), bcAccBefore + 100), '19.4 ★ 重放后账户未再增加（押金没有天然唯一约束，全靠幂等键）');
  const bcDepRows = (
    await pool.query('SELECT COUNT(*) AS n FROM barrel_deposits WHERE barrel_type = ?', [bcBarrelType])
  )[0];
  assert(Number(bcDepRows[0].n) === 1, `19.4 押金记录仍为 1 条（实得 ${bcDepRows[0].n}）`);

  // 汇总：在押 2 桶 / 100 元
  const bcSum = await call(
    'GET',
    '/mini/admin/barrels/summary?barrelType=' + encodeURIComponent(bcBarrelType),
    null,
    adminToken
  );
  const bcSumRow = (bcSum.data.list || []).find(x => x.barrelType === bcBarrelType);
  assert(
    bcSumRow && bcSumRow.pendingQty === 2 && near(bcSumRow.pendingAmount, 100),
    `19.4 在押汇总 2 桶 / 100 元（实得 ${JSON.stringify(bcSumRow || null)}）`
  );
  assert(bcSumRow && bcSumRow.partyName === '冒烟零售客户' + TS, '19.4 汇总对象名为客户姓名');

  // ── 19.5 ★ 退回 = 账户 − / 超额拒绝 ──────────────────────────────────────
  const bcRetKey = 'smkbc_' + TS + '_r1';
  const bcRetBody = Object.assign({}, bcDepBody, {
    clientRequestId: bcRetKey,
    depositType: 'return',
    quantity: 1
  });
  const bcRet = await call('POST', '/mini/admin/barrels/deposits', bcRetBody, adminToken);
  assert(bcRet.code === 200, `19.5 押金退回成功（${bcRet.code} ${bcRet.message || ''}）`);
  assert(near(await balanceOf(), bcAccBefore + 50), `19.5 ★ **账户 −**50（实得 ${await balanceOf()}）`);
  const bcRetTx = (
    await pool.query(
      "SELECT tx_type, tx_category FROM finance_transactions WHERE related_module = 'barrel_deposit' AND related_id = ?",
      [bcRet.data.depositNo]
    )
  )[0];
  assert(
    bcRetTx.length === 1 && Number(bcRetTx[0].tx_type) === 2 && bcRetTx[0].tx_category === '押金退回',
    `19.5 支出流水（tx_type=2 / 押金退回）：${JSON.stringify(bcRetTx[0] || null)}`
  );
  const bcOver = await call(
    'POST',
    '/mini/admin/barrels/deposits',
    Object.assign({}, bcDepBody, { clientRequestId: 'smkbc_' + TS + '_ov', depositType: 'return', quantity: 99 }),
    adminToken
  );
  assert(
    bcOver.code === 400 && /超过在押桶数/.test(String(bcOver.message)),
    `19.5 退回超过在押桶数被拒（${bcOver.message}）`
  );
  assert(near(await balanceOf(), bcAccBefore + 50), '19.5 ★ 被拒后账户未变（校验在动账之前）');

  // ── 19.6 ★ 跨端联动：停用桶型 → 押金登记被拒 ─────────────────────────────
  const bcDisable = await call(
    'PUT',
    '/mini/admin/barrels/configs/' + bcId,
    { clientRequestId: 'smkbc_' + TS + '_off', barrelType: bcBarrelType, depositPrice: 50, status: 0, sortOrder: 900 },
    adminToken
  );
  assert(bcDisable.code === 200, `19.6 停用桶型成功（${bcDisable.code}）`);
  const bcAfterDisable = await call('GET', '/mini/admin/barrels/options', null, adminToken);
  assert(
    !(bcAfterDisable.data.barrelTypes || []).some(b => b.barrelType === bcBarrelType),
    '19.6 ★ 联动：停用后**不再出现**在登记表单可选桶型里'
  );
  const bcDisabledWrite = await call(
    'POST',
    '/mini/admin/barrels/deposits',
    Object.assign({}, bcDepBody, { clientRequestId: 'smkbc_' + TS + '_cw' }),
    adminToken
  );
  assert(
    bcDisabledWrite.code === 400 && /桶型不存在或已停用/.test(String(bcDisabledWrite.message)),
    `19.6 ★ 联动：停用后直接调接口登记被拒（${bcDisabledWrite.message}）`
  );
  // 删除有流水的桶型 → 拒绝并提示停用
  const bcDelUsed = await call(
    'DELETE',
    '/mini/admin/barrels/configs/' + bcId + '?clientRequestId=' + encodeURIComponent('smkbc_' + TS + '_du'),
    null,
    adminToken
  );
  assert(
    bcDelUsed.code === 400 && /改为停用/.test(String(bcDelUsed.message)),
    `19.6 有流水的桶型删除被拒并提示停用（${bcDelUsed.message}）`
  );
  // 无流水的桶型可删
  const bcCreate2 = await call(
    'POST',
    '/mini/admin/barrels/configs',
    { clientRequestId: 'smkbc_' + TS + '_c2', barrelType: bcBarrelType2, depositPrice: 10 },
    adminToken
  );
  const bcId2 = bcCreate2.data.id;
  const bcDel2 = await call(
    'DELETE',
    '/mini/admin/barrels/configs/' + bcId2 + '?clientRequestId=' + encodeURIComponent('smkbc_' + TS + '_d2'),
    null,
    adminToken
  );
  assert(bcDel2.code === 200, `19.6 无流水桶型物理删除成功（${bcDel2.code} ${bcDel2.message || ''}）`);
  const bcAudit3 = await bcAudit();
  assert(bcAudit3.includes('DELETE_BARREL_CONFIG'), '19.6 审计含 DELETE_BARREL_CONFIG');
  const bcDelReplay = await call(
    'DELETE',
    '/mini/admin/barrels/configs/' + bcId2 + '?clientRequestId=' + encodeURIComponent('smkbc_' + TS + '_d2'),
    null,
    adminToken
  );
  assert(bcDelReplay.code === 200 && bcDelReplay.data.replayed === true, '19.6 删除幂等重放 replayed=true');

  // ── 19.7 个人信息：不发明文手机号 ────────────────────────────────────────
  const bcListDep = await call(
    'GET',
    '/mini/admin/barrels/deposits?barrelType=' + encodeURIComponent(bcBarrelType),
    null,
    adminToken
  );
  assert(bcListDep.code === 200 && (bcListDep.data.list || []).length === 2, `19.7 押金流水 2 条（收+退）`);
  assert(
    (bcListDep.data.list || []).every(d => d.customerPhone === undefined),
    '19.7 流水不返回 customerPhone 字段'
  );
  assert(
    !JSON.stringify(bcListDep.data).includes('13900008888'),
    '19.7 ★ 押金流水不含明文手机号（登记时填的号码在响应里搜不到，partyName 已重建）'
  );
  assert(!JSON.stringify(bcSum.data).includes('13900008888'), '19.7 ★ 押金汇总不含明文手机号');

  // ═════════════ 20. 系统设置域（Phase 8b 第 17 域：销售单打印店长）═══════════
  // ⚠️ 这是**全局配置**：本节的清理段会把原值还原（否则跑一次冒烟就改掉了真实的打印配置）。
  section('20. 系统设置域：打印店长（全局配置，冒烟后原值还原）');

  const [pmSnapshotRows] = await pool.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'print_manager_worker_id'"
  );
  // ⚠️ 赋值给**模块级**变量：清理段在 main() 之外的 finally 里，读不到函数内的 const
  pmSnapshot = pmSnapshotRows.length ? pmSnapshotRows[0].setting_value : null;

  // 测试用店长（employee_type = 1 才会出现在「在职店长」下拉里）
  const pmWorkerId = 'SMKSLR' + TS + 'PM';
  await pool.query(
    'INSERT INTO workers (worker_id, worker_name, phone, employee_type, status, created_at, updated_at) VALUES (?, ?, ?, 1, 1, NOW(), NOW())',
    [pmWorkerId, 'SMKSLR店长' + TS, '13900002222']
  );

  // ── 20.1 权限 ────────────────────────────────────────────────────────────
  const pmNoToken = await call('GET', '/mini/admin/settings/print-manager');
  assert(pmNoToken._status === 401 || pmNoToken.code === 401, `20.1 无令牌读配置被拒 401（实得 ${pmNoToken._status}）`);
  const pmDenied = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'x', workerId: pmWorkerId },
    ordSalesmanToken
  );
  assert(pmDenied.code === 403, `20.1 业务员改配置被拒 403（实得 ${pmDenied.code}）`);

  // ── 20.2 读 + 选项 ───────────────────────────────────────────────────────
  const pmGet = await call('GET', '/mini/admin/settings/print-manager', null, adminToken);
  assert(pmGet.code === 200 && pmGet.data.source, `20.2 读取当前打印店长 200（${pmGet.code}）`);
  const pmOpts = await call('GET', '/mini/admin/settings/options', null, adminToken);
  assert(pmOpts.code === 200 && Array.isArray(pmOpts.data.storeManagers), '20.2 选项含在职店长列表');
  assert(
    (pmOpts.data.storeManagers || []).some(m => m.workerId === pmWorkerId),
    '20.2 新建的在职店长出现在候选里'
  );

  // ── 20.3 设置 + 审计 + 幂等 ──────────────────────────────────────────────
  const pmKey = 'smkpm_' + TS + '_1';
  const pmSet = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: pmKey, workerId: pmWorkerId },
    adminToken
  );
  assert(
    pmSet.code === 200 && pmSet.data.workerId === pmWorkerId,
    `20.3 设置打印店长成功（${pmSet.code} ${pmSet.message || ''}）`
  );
  assert(pmSet.data.source === 'setting', `20.3 来源标记为「按配置」（实得 ${pmSet.data.source}）`);
  const pmGet2 = await call('GET', '/mini/admin/settings/print-manager', null, adminToken);
  assert(pmGet2.data.workerId === pmWorkerId, '20.3 读回同一人（配置确实落库）');
  const pmAudit = await auditActions();
  assert(pmAudit.includes('UPDATE_SETTING'), '20.3 审计含 UPDATE_SETTING');
  const pmReplay = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: pmKey, workerId: pmWorkerId },
    adminToken
  );
  assert(pmReplay.code === 200 && pmReplay.data.replayed === true, '20.3 幂等重放 replayed=true');

  // ── 20.4 非法入参 ────────────────────────────────────────────────────────
  const pmNoIdem = await call('PUT', '/mini/admin/settings/print-manager', { workerId: pmWorkerId }, adminToken);
  assert(
    pmNoIdem.code === 400 && /clientRequestId/.test(String(pmNoIdem.message)),
    `20.4 缺幂等键被拒（${pmNoIdem.message}）`
  );
  const pmMissing = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'smkpm_' + TS + '_m' },
    adminToken
  );
  assert(
    pmMissing.code === 400 && /workerId/.test(String(pmMissing.message)),
    `20.4 不传 workerId 被拒（少传字段与「我要清空」是两件事，${pmMissing.message}）`
  );
  const pmGhost = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'smkpm_' + TS + '_g', workerId: 'SMKNOWORKER' },
    adminToken
  );
  assert(
    pmGhost.code === 400 && /员工不存在/.test(String(pmGhost.message)),
    `20.4 不存在的员工被拒（${pmGhost.message}）`
  );
  // 停用员工
  await pool.query('UPDATE workers SET status = 0 WHERE worker_id = ?', [pmWorkerId]);
  const pmOff = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'smkpm_' + TS + '_off', workerId: pmWorkerId },
    adminToken
  );
  assert(pmOff.code === 400 && /离职/.test(String(pmOff.message)), `20.4 停用员工被拒（${pmOff.message}）`);
  await pool.query('UPDATE workers SET status = 1 WHERE worker_id = ?', [pmWorkerId]);

  // ── 20.5 ★ 清除 → 回退（且不静默换人：配置指向停用员工时仍按配置）───────────
  const pmClear = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'smkpm_' + TS + '_clear', workerId: null },
    adminToken
  );
  assert(
    pmClear.code === 200 && pmClear.data.source === 'fallback',
    `20.5 ★ 清除后回退（source 实得 ${pmClear.data.source}）`
  );
  // ⚠️ 不能断言「回退到的人 ≠ 刚才那位」：库里若只有这一位在职店长，回退本来就该是他。
  //    正确判据是与 SQL 口径一致（第一位启用的店长，worker_id 升序）。
  const [[expectFirstManager]] = await pool.query(
    'SELECT worker_id FROM workers WHERE employee_type = 1 AND status = 1 ORDER BY worker_id ASC LIMIT 1'
  );
  assert(
    pmClear.data.workerId === expectFirstManager.worker_id,
    `20.5 回退取到「第一位在职店长」（期望 ${expectFirstManager.worker_id}，实得 ${pmClear.data.workerId}）`
  );

  // ── 20.6 ★ 个人信息：手机号脱敏 + 无 phone 字段 ─────────────────────────
  assert(!Object.prototype.hasOwnProperty.call(pmGet2.data, 'phone'), '20.6 ★ 响应不含 phone 字段（文档 §八）');
  assert(
    !pmGet2.data.phoneMasked || /^\d{3}\*{4}\d{4}$/.test(pmGet2.data.phoneMasked),
    `20.6 ★ 手机号已脱敏（实得「${pmGet2.data.phoneMasked}」）`
  );

  // ── 20.7 ★ 跨端一致：Web 与小程序解析到同一位店长 ────────────────────────
  const pmSetAgain = await call(
    'PUT',
    '/mini/admin/settings/print-manager',
    { clientRequestId: 'smkpm_' + TS + '_2', workerId: pmWorkerId },
    adminToken
  );
  void pmSetAgain;
  const pmWeb = await web('/system-settings/print-manager');
  const pmMini = await call('GET', '/mini/admin/settings/print-manager', null, adminToken);
  assert(
    pmWeb.code === 200 && pmMini.code === 200 && pmWeb.data.workerId === pmMini.data.workerId,
    `20.7 ★ 跨端一致：Web ${pmWeb.data && pmWeb.data.workerId} == 小程序 ${pmMini.data && pmMini.data.workerId}`
  );

  // ═════════════ 21. 水票域（第 15 域 + Phase 7 补齐：发行 / 改数量 / 作废）═════════
  // ⚠️ Phase 7 已落地：发行与改数量**已开放**（两者都会动水站积分），**批次删除仍不开放**。
  //    故本节两条腿都要走：既验「开放了的能做、且方向与金额正确」，也验「没开放的仍 404」。
  // ⚠️ 发行/改数量是资金动作 → 必带幂等键，且**重放不得重复入账**（弱网重试的典型场景）。
  section('21. 水票域：库存/明细/发行记录 + 发行入账 + 改数量 + 作废回冲 + ★ 范围反向断言');

  const wtTicketA = 'SMKWT' + TS + 'A'; // 未使用（可作废）
  const wtTicketB = 'SMKWT' + TS + 'B'; // 已核销（作废必须被拒）
  const [[wtStation]] = await pool.query('SELECT station_id FROM sub_stations ORDER BY station_id LIMIT 1');
  const [[wtProduct]] = await pool.query('SELECT product_id FROM products ORDER BY product_id LIMIT 1');
  const wtMonth = curMonth;
  await pool.query(
    `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
     VALUES (?, ?, ?, 1, ?, NOW(), 'smoke', '冒烟-未使用'), (?, ?, ?, 2, ?, NOW(), 'smoke', '冒烟-已核销')`,
    [
      wtTicketA,
      wtProduct.product_id,
      wtStation.station_id,
      wtMonth,
      wtTicketB,
      wtProduct.product_id,
      wtStation.station_id,
      wtMonth
    ]
  );

  // ── 21.1 权限 ────────────────────────────────────────────────────────────
  const wtNoToken = await call('GET', '/mini/admin/water-tickets/inventory');
  assert(
    wtNoToken._status === 401 || wtNoToken.code === 401,
    `21.1 无令牌读水票库存被拒 401（实得 ${wtNoToken._status}）`
  );
  const wtDenied = await call('GET', '/mini/admin/water-tickets/list', null, ordSalesmanToken);
  assert(
    wtDenied.code === 403 && /管理员角色/.test(String(wtDenied.message)),
    `21.1 业务员读水票明细被拒 403（实得 ${wtDenied.code}）`
  );
  const wtCancelDenied = await call(
    'POST',
    '/mini/admin/water-tickets/' + wtTicketA + '/cancel',
    { clientRequestId: 'x' },
    ordSalesmanToken
  );
  assert(wtCancelDenied.code === 403, `21.1 业务员作废被拒 403（实得 ${wtCancelDenied.code}）`);

  // ── 21.2 选项与三个只读接口 ──────────────────────────────────────────────
  const wtOpts = await call('GET', '/mini/admin/water-tickets/options', null, adminToken);
  assert(wtOpts.code === 200, `21.2 水票选项 200（${wtOpts.code} ${wtOpts.message || ''}）`);
  assert(
    Array.isArray(wtOpts.data.stations) &&
      Array.isArray(wtOpts.data.products) &&
      Array.isArray(wtOpts.data.statusOptions),
    '21.2 选项含 水站 / 商品 / 状态'
  );
  assert(
    !('activeAccounts' in wtOpts.data),
    '21.2 ★ 选项不含账户（发行入的是**水站钱包**，与公司资金账户无关；列出来会被当成要选账户）'
  );
  const wtInv = await call('GET', '/mini/admin/water-tickets/inventory', null, adminToken);
  assert(
    wtInv.code === 200 && Array.isArray(wtInv.data.list),
    `21.2 水票库存 200（${wtInv.code} ${wtInv.message || ''}）`
  );
  const wtList = await call(
    'GET',
    '/mini/admin/water-tickets/list?stationId=' + encodeURIComponent(wtStation.station_id),
    null,
    adminToken
  );
  assert(wtList.code === 200 && Array.isArray(wtList.data.list), `21.2 水票明细 200（${wtList.code}）`);
  const wtRowA = (wtList.data.list || []).find(t => t.ticketId === wtTicketA);
  assert(
    wtRowA && wtRowA.status === 1 && wtRowA.statusName && wtRowA.canCancel === true,
    `21.2 明细行带状态中文名与 canCancel（实得 ${JSON.stringify(wtRowA || null)}）`
  );
  const wtRowB = (wtList.data.list || []).find(t => t.ticketId === wtTicketB);
  assert(wtRowB && wtRowB.canCancel === false, '21.2 已核销的票 canCancel=false');
  const wtIss = await call('GET', '/mini/admin/water-tickets/issuances', null, adminToken);
  assert(wtIss.code === 200 && Array.isArray(wtIss.data.list), `21.2 发行记录 200（${wtIss.code}）`);
  assert(
    typeof wtIss.data.notice === 'string' && /删除批次/.test(wtIss.data.notice),
    `21.2 ★ 发行记录页的说明改为「删除批次仍在 Web」（范围决定要说清，实得「${wtIss.data.notice}」）`
  );

  // ── 21.3 作废单张（幂等 + 审计 + 状态守卫）───────────────────────────────
  const wtNoIdem = await call('POST', '/mini/admin/water-tickets/' + wtTicketA + '/cancel', null, adminToken);
  assert(
    wtNoIdem.code === 400 && /clientRequestId/.test(String(wtNoIdem.message)),
    `21.3 缺幂等键被拒（${wtNoIdem.message}）`
  );
  const wtGhost = await call(
    'POST',
    '/mini/admin/water-tickets/SMKNOWT/cancel?clientRequestId=' + encodeURIComponent('smkwt_' + TS + '_g'),
    null,
    adminToken
  );
  assert(wtGhost.code === 404, `21.3 不存在的水票 → 404（实得 ${wtGhost.code}）`);

  const wtCancelKey = 'smkwt_' + TS + '_c1';
  const wtCancel = await call(
    'POST',
    '/mini/admin/water-tickets/' + wtTicketA + '/cancel',
    { clientRequestId: wtCancelKey },
    adminToken
  );
  assert(wtCancel.code === 200, `21.3 作废成功（${wtCancel.code} ${wtCancel.message || ''}）`);
  const wtAfter = (await pool.query('SELECT status FROM water_tickets WHERE ticket_id = ?', [wtTicketA]))[0];
  assert(Number(wtAfter[0].status) === 3, `21.3 ★ 状态变为「作废」=3（实得 ${wtAfter[0].status}）`);
  const wtAudit = await auditActions();
  assert(wtAudit.includes('CANCEL_TICKET_ADMIN'), '21.3 审计含 CANCEL_TICKET_ADMIN');
  const wtReplay = await call(
    'POST',
    '/mini/admin/water-tickets/' + wtTicketA + '/cancel',
    { clientRequestId: wtCancelKey },
    adminToken
  );
  assert(
    wtReplay.code === 200 && wtReplay.data.replayed === true,
    `21.3 幂等重放 replayed=true（${JSON.stringify(wtReplay.data || wtReplay.message)}）`
  );

  // ★ 状态守卫：已核销的票不能作废（守卫在 SQL 的 status 条件上，并发下也成立）
  const wtCancelUsed = await call(
    'POST',
    '/mini/admin/water-tickets/' + wtTicketB + '/cancel?clientRequestId=' + encodeURIComponent('smkwt_' + TS + '_c2'),
    null,
    adminToken
  );
  assert(
    wtCancelUsed.code === 400 && /不可作废/.test(String(wtCancelUsed.message)),
    `21.3 ★ 已核销的水票作废被拒（${wtCancelUsed.message}）`
  );
  const wtAfterB = (await pool.query('SELECT status FROM water_tickets WHERE ticket_id = ?', [wtTicketB]))[0];
  assert(Number(wtAfterB[0].status) === 2, `21.3 ★ 被拒后状态未变（仍 2，实得 ${wtAfterB[0].status}）`);

  // ── 21.4 ★ 发行（Phase 7 开放）：单件值服务端取 + 水站积分入账 + 幂等 ─────
  // ⚠️ 用**自建**水站与商品：发行会同时写发行记录 / 水票 / 钱包三处，不能拿真实数据当对象。
  const wtIssueStation = 'SMKSTWT' + TS;
  const wtIssueProduct = 'SMKWT' + TS + 'P';
  const wtUnitFee = 3.5;
  await pool.query(
    `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, created_at, updated_at)
     VALUES (?, '冒烟-发行水站', '冒烟', '13800000000', 1, NOW(), NOW())`,
    [wtIssueStation]
  );
  await pool.query(
    `INSERT INTO products (product_id, product_name, product_code, category, purchase_price, wholesale_price,
       retail_price, machine_price, distribution_delivery_fee, status, created_at, updated_at)
     VALUES (?, '冒烟-发行测试商品', ?, '冒烟', 10, 12, 15, 10, ?, 1, NOW(), NOW())`,
    [wtIssueProduct, wtIssueProduct, wtUnitFee]
  );

  const wtIssueKey = 'smkwt_' + TS + '_i1';
  const wtIssueBody = {
    clientRequestId: wtIssueKey,
    stationId: wtIssueStation,
    month: wtMonth,
    remark: '冒烟-小程序发行',
    // ⚠️ 故意传错金额：必须被忽略（§12.10 单件值一律服务端重取）
    items: [{ productId: wtIssueProduct, quantity: 2, distributionDeliveryFee: 999 }]
  };
  const wtNoIdemIssue = await call(
    'POST',
    '/mini/admin/water-tickets/issue',
    { stationId: wtIssueStation, items: [{ productId: wtIssueProduct, quantity: 1 }] },
    adminToken
  );
  assert(
    wtNoIdemIssue.code === 400 && /clientRequestId/.test(String(wtNoIdemIssue.message)),
    `21.4 发行缺幂等键被拒（${wtNoIdemIssue.message}）`
  );
  const wtIssue = await call('POST', '/mini/admin/water-tickets/issue', wtIssueBody, adminToken);
  assert(wtIssue.code === 200, `21.4 ★ 发行 200（${wtIssue.code} ${wtIssue.message || ''}）`);

  const wtIssRow = (
    await pool.query(
      `SELECT distribution_delivery_fee_unit, distribution_delivery_fee_total, distribution_delivery_fee, wallet_transaction_id
         FROM water_ticket_issuance WHERE issuance_id = ?`,
      [wtIssue.data.issuanceIds[0]]
    )
  )[0][0];
  assert(
    near(wtIssRow.distribution_delivery_fee_unit, wtUnitFee) &&
      near(wtIssRow.distribution_delivery_fee_total, wtUnitFee * 2) &&
      near(wtIssRow.distribution_delivery_fee, wtUnitFee * 2),
    `21.4 ★★ 三列恒等且客户端金额（999）被忽略：unit=${wtIssRow.distribution_delivery_fee_unit} total=${wtIssRow.distribution_delivery_fee_total}`
  );
  assert(Boolean(wtIssRow.wallet_transaction_id), '21.4 发行记录回填了入账流水号（wallet_transaction_id）');
  const wtWalletOf = async () =>
    (
      await pool.query("SELECT wallet_id, balance FROM wallet_accounts WHERE owner_type = 'STATION' AND owner_id = ?", [
        wtIssueStation
      ])
    )[0][0];
  const wtWallet1 = await wtWalletOf();
  assert(
    wtWallet1 && near(Number(wtWallet1.balance), wtUnitFee * 2),
    `21.4 ★★ 发行给水站钱包入账 = 单件×数量 = ${wtUnitFee * 2}（实得 ${wtWallet1 && wtWallet1.balance}）`
  );
  const wtTicketCnt = (
    await pool.query('SELECT COUNT(*) c FROM water_tickets WHERE issuance_id = ?', [wtIssue.data.issuanceIds[0]])
  )[0][0];
  assert(Number(wtTicketCnt.c) === 2, `21.4 生成等量水票 2 张（实得 ${wtTicketCnt.c}）`);

  const wtIssueReplay = await call('POST', '/mini/admin/water-tickets/issue', wtIssueBody, adminToken);
  assert(
    wtIssueReplay.code === 200 && wtIssueReplay.data.replayed === true,
    `21.4 ★ 幂等重放 replayed=true（${JSON.stringify(wtIssueReplay.data || wtIssueReplay.message)}）`
  );
  assert(
    near(Number((await wtWalletOf()).balance), wtUnitFee * 2),
    '21.4 ★★ 重放后余额未变（弱网重试**不会**给水站发两次积分）'
  );
  assert((await auditActions()).includes('ISSUE_TICKET_ADMIN'), '21.4 审计含 ISSUE_TICKET_ADMIN');

  // ── 21.5 改数量：差额补入账 / 回冲（同一个核心，金额仍由服务端算）──────────
  const wtEditKey = 'smkwt_' + TS + '_u1';
  const wtEdit = await call(
    'PUT',
    '/mini/admin/water-tickets/issuances/' + wtIssue.data.issuanceIds[0],
    { clientRequestId: wtEditKey, quantity: 3 },
    adminToken
  );
  assert(wtEdit.code === 200, `21.5 改数量 2→3（${wtEdit.code} ${wtEdit.message || ''}）`);
  assert(
    near(Number((await wtWalletOf()).balance), wtUnitFee * 3),
    `21.5 ★★ 加量按差额补入账（余额应 ${wtUnitFee * 3}，实得 ${(await wtWalletOf()).balance}）`
  );
  const wtEditBad = await call(
    'PUT',
    '/mini/admin/water-tickets/issuances/' + wtIssue.data.issuanceIds[0],
    { clientRequestId: wtEditKey, quantity: 5 },
    adminToken
  );
  assert(
    wtEditBad.code === 400 && /内容不一致/.test(String(wtEditBad.message)),
    `21.5 同键不同内容（2→5）被拒 400（${wtEditBad.message}）`
  );
  const wtEditReplay = await call(
    'PUT',
    '/mini/admin/water-tickets/issuances/' + wtIssue.data.issuanceIds[0],
    { clientRequestId: wtEditKey, quantity: 3 },
    adminToken
  );
  assert(
    wtEditReplay.code === 200 && wtEditReplay.data.replayed === true,
    '21.5 幂等重放 replayed=true（不会重复补一次积分）'
  );
  assert(near(Number((await wtWalletOf()).balance), wtUnitFee * 3), '21.5 ★ 重放后余额未变');
  const wtEditNotFound = await call(
    'PUT',
    '/mini/admin/water-tickets/issuances/NOSUCH?clientRequestId=' + encodeURIComponent('smkwt_' + TS + '_u9'),
    { quantity: 1 },
    adminToken
  );
  assert(wtEditNotFound.code === 404, `21.5 发行记录不存在 → 404（实得 ${wtEditNotFound.code}）`);

  // ── 21.6 ★ 范围反向断言：仍未开放的路径必须 404 ───────────────────────────
  // ⚠️ 这条断言的价值在于「防止将来顺手加上」：
  //    · 两个配送费调整端点已于 §12.9 停用（Web 侧也只返回 410）；
  //    · 批次删除是破坏性操作（整批删除 + 按净入账回冲积分），手机误触代价过高。
  for (const p of ['adjust-balance', 'adjust-delivery-fee', 'adjust-station-delivery-fee']) {
    const hit = await call('POST', '/mini/admin/water-tickets/' + p, { clientRequestId: 'x' }, adminToken);
    assert(hit.code === 404, `21.6 ★ /admin/water-tickets/${p} 不存在（实得 ${hit.code}）`);
  }
  const wtBatchDel = await call(
    'DELETE',
    '/mini/admin/water-tickets/issuances/batch/SMKNOBATCH?clientRequestId=' + encodeURIComponent('smkwt_' + TS + '_b'),
    null,
    adminToken
  );
  assert(wtBatchDel.code === 404, `21.6 ★ 批次删除未开放（实得 ${wtBatchDel.code}）`);

  // ── 18.5 各域声明可用的区间都真的通 ─────────────────────────────────────
  for (const [p, ranges] of [
    ['revenue', ['month', 'year', 'all']],
    ['cost', ['month', 'quarter', 'year']],
    ['profit', ['month', 'quarter', 'year']]
  ]) {
    for (const rg of ranges) {
      const one = await call('GET', '/mini/admin/reports/' + p + '?range=' + rg, null, adminToken);
      assert(one.code === 200, `18.5 ${p} range=${rg} → 200（实得 ${one.code} ${one.message || ''}）`);
    }
  }

  // ═════════════ 22. 小程序账号管理（运维域：禁用/启用、改绑定、解绑）════════════
  // 背景：这三件事此前只能改 SQL —— 服务端每请求校验早已生效，缺的只是管理入口。
  // ⚠️ 三条硬边界都要有**反向断言**（它们不是保守，是放开后没有可恢复的路径）：
  //    ① 不能操作自己；② 管理员角色账号不在此处管理；③ 改绑目标必须存在且启用且未被占用。
  // ⚠️ 「禁用」与「解绑」是两件不同的事，断言必须把差别钉住：
  //    禁用保留绑定（该微信登不进、**写操作 401**、读历史仍可用）；解绑**删除绑定行**
  //    （这正是「同一微信可以重新登录并重绑」的前提）。
  section('22. 小程序账号管理：列表脱敏 + 禁用/启用 + 改绑定 + 解绑 + ★ 三条硬边界');

  // 自建载体：两个水站 + 一个停用水站 + 一个业务员（冒烟前缀，收尾按前缀清）
  const accStation1 = 'SMKSTACA' + TS;
  const accStation2 = 'SMKSTACB' + TS;
  const accStationOff = 'SMKSTACO' + TS;
  const accWorker = 'SMKWKAC' + TS;
  for (const [sid, sname, st] of [
    [accStation1, '冒烟-账号测试水站A', 1],
    [accStation2, '冒烟-账号测试水站B', 1],
    [accStationOff, '冒烟-账号测试水站(停用)', 0]
  ]) {
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, created_at, updated_at)
       VALUES (?, ?, '冒烟', '13800000000', ?, NOW(), NOW())`,
      [sid, sname, st]
    );
  }
  await pool.query(
    `INSERT INTO workers (worker_id, worker_name, employee_type, phone, status, created_at, updated_at)
     VALUES (?, '冒烟-账号测试业务员', 3, '13900001111', 1, NOW(), NOW())`,
    [accWorker]
  );

  const accOpenidA = 'smoke_ac_' + TS + '_A';
  const accOpenidB = 'smoke_ac_' + TS + '_B';
  const accOpenidAdm = 'smoke_ac_' + TS + '_ADM';
  await pool.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, '13700000002', 'salesman', ?, '冒烟-账号A', 1, NOW())`,
    [accOpenidA, accWorker]
  );
  await pool.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, '13700000001', 'station', ?, '冒烟-账号B', 1, NOW())`,
    [accOpenidB, accStation1]
  );
  // ⚠️ target_id 用冒烟专用值：与 §0 建的冒烟管理员账号共用同一 users.id 会撞唯一键 uk_role_active
  await pool.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, '13700000003', 'admin', ?, '冒烟-账号ADM', 1, NOW())`,
    [accOpenidAdm, 'SMKADMT' + TS]
  );
  const accIdOfOpenid = async o => (await pool.query('SELECT id FROM mini_accounts WHERE openid = ?', [o]))[0][0].id;
  const accIdA = await accIdOfOpenid(accOpenidA);
  const accIdB = await accIdOfOpenid(accOpenidB);
  const accIdAdm = await accIdOfOpenid(accOpenidAdm);
  const accStatusOf = async id =>
    Number((await pool.query('SELECT status FROM mini_accounts WHERE id = ?', [id]))[0][0].status);

  // ── 22.1 权限 ────────────────────────────────────────────────────────────
  const accNoToken = await call('GET', '/mini/admin/mini-accounts');
  assert(
    accNoToken._status === 401 || accNoToken.code === 401,
    `22.1 无令牌读账号列表被拒 401（实得 ${accNoToken._status}）`
  );
  const acctDenied = await call('GET', '/mini/admin/mini-accounts', null, ordSalesmanToken);
  assert(
    acctDenied.code === 403 && /管理员角色/.test(String(acctDenied.message)),
    `22.1 业务员读账号列表被拒 403（实得 ${acctDenied.code}）`
  );
  const accWriteDenied = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdA + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_d', status: 0 },
    ordSalesmanToken
  );
  assert(accWriteDenied.code === 403, `22.1 业务员改账号状态被拒 403（实得 ${accWriteDenied.code}）`);

  // ── 22.2 列表与脱敏 ──────────────────────────────────────────────────────
  const accList = await call('GET', '/mini/admin/mini-accounts?role=salesman&pageSize=50', null, adminToken);
  assert(accList.code === 200 && Array.isArray(accList.data.list), `22.2 账号列表 200（${accList.code}）`);
  assert(
    (accList.data.list || []).every(x => x.role === 'salesman'),
    '22.2 角色筛选生效（全部为 salesman）'
  );
  const accRowA = (accList.data.list || []).find(x => x.accountId === accIdA);
  assert(Boolean(accRowA), '22.2 列表含本次自建的业务员账号');
  assert(
    accRowA && !('openid' in accRowA) && accRowA.phoneMasked === '137****0002',
    `22.2 ★★ 列表**不含 openid** 且手机号脱敏（实得 ${accRowA && JSON.stringify({ phoneMasked: accRowA.phoneMasked })}）`
  );
  assert(
    accRowA && accRowA.operable === true && accRowA.subjectName === '冒烟-账号测试业务员',
    '22.2 业务账号 operable=true 且带主体名'
  );
  const accBadRole = await call('GET', '/mini/admin/mini-accounts?role=bogus', null, adminToken);
  assert(accBadRole.code === 400, `22.2 非法 role 筛选 → 400（实得 ${accBadRole.code}）`);

  // ── 22.3 ★ 硬边界②：管理员角色账号不在此处管理 ───────────────────────────
  // ⚠️ 附带一个诚实结论：硬边界①（不能操作自己）在当前角色模型下**被②覆盖**——
  //    调用者必然是管理员，而管理员账号一律不可操作，所以「操作自己」进不到 ① 的分支。
  //    ① 是**冗余防线**：一旦将来放开「管理员账号管理」，它就会成为唯一的防线，故保留。
  const accAdmStatus = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdAdm + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_adm1', status: 0 },
    adminToken
  );
  assert(
    accAdmStatus.code === 403 && /管理员账号不在此处管理/.test(String(accAdmStatus.message)),
    `22.3 ★★ 改管理员账号状态被拒 403（实得 ${accAdmStatus.code} ${accAdmStatus.message}）`
  );
  const accAdmBind = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdAdm + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_adm2', role: 'station', targetId: accStation1 },
    adminToken
  );
  assert(accAdmBind.code === 403, `22.3 ★ 改管理员账号绑定被拒 403（实得 ${accAdmBind.code}）`);
  const accAdmUnbind = await call(
    'DELETE',
    '/mini/admin/mini-accounts/' + accIdAdm + '?clientRequestId=' + encodeURIComponent('smoke_ac_' + TS + '_adm3'),
    null,
    adminToken
  );
  assert(accAdmUnbind.code === 403, `22.3 ★ 解绑管理员账号被拒 403（实得 ${accAdmUnbind.code}）`);
  assert((await accStatusOf(accIdAdm)) === 1, '22.3 被拒后管理员账号状态未变（仍启用）');
  assert(
    (await pool.query('SELECT COUNT(*) c FROM mini_accounts WHERE id = ?', [accIdAdm]))[0][0].c === 1,
    '22.3 管理员账号未被删除（三条路径全部被拒）'
  );

  // ── 22.4 禁用 / 启用：禁用即时拦「写」、不拦「读」────────────────────────
  const accTicketToken = signMiniToken({ id: accIdA, role: 'salesman', target_id: accWorker });
  const accWriteProbe = async () =>
    call('POST', '/mini/wallet/recharge', { clientRequestId: 'smoke_ac_' + TS + '_r' }, accTicketToken);
  const accBefore = await accWriteProbe();
  assert(
    accBefore._status === 503 || accBefore.code === 503,
    `22.4 启用态下写接口过了 requireMiniActive（落到「微信充值未开通」503，实得 ${accBefore._status}）`
  );
  const accDisable = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdA + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_s1', status: 0 },
    adminToken
  );
  assert(accDisable.code === 200, `22.4 禁用成功（${accDisable.code} ${accDisable.message || ''}）`);
  assert((await accStatusOf(accIdA)) === 0, '22.4 DB 中 status=0');
  const accAfterBlock = await accWriteProbe();
  assert(
    accAfterBlock._status === 401 && accAfterBlock.code === 401,
    `22.4 ★★ 禁用后该账号**写操作 401**（禁用即时生效，实得 ${accAfterBlock._status}）`
  );
  const accReadStill = await call('GET', '/mini/me', null, accTicketToken);
  assert(accReadStill.code === 200, `22.4 ★ 禁用**不拦读**：该账号仍能读自己的资料（实得 ${accReadStill.code}）`);
  const accDisableReplay = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdA + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_s1', status: 0 },
    adminToken
  );
  assert(
    accDisableReplay.code === 200 && accDisableReplay.data.replayed === true,
    `22.4 幂等重放 replayed=true（${JSON.stringify(accDisableReplay.data || accDisableReplay.message)}）`
  );
  assert((await auditActions()).includes('UPDATE_MINI_ACCOUNT_STATUS'), '22.4 审计含 UPDATE_MINI_ACCOUNT_STATUS');
  const accEnable = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdA + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_s2', status: 1 },
    adminToken
  );
  assert(accEnable.code === 200 && (await accStatusOf(accIdA)) === 1, '22.4 启用成功且 status=1');
  assert(
    (await accWriteProbe())._status === 503,
    '22.4 ★ 恢复后写接口重新可达（503 未开通，说明已通过 requireMiniActive）'
  );
  const accBadStatus = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdA + '/status',
    { clientRequestId: 'smoke_ac_' + TS + '_s3', status: 9 },
    adminToken
  );
  assert(accBadStatus.code === 400, `22.4 非法 status 值 → 400（实得 ${accBadStatus.code}）`);
  const acctNoIdem = await call('PUT', '/mini/admin/mini-accounts/' + accIdA + '/status', { status: 0 }, adminToken);
  assert(
    acctNoIdem.code === 400 && /clientRequestId/.test(String(acctNoIdem.message)),
    `22.4 缺幂等键被拒（${acctNoIdem.message}）`
  );

  // ── 22.5 改绑定（占用 / 停用 / 不存在 / 角色非法 / 未变化 五种拒绝）────────
  const accBind = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b1', role: 'station', targetId: accStation2 },
    adminToken
  );
  assert(accBind.code === 200, `22.5 改绑水站A→B（${accBind.code} ${accBind.message || ''}）`);
  const accRowB = (await pool.query('SELECT role, target_id FROM mini_accounts WHERE id = ?', [accIdB]))[0][0];
  assert(
    accRowB.role === 'station' && accRowB.target_id === accStation2,
    `22.5 DB 绑定已更新（实得 ${accRowB.role}/${accRowB.target_id}）`
  );
  const accBindReplay = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b1', role: 'station', targetId: accStation2 },
    adminToken
  );
  assert(accBindReplay.code === 200 && accBindReplay.data.replayed === true, '22.5 幂等重放 replayed=true');
  assert((await auditActions()).includes('UPDATE_MINI_ACCOUNT_BINDING'), '22.5 审计含 UPDATE_MINI_ACCOUNT_BINDING');
  const accBindConflict = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b2', role: 'salesman', targetId: accWorker },
    adminToken
  );
  assert(
    accBindConflict.code === 400 && /已绑定其他微信/.test(String(accBindConflict.message)),
    `22.5 ★ 目标已被别的启用账号占用 → 400 且文案可读（非 500）（${accBindConflict.message}）`
  );
  const accBindOff = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b3', role: 'station', targetId: accStationOff },
    adminToken
  );
  assert(
    accBindOff.code === 400 && /已停用/.test(String(accBindOff.message)),
    `22.5 ★ 目标主体已停用 → 400（${accBindOff.message}）`
  );
  const accBindGhost = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b4', role: 'station', targetId: 'SMKNOSUCH' + TS },
    adminToken
  );
  assert(accBindGhost.code === 404, `22.5 目标不存在 → 404（实得 ${accBindGhost.code}）`);
  const accBindAdmin = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b5', role: 'admin', targetId: '1' },
    adminToken
  );
  assert(
    accBindAdmin.code === 400 && /业务员|直营水站/.test(String(accBindAdmin.message)),
    `22.5 ★★ 不允许把账号改绑成 **admin**（否则就是提权通道，实得 ${accBindAdmin.code} ${accBindAdmin.message}）`
  );
  const accBindSame = await call(
    'PUT',
    '/mini/admin/mini-accounts/' + accIdB + '/binding',
    { clientRequestId: 'smoke_ac_' + TS + '_b6', role: 'station', targetId: accStation2 },
    adminToken
  );
  assert(accBindSame.code === 400, `22.5 绑定未变化 → 400（实得 ${accBindSame.code}）`);
  assert(
    (await pool.query('SELECT target_id FROM mini_accounts WHERE id = ?', [accIdB]))[0][0].target_id === accStation2,
    '22.5 五种拒绝之后绑定仍是第二次改绑的结果（没有被后续请求改坏）'
  );

  // ── 22.6 解绑：删绑定行（同一微信才能重新绑）+ 审计 + 幂等 ────────────────
  const accUnbindKey = 'smoke_ac_' + TS + '_u1';
  const accUnbind = await call(
    'DELETE',
    '/mini/admin/mini-accounts/' + accIdA + '?clientRequestId=' + encodeURIComponent(accUnbindKey),
    null,
    adminToken
  );
  assert(accUnbind.code === 200, `22.6 解绑成功（${accUnbind.code} ${accUnbind.message || ''}）`);
  assert(
    (await pool.query('SELECT COUNT(*) c FROM mini_accounts WHERE id = ?', [accIdA]))[0][0].c === 0,
    '22.6 ★★ 绑定行已**删除**（这正是「同一微信可重新登录并重绑」的前提 —— 用 status=0 冒充解绑会让用户永远登不进去）'
  );
  const accUnbindReplay = await call(
    'DELETE',
    '/mini/admin/mini-accounts/' + accIdA + '?clientRequestId=' + encodeURIComponent(accUnbindKey),
    null,
    adminToken
  );
  assert(
    accUnbindReplay.code === 200 && accUnbindReplay.data.replayed === true,
    '22.6 幂等重放 replayed=true（不会重复删/重复审计）'
  );
  assert((await auditActions()).includes('UNBIND_MINI_ACCOUNT'), '22.6 审计含 UNBIND_MINI_ACCOUNT');
  const accUnbindGone = await call(
    'DELETE',
    '/mini/admin/mini-accounts/' + accIdA + '?clientRequestId=' + encodeURIComponent('smoke_ac_' + TS + '_u2'),
    null,
    adminToken
  );
  assert(accUnbindGone.code === 404, `22.6 已解绑的账号再解绑（新键）→ 404（实得 ${accUnbindGone.code}）`);
  const accUnbindGhost = await call(
    'DELETE',
    '/mini/admin/mini-accounts/999999999?clientRequestId=' + encodeURIComponent('smoke_ac_' + TS + '_u3'),
    null,
    adminToken
  );
  assert(accUnbindGhost.code === 404, `22.6 不存在的账号 → 404（实得 ${accUnbindGhost.code}）`);

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
// 打印店长配置的冒烟前快照（清理段按它还原全局配置）
let pmSnapshot = null;

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
      // 工资域（第 11 域）：**先删抵扣明细/发放单/预支，再删员工** ——
      // salary_payments.worker_id 与 salary_advances.worker_id 都外键指向 workers，
      // 顺序反了会撞外键让整个清理中断（本文件下方那段注释已记过一次同类教训）。
      const slWorkerIds = (await pool.query("SELECT worker_id FROM workers WHERE worker_name LIKE 'SMKSLR%'"))[0].map(
        r => r.worker_id
      );
      if (slWorkerIds.length) {
        const ph = slWorkerIds.map(() => '?').join(',');
        await pool.query(
          `DELETE FROM finance_transactions WHERE related_module = 'salary_payment'
             AND related_id IN (SELECT payment_id FROM salary_payments WHERE worker_id IN (${ph}))`,
          slWorkerIds
        );
        await pool.query(
          `DELETE FROM finance_transactions WHERE related_module = 'salary_advance'
             AND related_id IN (SELECT advance_id FROM salary_advances WHERE worker_id IN (${ph}))`,
          slWorkerIds
        );
        await pool.query(
          `DELETE FROM salary_payment_advances WHERE payment_id IN (SELECT payment_id FROM salary_payments WHERE worker_id IN (${ph}))`,
          slWorkerIds
        );
        await pool.query(`DELETE FROM salary_payments WHERE worker_id IN (${ph})`, slWorkerIds);
        await pool.query(`DELETE FROM salary_advances WHERE worker_id IN (${ph})`, slWorkerIds);
      }
      // 水票域（第 15 域）：删冒烟插入的水票（它们引用 products/sub_stations）
      await pool.query("DELETE FROM water_tickets WHERE ticket_id LIKE 'SMKWT%' AND remark LIKE '冒烟%'");
      // 回桶域（第 16 域）：先删押金流水与押金记录，再删桶型配置
      //（顺序受业务约束：有押金流水的桶型不允许删除 —— 服务端就是这么判的）
      await pool.query(
        "DELETE FROM finance_transactions WHERE related_module = 'barrel_deposit' AND related_id IN (SELECT deposit_no FROM barrel_deposits WHERE barrel_type LIKE 'SMKBC%')"
      );
      await pool.query("DELETE FROM barrel_deposits WHERE barrel_type LIKE 'SMKBC%'");
      await pool.query("DELETE FROM barrel_config WHERE barrel_type LIKE 'SMKBC%'");
      // 系统设置域（第 17 域）：**还原全局配置**（不还原就等于每次冒烟都改掉真实打印配置）
      if (pmSnapshot === null) {
        await pool.query("DELETE FROM system_settings WHERE setting_key = 'print_manager_worker_id'");
      } else {
        await pool.query("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'print_manager_worker_id'", [
          pmSnapshot
        ]);
      }
      // 员工：主数据四域（SMKWK%）+ 工资域（SMKSLR%，含系统设置域的测试店长）
      await pool.query("DELETE FROM workers WHERE worker_name LIKE 'SMKWK%' OR worker_name LIKE 'SMKSLR%'");
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
      // 账户域（第 10 域）的账户都用 SMKA% 前缀（含第 0 节的 SMKACC+TS）——
      // 按前缀清比逐个 ctx 字段可靠：第 16 节自建了甲~戊五个账户。
      // ⚠️ 不放在 `if (ctx.accountId)` 里：早期异常时 ctx 可能为空，那样账户就漏清了。
      await pool.query("DELETE FROM finance_transactions WHERE account_id LIKE 'SMKA%'");
      await pool.query("DELETE FROM finance_accounts WHERE account_id LIKE 'SMKA%'");
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
      // 账户域残留（SMKA% 前缀，含第 0 节账户与第 16 节甲~戊）
      const accLeft = (await pool.query("SELECT COUNT(*) n FROM finance_accounts WHERE account_id LIKE 'SMKA%'"))[0];
      // 工资域残留：员工（SMKSLR%）+ 发放单 + 预支 —— 任何一项非 0 都说明清理没走完
      const slLeft = (
        await pool.query(
          `SELECT (SELECT COUNT(*) FROM workers WHERE worker_name LIKE 'SMKSLR%') AS w,
                  (SELECT COUNT(*) FROM salary_payments WHERE worker_name LIKE 'SMKSLR%') AS p,
                  (SELECT COUNT(*) FROM salary_advances WHERE worker_name LIKE 'SMKSLR%') AS a`
        )
      )[0][0];
      const slTotal = Number(slLeft.w) + Number(slLeft.p) + Number(slLeft.a);
      // 回桶域残留（桶型配置 + 押金流水）与系统设置还原核对
      const bcLeft = (
        await pool.query(
          "SELECT (SELECT COUNT(*) FROM barrel_config WHERE barrel_type LIKE 'SMKBC%') AS c, (SELECT COUNT(*) FROM barrel_deposits WHERE barrel_type LIKE 'SMKBC%') AS d"
        )
      )[0][0];
      const bcTotal = Number(bcLeft.c) + Number(bcLeft.d);
      // 水票域残留（冒烟插入的票）
      const wtLeft = (await pool.query("SELECT COUNT(*) AS n FROM water_tickets WHERE ticket_id LIKE 'SMKWT%'"))[0][0];
      const wtTotal = Number(wtLeft.n) || 0;
      const [pmLeftRows] = await pool.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'print_manager_worker_id'"
      );
      const pmRestored = (pmLeftRows.length ? pmLeftRows[0].setting_value : null) === pmSnapshot;
      if (!pmRestored) console.log('⚠️ 打印店长配置未还原到原值！');
      const ordTotal = Number(ordLeft[0].n) + Number(walLeft[0].n) + Number(accLeft[0].n) + slTotal + bcTotal + wtTotal;
      const clean =
        Number(left[0].n) === 0 &&
        Number(leftInc[0].n) === 0 &&
        Number(leftPrd[0].n) === 0 &&
        invTotal === 0 &&
        masterTotal === 0 &&
        ordTotal === 0 &&
        pmRestored;
      console.log(
        `\n清理：残留 支出 ${left[0].n} 行 / 收入 ${leftInc[0].n} 行 / 商品 ${leftPrd[0].n} 条 / 库存域 ${invTotal} 条 / 主数据 ${masterTotal} 条 / 订单+账户+工资+回桶域 ${ordTotal} 条（其中工资域 ${slTotal}、回桶域 ${bcTotal}、水票域 ${wtTotal}）/ 打印店长配置已还原 ${pmRestored ? '✓' : '✗'}` +
          `${clean ? ' ✓' : ' ✗ ' + JSON.stringify({ masterLeft, invTotal, ordTotal, slTotal, bcTotal, wtTotal, pmRestored })}`
      );
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

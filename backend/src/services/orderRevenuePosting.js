// 订单营收入账服务（财务管理 V2 · 需求 5，2026-09-15）
// ---------------------------------------------------------------------------
// 职责：把「订单应收」落到公司账户（写 finance_transactions + 改 current_balance）。
// 调用方：orderController 的 创建 / 修改 / 取消 / 硬删除，全部在同一事务内执行。
//
// 入账规则（业务方 2026-09-15 确认）：
//   类型1 送水到府     → 农夫上单账户（全额）
//   类型5 水公社       → 水公社公户（全额）
//   类型2 直营水站销售 → 按实际发生拆账（各笔金额 > 0 才写）：
//                        水票抵扣商品金额 = (进货价 + 总包配送费) × 抵扣件数 → 农夫上单账户
//                        未抵扣商品金额   = 分销价 × (数量 − 抵扣件数)              → 晟之溪公户
//   类型3 线下零售     → 晟之溪公户（全额）
//   类型4/6 机台供货   → 不入账（商品明细不计营收，营收走 machine_sales 手动录入）
//
// 关键约束：
//   1. 入账为「收入」方向，**不受余额限制**；但账户已停用（status != 1）必须报错。
//   2. 金额为 0 不写流水（避免零额脏流水）；冲回时按 related_id 查不到即视为无账可冲。
//   3. related_module 固定 'order_revenue'，related_id = order_id，
//      冲回 = 按该组合查出全部流水 → 逐笔回补余额 → 删除流水。
//   4. 冲回对停用账户同样要回补余额（余额搬走后恒等式仍须成立），故冲回不校验 status。
//
// ⚠️ 金额口径必须与 utils/revenueExpr.js 的 itemRevenueExpr 一致：
//    营收页显示多少，账户就入多少。改口径时两处必须同步。
// ---------------------------------------------------------------------------
const { itemRevenueExpr } = require('../utils/revenueExpr');

// 账户类型常量（与 financeAccountController.ACCOUNT_TYPES 对齐）
const ACCOUNT_TYPE = {
  SZX: 1,             // 晟之溪公户
  WATER_COMMUNE: 2,   // 水公社公户
  NFSD: 8,            // 农夫上单账户
  BULK_MACHINE: 9,    // 量贩机账户
  RETAIL_MACHINE: 10  // 零售机账户
};

// 订单类型 → 入账账户类型（null = 不入账；2 为拆账，单独处理）
const ORDER_ACCOUNT_TYPE = {
  1: ACCOUNT_TYPE.NFSD,
  2: null,
  3: ACCOUNT_TYPE.SZX,
  4: null,
  5: ACCOUNT_TYPE.WATER_COMMUNE,
  6: null
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function businessError(msg) {
  const e = new Error(msg);
  e.business = true;
  return e;
}

// 按 account_type 取账户（事务内，行锁）。无匹配返回 null。
async function loadAccountByType(conn, accountType) {
  const [rows] = await conn.query(
    'SELECT account_id, account_name, current_balance, status FROM finance_accounts WHERE account_type = ? ORDER BY created_at LIMIT 1 FOR UPDATE',
    [accountType]
  );
  return rows.length ? rows[0] : null;
}

// 写一条收入流水并改余额（入账不受余额限制，仅校验账户启用状态）
async function postIncome(conn, { account, amount, category, relatedId, counterparty, remark, user }) {
  const amt = round2(amount);
  if (amt <= 0) return null; // 零额不写流水
  if (Number(account.status) !== 1) {
    throw businessError(`入账账户「${account.account_name}」已停用，无法入账`);
  }
  const before = round2(account.current_balance);
  const after = round2(before + amt);
  await conn.query(
    'UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?',
    [after, account.account_id]
  );
  await conn.query(
    `INSERT INTO finance_transactions
       (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
        related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'order_revenue', ?, CURDATE(), ?, ?, ?, NOW())`,
    [
      genTxId(), genTxNo(), account.account_id, account.account_name, category, amt,
      before, after, relatedId, user || null, counterparty || null, remark || null
    ]
  );
  // 同一事务内若再次入同一账户（重载时），让余额串联正确
  account.current_balance = after;
  return after;
}

// 流水号 / 流水ID 生成（与 financeAccountController 同规则，避免跨模块耦合）
function genTxId() {
  return 'TX' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 10000).toString(36).toUpperCase();
}
function genTxNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'TX' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}

// 订单营收金额（与营收页口径一致，复用 itemRevenueExpr）
async function sumOrderRevenue(conn, orderId) {
  const [rows] = await conn.query(
    `SELECT ROUND(SUM(${itemRevenueExpr()}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.order_id = ?`,
    [orderId]
  );
  return round2(rows[0] ? rows[0].revenue : 0);
}

/**
 * 计算订单入账计划（纯函数，便于测试）
 * @param {object} order 含 order_id / order_type / customer_name
 * @param {Array}  items order_items 行
 * @param {number} totalRevenue 非拆账类型的整单营收（由 sumOrderRevenue 提供）
 * @returns {Array<{accountType:number, amount:number, category:string}>}
 */
function buildPostingPlan(order, items, totalRevenue) {
  const type = Number(order.order_type);
  const rows = Array.isArray(items) ? items : [];

  if (type === 2) {
    let deducted = 0;
    let wholesale = 0;
    for (const it of rows) {
      const qty = Number(it.quantity) || 0;
      const tq = Number(it.ticket_qty) || 0;
      const isWholeTicket = tq <= 0 && Number(it.pricing_type) === 2;
      const deductQty = tq > 0 ? tq : (isWholeTicket ? qty : 0);
      const restQty = qty - deductQty;
      const unitDeduct = (Number(it.purchase_price) || 0) + (Number(it.total_delivery_fee) || 0);
      deducted += unitDeduct * deductQty;
      wholesale += (Number(it.wholesale_price) || 0) * restQty;
    }
    const plan = [];
    if (round2(deducted) > 0) {
      plan.push({ accountType: ACCOUNT_TYPE.NFSD, amount: round2(deducted), category: '订单营收-水站水票抵扣' });
    }
    if (round2(wholesale) > 0) {
      plan.push({ accountType: ACCOUNT_TYPE.SZX, amount: round2(wholesale), category: '订单营收-水站分销' });
    }
    return plan;
  }

  const accountType = ORDER_ACCOUNT_TYPE[type];
  if (accountType === undefined || accountType === null) return []; // 4/6 不入账
  if (round2(totalRevenue) <= 0) return [];
  return [{ accountType, amount: round2(totalRevenue), category: '订单营收' }];
}

/**
 * 订单营收入账（创建订单 / 改单重记时调用；须在事务内）
 * @returns {{posted:number, parts:Array}}
 */
async function postOrderRevenue(conn, order, items, user) {
  const totalRevenue = await sumOrderRevenue(conn, order.order_id);
  const plan = buildPostingPlan(order, items, totalRevenue);
  const parts = [];
  let posted = 0;

  for (const p of plan) {
    const acc = await loadAccountByType(conn, p.accountType);
    if (!acc) throw businessError(`未找到入账账户（类型 ${p.accountType}），无法入账`);
    await postIncome(conn, {
      account: acc,
      amount: p.amount,
      category: p.category,
      relatedId: order.order_id,
      counterparty: order.customer_name || null,
      remark: `订单 ${order.order_id} 营收入账`,
      user
    });
    parts.push({ accountType: p.accountType, amount: p.amount });
    posted += p.amount;
  }

  return { posted: round2(posted), parts };
}

/**
 * 冲回订单营收（改单前 / 取消 / 硬删除时调用；须在事务内）
 * 对停用账户同样回补余额（保证恒等式），不校验 status。
 * @returns {number} 冲回总金额
 */
async function revertOrderRevenue(conn, orderId) {
  const [txs] = await conn.query(
    'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
    ['order_revenue', orderId]
  );
  let reverted = 0;
  for (const tx of txs) {
    await conn.query(
      'UPDATE finance_accounts SET current_balance = current_balance - ?, updated_at = NOW() WHERE account_id = ?',
      [Number(tx.amount), tx.account_id]
    );
    await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
    reverted += Number(tx.amount) || 0;
  }
  return round2(reverted);
}

module.exports = {
  ACCOUNT_TYPE,
  ORDER_ACCOUNT_TYPE,
  buildPostingPlan,
  postOrderRevenue,
  revertOrderRevenue,
  sumOrderRevenue,
  businessError
};

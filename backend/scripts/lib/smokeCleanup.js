/**
 * 冒烟脚本统一收尾清理
 *
 * 为什么需要它：过去各 smoke_*.js 各自写清理代码，普遍存在两个漏洞——
 *   1. 只在「成功路径」清理，一旦中间断言抛错 / 提前 process.exit，清理被整段跳过；
 *   2. 清理口径不全（只删最后一条、只作废不删除、软删除接口清不掉）。
 * 结果就是测试数据在库里堆积，而且 products / workers 走的是业务软删除接口，
 * 在前台永远看得到、删不掉。
 *
 * 用法（务必放在 finally 里，保证异常路径也执行）：
 *
 *   const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
 *   let cleanup = null;
 *   try {
 *     ...冒烟主体...
 *   } finally {
 *     cleanup = await cleanupSmokeResidue(pool);
 *   }
 *
 * 识别口径：见 MARKERS。凡是按此口径命名的测试数据，一律物理删除；
 * 调用方还可用 extraSalaryPayments / extraProducts / extraOrders 追加精确主键。
 * 清理后按「余额 = 初始余额 + 剩余流水净额」重算账户 current_balance，
 * 保证资金记账恒等式成立。整个过程单事务，失败整体回滚。
 */
const MARKERS = {
  workers: "worker_name LIKE '冒烟%'",
  miniAccounts: "username LIKE 'smoke\\_%'",
  products: "(product_name LIKE '冒烟%' OR product_code LIKE 'SMK%')",
  orders: "customer_name LIKE '冒烟%'",
  purchaseRecords: "(remark LIKE '%冒烟%' OR void_reason LIKE '%冒烟%')",
  txByRemark: "remark LIKE '%冒烟%'",
};

async function cleanupSmokeResidue(pool, opts = {}) {
  const { extraSalaryPayments = [], log = console.log } = opts;
  const conn = await pool.getConnection();
  const summary = {};

  try {
    const pick = async (sql, args = []) => (await conn.query(sql, args))[0];

    const smokeWorkers = await pick(`SELECT worker_id FROM workers WHERE ${MARKERS.workers}`);
    const smokeAccounts = await pick(`SELECT id FROM mini_accounts WHERE ${MARKERS.miniAccounts}`);
    const smokeProducts = await pick(`SELECT product_id FROM products WHERE ${MARKERS.products}`);
    const smokeOrders = await pick(`SELECT order_id FROM orders WHERE ${MARKERS.orders}`);
    const smokePurchases = await pick(`SELECT purchase_id FROM purchase_records WHERE ${MARKERS.purchaseRecords}`);

    const workerIds = smokeWorkers.map(r => r.worker_id);
    const accountIds = smokeAccounts.map(r => r.id);
    const productIds = smokeProducts.map(r => r.product_id);
    const orderIds = smokeOrders.map(r => r.order_id);
    const purchaseIds = smokePurchases.map(r => r.purchase_id);

    const txConds = [MARKERS.txByRemark];
    const txArgs = [];
    if (purchaseIds.length) { txConds.push('related_id IN (?)'); txArgs.push(purchaseIds); }
    if (extraSalaryPayments.length) {
      txConds.push("(related_module = 'salary_payment' AND related_id IN (?))");
      txArgs.push(extraSalaryPayments);
    }
    const txRows = await pick(
      `SELECT tx_id FROM finance_transactions WHERE ${txConds.join(' OR ')}`, txArgs
    );
    const txIds = txRows.map(r => r.tx_id);

    const touched = [
      workerIds.length, accountIds.length, productIds.length,
      orderIds.length, purchaseIds.length, txIds.length, extraSalaryPayments.length,
    ].reduce((a, b) => a + b, 0);
    if (!touched) return { total: 0, resume: '无残留' };

    await conn.beginTransaction();
    const del = async (key, sql, args) => {
      const [r] = await conn.query(sql, args);
      if (r.affectedRows) summary[key] = (summary[key] || 0) + r.affectedRows;
      return r.affectedRows;
    };

    if (orderIds.length) {
      await del('order_items', 'DELETE FROM order_items WHERE order_id IN (?)', [orderIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE order_id IN (?)', [orderIds]);
      await del('financial_settlement', 'DELETE FROM financial_settlement WHERE order_id IN (?)', [orderIds]);
      await del('water_tickets', 'DELETE FROM water_tickets WHERE order_id IN (?)', [orderIds]);
    }
    // 冒烟脚本自建的载体数据：脚本专用 issued_by 标记 / 2099 未来月份 / 冒烟备注
    await del('water_tickets', "DELETE FROM water_tickets WHERE issued_by IN ('smoke', 't1', 'a6')");
    await del('water_tickets', "DELETE FROM water_tickets WHERE remark LIKE '%冒烟%'");
    // 水票永远按真实当月发行，2099 开头的月份必然来自冒烟脚本的 month: '2099-01'
    await del('water_tickets', "DELETE FROM water_tickets WHERE month LIKE '2099%'");
    await del('water_ticket_issuance', "DELETE FROM water_ticket_issuance WHERE month LIKE '2099%' OR remark LIKE '%冒烟%'");
    await del('machine_sales', "DELETE FROM machine_sales WHERE sale_date >= '2099-01-01' OR remark LIKE '%冒烟%'");
    if (productIds.length) {
      await del('order_items', 'DELETE FROM order_items WHERE product_id IN (?)', [productIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE product_id IN (?)', [productIds]);
      await del('machine_sales', 'DELETE FROM machine_sales WHERE product_id IN (?)', [productIds]);
      await del('stock_out_records', 'DELETE FROM stock_out_records WHERE product_id IN (?)', [productIds]);
      await del('water_tickets', 'DELETE FROM water_tickets WHERE product_id IN (?)', [productIds]);
      await del('water_ticket_issuance', 'DELETE FROM water_ticket_issuance WHERE product_id IN (?)', [productIds]);
      await del('inventory', 'DELETE FROM inventory WHERE product_id IN (?)', [productIds]);
    }
    if (extraSalaryPayments.length) {
      await del('salary_payment_advances', 'DELETE FROM salary_payment_advances WHERE payment_id IN (?)', [extraSalaryPayments]);
    }
    if (txIds.length) {
      await del('finance_transactions', 'DELETE FROM finance_transactions WHERE tx_id IN (?)', [txIds]);
    }
    if (purchaseIds.length) {
      await del('purchase_records', 'DELETE FROM purchase_records WHERE purchase_id IN (?)', [purchaseIds]);
    }
    if (extraSalaryPayments.length) {
      await del('salary_payments', 'DELETE FROM salary_payments WHERE payment_id IN (?)', [extraSalaryPayments]);
    }
    if (orderIds.length) {
      await del('orders', 'DELETE FROM orders WHERE order_id IN (?)', [orderIds]);
    }
    if (productIds.length) {
      await del('products', 'DELETE FROM products WHERE product_id IN (?)', [productIds]);
    }
    if (workerIds.length) {
      await del('financial_settlement', 'DELETE FROM financial_settlement WHERE worker_id IN (?)', [workerIds]);
      await del('orders', 'DELETE FROM orders WHERE worker_id IN (?) OR created_by IN (?)', [workerIds, workerIds]);
      await del('workers', 'DELETE FROM workers WHERE worker_id IN (?)', [workerIds]);
    }
    if (accountIds.length) {
      await del('mini_accounts', 'DELETE FROM mini_accounts WHERE id IN (?)', [accountIds]);
    }

    // 按恒等式重算账户余额
    const [accounts] = await conn.query('SELECT account_id, initial_balance, current_balance FROM finance_accounts');
    const [nets] = await conn.query(
      `SELECT account_id, ROUND(COALESCE(SUM(CASE WHEN tx_type = 1 THEN amount WHEN tx_type = 2 THEN -amount ELSE 0 END), 0), 2) net
       FROM finance_transactions GROUP BY account_id`
    );
    const netMap = {};
    for (const n of nets) netMap[n.account_id] = Number(n.net);
    for (const a of accounts) {
      const target = Math.round((Number(a.initial_balance) + (netMap[a.account_id] || 0)) * 100) / 100;
      if (Math.abs(target - Number(a.current_balance)) > 0.001) {
        await conn.query('UPDATE finance_accounts SET current_balance = ? WHERE account_id = ?', [target, a.account_id]);
        summary.balanceFixed = (summary.balanceFixed || 0) + 1;
      }
    }

    await conn.commit();
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    log(`  [清理] 冒烟残留已清除：${Object.entries(summary).map(([k, v]) => `${k}×${v}`).join(' ') || '无'}`);
    return { total, detail: summary };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    log(`  [清理] ⚠️ 收尾清理失败（不影响冒烟结论）：${e.message}`);
    return { total: 0, error: e.message };
  } finally {
    conn.release();
  }
}

module.exports = { cleanupSmokeResidue, MARKERS };

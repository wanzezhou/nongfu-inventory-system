// 工资口径与**资金原语**单一来源（Web 端点 + 小程序管理端 Phase 8b 共用）
// ===========================================================================
// 为什么要有这个文件：工资发放一个动作牵动五张表 ——
//   salary_payments（发放单）+ salary_payment_advances（抵扣明细）
//   + salary_advances（预支挂账）+ finance_accounts（余额）+ finance_transactions（流水），
//   必须同一事务。小程序管理端接入时若在控制器里再写一遍，两边必然在
//   「实发为负时到底动不动账户」「预支抵扣是不是先日期先扣」「撤销时方向取 + 还是 −」
//   这几处上分叉 —— 而分叉在账面上**看不出来**：总额守恒仍然成立，
//   只有预支的 deducted_amount/status 会莫名不一致（这正是本仓库踩过的坑型）。
//
// 文档 §41 头号禁止项：不复制余额与流水的写法。故这里把「事务体」抽成原语，
// 两端控制器只做编排（校验入参 / 幂等 / 审计 / 转响应）。
//
// ⚠️ 约定：
//   ① 所有原语**须在事务内调用**（conn 为事务连接），自身不开事务、不提交。
//   ② 校验失败抛 `bizFail()`（`e.business === true`，带 `e.status`），
//      由调用方统一 `rollback()` 后按 `e.status` 转响应 ——
//      **绝不在事务内直接 `return error(...)`**（项目铁律：那会散落「事务已开但走正常返回」的半状态）。
//   ③ 记账方向钉死在原语里，不靠调用方传：工资发放/预支 = 支出（tx_type 2，账户 −），
//      撤销 = 回补（账户 +）。
// ===========================================================================
const { deliveryFeeExpr, commonWhere, calcDue, round2 } = require('./salarySummary');

function genPaymentId() {
  return (
    'PAY' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1000)
      .toString(36)
      .toUpperCase()
  );
}
function genAdvanceId() {
  return (
    'ADV' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1000)
      .toString(36)
      .toUpperCase()
  );
}
function genTxNo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return (
    'TX' +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  );
}
function genTxId() {
  return (
    'TX' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 10000)
      .toString(36)
      .toUpperCase()
  );
}
function isMonth(m) {
  return m && /^\d{4}-\d{2}$/.test(m);
}
function isDate(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(String(d));
}

/** 业务校验失败（`e.business = true`）—— 项目既有约定（同 inventoryController.bizFail） */
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

/** 员工当月实时配送费（工资应发的唯一取数口径） */
async function calcWorkerFee(conn, workerId, month) {
  const feeExpr = deliveryFeeExpr();
  const [rows] = await conn.execute(
    `SELECT ROUND(SUM(${feeExpr} * oi.quantity), 2) AS calc_fee
     FROM orders o
     JOIN order_items oi ON o.order_id = oi.order_id
     WHERE o.worker_id = ? AND ${commonWhere(month)}`,
    [workerId, month]
  );
  return Number(rows[0].calc_fee) || 0;
}

/** 员工未结清预支列表（按预支日期/ID 顺序，供结算抵扣）与待扣总额 */
async function loadPendingAdvances(conn, workerId) {
  const [rows] = await conn.execute(
    `SELECT advance_id, amount, deducted_amount FROM salary_advances
     WHERE worker_id = ? AND deducted_amount < amount
     ORDER BY advance_date ASC, advance_id ASC`,
    [workerId]
  );
  const pending = rows.reduce((s, a) => s + (Number(a.amount) - Number(a.deducted_amount)), 0);
  return { advances: rows, pending: round2(pending) };
}

/**
 * 预支列表的筛选条件 —— Web 与小程序管理端**共用同一段**（文档 §5.8 定式 ⑦）
 * 两端各写一遍的话，最容易出现的差异是「status=0 到底算不算筛选条件」
 * （空串/undefined/null 都得视为「不限」，否则前端清空筛选会查出空列表）。
 * @returns {{clause:string, params:Array}}
 */
function buildAdvanceListWhere(query = {}) {
  const { workerId, status } = query;
  const parts = [];
  const params = [];
  if (workerId) {
    parts.push('worker_id = ?');
    params.push(workerId);
  }
  if (status !== undefined && status !== '' && status !== null) {
    parts.push('status = ?');
    params.push(Number(status));
  }
  return { clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

// ===========================================================================
// 资金原语
// ===========================================================================

/**
 * 工资发放：实发 = 应发（可手动覆盖，用于补加其他工资）− 待扣预支
 * ⚠️ 实发**可为负**（预支超过应发 → 挂账下月继续扣）。负数时：
 *    不选账户、不动余额、不写流水 —— 本次不涉及资金，只是把抵扣关系落下来。
 * @returns {Promise<{paymentId:string, amount:number, month:string, due:number, pendingAdvance:number}>}
 *          `amount` 是**实发**（Web 与小程序的响应都直接用它，故命名对齐既有接口）
 */
async function applySalaryPayment(conn, { workerId, month, accountId, amount, remark, user }) {
  if (!workerId) throw bizFail('请选择员工');
  if (!isMonth(month)) throw bizFail('发放月份格式应为 YYYY-MM');

  const [wk] = await conn.query(
    'SELECT worker_id, worker_name, employee_type, monthly_salary FROM workers WHERE worker_id = ? AND status = 1',
    [workerId]
  );
  if (!wk.length) throw bizFail('员工不存在或已离职');
  const w = wk[0];

  // 同一员工同一月份只能发放一次（DB 无唯一约束，靠这里 + 事务串行保证）
  const [dup] = await conn.query('SELECT payment_id FROM salary_payments WHERE worker_id = ? AND salary_month = ?', [
    workerId,
    month
  ]);
  if (dup.length) throw bizFail('该员工该月工资已发放，请勿重复操作');

  // 应发：显式 amount（发放时可改）优先，否则 = 当月配送费
  const fee = await calcWorkerFee(conn, workerId, month);
  const autoDue = round2(calcDue(w, fee));
  const manual = amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null;
  const due = manual !== null && !isNaN(manual) && manual > 0 ? round2(manual) : autoDue;
  if (due <= 0) throw bizFail('该员工该月无应发工资，无需发放');

  const { advances, pending } = await loadPendingAdvances(conn, workerId);
  const net = round2(due - pending);

  // 账户处理：**仅实发 > 0 时**才涉及本次资金
  let accountName = null;
  let balance = null;
  if (net > 0) {
    if (!accountId) throw bizFail('请选择发放账户');
    // 支出方向 → 必须先加锁读余额再校验（收入方向才不校验余额）
    const [acc] = await conn.query(
      'SELECT account_id, account_name, current_balance, status FROM finance_accounts WHERE account_id = ? FOR UPDATE',
      [accountId]
    );
    if (!acc.length || Number(acc[0].status) !== 1) throw bizFail('发放账户不存在或已停用');
    if (Number(acc[0].current_balance) < net) throw bizFail('发放账户可用余额不足');
    balance = Number(acc[0].current_balance);
    accountName = acc[0].account_name;
  }

  const paymentId = genPaymentId();
  await conn.query(
    `INSERT INTO salary_payments (payment_id, worker_id, worker_name, salary_month, amount, account_id, account_name, paid_at, remark, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())`,
    [paymentId, workerId, w.worker_name, month, net, net > 0 ? accountId : null, accountName, remark || null, user]
  );

  // 预支抵扣：用应发逐笔结清（先日期先扣），明细入 salary_payment_advances 供撤销还原
  let remain = due;
  for (const adv of advances) {
    if (remain <= 0) break;
    const left = Number(adv.amount) - Number(adv.deducted_amount);
    const cut = Math.min(left, remain);
    const newDeducted = round2(Number(adv.deducted_amount) + cut);
    await conn.query(
      'UPDATE salary_advances SET deducted_amount = ?, status = ?, updated_at = NOW() WHERE advance_id = ?',
      [newDeducted, newDeducted >= Number(adv.amount) ? 1 : 0, adv.advance_id]
    );
    await conn.query('INSERT INTO salary_payment_advances (payment_id, advance_id, deducted_amount) VALUES (?, ?, ?)', [
      paymentId,
      adv.advance_id,
      cut
    ]);
    remain = round2(remain - cut);
  }

  // 实发 > 0：公司账户扣款 + 支出流水（tx_type 2 = 支出）
  if (net > 0) {
    await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
      balance - net,
      accountId
    ]);
    await conn.query(
      `INSERT INTO finance_transactions
         (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
          related_module, related_id, tx_date, handler, counterparty, remark, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
      [
        genTxId(),
        genTxNo(),
        accountId,
        accountName,
        2,
        '工资发放',
        net,
        balance,
        balance - net,
        'salary_payment',
        paymentId,
        user || null,
        w.worker_name,
        remark || null
      ]
    );
  }

  return { paymentId, amount: net, month, due, pendingAdvance: pending };
}

/**
 * 撤销发放：回补账户 + 删流水 + 删发放记录 + 反向还原预支抵扣
 * ⚠️ 支出方向的撤销是 **+amount**（本仓库第一条铁律：抄成 − 会变成「撤一次反而再扣一笔」，
 *    而恒等式看起来仍然成立）。这里不按类型反推方向，直接按「当初扣了就补回来」写。
 */
async function revertSalaryPaymentById(conn, paymentId) {
  const [p] = await conn.query('SELECT payment_id FROM salary_payments WHERE payment_id = ? FOR UPDATE', [paymentId]);
  if (!p.length) throw bizFail('发放记录不存在', 404);

  const [txs] = await conn.query(
    'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
    ['salary_payment', paymentId]
  );
  for (const tx of txs) {
    await conn.query(
      'UPDATE finance_accounts SET current_balance = current_balance + ?, updated_at = NOW() WHERE account_id = ?',
      [tx.amount, tx.account_id]
    );
    await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
  }

  // 反向还原预支抵扣（该次发放抵扣掉的预支退回挂账）
  const [det] = await conn.query(
    'SELECT advance_id, deducted_amount FROM salary_payment_advances WHERE payment_id = ?',
    [paymentId]
  );
  for (const d of det) {
    await conn.query(
      `UPDATE salary_advances
         SET deducted_amount = GREATEST(0, deducted_amount - ?),
             status = IF(GREATEST(0, deducted_amount - ?) >= amount, 1, 0),
             updated_at = NOW()
       WHERE advance_id = ?`,
      [d.deducted_amount, d.deducted_amount, d.advance_id]
    );
  }
  await conn.query('DELETE FROM salary_payment_advances WHERE payment_id = ?', [paymentId]);
  await conn.query('DELETE FROM salary_payments WHERE payment_id = ?', [paymentId]);
  return null;
}

/** 预支登记：写预支记录 + 公司账户扣款 + 支出流水（tx_type 2 = 支出） */
async function applySalaryAdvance(conn, { workerId, amount, advanceDate, accountId, remark, user }) {
  if (!workerId) throw bizFail('请选择员工');
  const amt = Number(amount);
  if (!amount || isNaN(amt) || amt <= 0) throw bizFail('预支金额必须为大于 0 的数字');
  if (!isDate(advanceDate)) throw bizFail('预支日期格式应为 YYYY-MM-DD');
  if (!accountId) throw bizFail('请选择付款账户');

  const [wk] = await conn.query('SELECT worker_id, worker_name FROM workers WHERE worker_id = ? AND status = 1', [
    workerId
  ]);
  if (!wk.length) throw bizFail('员工不存在或已离职');

  const [acc] = await conn.query(
    'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE',
    [accountId]
  );
  if (!acc.length) throw bizFail('付款账户不存在或已停用');
  const balance = Number(acc[0].current_balance);
  if (balance < amt) throw bizFail('付款账户可用余额不足');

  const advanceId = genAdvanceId();
  await conn.query(
    `INSERT INTO salary_advances (advance_id, worker_id, worker_name, amount, advance_date, account_id, account_name, deducted_amount, status, remark, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NOW(), NOW())`,
    [advanceId, workerId, wk[0].worker_name, amt, advanceDate, accountId, acc[0].account_name, remark || null, user]
  );
  await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
    balance - amt,
    accountId
  ]);
  await conn.query(
    `INSERT INTO finance_transactions
       (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
        related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      genTxId(),
      genTxNo(),
      accountId,
      acc[0].account_name,
      2,
      '工资预支',
      amt,
      balance,
      balance - amt,
      'salary_advance',
      advanceId,
      advanceDate,
      user || null,
      wk[0].worker_name,
      remark || null
    ]
  );
  return { advanceId, amount: amt };
}

/**
 * 撤销预支：**仅未参与工资抵扣（deducted_amount = 0）可撤销** —— 回补账户 + 删流水 + 删记录
 * ⚠️ 已抵扣的预支不能直接撤：抵扣明细在 salary_payment_advances 里挂着发放单，
 *    直接删会让发放单指向不存在的预支（撤销发放时还原不动）。正确路径是先撤发放再撤预支，
 *    故这里给的是**可执行的操作指引**，而不是一句「不允许」。
 */
async function revertSalaryAdvanceById(conn, advanceId) {
  const [a] = await conn.query(
    'SELECT advance_id, deducted_amount FROM salary_advances WHERE advance_id = ? FOR UPDATE',
    [advanceId]
  );
  if (!a.length) throw bizFail('预支记录不存在', 404);
  if (Number(a[0].deducted_amount) > 0) {
    throw bizFail('该预支已参与工资结算（已抵扣部分金额），无法撤销；可先撤销对应月份工资发放');
  }

  const [txs] = await conn.query(
    'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
    ['salary_advance', advanceId]
  );
  for (const tx of txs) {
    await conn.query(
      'UPDATE finance_accounts SET current_balance = current_balance + ?, updated_at = NOW() WHERE account_id = ?',
      [tx.amount, tx.account_id]
    );
    await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
  }
  await conn.query('DELETE FROM salary_advances WHERE advance_id = ?', [advanceId]);
  return null;
}

/** 员工类型展示名（与前端 SalaryStatistics.vue 的 employeeTypeLabel 一致）
 *  ⚠️ 收敛到这里而不是各端各写一份：小程序接口要下发 employeeTypeName，
 *     Web 导出 Excel 也要写这一列，两份映射迟早会出现「一边叫配送员工、一边叫配送员」。 */
const EMPLOYEE_TYPE_TEXT = { 1: '店长', 2: '配送员工', 3: '业务员', 4: '管理员' };

module.exports = {
  bizFail,
  isMonth,
  isDate,
  EMPLOYEE_TYPE_TEXT,
  calcWorkerFee,
  loadPendingAdvances,
  buildAdvanceListWhere,
  applySalaryPayment,
  revertSalaryPaymentById,
  applySalaryAdvance,
  revertSalaryAdvanceById
};

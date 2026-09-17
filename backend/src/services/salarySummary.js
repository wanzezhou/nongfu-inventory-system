// 工资汇总口径 —— 单源（2026-09-16 晚 2）
// ---------------------------------------------------------------------------
// 由 salaryController 抽出，供三处共用，避免「导出」另写一套应发口径：
//   ① 工资统计页 getSalarySummary          ② 工资统计导出 exportSalary
//   ③ 成本汇总页导出 exportCostSummary 的「员工工资明细」sheet
//
// 配送费口径：按订单商品快照的工人配送费 × 数量，按订单类型取不同字段：
//   送水到府(1) / 线下零售(3) / 水公社(5) → 工人零售配送费
//   直营水站销售(2)                      → 工人水站配送费
//   量贩机供货(4) / 零售机供货(6)        → 工人零售机配送费
// 应发口径（2026-09-09 起）：全员 = 区间内配送费（其他工资发放时手动设置）
// ---------------------------------------------------------------------------
const { pool } = require('../config/db');
const { buildRangeWhere } = require('../utils/dateRange');
const { ORDER_TYPES, VALID_ORDER_TYPES } = require('../constants/order');

// 订单类型 SQL 片段（全部合法类型，含 5-水公社）
const ORDER_TYPE_IN = `o.order_type IN (${VALID_ORDER_TYPES.join(',')})`;

// 订单类型 -> 员工配送费费率（order_items 创建时快照的商品配送费）
function deliveryFeeExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN oi.worker_retail_delivery_fee
      WHEN 2 THEN oi.worker_wholesale_delivery_fee
      WHEN 3 THEN oi.worker_retail_delivery_fee
      WHEN 4 THEN oi.worker_machine_delivery_fee
      WHEN 5 THEN oi.worker_retail_delivery_fee
      WHEN 6 THEN oi.worker_machine_delivery_fee
      ELSE 0 END)`;
}

// 通用过滤（不含时间条件）：排除已取消、无需配送(delivery_type=3)、未指定员工、非业务订单
const BASE_ORDER_FILTER = `o.canceled_at IS NULL
    AND o.delivery_type IN (1, 2)
    AND o.worker_id IS NOT NULL
    AND ${ORDER_TYPE_IN}`;

// 按整月过滤——工资发放/预支结算等「按月不可分割」的场景（参数：month）
function commonWhere(month) {
  return `${BASE_ORDER_FILTER}
    AND DATE_FORMAT(o.created_at, '%Y-%m') = ?`;
}

// 按时间范围过滤——统计场景（rw 来自 utils/dateRange.buildRangeWhere）
function commonWhereRange(rw) {
  return `${BASE_ORDER_FILTER}
    AND ${rw.clause}`;
}

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// 员工应发工资（2026-09-09 起）：全员 = 区间/当月配送费；其他工资发放时手动设置金额
function calcDue(worker, deliveryFee) {
  return deliveryFee;
}

/**
 * 按员工汇总应发（时间范围）——全部在职员工：应发 = 区间内配送费（2026-09-09 起）
 * 跨月区间的「已发放」口径：按 salary_month 落在区间内判定，汇总该区间内的发放金额与覆盖月份
 * @param {{startMonth:string,endMonth:string,isSingleMonth:boolean}} r resolveRange 结果
 * @returns {Promise<{list:object[], summary:object, multiMonth:boolean, month:(string|undefined)}>}
 */
async function loadSalarySummary(r) {
  const multiMonth = !r.isSingleMonth;
  const rw = buildRangeWhere('o.created_at', r);
  const feeExpr = deliveryFeeExpr();
  const [rows] = await pool.execute(
    `SELECT w.worker_id, w.worker_name, w.phone, w.employee_type, w.monthly_salary,
            COALESCE(s.order_count, 0) AS order_count,
            COALESCE(s.total_qty, 0) AS total_qty,
            COALESCE(s.calc_fee, 0) AS calc_fee,
            COALESCE(adv.pending, 0) AS pending_advance,
            p.payment_id, p.paid_amount, p.pay_count, p.pay_months,
            p.paid_account, p.paid_at, p.pay_remark
     FROM workers w
     LEFT JOIN (
       SELECT o.worker_id,
              COUNT(DISTINCT o.order_id) AS order_count,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS calc_fee
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${commonWhereRange(rw)}
       GROUP BY o.worker_id
     ) s ON s.worker_id = w.worker_id
     LEFT JOIN (
       SELECT worker_id, ROUND(SUM(amount - deducted_amount), 2) AS pending
       FROM salary_advances WHERE deducted_amount < amount GROUP BY worker_id
     ) adv ON adv.worker_id = w.worker_id
     LEFT JOIN (
       SELECT worker_id,
              MIN(payment_id) AS payment_id,
              ROUND(SUM(amount), 2) AS paid_amount,
              COUNT(*) AS pay_count,
              GROUP_CONCAT(DISTINCT salary_month ORDER BY salary_month) AS pay_months,
              MAX(account_name) AS paid_account,
              MAX(paid_at) AS paid_at,
              MAX(remark) AS pay_remark
       FROM salary_payments
       WHERE salary_month >= ? AND salary_month <= ?
       GROUP BY worker_id
     ) p ON p.worker_id = w.worker_id
     WHERE w.status = 1
     ORDER BY w.employee_type ASC, w.worker_name ASC`,
    [...rw.params, r.startMonth, r.endMonth]
  );

  const list = rows.map((row) => {
    const payCount = Number(row.pay_count) || 0;
    const paid = payCount > 0;
    const deliveryFee = Number(row.calc_fee) || 0;
    const due = round2(calcDue(row, deliveryFee));
    const pendingAdvance = round2(row.pending_advance);
    const net = round2(due - pendingAdvance);
    const paidAmount = paid ? round2(row.paid_amount) : null;
    // 汇总口径：
    //   单月 —— 沿用原逻辑（已发放取发放快照金额，未发放取实发 net）
    //   跨月 —— 取应发口径（区间内配送费合计），逐月发放状态由 paidMonths 单独展示，
    //           避免「部分月已发」时用发放额掩盖了未发月份的应发成本
    const payAmount = multiMonth ? due : (paid ? paidAmount : net);
    return {
      workerId: row.worker_id,
      workerName: row.worker_name,
      phone: row.phone || '',
      employeeType: Number(row.employee_type),
      orderCount: Number(row.order_count) || 0,
      totalQty: Number(row.total_qty) || 0,
      calcFee: deliveryFee,
      // 应发：全员 = 区间内配送费（发放时可手动调整）
      due,
      pendingAdvance,
      // 实发 = 应发 - 待扣预支（可为负：挂账下月继续扣）
      net,
      payAmount,
      paid,
      multiMonth,
      paymentId: row.payment_id || null,
      paidAmount,
      paidMonthCount: payCount,
      paidMonths: row.pay_months ? String(row.pay_months).split(',') : [],
      paidAccount: row.paid_account || '',
      paidAt: row.paid_at || null,
      payRemark: row.pay_remark || ''
    };
  });

  const summary = {
    // 应发合计（Σ due = 区间内订单配送费，不减预支、不取发放快照）——仪表盘成本口径用它：
    // 成本是「应发的工资」，预支抵扣属于资金结算而非成本减少；且只有该口径能按任意时间粒度拆分
    totalDue: round2(list.reduce((s, x) => s + x.due, 0)),
    // 结算口径合计（Σ payAmount）：单月未发放时已扣减待抵扣预支、已发放时取发放快照
    // ——工资统计页/成本汇总页沿用（页面语义是「本期实发/应结」，与成本口径不同属预期）
    totalDeliveryFee: round2(list.reduce((s, x) => s + x.payAmount, 0)),
    workerCount: list.length,
    orderCount: list.reduce((s, x) => s + x.orderCount, 0),
    totalPendingAdvance: round2(list.reduce((s, x) => s + x.pendingAdvance, 0)),
    paidWorkerCount: list.filter((x) => x.paid).length
  };

  return { list, summary, multiMonth, month: r.isSingleMonth ? r.startMonth : undefined };
}

module.exports = {
  ORDER_TYPE_IN,
  ORDER_TYPES,
  deliveryFeeExpr,
  BASE_ORDER_FILTER,
  commonWhere,
  commonWhereRange,
  calcDue,
  round2,
  loadSalarySummary
};

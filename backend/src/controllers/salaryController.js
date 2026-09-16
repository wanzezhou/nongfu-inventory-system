// 工资统计 + 工资发放 + 工资预支
// 应发口径（2026-09-09 起）：全员 = 当月订单配送费（规则同配送员工）；
//   其他工资部分（如固定月薪）不再自动计入，发放时手动设置应发金额。
// 预支：全部员工可预支（公司账户支出+员工挂账），发工资时从应发中抵扣；
//   应发不足时实发记为负数（挂账下月继续扣），撤销发放时反向还原预支。
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
// 导出订单类型常量，避免各处硬编码漂移
const { ORDER_TYPES } = require('../constants/order');
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');
const { writeWorkbook } = require('../utils/excel');
// 工资口径（配送费表达式 / 订单过滤 / 应发计算 / 员工汇总）单一来源：
// services/salarySummary.js —— 工资统计页、工资导出、成本汇总导出共用同一套口径
const {
  ORDER_TYPE_IN, deliveryFeeExpr, BASE_ORDER_FILTER,
  commonWhere, commonWhereRange, calcDue, round2, loadSalarySummary
} = require('../services/salarySummary');

function genPaymentId() {
  return 'PAY' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
}
function genAdvanceId() {
  return 'ADV' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
}
function genTxNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'TX' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}
function genTxId() {
  return 'TX' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 10000).toString(36).toUpperCase();
}
function isMonth(m) {
  return m && /^\d{4}-\d{2}$/.test(m);
}
function isDate(d) {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(String(d));
}

// 员工当月实时配送费（共享计算）
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

// 员工未结清预支列表（按预支日期/ID 顺序，供结算抵扣）与待扣总额
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

// 按员工汇总应发（时间范围）—— 口径与取数见 services/salarySummary.js（工资导出共用同一份）
async function getSalarySummary(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, RANGE_INVALID_MSG, 400);
    }
    const { list, summary, multiMonth, month } = await loadSalarySummary(r);
    return success(res, { list, summary, range: r, multiMonth, month });
  } catch (e) {
    console.error('getSalarySummary error:', e);
    return error(res, '工资统计查询失败', 500);
  }
}

// 指定员工在时间范围内的配送订单明细
async function getSalaryOrders(req, res) {
  try {
    const { workerId } = req.query;
    const r = resolveRange(req.query);
    if (!r || !workerId) {
      return error(res, '缺少时间范围或员工', 400);
    }
    const rw = buildRangeWhere('o.created_at', r);
    const feeExpr = deliveryFeeExpr();
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS delivery_fee
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${commonWhereRange(rw)} AND o.worker_id = ?
       GROUP BY o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at
       ORDER BY o.created_at DESC`,
      [...rw.params, workerId]
    );

    // 订单级商品明细（供展开查看：每件商品的配送费 = 费率快照 × 数量）
    const orderIds = rows.map((r) => r.order_id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const [items] = await pool.execute(
        `SELECT oi.order_id, p.product_name AS product_name, p.specification, oi.quantity,
                ${feeExpr} AS unit_fee,
                ROUND(${feeExpr} * oi.quantity, 2) AS fee
         FROM order_items oi
         JOIN orders o ON o.order_id = oi.order_id
         LEFT JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id IN (${placeholders})
           AND o.canceled_at IS NULL
           AND ${ORDER_TYPE_IN}
         ORDER BY oi.order_id, oi.item_id`,
        orderIds
      );
      itemsByOrder = {};
      items.forEach((it) => {
        (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push({
          productName: it.product_name || '未知商品',
          spec: it.specification || '',
          quantity: Number(it.quantity) || 0,
          unitFee: Number(it.unit_fee) || 0,
          fee: Number(it.fee) || 0
        });
      });
    }

    const list = rows.map((r) => ({
      orderId: r.order_id,
      orderType: Number(r.order_type),
      orderTypeName: ORDER_TYPES[r.order_type] || '未知',
      customerName: r.customer_name || '',
      contactName: r.contact_name || '',
      createTime: r.created_at,
      totalQty: Number(r.total_qty) || 0,
      deliveryFee: Number(r.delivery_fee) || 0,
      items: itemsByOrder[r.order_id] || []
    }));

    return success(res, { list, range: r, month: r.isSingleMonth ? r.startMonth : undefined, workerId });
  } catch (e) {
    console.error('getSalaryOrders error:', e);
    return error(res, '工资明细查询失败', 500);
  }
}

// 指定订单的商品配送明细（商品行：数量 × 对应费率）
async function getSalaryOrderItems(req, res) {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return error(res, '缺少订单号', 400);
    }
    const feeExpr = deliveryFeeExpr();
    const [rows] = await pool.execute(
      `SELECT oi.product_id, p.product_name, p.specification, p.unit,
              oi.quantity,
              ${feeExpr} AS fee_per_unit,
              ROUND(${feeExpr} * oi.quantity, 2) AS delivery_fee
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE o.order_id = ? AND o.canceled_at IS NULL
       ORDER BY oi.item_id`,
      [orderId]
    );

    const list = rows.map((r) => ({
      productId: r.product_id,
      productName: r.product_name || '-',
      spec: r.specification || '',
      unit: r.unit || '',
      quantity: Number(r.quantity) || 0,
      feePerUnit: Number(r.fee_per_unit) || 0,
      deliveryFee: Number(r.delivery_fee) || 0
    }));

    return success(res, { list, orderId });
  } catch (e) {
    console.error('getSalaryOrderItems error:', e);
    return error(res, '商品配送明细查询失败', 500);
  }
}

// ==================== 工资发放管理 ====================

// 单员工：当月应发（配送费）+ 待扣预支 + 实发 + 发放状态（发放弹窗月份变更时刷新）
async function getWorkerSummary(req, res) {
  try {
    const { month, workerId } = req.query;
    if (!isMonth(month) || !workerId) return error(res, '缺少月份或员工', 400);
    const [wk] = await pool.query(
      'SELECT worker_id, worker_name, employee_type, monthly_salary FROM workers WHERE worker_id = ?',
      [workerId]
    );
    if (!wk.length) return error(res, '员工不存在', 404);
    const w = wk[0];
    const fee = await calcWorkerFee(pool, workerId, month);
    const due = round2(calcDue(w, fee));
    const { pending } = await loadPendingAdvances(pool, workerId);
    const net = round2(due - pending);
    const [p] = await pool.query(
      'SELECT payment_id, amount, account_name, paid_at, remark FROM salary_payments WHERE worker_id = ? AND salary_month = ?',
      [workerId, month]
    );
    const rec = p[0] || null;
    return success(res, {
      workerId: w.worker_id,
      workerName: w.worker_name,
      employeeType: Number(w.employee_type),
      calcFee: fee,
      monthlySalary: w.monthly_salary != null ? Number(w.monthly_salary) : null,
      due,
      pendingAdvance: pending,
      net,
      paid: !!rec,
      payAmount: rec ? Number(rec.amount) || 0 : net,
      payment: rec
        ? {
            paymentId: rec.payment_id, amount: Number(rec.amount) || 0,
            accountName: rec.account_name || '', paidAt: rec.paid_at, remark: rec.remark || ''
          }
        : null
    });
  } catch (e) {
    console.error('getWorkerSummary error:', e);
    return error(res, '查询失败', 500);
  }
}

// 确认发放：事务——唯一校验 + 应发计算 + 预支抵扣 + 记发放 + 公司账户扣款 + 支出流水
// 实发 = 应发（全员=配送费，发放时可传 amount 手动覆盖补加其他工资） - 待扣预支；实发可为负（挂账下月扣）
async function paySalary(req, res) {
  try {
    const { workerId, month, accountId, amount, remark } = req.body;
    if (!workerId) return error(res, '请选择员工', 400);
    if (!isMonth(month)) return error(res, '发放月份格式应为 YYYY-MM', 400);
    const user = (req.user && (req.user.username || req.user.id)) || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 员工
      const [wk] = await conn.query('SELECT worker_id, worker_name, employee_type, monthly_salary FROM workers WHERE worker_id = ? AND status = 1', [workerId]);
      if (!wk.length) { await conn.rollback(); return error(res, '员工不存在或已离职', 400); }
      const w = wk[0];
      // 该月未发放（唯一）
      const [dup] = await conn.query('SELECT payment_id FROM salary_payments WHERE worker_id = ? AND salary_month = ?', [workerId, month]);
      if (dup.length) { await conn.rollback(); return error(res, '该员工该月工资已发放，请勿重复操作', 400); }
      // 应发：显式 amount（全员发放可改，用于补加其他工资）优先，否则=当月配送费
      const fee = await calcWorkerFee(conn, workerId, month);
      const autoDue = round2(calcDue(w, fee));
      const manual = amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null;
      const due = manual !== null && !isNaN(manual) && manual > 0 ? round2(manual) : autoDue;
      if (due <= 0) { await conn.rollback(); return error(res, '该员工该月无应发工资，无需发放', 400); }
      // 待扣预支
      const { advances, pending } = await loadPendingAdvances(conn, workerId);
      const net = round2(due - pending); // 实发，可为负
      // 账户处理（仅实发 > 0 时扣款；负数/0 表示预支已抵扣或倒欠，不涉及本次资金）
      let accountName = null;
      let balance = null;
      if (net > 0) {
        if (!accountId) { await conn.rollback(); return error(res, '请选择发放账户', 400); }
        const [acc] = await conn.query('SELECT * FROM finance_accounts WHERE account_id = ? FOR UPDATE', [accountId]);
        if (!acc.length || Number(acc[0].status) !== 1) { await conn.rollback(); return error(res, '发放账户不存在或已停用', 400); }
        if (Number(acc[0].current_balance) < net) { await conn.rollback(); return error(res, '发放账户可用余额不足', 400); }
        balance = Number(acc[0].current_balance);
        accountName = acc[0].account_name;
      }
      // 记发放（amount=实发，可为负）
      const paymentId = genPaymentId();
      await conn.query(
        `INSERT INTO salary_payments (payment_id, worker_id, worker_name, salary_month, amount, account_id, account_name, paid_at, remark, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())`,
        [paymentId, workerId, w.worker_name, month, net, net > 0 ? accountId : null, accountName, remark || null, user]
      );
      // 预支抵扣：用应发逐笔结清（先日期先扣），明细入 salary_payment_advances 供撤销还原
      let remain = due;
      if (advances.length > 0) {
        for (const adv of advances) {
          if (remain <= 0) break;
          const left = Number(adv.amount) - Number(adv.deducted_amount);
          const cut = Math.min(left, remain);
          const newDeducted = round2(Number(adv.deducted_amount) + cut);
          await conn.query(
            'UPDATE salary_advances SET deducted_amount = ?, status = ?, updated_at = NOW() WHERE advance_id = ?',
            [newDeducted, newDeducted >= Number(adv.amount) ? 1 : 0, adv.advance_id]
          );
          await conn.query(
            'INSERT INTO salary_payment_advances (payment_id, advance_id, deducted_amount) VALUES (?, ?, ?)',
            [paymentId, adv.advance_id, cut]
          );
          remain = round2(remain - cut);
        }
      }
      // 实发 > 0：公司账户扣款 + 支出流水
      if (net > 0) {
        await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [balance - net, accountId]);
        await conn.query(
          `INSERT INTO finance_transactions
             (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
              related_module, related_id, tx_date, handler, counterparty, remark, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
          [
            genTxId(), genTxNo(), accountId, accountName, 2, '工资发放', net,
            balance, balance - net, 'salary_payment', paymentId, user || null, w.worker_name, remark || null
          ]
        );
      }
      await conn.commit();
      return success(res, { paymentId, amount: net, month, due, pendingAdvance: pending }, '工资发放成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('paySalary error:', e);
    return error(res, e.message.includes('余额') || e.message.includes('已发放') || e.message.includes('应发') || e.message.includes('账户') ? e.message : '工资发放失败', 400);
  }
}

// 撤销发放：回补公司账户 + 删流水 + 删发放记录 + 反向还原预支抵扣
async function revokeSalaryPayment(req, res) {
  try {
    const { id } = req.params;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [p] = await conn.query('SELECT * FROM salary_payments WHERE payment_id = ? FOR UPDATE', [id]);
      if (!p.length) { await conn.rollback(); return error(res, '发放记录不存在', 404); }
      const rec = p[0];
      // 撤销关联支出流水并回补余额
      const [txs] = await conn.query(
        'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
        ['salary_payment', id]
      );
      for (const tx of txs) {
        await conn.query('UPDATE finance_accounts SET current_balance = current_balance + ?, updated_at = NOW() WHERE account_id = ?', [tx.amount, tx.account_id]);
        await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
      }
      // 反向还原预支抵扣（该次发放抵扣的预支退回挂账）
      const [det] = await conn.query('SELECT advance_id, deducted_amount FROM salary_payment_advances WHERE payment_id = ?', [id]);
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
      await conn.query('DELETE FROM salary_payment_advances WHERE payment_id = ?', [id]);
      await conn.query('DELETE FROM salary_payments WHERE payment_id = ?', [id]);
      await conn.commit();
      return success(res, null, '已撤销发放，账户余额与预支已还原');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('revokeSalaryPayment error:', e);
    return error(res, '撤销发放失败', 500);
  }
}

// ==================== 工资预支管理 ====================

// 预支列表（筛选：员工/状态，分页）
async function getAdvances(req, res) {
  try {
    const { workerId, status, page = 1, pageSize = 20 } = req.query;
    const where = [];
    const params = [];
    if (workerId) { where.push('worker_id = ?'); params.push(workerId); }
    if (status !== undefined && status !== '' && status !== null) { where.push('status = ?'); params.push(Number(status)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.execute(
      `SELECT advance_id, worker_id, worker_name, amount, DATE_FORMAT(advance_date, '%Y-%m-%d') AS advance_date,
              account_id, account_name, deducted_amount, status, remark, created_by, created_at
       FROM salary_advances ${w}
       ORDER BY advance_date DESC, created_at DESC
       LIMIT ${parseInt(pageSize)} OFFSET ${parseInt((page - 1) * pageSize)}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM salary_advances ${w}`, params);
    const list = rows.map((r) => ({
      advanceId: r.advance_id,
      workerId: r.worker_id,
      workerName: r.worker_name,
      amount: Number(r.amount) || 0,
      advanceDate: r.advance_date,
      accountId: r.account_id,
      accountName: r.account_name || '',
      deductedAmount: Number(r.deducted_amount) || 0,
      // 待扣余额 = 全额 - 已抵扣
      pendingAmount: round2((Number(r.amount) || 0) - (Number(r.deducted_amount) || 0)),
      status: Number(r.status),
      remark: r.remark || '',
      createdAt: r.created_at
    }));
    return success(res, { list, total: cnt[0].n, page: Number(page), pageSize: Number(pageSize) });
  } catch (e) {
    console.error('getAdvances error:', e);
    return error(res, '预支查询失败', 500);
  }
}

// 预支登记：事务——写预支记录 + 公司账户扣款 + 支出流水（related_module='salary_advance'）
async function createAdvance(req, res) {
  try {
    const { workerId, amount, advanceDate, accountId, remark } = req.body;
    if (!workerId) return error(res, '请选择员工', 400);
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) return error(res, '预支金额必须为大于 0 的数字', 400);
    if (!isDate(advanceDate)) return error(res, '预支日期格式应为 YYYY-MM-DD', 400);
    if (!accountId) return error(res, '请选择付款账户', 400);
    const user = (req.user && (req.user.username || req.user.id)) || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 员工
      const [wk] = await conn.query('SELECT worker_id, worker_name FROM workers WHERE worker_id = ? AND status = 1', [workerId]);
      if (!wk.length) { await conn.rollback(); return error(res, '员工不存在或已离职', 400); }
      // 付款账户（启用 + 余额充足，行锁）
      const [acc] = await conn.query('SELECT * FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE', [accountId]);
      if (!acc.length) { await conn.rollback(); return error(res, '付款账户不存在或已停用', 400); }
      const balance = Number(acc[0].current_balance);
      if (balance < amt) { await conn.rollback(); return error(res, '付款账户可用余额不足', 400); }
      // 写预支记录
      const advanceId = genAdvanceId();
      await conn.query(
        `INSERT INTO salary_advances (advance_id, worker_id, worker_name, amount, advance_date, account_id, account_name, deducted_amount, status, remark, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NOW(), NOW())`,
        [advanceId, workerId, wk[0].worker_name, amt, advanceDate, accountId, acc[0].account_name, remark || null, user]
      );
      // 公司账户扣款 + 支出流水
      await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [balance - amt, accountId]);
      await conn.query(
        `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          genTxId(), genTxNo(), accountId, acc[0].account_name, 2, '工资预支', amt,
          balance, balance - amt, 'salary_advance', advanceId, advanceDate,
          user || null, wk[0].worker_name, remark || null
        ]
      );
      await conn.commit();
      return success(res, { advanceId, amount: amt }, '预支登记成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('createAdvance error:', e);
    return error(res, e.message.includes('余额') || e.message.includes('账户') ? e.message : '预支登记失败', 400);
  }
}

// 撤销预支：仅未参与工资抵扣（deducted_amount=0）可撤销——回补账户 + 删流水 + 删记录
async function deleteAdvance(req, res) {
  try {
    const { id } = req.params;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [a] = await conn.query('SELECT * FROM salary_advances WHERE advance_id = ? FOR UPDATE', [id]);
      if (!a.length) { await conn.rollback(); return error(res, '预支记录不存在', 404); }
      const rec = a[0];
      if (Number(rec.deducted_amount) > 0) {
        await conn.rollback();
        return error(res, '该预支已参与工资结算（已抵扣部分金额），无法撤销；可先撤销对应月份工资发放', 400);
      }
      // 回补账户 + 删关联流水
      const [txs] = await conn.query(
        'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
        ['salary_advance', id]
      );
      for (const tx of txs) {
        await conn.query('UPDATE finance_accounts SET current_balance = current_balance + ?, updated_at = NOW() WHERE account_id = ?', [tx.amount, tx.account_id]);
        await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
      }
      await conn.query('DELETE FROM salary_advances WHERE advance_id = ?', [id]);
      await conn.commit();
      return success(res, null, '已撤销预支，账户余额已回补');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('deleteAdvance error:', e);
    return error(res, '撤销预支失败', 500);
  }
}

// 员工类型展示名（与前端 SalaryStatistics.vue 的 employeeTypeLabel 一致）
const EMPLOYEE_TYPE_TEXT = { 1: '店长', 2: '配送员工', 3: '业务员', 4: '管理员' };

/**
 * 工资统计一键导出
 * GET /api/salary/export?range=month
 * sheet：工资汇总（口径说明）/ 员工工资汇总 / 配送订单明细 / 配送商品明细
 *
 * ⚠️ 与工资统计页同源：员工汇总走 services/salarySummary.loadSalarySummary(r)，
 *    订单与商品明细复用同一 deliveryFeeExpr / commonWhereRange，避免口径漂移。
 */
async function exportSalary(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, RANGE_INVALID_MSG, 400);
    }
    const { list, summary, multiMonth } = await loadSalarySummary(r);
    const rw = buildRangeWhere('o.created_at', r);
    const feeExpr = deliveryFeeExpr();

    // 1) 汇总与口径说明
    const overviewSheet = [
      { 项目: '统计范围', 数值: `${r.start} ~ ${r.end}` },
      { 项目: '应发工资总额', 数值: summary.totalDeliveryFee },
      { 项目: '参与员工', 数值: summary.workerCount },
      { 项目: '配送订单数', 数值: summary.orderCount },
      { 项目: '待扣预支', 数值: summary.totalPendingAdvance },
      {
        项目: '汇总口径',
        数值: multiMonth
          ? '跨月区间：按应发口径（区间内配送费合计），发放状态按 salary_month 落在区间内汇总'
          : '单月：已发放取发放快照金额，未发放取实发金额（应发 − 待扣预支）'
      },
      { 项目: '配送费规则', 数值: '送水到府/线下零售/水公社=工人零售配送费；直营水站=工人水站配送费；量贩机/零售机=工人零售机配送费' }
    ];

    // 2) 员工工资汇总
    const workerSheet = list.map((x) => ({
      员工姓名: x.workerName,
      员工类型: EMPLOYEE_TYPE_TEXT[x.employeeType] || '未知',
      联系电话: x.phone,
      配送订单数: x.orderCount,
      配送件数: x.totalQty,
      区间配送费: x.calcFee,
      应发工资: x.due,
      待扣预支: x.pendingAdvance,
      实发金额: x.net,
      发放状态: x.paid ? '已发放' : '未发放',
      已发金额: x.paidAmount === null ? '' : x.paidAmount,
      发放月份: (x.paidMonths || []).join('、'),
      发放账户: x.paidAccount,
      发放时间: x.paidAt ? String(x.paidAt) : '',
      备注: x.payRemark
    }));

    // 3) 配送订单明细（全部员工，按员工聚合到订单）
    const [orderRows] = await pool.execute(
      `SELECT o.worker_id, w.worker_name, o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS delivery_fee
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN workers w ON w.worker_id = o.worker_id
       WHERE ${commonWhereRange(rw)}
       GROUP BY o.worker_id, w.worker_name, o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at
       ORDER BY w.worker_name ASC, o.created_at DESC`,
      rw.params
    );
    const orderSheet = orderRows.map((x) => ({
      员工姓名: x.worker_name || '',
      订单号: x.order_id,
      订单类型: ORDER_TYPES[x.order_type] || `类型${x.order_type}`,
      客户: x.customer_name || '',
      联系人: x.contact_name || '',
      件数: Number(x.total_qty) || 0,
      配送费: Number(x.delivery_fee) || 0,
      下单时间: x.created_at
    }));

    // 4) 配送商品明细（商品行：配送费率快照 × 数量）
    const [itemRows] = await pool.execute(
      `SELECT w.worker_name, o.order_id, o.order_type, o.created_at,
              p.product_name, p.specification, p.unit,
              oi.quantity,
              ${feeExpr} AS fee_per_unit,
              ROUND(${feeExpr} * oi.quantity, 2) AS delivery_fee
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       LEFT JOIN workers w ON w.worker_id = o.worker_id
       WHERE ${commonWhereRange(rw)}
       ORDER BY w.worker_name ASC, o.created_at DESC, oi.item_id`,
      rw.params
    );
    const itemSheet = itemRows.map((x) => ({
      员工姓名: x.worker_name || '',
      订单号: x.order_id,
      订单类型: ORDER_TYPES[x.order_type] || `类型${x.order_type}`,
      商品名称: x.product_name || '-',
      规格: x.specification || '',
      单位: x.unit || '',
      数量: Number(x.quantity) || 0,
      配送费率: Number(x.fee_per_unit) || 0,
      配送费: Number(x.delivery_fee) || 0,
      下单时间: x.created_at
    }));

    const buffer = await writeWorkbook([
      { name: '汇总与口径', data: overviewSheet, widths: [16, 60] },
      { name: '员工工资汇总', data: workerSheet },
      { name: '配送订单明细', data: orderSheet },
      { name: '配送商品明细', data: itemSheet }
    ]);

    const fileName = `工资统计_${r.start}_${r.end}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 中文文件名需按 RFC 5987 编码，否则 Node 报 ERR_INVALID_CHAR
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportSalary error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = {
  getSalarySummary, getSalaryOrders, getSalaryOrderItems,
  getWorkerSummary, paySalary, revokeSalaryPayment,
  getAdvances, createAdvance, deleteAdvance,
  exportSalary
};

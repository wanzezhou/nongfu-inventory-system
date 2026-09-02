// 工资统计：根据订单计算每位配送员工的配送费（按订单类型取商品配送费快照 × 数量）
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// 订单类型 -> 员工配送费费率（order_items 创建时快照的商品配送费）
//   官方平台销售(1) / 线下零售(3)：工人零售配送费
//   直营水站销售(2)：工人水站配送费
//   量贩机供货(4) / 零售机供货(6)：工人零售机配送费
function deliveryFeeExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN oi.worker_retail_delivery_fee
      WHEN 2 THEN oi.worker_wholesale_delivery_fee
      WHEN 3 THEN oi.worker_retail_delivery_fee
      WHEN 4 THEN oi.worker_machine_delivery_fee
      WHEN 6 THEN oi.worker_machine_delivery_fee
      ELSE 0 END)`;
}

const ORDER_TYPES = {
  1: '官方平台销售',
  2: '直营水站销售',
  3: '线下零售',
  4: '量贩机供货',
  6: '零售机供货'
};

// 通用过滤：排除已取消、无需配送(delivery_type=3)、未指定员工、非业务订单
function commonWhere(month) {
  return `o.canceled_at IS NULL
    AND o.delivery_type IN (1, 2)
    AND o.worker_id IS NOT NULL
    AND o.order_type IN (1,2,3,4,6)
    AND DATE_FORMAT(o.created_at, '%Y-%m') = ?`;
}

// 按员工汇总配送费（月份）
async function getSalarySummary(req, res) {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return error(res, '请选择统计月份（格式 YYYY-MM）', 400);
    }
    const feeExpr = deliveryFeeExpr();
    const [rows] = await pool.execute(
      `SELECT w.worker_id, w.worker_name, w.phone,
              COUNT(DISTINCT o.order_id) AS order_count,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS calc_fee,
              p.payment_id AS payment_id, p.amount AS paid_amount,
              p.account_name AS paid_account, p.paid_at AS paid_at, p.remark AS pay_remark
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN workers w ON w.worker_id = o.worker_id
       LEFT JOIN salary_payments p ON p.worker_id = w.worker_id AND p.salary_month = ?
       WHERE ${commonWhere(month)}
       GROUP BY w.worker_id, w.worker_name, w.phone, p.payment_id, p.amount, p.account_name, p.paid_at, p.remark
       ORDER BY calc_fee DESC`,
      [month, month]
    );

    const list = rows.map((r) => {
      const paid = !!r.payment_id;
      return {
        workerId: r.worker_id,
        workerName: r.worker_name,
        phone: r.phone || '',
        orderCount: Number(r.order_count) || 0,
        totalQty: Number(r.total_qty) || 0,
        calcFee: Number(r.calc_fee) || 0,
        // 已发放行锁定为发放记录金额，未发放行显示当月实时汇总
        deliveryFee: paid ? Number(r.paid_amount) || 0 : Number(r.calc_fee) || 0,
        paid,
        paymentId: r.payment_id || null,
        paidAmount: paid ? Number(r.paid_amount) || 0 : null,
        paidAccount: r.paid_account || '',
        paidAt: r.paid_at || null,
        payRemark: r.pay_remark || ''
      };
    });

    const summary = {
      totalDeliveryFee: Math.round(list.reduce((s, x) => s + x.deliveryFee, 0) * 100) / 100,
      workerCount: list.length,
      orderCount: list.reduce((s, x) => s + x.orderCount, 0)
    };

    return success(res, { list, summary, month });
  } catch (e) {
    console.error('getSalarySummary error:', e);
    return error(res, '工资统计查询失败', 500);
  }
}

// 指定员工当月配送订单明细
async function getSalaryOrders(req, res) {
  try {
    const { month, workerId } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !workerId) {
      return error(res, '缺少月份或员工', 400);
    }
    const feeExpr = deliveryFeeExpr();
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS delivery_fee
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${commonWhere(month)} AND o.worker_id = ?
       GROUP BY o.order_id, o.order_type, o.customer_name, o.contact_name, o.created_at
       ORDER BY o.created_at DESC`,
      [month, workerId]
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
           AND o.order_type IN (1,2,3,4,6)
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

    return success(res, { list, month, workerId });
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

function genPaymentId() {
  return 'PAY' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
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

// 单员工：当月实时配送费 + 发放状态（发放弹窗月份变更时刷新）
async function getWorkerSummary(req, res) {
  try {
    const { month, workerId } = req.query;
    if (!isMonth(month) || !workerId) return error(res, '缺少月份或员工', 400);
    const fee = await calcWorkerFee(pool, workerId, month);
    const [p] = await pool.query(
      'SELECT payment_id, amount, account_name, paid_at, remark FROM salary_payments WHERE worker_id = ? AND salary_month = ?',
      [workerId, month]
    );
    const rec = p[0] || null;
    return success(res, {
      calcFee: fee,
      paid: !!rec,
      deliveryFee: rec ? Number(rec.amount) || 0 : fee,
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

// 确认发放：事务——唯一校验 + 记发放 + 公司账户扣款 + 支出流水
async function paySalary(req, res) {
  try {
    const { workerId, month, accountId, remark } = req.body;
    if (!workerId) return error(res, '请选择员工', 400);
    if (!isMonth(month)) return error(res, '发放月份格式应为 YYYY-MM', 400);
    if (!accountId) return error(res, '请选择发放账户', 400);
    const user = (req.user && (req.user.username || req.user.id)) || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 员工
      const [wk] = await conn.query('SELECT worker_id, worker_name FROM workers WHERE worker_id = ? AND status = 1', [workerId]);
      if (!wk.length) { await conn.rollback(); return error(res, '员工不存在或已离职', 400); }
      // 该月未发放（唯一）
      const [dup] = await conn.query('SELECT payment_id FROM salary_payments WHERE worker_id = ? AND salary_month = ?', [workerId, month]);
      if (dup.length) { await conn.rollback(); return error(res, '该员工该月工资已发放，请勿重复操作', 400); }
      // 实时配送费（发放金额）
      const fee = await calcWorkerFee(conn, workerId, month);
      if (fee <= 0) { await conn.rollback(); return error(res, '该员工该月无配送费，无需发放', 400); }
      // 发放账户（启用，余额充足）
      const [acc] = await conn.query('SELECT * FROM finance_accounts WHERE account_id = ? FOR UPDATE', [accountId]);
      if (!acc.length || Number(acc[0].status) !== 1) { await conn.rollback(); return error(res, '发放账户不存在或已停用', 400); }
      if (Number(acc[0].current_balance) < fee) { await conn.rollback(); return error(res, '发放账户可用余额不足', 400); }
      const balance = Number(acc[0].current_balance);
      // 记发放
      const paymentId = genPaymentId();
      await conn.query(
        `INSERT INTO salary_payments (payment_id, worker_id, worker_name, salary_month, amount, account_id, account_name, paid_at, remark, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW(), NOW())`,
        [paymentId, workerId, wk[0].worker_name, month, fee, accountId, acc[0].account_name, remark || null, user]
      );
      // 公司账户扣款 + 支出流水
      await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [balance - fee, accountId]);
      await conn.query(
        `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
        [
          genTxId(), genTxNo(), accountId, acc[0].account_name, 2, '工资发放', fee,
          balance, balance - fee, 'salary_payment', paymentId, user || null, wk[0].worker_name, remark || null
        ]
      );
      await conn.commit();
      return success(res, { paymentId, amount: fee, month }, '工资发放成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('paySalary error:', e);
    return error(res, e.message.includes('余额') || e.message.includes('已发放') || e.message.includes('配送费') ? e.message : '工资发放失败', 400);
  }
}

// 撤销发放：回补公司账户 + 删流水 + 删发放记录（状态回到未发放）
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
      await conn.query('DELETE FROM salary_payments WHERE payment_id = ?', [id]);
      await conn.commit();
      return success(res, null, '已撤销发放，账户余额已回补');
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

module.exports = {
  getSalarySummary, getSalaryOrders, getSalaryOrderItems,
  getWorkerSummary, paySalary, revokeSalaryPayment
};



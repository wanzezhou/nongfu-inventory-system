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
              ROUND(SUM(${feeExpr} * oi.quantity), 2) AS delivery_fee_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN workers w ON w.worker_id = o.worker_id
       WHERE ${commonWhere(month)}
       GROUP BY w.worker_id, w.worker_name, w.phone
       ORDER BY delivery_fee_total DESC`,
      [month]
    );

    const list = rows.map((r) => ({
      workerId: r.worker_id,
      workerName: r.worker_name,
      phone: r.phone || '',
      orderCount: Number(r.order_count) || 0,
      totalQty: Number(r.total_qty) || 0,
      deliveryFee: Number(r.delivery_fee_total) || 0
    }));

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

module.exports = { getSalarySummary, getSalaryOrders, getSalaryOrderItems };

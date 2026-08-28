// 直营水站成本统计：类型2 订单中水票抵扣商品的成本
// 成本 = (进货价 + 水站分销配送费 distribution_delivery_fee) × 抵扣件数
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// 行抵扣件数（旧整单抵扣 ticket_qty=0 时按整行数量）
function ticketQtyExpr() {
  return `IF(oi.ticket_qty > 0, oi.ticket_qty, oi.quantity)`;
}

// 行成本
function costExpr() {
  return `(oi.purchase_price + oi.distribution_delivery_fee) * ${ticketQtyExpr()}`;
}

// 校验月份
function checkMonth(month) {
  return month && /^\d{4}-\d{2}$/.test(month);
}

// 按水站汇总直营水站抵扣成本（月份）
async function getStationSummary(req, res) {
  try {
    const { month } = req.query;
    if (!checkMonth(month)) {
      return error(res, '请选择统计月份（格式 YYYY-MM）', 400);
    }
    const [rows] = await pool.execute(
      `SELECT st.station_id, st.station_name,
              COUNT(DISTINCT o.order_id) AS order_count,
              SUM(${ticketQtyExpr()}) AS ticket_qty,
              ROUND(SUM(${costExpr()}), 2) AS cost_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       JOIN sub_stations st ON st.station_id = o.station_id
       WHERE o.order_type = 2 AND o.canceled_at IS NULL
         AND oi.pricing_type = 2
         AND DATE_FORMAT(o.created_at, '%Y-%m') = ?
       GROUP BY st.station_id, st.station_name
       ORDER BY cost_total DESC`,
      [month]
    );

    const list = rows.map((r) => ({
      stationId: r.station_id,
      stationName: r.station_name,
      orderCount: Number(r.order_count) || 0,
      ticketQty: Number(r.ticket_qty) || 0,
      costTotal: Number(r.cost_total) || 0
    }));

    const summary = {
      totalCost: Math.round(list.reduce((s, x) => s + x.costTotal, 0) * 100) / 100,
      stationCount: list.length,
      orderCount: list.reduce((s, x) => s + x.orderCount, 0),
      ticketQty: list.reduce((s, x) => s + x.ticketQty, 0)
    };

    return success(res, { list, summary, month });
  } catch (e) {
    console.error('getStationSummary error:', e);
    return error(res, '直营水站成本统计查询失败', 500);
  }
}

// 指定水站当月抵扣订单明细
async function getStationOrders(req, res) {
  try {
    const { month, stationId } = req.query;
    if (!checkMonth(month) || !stationId) {
      return error(res, '缺少月份或水站', 400);
    }
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.created_at,
              SUM(${ticketQtyExpr()}) AS ticket_qty,
              ROUND(SUM(${costExpr()}), 2) AS cost_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.order_type = 2 AND o.canceled_at IS NULL
         AND oi.pricing_type = 2
         AND o.station_id = ? AND DATE_FORMAT(o.created_at, '%Y-%m') = ?
       GROUP BY o.order_id, o.created_at
       ORDER BY o.created_at DESC`,
      [stationId, month]
    );

    const list = rows.map((r) => ({
      orderId: r.order_id,
      createTime: r.created_at,
      ticketQty: Number(r.ticket_qty) || 0,
      costTotal: Number(r.cost_total) || 0
    }));

    return success(res, { list, month, stationId });
  } catch (e) {
    console.error('getStationOrders error:', e);
    return error(res, '水站抵扣订单查询失败', 500);
  }
}

// 订单内水票抵扣商品行成本
async function getOrderItems(req, res) {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return error(res, '缺少订单号', 400);
    }
    const [rows] = await pool.execute(
      `SELECT p.product_name, p.specification, p.unit,
              oi.quantity,
              ${ticketQtyExpr()} AS ticket_qty,
              oi.purchase_price,
              oi.distribution_delivery_fee,
              ROUND(${costExpr()}, 2) AS cost_total
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE o.order_id = ? AND oi.pricing_type = 2
       ORDER BY oi.item_id`,
      [orderId]
    );

    const list = rows.map((r) => ({
      productName: r.product_name || '-',
      spec: r.specification || '',
      unit: r.unit || '',
      quantity: Number(r.quantity) || 0,
      ticketQty: Number(r.ticket_qty) || 0,
      purchasePrice: Number(r.purchase_price) || 0,
      distributionFee: Number(r.distribution_delivery_fee) || 0,
      costTotal: Number(r.cost_total) || 0
    }));

    return success(res, { list, orderId });
  } catch (e) {
    console.error('getOrderItems error:', e);
    return error(res, '抵扣商品成本查询失败', 500);
  }
}

module.exports = { getStationSummary, getStationOrders, getOrderItems };

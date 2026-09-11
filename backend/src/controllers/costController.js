// 直营水站成本统计：类型2 订单中水票抵扣商品的成本
// 成本 = (进货价 + 水站分销配送费 distribution_delivery_fee) × 抵扣件数
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere } = require('../utils/dateRange');

// 行抵扣件数（旧整单抵扣 ticket_qty=0 时按整行数量）
function ticketQtyExpr() {
  return `IF(oi.ticket_qty > 0, oi.ticket_qty, oi.quantity)`;
}

// 行成本
function costExpr() {
  return `(oi.purchase_price + oi.distribution_delivery_fee) * ${ticketQtyExpr()}`;
}

// 按水站汇总直营水站抵扣成本（时间范围：预设区间或旧 month 参数）
async function getStationSummary(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, '时间范围不合法：range 支持 month/lastMonth/quarter/year/custom，自定义需合法起止日期', 400);
    }
    const rw = buildRangeWhere('o.created_at', r);
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
         AND ${rw.clause}
       GROUP BY st.station_id, st.station_name
       ORDER BY cost_total DESC`,
      rw.params
    );

    const list = rows.map((row) => ({
      stationId: row.station_id,
      stationName: row.station_name,
      orderCount: Number(row.order_count) || 0,
      ticketQty: Number(row.ticket_qty) || 0,
      costTotal: Number(row.cost_total) || 0
    }));

    const summary = {
      totalCost: Math.round(list.reduce((s, x) => s + x.costTotal, 0) * 100) / 100,
      stationCount: list.length,
      orderCount: list.reduce((s, x) => s + x.orderCount, 0),
      ticketQty: list.reduce((s, x) => s + x.ticketQty, 0)
    };

    return success(res, { list, summary, range: r, month: r.isSingleMonth ? r.startMonth : undefined });
  } catch (e) {
    console.error('getStationSummary error:', e);
    return error(res, '直营水站成本统计查询失败', 500);
  }
}

// 指定水站在时间范围内的抵扣订单明细
async function getStationOrders(req, res) {
  try {
    const { stationId } = req.query;
    const r = resolveRange(req.query);
    if (!r || !stationId) {
      return error(res, '缺少时间范围或水站', 400);
    }
    const rw = buildRangeWhere('o.created_at', r);
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.created_at,
              SUM(${ticketQtyExpr()}) AS ticket_qty,
              ROUND(SUM(${costExpr()}), 2) AS cost_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.order_type = 2 AND o.canceled_at IS NULL
         AND oi.pricing_type = 2
         AND o.station_id = ? AND ${rw.clause}
       GROUP BY o.order_id, o.created_at
       ORDER BY o.created_at DESC`,
      [stationId, ...rw.params]
    );

    const list = rows.map((row) => ({
      orderId: row.order_id,
      createTime: row.created_at,
      ticketQty: Number(row.ticket_qty) || 0,
      costTotal: Number(row.cost_total) || 0
    }));

    return success(res, { list, range: r, stationId });
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

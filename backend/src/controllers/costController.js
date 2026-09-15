// 直营水站成本统计：类型2 订单中水票抵扣商品的成本
// 成本 = (进货价 + 水站分销配送费 distribution_delivery_fee) × 抵扣件数
//
// 2026-09-15 财务管理 V2（需求 4）扩展：
//   - 新增按订单类型的成本统计 getCostByType（送水到府/水公社/直营水站/线下零售/量贩机/零售机）
//   - 直营水站拆「成本1 / 成本2」，线下零售拆「成本A / 成本B」，口径见 utils/costExpr.js
//   - 机台成本按机台供货订单(type 4/6)内商品汇总
//
// 2026-09-15（晚）：「水站成本明细」页（/cost/station）删除，原 station-summary / station-orders /
//   order-items 三接口及 legacyTicketQtyExpr / legacyCostExpr 一并移除 —— 口径窄（少算
//   worker_wholesale_delivery_fee）且已被 getCostByType(2) 覆盖。成本汇总页改走 /overview 与 /by-type。
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere } = require('../utils/dateRange');
const { ORDER_TYPES, VALID_ORDER_TYPES } = require('../constants/order');
const costExprUtil = require('../utils/costExpr');
const {
  ticketQtyExpr, nonTicketQtyExpr, stationCost1Expr, stationCost2Expr,
  retailCostAExpr, retailCostBExpr, itemCostExpr, costExpr, COST_LABELS
} = costExprUtil;

// 机台类型 → 订单类型（machine_sales.machine_type: 1=量贩机 / 2=零售机）
const MACHINE_ORDER_TYPE = { 1: 4, 2: 6 };

// ===========================================================================
// 需求 4：按订单类型的成本统计（2026-09-15）
// ===========================================================================

/**
 * 成本汇总（单类型）
 * GET /api/cost/by-type?orderType=1&range=month
 * 返回：{ orderType, typeName, label, summary:{ costTotal, cost1, cost2, costA, costB, orderCount, totalQty }, list:[按订单], start, end }
 *
 * 口径见 utils/costExpr.js：
 *   类型1/5 → (进货价+工人零售配送费)×数量
 *   类型2   → 成本1(抵扣) + 成本2(未抵扣)
 *   类型3   → 成本A(自有配送) / 成本B(无需配送) 按订单 delivery_type 二选一
 *   类型4   → (进货价+工人零售机配送费)×数量
 *   类型6   → 进货价×数量
 */
async function getCostByType(req, res) {
  try {
    const wantType = Number(req.query.orderType);
    if (!VALID_ORDER_TYPES.includes(wantType)) {
      return error(res, '订单类型无效', 400);
    }
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, '时间范围不合法：range 支持 month/lastMonth/quarter/year/custom，自定义需合法起止日期', 400);
    }
    const rw = buildRangeWhere('o.created_at', r);
    const where = `WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}`;
    const params = [wantType, ...rw.params];

    // 按订单聚合后汇总（避免跨行乘算重复累加）
    const [rows] = await pool.execute(
      `SELECT t.order_id, t.created_at, t.station_id, t.machine_station_id, t.delivery_type,
              t.customer_name, t.worker_id,
              ROUND(t.cost1, 2) AS cost1, ROUND(t.cost2, 2) AS cost2,
              ROUND(t.costA, 2) AS costA, ROUND(t.costB, 2) AS costB,
              ROUND(t.cost_total, 2) AS cost_total,
              t.total_qty, t.ticket_qty, t.non_ticket_qty
       FROM (
         SELECT o.order_id, o.created_at, o.station_id, o.machine_station_id, o.delivery_type,
                o.customer_name, o.worker_id,
                SUM(${stationCost1Expr()}) AS cost1,
                SUM(${stationCost2Expr()}) AS cost2,
                SUM(${retailCostAExpr()}) AS costA,
                SUM(${retailCostBExpr()}) AS costB,
                SUM(${itemCostExpr(wantType)}) AS cost_total,
                SUM(oi.quantity) AS total_qty,
                SUM(${ticketQtyExpr()}) AS ticket_qty,
                SUM(${nonTicketQtyExpr()}) AS non_ticket_qty
         FROM orders o
         JOIN order_items oi ON o.order_id = oi.order_id
         ${where}
         GROUP BY o.order_id, o.created_at, o.station_id, o.machine_station_id, o.delivery_type, o.customer_name, o.worker_id
       ) t
       ORDER BY t.created_at DESC`,
      params
    );

    // 水站/机台名称补齐
    const stationIds = [...new Set(rows.map(x => x.station_id).filter(Boolean))];
    const machineIds = [...new Set(rows.map(x => x.machine_station_id).filter(Boolean))];
    const nameOfStation = {};
    const nameOfMachine = {};
    if (stationIds.length) {
      const [ss] = await pool.query(`SELECT station_id, station_name FROM sub_stations WHERE station_id IN (${stationIds.map(() => '?').join(',')})`, stationIds);
      ss.forEach(x => { nameOfStation[x.station_id] = x.station_name; });
    }
    if (machineIds.length) {
      const [ms] = await pool.query(`SELECT machine_id, station_name FROM machine_stations WHERE machine_id IN (${machineIds.map(() => '?').join(',')})`, machineIds);
      ms.forEach(x => { nameOfMachine[x.machine_id] = x.station_name; });
    }

    const list = rows.map(x => ({
      orderId: x.order_id,
      orderNo: x.order_id,
      customerName: x.customer_name || '-',
      stationName: x.station_id ? (nameOfStation[x.station_id] || x.station_id) : null,
      machineName: x.machine_station_id ? (nameOfMachine[x.machine_station_id] || x.machine_station_id) : null,
      totalQty: Number(x.total_qty) || 0,
      ticketQty: Number(x.ticket_qty) || 0,
      nonTicketQty: Number(x.non_ticket_qty) || 0,
      cost1: Number(x.cost1) || 0,
      cost2: Number(x.cost2) || 0,
      costA: Number(x.costA) || 0,
      costB: Number(x.costB) || 0,
      costTotal: Number(x.cost_total) || 0,
      createTime: x.created_at
    }));

    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const summary = {
      costTotal: r2(list.reduce((s, x) => s + x.costTotal, 0)),
      cost1: r2(list.reduce((s, x) => s + x.cost1, 0)),
      cost2: r2(list.reduce((s, x) => s + x.cost2, 0)),
      costA: r2(list.reduce((s, x) => s + x.costA, 0)),
      costB: r2(list.reduce((s, x) => s + x.costB, 0)),
      orderCount: list.length,
      totalQty: list.reduce((s, x) => s + x.totalQty, 0),
      ticketQty: list.reduce((s, x) => s + x.ticketQty, 0)
    };

    return success(res, {
      list, summary,
      orderType: wantType,
      typeName: ORDER_TYPES[wantType],
      label: COST_LABELS[wantType],
      range: r,
      start: r.start, end: r.end
    });
  } catch (e) {
    console.error('getCostByType error:', e);
    return error(res, '成本统计查询失败', 500);
  }
}

/**
 * 成本汇总总览（全部类型横向对比）
 * GET /api/cost/overview?range=month
 * 返回各类型成本 + 员工工资(配送费) + 其他支出，供「成本汇总」页使用
 */
async function getCostOverview(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, '时间范围不合法：range 支持 month/lastMonth/quarter/year/custom，自定义需合法起止日期', 400);
    }
    const rw = buildRangeWhere('o.created_at', r);
    const [rows] = await pool.execute(
      `SELECT o.order_type,
              COUNT(DISTINCT o.order_id) AS order_count,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${costExpr()}), 2) AS cost_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.canceled_at IS NULL AND ${rw.clause}
       GROUP BY o.order_type`,
      rw.params
    );

    const byType = {};
    VALID_ORDER_TYPES.forEach(t => {
      byType[t] = { orderType: t, typeName: ORDER_TYPES[t], costTotal: 0, orderCount: 0, totalQty: 0, label: COST_LABELS[t] };
    });
    rows.forEach(x => {
      if (byType[x.order_type]) {
        byType[x.order_type].costTotal = Number(x.cost_total) || 0;
        byType[x.order_type].orderCount = Number(x.order_count) || 0;
        byType[x.order_type].totalQty = Number(x.total_qty) || 0;
      }
    });

    const list = VALID_ORDER_TYPES.map(t => byType[t]);
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const orderCostTotal = r2(list.reduce((s, x) => s + x.costTotal, 0));

    return success(res, {
      list,
      orderCostTotal,
      range: r,
      start: r.start, end: r.end
    });
  } catch (e) {
    console.error('getCostOverview error:', e);
    return error(res, '成本总览查询失败', 500);
  }
}

/**
 * 机台成本（量贩机/零售机）—— 按机台供货订单(type 4/6)内商品汇总
 * GET /api/cost/machine?machineType=1|2&range=month
 * machineType 1=量贩机(订单类型4) / 2=零售机(订单类型6)
 * 说明：成本按订单日期统计；营收走 machine_sales（按 sale_date），两者时间口径不同属预期。
 */
async function getMachineCost(req, res) {
  try {
    const machineType = Number(req.query.machineType);
    if (![1, 2].includes(machineType)) return error(res, '机台类型无效（1=量贩机 / 2=零售机）', 400);
    const orderType = MACHINE_ORDER_TYPE[machineType];
    const r = resolveRange(req.query);
    if (!r) return error(res, '时间范围不合法', 400);
    const rw = buildRangeWhere('o.created_at', r);

    const [rows] = await pool.execute(
      `SELECT t.machine_station_id, t.station_name,
              t.order_count, t.total_qty,
              ROUND(t.cost_total, 2) AS cost_total
       FROM (
         SELECT o.machine_station_id, m.station_name,
                COUNT(DISTINCT o.order_id) AS order_count,
                SUM(oi.quantity) AS total_qty,
                SUM(${itemCostExpr(orderType)}) AS cost_total
         FROM orders o
         JOIN order_items oi ON o.order_id = oi.order_id
         LEFT JOIN machine_stations m ON m.machine_id = o.machine_station_id
         WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}
         GROUP BY o.machine_station_id, m.station_name
       ) t
       ORDER BY t.cost_total DESC`,
      [orderType, ...rw.params]
    );

    const list = rows.map(x => ({
      machineId: x.machine_station_id,
      machineName: x.station_name || x.machine_station_id || '-',
      orderCount: Number(x.order_count) || 0,
      totalQty: Number(x.total_qty) || 0,
      costTotal: Number(x.cost_total) || 0
    }));
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const summary = {
      costTotal: r2(list.reduce((s, x) => s + x.costTotal, 0)),
      machineCount: list.length,
      orderCount: list.reduce((s, x) => s + x.orderCount, 0),
      totalQty: list.reduce((s, x) => s + x.totalQty, 0)
    };

    return success(res, {
      list, summary,
      machineType,
      orderType,
      typeName: ORDER_TYPES[orderType],
      label: COST_LABELS[orderType],
      range: r,
      start: r.start, end: r.end
    });
  } catch (e) {
    console.error('getMachineCost error:', e);
    return error(res, '机台成本查询失败', 500);
  }
}

/**
 * 成本明细行（按订单展开到商品行）—— 供成本页「查看明细」抽屉
 * GET /api/cost/order-lines?orderType=1&range=month  或  ?orderId=xxx
 */
async function getCostOrderLines(req, res) {
  try {
    const { orderId } = req.query;
    const wantType = Number(req.query.orderType);
    if (orderId) {
      const [rows] = await pool.execute(
        `SELECT o.order_id, o.order_type, o.delivery_type, p.product_name, p.specification, p.unit,
                oi.quantity, ${ticketQtyExpr()} AS ticket_qty, ${nonTicketQtyExpr()} AS non_ticket_qty,
                oi.purchase_price, oi.distribution_delivery_fee,
                oi.worker_retail_delivery_fee, oi.worker_wholesale_delivery_fee, oi.worker_machine_delivery_fee,
                ROUND(${stationCost1Expr()}, 2) AS cost1,
                ROUND(${stationCost2Expr()}, 2) AS cost2,
                ROUND(${retailCostAExpr()}, 2) AS costA,
                ROUND(${retailCostBExpr()}, 2) AS costB
         FROM orders o
         JOIN order_items oi ON o.order_id = oi.order_id
         LEFT JOIN products p ON p.product_id = oi.product_id
         WHERE o.order_id = ?
         ORDER BY oi.item_id`,
        [orderId]
      );
      const list = rows.map(x => {
        const t = Number(x.order_type);
        const costTotal = t === 2 ? (Number(x.cost1) || 0) + (Number(x.cost2) || 0)
          : t === 3 ? (Number(x.delivery_type) === 1 ? Number(x.costA) : Number(x.costB)) || 0
            : t === 1 || t === 5 ? (Number(x.purchase_price) + Number(x.worker_retail_delivery_fee)) * Number(x.quantity)
              : t === 4 ? (Number(x.purchase_price) + Number(x.worker_machine_delivery_fee)) * Number(x.quantity)
                : Number(x.purchase_price) * Number(x.quantity);
        return {
          orderId: x.order_id,
          productName: x.product_name || '-',
          spec: x.specification || '',
          unit: x.unit || '',
          quantity: Number(x.quantity) || 0,
          ticketQty: Number(x.ticket_qty) || 0,
          nonTicketQty: Number(x.non_ticket_qty) || 0,
          purchasePrice: Number(x.purchase_price) || 0,
          distributionFee: Number(x.distribution_delivery_fee) || 0,
          workerRetailFee: Number(x.worker_retail_delivery_fee) || 0,
          workerWholesaleFee: Number(x.worker_wholesale_delivery_fee) || 0,
          workerMachineFee: Number(x.worker_machine_delivery_fee) || 0,
          cost1: Number(x.cost1) || 0,
          cost2: Number(x.cost2) || 0,
          costA: Number(x.costA) || 0,
          costB: Number(x.costB) || 0,
          costTotal: Math.round(costTotal * 100) / 100
        };
      });
      return success(res, { list, orderId });
    }

    if (!VALID_ORDER_TYPES.includes(wantType)) return error(res, '订单类型无效', 400);
    const r = resolveRange(req.query);
    if (!r) return error(res, '时间范围不合法', 400);
    const rw = buildRangeWhere('o.created_at', r);
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.delivery_type, p.product_name, p.specification, p.unit,
              oi.quantity, ${ticketQtyExpr()} AS ticket_qty, ${nonTicketQtyExpr()} AS non_ticket_qty,
              ROUND(${itemCostExpr(wantType)}, 2) AS cost_total
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}
       ORDER BY o.created_at DESC, oi.item_id
       LIMIT 500`,
      [wantType, ...rw.params]
    );
    const list = rows.map(x => ({
      orderId: x.order_id,
      productName: x.product_name || '-',
      spec: x.specification || '',
      unit: x.unit || '',
      quantity: Number(x.quantity) || 0,
      ticketQty: Number(x.ticket_qty) || 0,
      nonTicketQty: Number(x.non_ticket_qty) || 0,
      costTotal: Number(x.cost_total) || 0
    }));
    return success(res, { list, orderType: wantType, range: r });
  } catch (e) {
    console.error('getCostOrderLines error:', e);
    return error(res, '成本明细查询失败', 500);
  }
}

module.exports = {
  getCostByType, getCostOverview, getMachineCost, getCostOrderLines
};

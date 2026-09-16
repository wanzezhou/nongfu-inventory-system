// 商品行明细查询 —— 成本导出 / 利润导出共用的「订单 → 商品行」取数（2026-09-16 晚 2）
// ---------------------------------------------------------------------------
// ⚠️ 本文件不定义任何金额公式：成本口径取 utils/costExpr.js，营收口径取 utils/revenueExpr.js。
//    导出必须与页面看到的口径逐位一致，公式改动只需改那两个单源文件。
//
// 返回的每行 = 一个订单商品行，已补齐水站/机台名称与金额字段：
//   loadCostItemLines   → 含 抵扣件数/未抵扣件数/进货价/各项配送费/成本1/成本2/成本A/成本B/行成本
//   loadProfitItemLines → 含 营收1/营收2/营收/成本/利润
// ---------------------------------------------------------------------------
const {
  ticketQtyExpr, nonTicketQtyExpr, stationCost1Expr, stationCost2Expr,
  retailCostAExpr, retailCostBExpr, itemCostExpr
} = require('./costExpr');
const { itemRevenueExpr, stationRevenue1Expr, stationRevenue2Expr } = require('./revenueExpr');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 基础列（成本/利润两个查询共用，保证订单与商品字段完全一致）
const BASE_COLS = `o.order_id, o.order_type, o.created_at, o.station_id, o.machine_station_id,
       o.customer_name, o.worker_id, o.delivery_type,
       oi.item_id, oi.quantity, oi.ticket_qty, oi.pricing_type,
       p.product_name, p.specification, p.unit,
       oi.purchase_price, oi.distribution_delivery_fee,
       oi.worker_retail_delivery_fee, oi.worker_wholesale_delivery_fee, oi.worker_machine_delivery_fee`;

const BASE_FROM = `FROM orders o
     JOIN order_items oi ON o.order_id = oi.order_id
     LEFT JOIN products p ON p.product_id = oi.product_id`;

// 批量取水站 / 机台名称（避免逐行查询）
async function loadNames(conn, rows) {
  const station = {};
  const machine = {};
  const sIds = [...new Set(rows.map((x) => x.station_id).filter(Boolean))];
  const mIds = [...new Set(rows.map((x) => x.machine_station_id).filter(Boolean))];
  if (sIds.length) {
    const [ss] = await conn.query(
      `SELECT station_id, station_name FROM sub_stations WHERE station_id IN (${sIds.map(() => '?').join(',')})`,
      sIds
    );
    ss.forEach((x) => { station[x.station_id] = x.station_name; });
  }
  if (mIds.length) {
    const [ms] = await conn.query(
      `SELECT machine_id, station_name FROM machine_stations WHERE machine_id IN (${mIds.map(() => '?').join(',')})`,
      mIds
    );
    ms.forEach((x) => { machine[x.machine_id] = x.station_name; });
  }
  return { station, machine };
}

// 订单/商品公共字段映射
function mapBase(x, names) {
  return {
    orderId: x.order_id,
    orderType: Number(x.order_type),
    createTime: x.created_at,
    customerName: x.customer_name || '-',
    stationName: x.station_id ? (names.station[x.station_id] || x.station_id) : '',
    machineName: x.machine_station_id ? (names.machine[x.machine_station_id] || x.machine_station_id) : '',
    deliveryType: Number(x.delivery_type) || 0,
    productName: x.product_name || '-',
    spec: x.specification || '',
    unit: x.unit || '',
    quantity: Number(x.quantity) || 0,
    purchasePrice: round2(x.purchase_price),
    distributionFee: round2(x.distribution_delivery_fee),
    workerRetailFee: round2(x.worker_retail_delivery_fee),
    workerWholesaleFee: round2(x.worker_wholesale_delivery_fee),
    workerMachineFee: round2(x.worker_machine_delivery_fee)
  };
}

/**
 * 成本口径商品行
 * @param {object} conn mysql2 连接/连接池
 * @param {{ orderType:number, rw:{clause:string, params:any[]} }} opts rw 来自 utils/dateRange.buildRangeWhere
 */
async function loadCostItemLines(conn, { orderType, rw }) {
  const t = Number(orderType);
  const [rows] = await conn.execute(
    `SELECT ${BASE_COLS},
            ${ticketQtyExpr()} AS ticket_qty_calc,
            ${nonTicketQtyExpr()} AS non_ticket_qty,
            ROUND(${stationCost1Expr()}, 2) AS cost1,
            ROUND(${stationCost2Expr()}, 2) AS cost2,
            ROUND(${retailCostAExpr()}, 2) AS costA,
            ROUND(${retailCostBExpr()}, 2) AS costB,
            ROUND(${itemCostExpr(t)}, 2) AS cost_total
     ${BASE_FROM}
     WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}
     ORDER BY o.created_at DESC, o.order_id, oi.item_id`,
    [t, ...rw.params]
  );
  const names = await loadNames(conn, rows);
  return rows.map((x) => ({
    ...mapBase(x, names),
    ticketQty: Number(x.ticket_qty_calc) || 0,
    nonTicketQty: Number(x.non_ticket_qty) || 0,
    cost1: round2(x.cost1),
    cost2: round2(x.cost2),
    costA: round2(x.costA),
    costB: round2(x.costB),
    costTotal: round2(x.cost_total)
  }));
}

/**
 * 利润口径商品行（营收 / 成本 / 利润）
 * 类型2 营收拆 营收1(水票抵扣) / 营收2(未抵扣分销价)；其余类型走通用 itemRevenueExpr。
 * 类型4/6 的商品行营收恒为 0（机台营收来自 machine_sales），不应调用本函数。
 */
async function loadProfitItemLines(conn, { orderType, rw }) {
  const t = Number(orderType);
  const rev1 = t === 2 ? stationRevenue1Expr() : '0';
  const rev2 = t === 2 ? stationRevenue2Expr() : '0';
  const revAll = t === 2 ? `(${stationRevenue1Expr()} + ${stationRevenue2Expr()})` : itemRevenueExpr();
  const costAll = itemCostExpr(t);
  const [rows] = await conn.execute(
    `SELECT ${BASE_COLS},
            ROUND(${rev1}, 2) AS revenue1,
            ROUND(${rev2}, 2) AS revenue2,
            ROUND(${revAll}, 2) AS revenue,
            ROUND(${costAll}, 2) AS cost_total,
            ROUND(${revAll} - ${costAll}, 2) AS profit
     ${BASE_FROM}
     WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}
     ORDER BY o.created_at DESC, o.order_id, oi.item_id`,
    [t, ...rw.params]
  );
  const names = await loadNames(conn, rows);
  return rows.map((x) => ({
    ...mapBase(x, names),
    revenue1: round2(x.revenue1),
    revenue2: round2(x.revenue2),
    revenue: round2(x.revenue),
    costTotal: round2(x.cost_total),
    profit: round2(x.profit)
  }));
}

module.exports = { loadCostItemLines, loadProfitItemLines, loadNames, mapBase, BASE_COLS, BASE_FROM };

// 利润统计（财务管理 V2 · 需求 6，2026-09-15）
// ---------------------------------------------------------------------------
// 利润口径（业务方 2026-09-15 确认）：
//   类型1 送水到府  利润 = 营收 − 成本
//   类型5 水公社    利润 = 营收 − 成本
//   类型2 直营水站  利润 = 利润1 + 利润2
//                     利润1 = 营收1 − 成本1   （营收1 = 返货价值 + 总包配送费；成本1 = 抵扣商品成本）
//                     利润2 = 营收2 − 成本2   （营收2 = 分销价合计；成本2 = 未抵扣商品成本）
//   类型3 线下零售  利润 = 营收 − (成本A + 成本B)
//   类型4 量贩机    利润 = 机台营收(machine_sales) − 机台成本(机台供货订单)
//   类型6 零售机    利润 = 机台营收(machine_sales) − 机台成本(机台供货订单)
//
// ⚠️ 时间口径：
//   营收/成本按订单创建日期（o.created_at）筛选；
//   机台营收按销量日期（machine_sales.sale_date），机台成本按订单日期 —— 二者不同属预期，
//   原因是 machine_sales 由人工录入且不强制关联订单。
//
// 营收口径唯一来源：utils/revenueExpr.js（itemRevenueExpr）
// 成本口径唯一来源：utils/costExpr.js（costExpr / stationCost1Expr / stationCost2Expr）
// ---------------------------------------------------------------------------
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');
const { ORDER_TYPES, VALID_ORDER_TYPES } = require('../constants/order');
const { writeWorkbook } = require('../utils/excel');
const { loadProfitItemLines, loadCostItemLines } = require('../utils/itemLines');
const { itemRevenueExpr, stationRevenue1Expr, stationRevenue2Expr } = require('../utils/revenueExpr');
const {
  costExpr, stationCost1Expr, stationCost2Expr, itemCostExpr,
  retailCostAExpr, retailCostBExpr
} = require('../utils/costExpr');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 机台类型 → 订单类型
const MACHINE_ORDER_TYPE = { 1: 4, 2: 6 };
const MACHINE_OF_ORDER_TYPE = { 4: 1, 6: 2 };

// 各类型利润公式说明（前端展示 + 文档同步）
const PROFIT_LABELS = {
  1: { main: '利润', formula: '营收 − 成本', desc: '成本 = 进货价 + 工人零售配送费' },
  2: { main: '利润（利润1 + 利润2）', formula: '利润1 + 利润2', desc: '利润1=营收1−成本1（返货价值+总包配送费 − 抵扣商品成本）；利润2=营收2−成本2（分销价合计 − 未抵扣商品成本）' },
  3: { main: '利润', formula: '营收 − （成本A + 成本B）', desc: '成本A=自有员工配送商品；成本B=无需配送商品' },
  4: { main: '利润', formula: '机台营收 − 机台成本', desc: '营收按机台销量(machine_sales)；成本按机台供货订单商品' },
  5: { main: '利润', formula: '营收 − 成本', desc: '成本 = 进货价 + 工人零售配送费' },
  6: { main: '利润', formula: '机台营收 − 机台成本', desc: '营收按机台销量(machine_sales)；成本按机台供货订单商品' }
};

/**
 * 单类型利润取数（页面查询与导出共用，避免导出另写一套口径）
 * 仅处理订单类类型 1/2/3/5；机台类型 4/6 见 loadMachineProfit。
 * @returns {Promise<{list: object[], summary: object}>}
 */
async function loadProfitByType(r, wantType) {
  const rw = buildRangeWhere('o.created_at', r);

  if (wantType === 2) {
      // 直营水站：营收1/营收2 + 成本1/成本2 分别聚合
      const [rows] = await pool.execute(
        `SELECT t.order_id, t.created_at, t.station_id, t.customer_name,
                ROUND(t.revenue1, 2) AS revenue1, ROUND(t.revenue2, 2) AS revenue2,
                ROUND(t.cost1, 2) AS cost1, ROUND(t.cost2, 2) AS cost2,
                ROUND(t.revenue1 - t.cost1, 2) AS profit1,
                ROUND(t.revenue2 - t.cost2, 2) AS profit2,
                ROUND((t.revenue1 + t.revenue2) - (t.cost1 + t.cost2), 2) AS profit_total,
                t.total_qty, t.ticket_qty
         FROM (
           SELECT o.order_id, o.created_at, o.station_id, o.customer_name,
                  SUM(${stationRevenue1Expr()}) AS revenue1,
                  SUM(${stationRevenue2Expr()}) AS revenue2,
                  SUM(${stationCost1Expr()}) AS cost1,
                  SUM(${stationCost2Expr()}) AS cost2,
                  SUM(oi.quantity) AS total_qty,
                  SUM(IF(oi.ticket_qty > 0, oi.ticket_qty, IF(oi.pricing_type = 2, oi.quantity, 0))) AS ticket_qty
           FROM orders o
           JOIN order_items oi ON o.order_id = oi.order_id
           WHERE o.order_type = 2 AND o.canceled_at IS NULL AND ${rw.clause}
           GROUP BY o.order_id, o.created_at, o.station_id, o.customer_name
         ) t
         ORDER BY t.created_at DESC`,
        rw.params
      );

      const nameMap = await loadStationNames(pool, rows.map(x => x.station_id));
      const list = rows.map(x => ({
        orderId: x.order_id, orderNo: x.order_id,
        stationName: x.station_id ? (nameMap[x.station_id] || x.station_id) : '-',
        customerName: x.customer_name || '-',
        totalQty: Number(x.total_qty) || 0,
        ticketQty: Number(x.ticket_qty) || 0,
        revenue1: Number(x.revenue1) || 0, revenue2: Number(x.revenue2) || 0,
        cost1: Number(x.cost1) || 0, cost2: Number(x.cost2) || 0,
        profit1: Number(x.profit1) || 0, profit2: Number(x.profit2) || 0,
        profitTotal: Number(x.profit_total) || 0,
        createTime: x.created_at
      }));

      const summary = {
        revenue: round2(list.reduce((s, x) => s + x.revenue1 + x.revenue2, 0)),
        revenue1: round2(list.reduce((s, x) => s + x.revenue1, 0)),
        revenue2: round2(list.reduce((s, x) => s + x.revenue2, 0)),
        costTotal: round2(list.reduce((s, x) => s + x.cost1 + x.cost2, 0)),
        cost1: round2(list.reduce((s, x) => s + x.cost1, 0)),
        cost2: round2(list.reduce((s, x) => s + x.cost2, 0)),
        profit: round2(list.reduce((s, x) => s + x.profitTotal, 0)),
        profit1: round2(list.reduce((s, x) => s + x.profit1, 0)),
        profit2: round2(list.reduce((s, x) => s + x.profit2, 0)),
        orderCount: list.length,
        totalQty: list.reduce((s, x) => s + x.totalQty, 0)
      };
      return { list, summary };
    }

    // 类型1/3/5：营收 − 成本
    const [rows] = await pool.execute(
      `SELECT t.order_id, t.created_at, t.station_id, t.machine_station_id, t.customer_name, t.delivery_type,
              ROUND(t.revenue, 2) AS revenue, ROUND(t.cost_total, 2) AS cost_total,
              ROUND(t.revenue - t.cost_total, 2) AS profit_total,
              ROUND(t.costA, 2) AS costA, ROUND(t.costB, 2) AS costB,
              t.total_qty
       FROM (
         SELECT o.order_id, o.created_at, o.station_id, o.machine_station_id, o.customer_name, o.delivery_type,
                SUM(${itemRevenueExpr()}) AS revenue,
                SUM(${itemCostExpr(wantType)}) AS cost_total,
                SUM(${retailCostAExpr()}) AS costA,
                SUM(${retailCostBExpr()}) AS costB,
                SUM(oi.quantity) AS total_qty
         FROM orders o
         JOIN order_items oi ON o.order_id = oi.order_id
         WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}
         GROUP BY o.order_id, o.created_at, o.station_id, o.machine_station_id, o.customer_name, o.delivery_type
       ) t
       ORDER BY t.created_at DESC`,
      [wantType, ...rw.params]
    );

    const list = rows.map(x => ({
      orderId: x.order_id, orderNo: x.order_id,
      customerName: x.customer_name || '-',
      totalQty: Number(x.total_qty) || 0,
      revenue: Number(x.revenue) || 0,
      costTotal: Number(x.cost_total) || 0,
      costA: Number(x.costA) || 0,
      costB: Number(x.costB) || 0,
      profitTotal: Number(x.profit_total) || 0,
      createTime: x.created_at
    }));

    const summary = {
      revenue: round2(list.reduce((s, x) => s + x.revenue, 0)),
      costTotal: round2(list.reduce((s, x) => s + x.costTotal, 0)),
      profit: round2(list.reduce((s, x) => s + x.profitTotal, 0)),
      costA: round2(list.reduce((s, x) => s + x.costA, 0)),
      costB: round2(list.reduce((s, x) => s + x.costB, 0)),
      orderCount: list.length,
      totalQty: list.reduce((s, x) => s + x.totalQty, 0)
    };
  return { list, summary };
}

// 单类型利润（页面接口）
async function getProfitByType(req, res) {
  try {
    const wantType = Number(req.query.orderType);
    if (!VALID_ORDER_TYPES.includes(wantType)) return error(res, '订单类型无效', 400);
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);

    // 机台类型（4/6）：营收来自 machine_sales，成本来自机台供货订单
    if (wantType === 4 || wantType === 6) {
      const { list, summary, note } = await loadMachineProfit(r, wantType);
      return success(res, {
        list, summary, note, orderType: wantType, typeName: ORDER_TYPES[wantType],
        label: PROFIT_LABELS[wantType], range: r, start: r.start, end: r.end
      });
    }

    const { list, summary } = await loadProfitByType(r, wantType);
    return success(res, {
      list, summary, orderType: wantType, typeName: ORDER_TYPES[wantType],
      label: PROFIT_LABELS[wantType], range: r, start: r.start, end: r.end
    });
  } catch (e) {
    console.error('getProfitByType error:', e);
    return error(res, '利润统计查询失败', 500);
  }
}

// 直营水站：营收1 / 营收2 表达式已上移至 utils/revenueExpr.js
// （stationRevenue1Expr / stationRevenue2Expr）—— 利润统计与利润导出共用同一份口径。

// 机台利润（量贩机/零售机）：营收按 machine_sales.sale_date，成本按机台供货订单 o.created_at
// ⚠️ 机台营收与成本时间口径不同属预期（machine_sales 人工录入、不强制关联订单），见文件头说明
async function loadMachineProfit(r, orderType) {
  const machineType = MACHINE_OF_ORDER_TYPE[orderType];

  // 机台营收（按销量日期）
  const machineParts = ['machine_type = ?'];
  const machineParams = [machineType];
  if (r.start && r.end) { machineParts.push('sale_date >= ? AND sale_date < ?'); machineParams.push(r.start, r.end); }
  const [revRows] = await pool.execute(
    `SELECT ROUND(SUM(sale_price * quantity), 2) AS revenue, SUM(quantity) AS total_qty
     FROM machine_sales WHERE ${machineParts.join(' AND ')}`,
    machineParams
  );

  // 机台成本（按订单日期）
  const rw = buildRangeWhere('o.created_at', r);
  const [costRows] = await pool.execute(
    `SELECT ROUND(SUM(${itemCostExpr(orderType)}), 2) AS cost_total,
            COUNT(DISTINCT o.order_id) AS order_count,
            SUM(oi.quantity) AS total_qty
     FROM orders o
     JOIN order_items oi ON o.order_id = oi.order_id
     WHERE o.order_type = ? AND o.canceled_at IS NULL AND ${rw.clause}`,
    [orderType, ...rw.params]
  );

  const revenue = round2(revRows[0] ? revRows[0].revenue : 0);
  const saleQty = Number(revRows[0] ? revRows[0].total_qty : 0) || 0;
  const costTotal = round2(costRows[0] ? costRows[0].cost_total : 0);
  const summary = {
    revenue,
    costTotal,
    profit: round2(revenue - costTotal),
    saleQty,
    orderCount: Number(costRows[0] ? costRows[0].order_count : 0) || 0,
    supplyQty: Number(costRows[0] ? costRows[0].total_qty : 0) || 0
  };

  return {
    list: [],
    summary,
    note: '机台营收按销量日期统计，机台成本按供货订单日期统计'
  };
}

// 利润总览（全部类型横向对比）：供「利润汇总」页使用
async function getProfitOverview(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
    const rw = buildRangeWhere('o.created_at', r);

    // 订单类 1/2/3/5：按订单聚合再按类型汇总
    const [orderRows] = await pool.execute(
      `SELECT t.order_type,
              ROUND(SUM(t.revenue), 2) AS revenue,
              ROUND(SUM(t.cost_total), 2) AS cost_total,
              ROUND(SUM(t.revenue - t.cost_total), 2) AS profit,
              COUNT(*) AS order_count,
              SUM(t.total_qty) AS total_qty
       FROM (
         SELECT o.order_id, o.order_type,
                SUM(${itemRevenueExpr()}) AS revenue,
                SUM(${costExpr()}) AS cost_total,
                SUM(oi.quantity) AS total_qty
         FROM orders o
         JOIN order_items oi ON o.order_id = oi.order_id
         WHERE o.order_type IN (1,2,3,5) AND o.canceled_at IS NULL AND ${rw.clause}
         GROUP BY o.order_id, o.order_type
       ) t
       GROUP BY t.order_type`,
      rw.params
    );

    // 直营水站拆利润1/利润2
    const [stationRows] = await pool.execute(
      `SELECT ROUND(SUM(t.revenue1), 2) AS revenue1, ROUND(SUM(t.revenue2), 2) AS revenue2,
              ROUND(SUM(t.cost1), 2) AS cost1, ROUND(SUM(t.cost2), 2) AS cost2,
              ROUND(SUM(t.revenue1 - t.cost1), 2) AS profit1,
              ROUND(SUM(t.revenue2 - t.cost2), 2) AS profit2
       FROM (
         SELECT o.order_id,
                SUM(${stationRevenue1Expr()}) AS revenue1, SUM(${stationRevenue2Expr()}) AS revenue2,
                SUM(${stationCost1Expr()}) AS cost1, SUM(${stationCost2Expr()}) AS cost2
         FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
         WHERE o.order_type = 2 AND o.canceled_at IS NULL AND ${rw.clause}
         GROUP BY o.order_id
       ) t`,
      rw.params
    );

    // 机台类 4/6：营收按 sale_date、成本按订单日期
    const machineRows = [];
    for (const orderType of [4, 6]) {
      const machineType = MACHINE_OF_ORDER_TYPE[orderType];
      const mp = ['machine_type = ?']; const mpar = [machineType];
      if (r.start && r.end) { mp.push('sale_date >= ? AND sale_date < ?'); mpar.push(r.start, r.end); }
      const [rev] = await pool.execute(`SELECT ROUND(SUM(sale_price*quantity),2) AS revenue FROM machine_sales WHERE ${mp.join(' AND ')}`, mpar);
      const [cst] = await pool.execute(
        `SELECT ROUND(SUM(${itemCostExpr(orderType)}),2) AS cost_total FROM orders o JOIN order_items oi ON o.order_id=oi.order_id
         WHERE o.order_type=? AND o.canceled_at IS NULL AND ${rw.clause}`,
        [orderType, ...rw.params]
      );
      machineRows.push({
        order_type: orderType,
        revenue: Number(rev[0]?.revenue) || 0,
        cost_total: Number(cst[0]?.cost_total) || 0,
        profit: round2((Number(rev[0]?.revenue) || 0) - (Number(cst[0]?.cost_total) || 0)),
        order_count: 0, total_qty: 0
      });
    }

    const map = {};
    VALID_ORDER_TYPES.forEach(t => {
      map[t] = { orderType: t, typeName: ORDER_TYPES[t], revenue: 0, costTotal: 0, profit: 0, orderCount: 0, totalQty: 0, label: PROFIT_LABELS[t] };
    });
    orderRows.forEach(x => {
      if (!map[x.order_type]) return;
      map[x.order_type].revenue = Number(x.revenue) || 0;
      map[x.order_type].costTotal = Number(x.cost_total) || 0;
      map[x.order_type].profit = Number(x.profit) || 0;
      map[x.order_type].orderCount = Number(x.order_count) || 0;
      map[x.order_type].totalQty = Number(x.total_qty) || 0;
    });
    machineRows.forEach(x => {
      if (!map[x.order_type]) return;
      map[x.order_type].revenue = round2(x.revenue);
      map[x.order_type].costTotal = round2(x.cost_total);
      map[x.order_type].profit = round2(x.profit);
    });

    const s = stationRows[0] || {};
    const list = VALID_ORDER_TYPES.map(t => {
      const item = map[t];
      if (t === 2) {
        item.revenue1 = Number(s.revenue1) || 0;
        item.revenue2 = Number(s.revenue2) || 0;
        item.cost1 = Number(s.cost1) || 0;
        item.cost2 = Number(s.cost2) || 0;
        item.profit1 = Number(s.profit1) || 0;
        item.profit2 = Number(s.profit2) || 0;
      }
      return item;
    });

    const overall = {
      revenue: round2(list.reduce((a, x) => a + x.revenue, 0)),
      costTotal: round2(list.reduce((a, x) => a + x.costTotal, 0)),
      profit: round2(list.reduce((a, x) => a + x.profit, 0))
    };
    overall.margin = overall.revenue > 0 ? Math.round((overall.profit / overall.revenue) * 10000) / 100 : 0;

    return success(res, { list, overall, range: r, start: r.start, end: r.end });
  } catch (e) {
    console.error('getProfitOverview error:', e);
    return error(res, '利润总览查询失败', 500);
  }
}

// 批量取水站名称
async function loadStationNames(conn, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  const map = {};
  if (!list.length) return map;
  const [rows] = await conn.query(
    `SELECT station_id, station_name FROM sub_stations WHERE station_id IN (${list.map(() => '?').join(',')})`,
    list
  );
  rows.forEach(x => { map[x.station_id] = x.station_name; });
  return map;
}

// ===========================================================================
// 利润统计一键导出（2026-09-16 晚 2）
// GET /api/profit/export?orderType=1..6&range=month
//   订单类 1/2/3/5 → sheet：汇总与口径 / 利润明细(订单) / 商品明细(营收·成本·利润)
//   机台类 4/6     → sheet：汇总与口径 / 机台利润汇总 / 机台销量明细 / 供货商品成本明细
// ⚠️ 与利润统计页同源：订单汇总走 loadProfitByType / loadMachineProfit，
//    商品行口径走 utils/itemLines.js（内部复用 costExpr / revenueExpr 单源表达式）。
// ===========================================================================
async function exportProfit(req, res) {
  try {
    const wantType = Number(req.query.orderType);
    if (!VALID_ORDER_TYPES.includes(wantType)) return error(res, '订单类型无效', 400);
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);

    const typeName = ORDER_TYPES[wantType];
    const label = PROFIT_LABELS[wantType];
    const isMachine = wantType === 4 || wantType === 6;

    const { list, summary } = isMachine
      ? await loadMachineProfit(r, wantType)
      : await loadProfitByType(r, wantType);

    // ---- sheet 1：汇总与口径 ----
    const overviewRows = [
      { 项目: '统计类型', 数值: typeName },
      { 项目: '统计范围', 数值: `${r.start} ~ ${r.end}` },
      { 项目: '利润口径', 数值: label.main },
      { 项目: '计算公式', 数值: label.formula },
      { 项目: '口径说明', 数值: label.desc },
      { 项目: '营收', 数值: summary.revenue },
      { 项目: '成本合计', 数值: summary.costTotal },
      { 项目: '利润', 数值: summary.profit }
    ];
    if (wantType === 2) {
      overviewRows.push(
        { 项目: '营收1（返货价值+总包配送费）', 数值: summary.revenue1 },
        { 项目: '成本1（水票抵扣商品）', 数值: summary.cost1 },
        { 项目: '利润1', 数值: summary.profit1 },
        { 项目: '营收2（分销价合计）', 数值: summary.revenue2 },
        { 项目: '成本2（未抵扣商品）', 数值: summary.cost2 },
        { 项目: '利润2', 数值: summary.profit2 }
      );
    }
    if (isMachine) {
      overviewRows.push(
        { 项目: '机台销量（件）', 数值: summary.saleQty },
        { 项目: '供货件数', 数值: summary.supplyQty },
        { 项目: '时间口径', 数值: '机台营收按销量日期，机台成本按供货订单日期（两者不同属预期）' }
      );
    } else {
      overviewRows.push(
        { 项目: '订单数', 数值: summary.orderCount },
        { 项目: '商品件数', 数值: summary.totalQty }
      );
    }
    const sheets = [{ name: '汇总与口径', data: overviewRows, widths: [26, 62] }];

    if (isMachine) {
      // ---- 机台：利润汇总（单行） + 销量明细（营收侧） + 供货商品成本明细 ----
      sheets.push({
        name: '机台利润汇总',
        data: [{
          统计类型: typeName,
          机台营收: summary.revenue,
          机台成本: summary.costTotal,
          利润: summary.profit,
          机台销量件数: summary.saleQty,
          供货订单数: summary.orderCount,
          供货件数: summary.supplyQty
        }]
      });

      const machineType = MACHINE_OF_ORDER_TYPE[wantType];
      // ⚠️ machine_stations 也有 machine_type 列，此处必须带 s. 前缀，否则 ER_NON_UNIQ_ERROR
      const mp = ['s.machine_type = ?', 's.sale_date >= ? AND s.sale_date < ?'];
      const [saleRows] = await pool.execute(
        `SELECT s.sale_date, s.quantity, s.sale_price, s.remark,
                m.station_name, p.product_name, p.specification, p.unit
         FROM machine_sales s
         LEFT JOIN machine_stations m ON m.machine_id = s.machine_id
         LEFT JOIN products p ON p.product_id = s.product_id
         WHERE ${mp.join(' AND ')}
         ORDER BY s.sale_date DESC, s.created_at DESC`,
        [machineType, r.start, r.end]
      );
      sheets.push({
        name: '机台销量明细',
        data: saleRows.map((x) => ({
          销售日期: x.sale_date,
          机台: x.station_name || '',
          商品: x.product_name || '',
          规格: x.specification || '',
          单位: x.unit || '',
          销量: Number(x.quantity) || 0,
          售价: round2(x.sale_price),
          营收: round2(Number(x.sale_price) * Number(x.quantity)),
          备注: x.remark || ''
        }))
      });

      // 机台成本的商品行（口径与成本页一致：类型4 = 进货价+工人零售机配送费；类型6 = 进货价）
      const costLines = await loadCostItemLines(pool, { orderType: wantType, rw: buildRangeWhere('o.created_at', r) });
      sheets.push({
        name: '供货商品成本明细',
        data: costLines.map((x) => ({
          机台: x.machineName || '',
          订单号: x.orderId,
          商品名称: x.productName,
          规格: x.spec,
          单位: x.unit,
          数量: x.quantity,
          进货价: x.purchasePrice,
          工人配送费: x.workerMachineFee,
          行成本: x.costTotal,
          下单时间: x.createTime
        }))
      });
    } else {
      // ---- 订单类：订单级利润明细 + 商品行明细 ----
      const orderSheet = list.map((x) => {
        const row = {
          订单号: x.orderId,
          数量: x.totalQty
        };
        if (wantType === 2) {
          row.水站 = x.stationName || '-';
          row.营收1 = x.revenue1;
          row.成本1 = x.cost1;
          row.利润1 = x.profit1;
          row.营收2 = x.revenue2;
          row.成本2 = x.cost2;
          row.利润2 = x.profit2;
        } else {
          row.客户 = x.customerName || '-';
          row.营收 = x.revenue;
          if (wantType === 3) {
            row.成本A = x.costA;
            row.成本B = x.costB;
          }
        }
        row.成本合计 = x.costTotal;
        row.利润 = x.profitTotal;
        row.下单时间 = x.createTime;
        return row;
      });
      sheets.push({ name: '利润明细', data: orderSheet });

      const lines = await loadProfitItemLines(pool, { orderType: wantType, rw: buildRangeWhere('o.created_at', r) });
      const itemSheet = lines.map((x) => {
        const row = {
          订单号: x.orderId,
          客户或水站: (wantType === 2 ? x.stationName : x.customerName) || '-',
          商品名称: x.productName,
          规格: x.spec,
          单位: x.unit,
          数量: x.quantity
        };
        if (wantType === 2) {
          row.营收1 = x.revenue1;
          row.营收2 = x.revenue2;
        }
        row.营收 = x.revenue;
        row.成本 = x.costTotal;
        row.利润 = x.profit;
        row.下单时间 = x.createTime;
        return row;
      });
      sheets.push({ name: '商品明细', data: itemSheet });
    }

    const buffer = await writeWorkbook(sheets);
    const fileName = `利润_${typeName}_${r.start}_${r.end}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 中文文件名需按 RFC 5987 编码，否则 Node 报 ERR_INVALID_CHAR
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportProfit error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = { getProfitByType, getProfitOverview, exportProfit, PROFIT_LABELS };

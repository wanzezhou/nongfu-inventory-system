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
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');
const { ORDER_TYPES, VALID_ORDER_TYPES } = require('../constants/order');
const { writeWorkbook } = require('../utils/excel');
const { loadCostItemLines } = require('../utils/itemLines');
const { loadSalarySummary } = require('../services/salarySummary');
const costExprUtil = require('../utils/costExpr');
const {
  ticketQtyExpr,
  nonTicketQtyExpr,
  stationCost1Expr,
  stationCost2Expr,
  retailCostAExpr,
  retailCostBExpr,
  itemCostExpr,
  costExpr,
  COST_LABELS
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
/**
 * 单类型成本取数（页面查询与导出共用，避免导出另写一套口径）
 * @param {{start:string,end:string}} r 时间范围（utils/dateRange.resolveRange 结果）
 * @param {number} wantType 订单类型 1..6
 * @returns {Promise<{list: object[], summary: object}>}
 */
async function loadCostByType(r, wantType) {
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
    const [ss] = await pool.query(
      `SELECT station_id, station_name FROM sub_stations WHERE station_id IN (${stationIds.map(() => '?').join(',')})`,
      stationIds
    );
    ss.forEach(x => {
      nameOfStation[x.station_id] = x.station_name;
    });
  }
  if (machineIds.length) {
    const [ms] = await pool.query(
      `SELECT machine_id, station_name FROM machine_stations WHERE machine_id IN (${machineIds.map(() => '?').join(',')})`,
      machineIds
    );
    ms.forEach(x => {
      nameOfMachine[x.machine_id] = x.station_name;
    });
  }

  const list = rows.map(x => ({
    orderId: x.order_id,
    orderNo: x.order_id,
    customerName: x.customer_name || '-',
    stationName: x.station_id ? nameOfStation[x.station_id] || x.station_id : null,
    machineName: x.machine_station_id ? nameOfMachine[x.machine_station_id] || x.machine_station_id : null,
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

  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
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

  return { list, summary };
}

async function getCostByType(req, res) {
  try {
    const wantType = Number(req.query.orderType);
    if (!VALID_ORDER_TYPES.includes(wantType)) {
      return error(res, '订单类型无效', 400);
    }
    const r = resolveRange(req.query);
    if (!r) {
      return error(res, RANGE_INVALID_MSG, 400);
    }
    const { list, summary } = await loadCostByType(r, wantType);

    return success(res, {
      list,
      summary,
      orderType: wantType,
      typeName: ORDER_TYPES[wantType],
      label: COST_LABELS[wantType],
      range: r,
      start: r.start,
      end: r.end
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
/**
 * 成本总览**取数**（Web 成本汇总页与小程序管理端共用 —— 单源，不重写 SQL）
 * @param {object} r utils/dateRange.resolveRange 结果（非法区间由调用方先拦 400）
 * @returns {Promise<object>} 原 getCostOverview 的 data
 */
async function loadCostOverview(r) {
  {
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
      byType[t] = {
        orderType: t,
        typeName: ORDER_TYPES[t],
        costTotal: 0,
        orderCount: 0,
        totalQty: 0,
        label: COST_LABELS[t]
      };
    });
    rows.forEach(x => {
      if (byType[x.order_type]) {
        byType[x.order_type].costTotal = Number(x.cost_total) || 0;
        byType[x.order_type].orderCount = Number(x.order_count) || 0;
        byType[x.order_type].totalQty = Number(x.total_qty) || 0;
      }
    });

    const list = VALID_ORDER_TYPES.map(t => byType[t]);
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const orderCostTotal = r2(list.reduce((s, x) => s + x.costTotal, 0));

    return { list, orderCostTotal, range: r, start: r.start, end: r.end };
  }
}

/** HTTP 出口（薄封装：只做区间校验与响应信封） */
async function getCostOverview(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
    return success(res, await loadCostOverview(r));
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
/** 机台成本取数（页面查询与导出共用） */
async function loadMachineCost(r, machineType) {
  const orderType = MACHINE_ORDER_TYPE[machineType];
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
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const summary = {
    costTotal: r2(list.reduce((s, x) => s + x.costTotal, 0)),
    machineCount: list.length,
    orderCount: list.reduce((s, x) => s + x.orderCount, 0),
    totalQty: list.reduce((s, x) => s + x.totalQty, 0)
  };
  return { list, summary, orderType };
}

async function getMachineCost(req, res) {
  try {
    const machineType = Number(req.query.machineType);
    if (![1, 2].includes(machineType)) return error(res, '机台类型无效（1=量贩机 / 2=零售机）', 400);
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);

    const { list, summary, orderType } = await loadMachineCost(r, machineType);

    return success(res, {
      list,
      summary,
      machineType,
      orderType,
      typeName: ORDER_TYPES[orderType],
      label: COST_LABELS[orderType],
      range: r,
      start: r.start,
      end: r.end
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
        const costTotal =
          t === 2
            ? (Number(x.cost1) || 0) + (Number(x.cost2) || 0)
            : t === 3
              ? (Number(x.delivery_type) === 1 ? Number(x.costA) : Number(x.costB)) || 0
              : t === 1 || t === 5
                ? (Number(x.purchase_price) + Number(x.worker_retail_delivery_fee)) * Number(x.quantity)
                : t === 4
                  ? (Number(x.purchase_price) + Number(x.worker_machine_delivery_fee)) * Number(x.quantity)
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
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
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

// ===========================================================================
// 成本统计一键导出（2026-09-16 晚 2）
// GET /api/cost/export?orderType=1..6&range=month   单类型成本（含商品明细）
// GET /api/cost/export?machineType=1|2&range=month  机台成本（含供货商品明细）
// GET /api/cost/export/summary?range=month          成本汇总页（三张明细表）
// ⚠️ 与成本统计页同源：订单汇总走 loadCostByType / loadMachineCost，
//    商品行口径走 utils/itemLines.js（内部复用 utils/costExpr.js 单源表达式）。
// ===========================================================================
async function exportCost(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
    const machineTypeRaw = req.query.machineType;
    const orderTypeRaw = req.query.orderType;
    const hasMachine = machineTypeRaw !== undefined && machineTypeRaw !== '';
    const hasOrder = orderTypeRaw !== undefined && orderTypeRaw !== '';

    if (!hasMachine && !hasOrder) {
      return error(res, '缺少参数：orderType（订单类型）或 machineType（机台类型）', 400);
    }

    const rw = buildRangeWhere('o.created_at', r);
    const sheets = [];
    let fileName;

    if (hasMachine) {
      const machineType = Number(machineTypeRaw);
      if (![1, 2].includes(machineType)) return error(res, '机台类型无效（1=量贩机 / 2=零售机）', 400);
      const { list, summary, orderType } = await loadMachineCost(r, machineType);
      const typeName = ORDER_TYPES[orderType];

      sheets.push({
        name: '汇总与口径',
        data: [
          { 项目: '统计类型', 数值: typeName },
          { 项目: '统计范围', 数值: `${r.start} ~ ${r.end}` },
          { 项目: '成本口径', 数值: COST_LABELS[orderType].desc },
          { 项目: '时间口径', 数值: '成本按机台供货订单(订单类型对应)的创建日期统计' },
          { 项目: '机台数量', 数值: summary.machineCount },
          { 项目: '供货订单数', 数值: summary.orderCount },
          { 项目: '供货件数', 数值: summary.totalQty },
          { 项目: '成本合计', 数值: summary.costTotal }
        ],
        widths: [20, 58]
      });

      sheets.push({
        name: '机台成本汇总',
        data: list.map(x => ({
          机台: x.machineName,
          供货订单数: x.orderCount,
          供货件数: x.totalQty,
          成本: x.costTotal
        }))
      });

      const lines = await loadCostItemLines(pool, { orderType, rw });
      sheets.push({
        name: '供货商品明细',
        data: lines.map(x => ({
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

      fileName = `成本_${typeName}_${r.start}_${r.end}.xlsx`;
    } else {
      const wantType = Number(orderTypeRaw);
      if (!VALID_ORDER_TYPES.includes(wantType)) return error(res, '订单类型无效', 400);
      const { list, summary } = await loadCostByType(r, wantType);
      const typeName = ORDER_TYPES[wantType];
      const label = COST_LABELS[wantType];
      const showTicket = wantType === 2;
      const showSplitAB = wantType === 3;

      sheets.push({
        name: '汇总与口径',
        data: [
          { 项目: '统计类型', 数值: typeName },
          { 项目: '统计范围', 数值: `${r.start} ~ ${r.end}` },
          { 项目: '成本口径', 数值: label.main },
          { 项目: '口径说明', 数值: label.desc },
          { 项目: '订单数', 数值: summary.orderCount },
          { 项目: '商品件数', 数值: summary.totalQty },
          { 项目: '成本合计', 数值: summary.costTotal }
        ],
        widths: [20, 62]
      });

      sheets.push({
        name: '成本明细',
        data: list.map(x => {
          const row = {
            订单号: x.orderId,
            [wantType === 2 ? '水站' : '客户']: (wantType === 2 ? x.stationName : x.customerName) || '-',
            数量: x.totalQty
          };
          if (showTicket) {
            row.抵扣件数 = x.ticketQty;
            row.成本1 = x.cost1;
            row.成本2 = x.cost2;
          }
          if (showSplitAB) {
            row.成本A = x.costA;
            row.成本B = x.costB;
          }
          row.成本合计 = x.costTotal;
          row.下单时间 = x.createTime;
          return row;
        })
      });

      const lines = await loadCostItemLines(pool, { orderType: wantType, rw });
      sheets.push({
        name: '商品明细',
        data: lines.map(x => {
          const row = {
            订单号: x.orderId,
            客户或水站: (wantType === 2 ? x.stationName : x.customerName) || '-',
            商品名称: x.productName,
            规格: x.spec,
            单位: x.unit,
            数量: x.quantity
          };
          if (showTicket) {
            row.抵扣件数 = x.ticketQty;
            row.未抵扣件数 = x.nonTicketQty;
          }
          row.进货价 = x.purchasePrice;
          if (wantType === 2) {
            row.水站分销配送费 = x.distributionFee;
            row.工人水站配送费 = x.workerWholesaleFee;
          }
          if ([1, 3, 5].includes(wantType)) row.工人零售配送费 = x.workerRetailFee;
          if (wantType === 4) row.工人零售机配送费 = x.workerMachineFee;
          if (showTicket) {
            row.成本1 = x.cost1;
            row.成本2 = x.cost2;
          }
          if (showSplitAB) {
            row.成本A = x.costA;
            row.成本B = x.costB;
          }
          row.行成本 = x.costTotal;
          row.下单时间 = x.createTime;
          return row;
        })
      });

      fileName = `成本_${typeName}_${r.start}_${r.end}.xlsx`;
    }

    const buffer = await writeWorkbook(sheets);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 中文文件名需按 RFC 5987 编码，否则 Node 报 ERR_INVALID_CHAR
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportCost error:', e);
    return error(res, '导出失败', 500);
  }
}

/**
 * 成本汇总页导出：类型对比 + 其他支出明细 + 直营水站成本明细 + 员工工资明细
 * GET /api/cost/export/summary?range=month
 */
async function exportCostSummary(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
    const rw = buildRangeWhere('o.created_at', r);

    // 各类型成本对比（口径同 /cost/overview）
    const [typeRows] = await pool.execute(
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
    const costByType = {};
    typeRows.forEach(x => {
      costByType[Number(x.order_type)] = {
        orderCount: Number(x.order_count) || 0,
        totalQty: Number(x.total_qty) || 0,
        costTotal: Number(x.cost_total) || 0
      };
    });

    // 直营水站成本（类型2）：取订单明细后按水站聚合，口径与页面一致
    const { list: stationOrders } = await loadCostByType(r, 2);
    const stationMap = new Map();
    stationOrders.forEach(o => {
      const key = o.stationName || '未关联水站';
      const cur = stationMap.get(key) || {
        stationName: key,
        orderCount: 0,
        totalQty: 0,
        ticketQty: 0,
        cost1: 0,
        cost2: 0,
        costTotal: 0
      };
      cur.orderCount += 1;
      cur.totalQty += o.totalQty;
      cur.ticketQty += o.ticketQty;
      cur.cost1 += o.cost1;
      cur.cost2 += o.cost2;
      cur.costTotal += o.costTotal;
      stationMap.set(key, cur);
    });
    const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const stationRows = [...stationMap.values()]
      .map(x => ({ ...x, cost1: r2(x.cost1), cost2: r2(x.cost2), costTotal: r2(x.costTotal) }))
      .sort((a, b) => b.costTotal - a.costTotal);

    // 其他支出（口径同 /expenses：range 作用于 expense_date）
    const er = buildRangeWhere('expense_date', r);
    const [expenseRows] = await pool.execute(
      `SELECT expense_name, category, amount, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
              COALESCE(account_name, '') AS account_name, COALESCE(remark, '') AS remark,
              COALESCE(created_by, '') AS created_by
       FROM other_expenses
       ${er.clause ? 'WHERE ' + er.clause : ''}
       ORDER BY expense_date DESC, created_at DESC`,
      er.params
    );
    const otherExpense = r2(expenseRows.reduce((s, x) => s + (Number(x.amount) || 0), 0));

    // 员工工资（口径同工资统计页：services/salarySummary）
    const salary = await loadSalarySummary(r);

    const stationCost = r2(stationOrders.reduce((s, x) => s + x.costTotal, 0));
    const totalCost = r2(stationCost + salary.summary.totalDeliveryFee + otherExpense);

    const sheets = [
      {
        name: '成本汇总',
        data: [
          { 项目: '统计范围', 数值: `${r.start} ~ ${r.end}` },
          { 项目: '直营水站成本', 数值: stationCost },
          { 项目: '员工工资（订单配送费）', 数值: salary.summary.totalDeliveryFee },
          { 项目: '其他支出', 数值: otherExpense },
          { 项目: '成本合计', 数值: totalCost },
          {
            项目: '口径说明',
            数值: '成本合计 = 直营水站成本（成本1 水票抵扣商品 + 成本2 未抵扣商品） + 员工工资（订单配送费） + 其他支出'
          }
        ],
        widths: [24, 66]
      },
      {
        name: '各类型成本对比',
        data: VALID_ORDER_TYPES.map(t => {
          const c = costByType[t] || { orderCount: 0, totalQty: 0, costTotal: 0 };
          return {
            订单类型: ORDER_TYPES[t],
            计算口径: COST_LABELS[t].desc,
            订单数: c.orderCount,
            商品件数: c.totalQty,
            成本合计: r2(c.costTotal)
          };
        })
      },
      {
        name: '直营水站成本明细',
        data: stationRows.map(x => ({
          水站名称: x.stationName,
          订单数: x.orderCount,
          商品件数: x.totalQty,
          抵扣件数: x.ticketQty,
          成本1: x.cost1,
          成本2: x.cost2,
          成本合计: x.costTotal
        }))
      },
      {
        name: '其他支出明细',
        data: expenseRows.map(x => ({
          支出名称: x.expense_name,
          支出类别: x.category,
          金额: Number(x.amount) || 0,
          支出日期: x.expense_date,
          支出账户: x.account_name,
          备注: x.remark,
          录入人: x.created_by
        }))
      },
      {
        name: '员工工资明细',
        data: salary.list.map(x => ({
          员工姓名: x.workerName,
          联系电话: x.phone,
          配送订单数: x.orderCount,
          配送件数: x.totalQty,
          配送费: x.calcFee,
          应发工资: x.due,
          待扣预支: x.pendingAdvance,
          实发金额: x.net,
          发放状态: x.paid ? '已发放' : '未发放'
        }))
      }
    ];

    const buffer = await writeWorkbook(sheets);
    const fileName = `成本汇总_${r.start}_${r.end}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportCostSummary error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = {
  getCostByType,
  getCostOverview,
  getMachineCost,
  getCostOrderLines,
  exportCost,
  exportCostSummary,
  // 取数函数（小程序管理端复用）
  loadCostOverview
};

// 仪表盘数据接口（2026-09-16 重构）
// ---------------------------------------------------------------------------
// 两类数据：
//   ① /summary —— 与时间无关的卡片（库存总金额 / 待配送订单），随页面刷新一次
//   ② /metrics —— 周期卡片（总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润）
//      周期由前端按卡片选择（月/季/年），故本接口接受 range 参数，一次返回该周期全部指标；
//      前端对同一 range 只请求一次，多张卡片共用同一份结果
//   ③ /trend   —— 本年度 1~12 月「商品件数」趋势
//
// ⚠️ 金额口径一律复用单源表达式，禁止在本文件另写公式：
//   营收 = utils/revenueExpr.itemRevenueExpr（订单类）+ machine_sales（机台 4/6）
//   成本 = utils/costExpr.costExpr（按 o.order_type 分派，含机台供货订单成本）
//   工资 = services/salarySummary.loadSalarySummary（与工资统计页同一函数）
// ---------------------------------------------------------------------------
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere } = require('../utils/dateRange');
const { itemRevenueExpr } = require('../utils/revenueExpr');
const { costExpr } = require('../utils/costExpr');
const { loadSalarySummary } = require('../services/salarySummary');
const { VALID_ORDER_TYPES } = require('../constants/order');

// 卡片可选周期白名单（月/季/年）—— 非法值直接 400，不静默回退成本月
const CARD_RANGES = ['month', 'quarter', 'year'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 全部合法订单类型的 SQL 片段（由常量派生，禁硬编码 IN 列表）
const ORDER_TYPE_IN = `o.order_type IN (${VALID_ORDER_TYPES.join(',')})`;

// 获取与时间无关的统计（库存总金额 / 待配送订单）
async function getSummary(req, res) {
  try {
    // totalInventoryValue：库存金额 = Σ max(库存,0) × 进货价，仅统计启用商品
    //   ① GREATEST(quantity,0)：负库存不计负值，避免单条脏数据把总额拉成负数
    //   ② INNER JOIN + status=1：软删商品不计入
    const [inventoryRows] = await pool.execute(`
      SELECT COALESCE(SUM(GREATEST(i.quantity, 0) * p.purchase_price), 0) as totalInventoryValue
      FROM inventory i
      INNER JOIN products p ON i.product_id = p.product_id AND p.status = 1
    `);
    const totalInventoryValue = inventoryRows[0].totalInventoryValue;

    // pendingOrders（待配送数）：自有员工配送(delivery_type=1)且未分配配送员(worker_id IS NULL)且未取消
    const [pendingRows] = await pool.execute(`
      SELECT COUNT(*) as pendingOrders
      FROM orders
      WHERE delivery_type = 1
      AND worker_id IS NULL
      AND canceled_at IS NULL
    `);
    const pendingOrders = pendingRows[0].pendingOrders;

    // 注：原「本月销售额」卡片已由「总营收（可选月/季/年）」取代（2026-09-16），故不再返回 monthSales
    return success(res, {
      totalInventoryValue,
      pendingOrders
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    return error(res, '获取统计数据失败: ' + err.message);
  }
}

/**
 * 周期指标（仪表盘 6 张可切换周期的卡片共用一次查询结果）
 * GET /api/dashboard/metrics?range=month|quarter|year
 *
 * 口径（业务方 2026-09-16 确认）：
 *   - 总销量   = Σ order_items.quantity（全部合法订单类型，含机台供货件数）+ Σ machine_sales.quantity
 *   - 总订单数 = 区间内未取消订单数（含机台供货订单）
 *   - 总营收   = 订单类营收(类型1/2/3/5，itemRevenueExpr) + 机台销量营收(machine_sales)
 *   - 总成本   = 订单商品成本合计（costExpr，含机台供货订单；不含工资与其他支出）
 *   - 工资统计 = 区间内应发工资合计（loadSalarySummary，与工资统计页同口径）
 *   - 总利润   = 总营收 − 总成本（与利润统计页一致，工资卡片独立展示不重复扣除）
 *
 * ⚠️ 机台营收按 machine_sales.sale_date、机台成本按供货订单 created_at——二者时间口径
 *    不同属预期（machine_sales 人工录入、不强制关联订单），与利润统计页保持一致。
 */
async function getMetrics(req, res) {
  try {
    const range = req.query.range || 'month';
    if (!CARD_RANGES.includes(range)) {
      return error(res, `统计周期不合法：支持 ${CARD_RANGES.join('/')}`, 400);
    }
    const r = resolveRange({ range });
    if (!r) return error(res, '统计周期解析失败', 400);

    const rw = buildRangeWhere('o.created_at', r);

    // ① 订单类：订单数 / 商品件数 / 营收 / 成本（一条 SQL 取全，避免多次扫表）
    const [orderRows] = await pool.execute(
      `SELECT COUNT(DISTINCT o.order_id) AS order_count,
              COALESCE(SUM(oi.quantity), 0) AS order_qty,
              ROUND(COALESCE(SUM(${itemRevenueExpr()}), 0), 2) AS order_revenue,
              ROUND(COALESCE(SUM(${costExpr()}), 0), 2) AS order_cost
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN} AND ${rw.clause}`,
      rw.params
    );

    // ② 机台销量（类型4/6 的营收与销量来源）
    const mParts = [];
    const mParams = [];
    if (r.start) { mParts.push('sale_date >= ?'); mParams.push(r.start); }
    if (r.end) { mParts.push('sale_date < ?'); mParams.push(r.end); }
    const [machineRows] = await pool.execute(
      `SELECT COALESCE(SUM(quantity), 0) AS machine_qty,
              ROUND(COALESCE(SUM(sale_price * quantity), 0), 2) AS machine_revenue
       FROM machine_sales
       ${mParts.length ? 'WHERE ' + mParts.join(' AND ') : ''}`,
      mParams
    );

    // ③ 工资（复用工资统计页单源函数）
    const { summary: salarySummary } = await loadSalarySummary(r);

    const orderQty = Number(orderRows[0].order_qty) || 0;
    const machineQty = Number(machineRows[0].machine_qty) || 0;
    const orderRevenue = Number(orderRows[0].order_revenue) || 0;
    const machineRevenue = Number(machineRows[0].machine_revenue) || 0;
    const revenue = round2(orderRevenue + machineRevenue);
    const cost = round2(orderRows[0].order_cost);
    const salary = round2(salarySummary.totalDeliveryFee);
    const profit = round2(revenue - cost);

    return success(res, {
      range,
      start: r.start,
      end: r.end,
      orderCount: Number(orderRows[0].order_count) || 0,
      salesQty: orderQty + machineQty,
      revenue,
      cost,
      salary,
      profit,
      // 拆分明细：便于卡片副文案标注口径来源，也便于排障对账
      detail: { orderQty, machineQty, orderRevenue, machineRevenue }
    });
  } catch (err) {
    console.error('获取仪表盘周期指标失败:', err);
    return error(res, '获取仪表盘周期指标失败: ' + err.message);
  }
}

/**
 * 月销售趋势（本年度 1~12 月，按商品件数）
 * GET /api/dashboard/trend
 * 返回：[{ month:'2026-01', label:'1月', qty: 0 }, ... 12 项]
 * 件数口径与「总销量」一致：订单商品件数（含机台供货）+ 机台销量件数
 */
async function getTrend(req, res) {
  try {
    const year = new Date().getFullYear();
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    const [orderRows] = await pool.execute(
      `SELECT MONTH(o.created_at) AS m, COALESCE(SUM(oi.quantity), 0) AS qty
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN}
         AND o.created_at >= ? AND o.created_at < ?
       GROUP BY MONTH(o.created_at)`,
      [start, end]
    );

    const [machineRows] = await pool.execute(
      `SELECT MONTH(sale_date) AS m, COALESCE(SUM(quantity), 0) AS qty
       FROM machine_sales
       WHERE sale_date >= ? AND sale_date < ?
       GROUP BY MONTH(sale_date)`,
      [start, end]
    );

    const qtyMap = {};
    orderRows.forEach((x) => { qtyMap[Number(x.m)] = (qtyMap[Number(x.m)] || 0) + (Number(x.qty) || 0); });
    machineRows.forEach((x) => { qtyMap[Number(x.m)] = (qtyMap[Number(x.m)] || 0) + (Number(x.qty) || 0); });

    const list = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return { month: `${year}-${String(m).padStart(2, '0')}`, label: `${m}月`, qty: qtyMap[m] || 0 };
    });

    return success(res, list);
  } catch (err) {
    console.error('获取销售趋势失败:', err);
    return error(res, '获取销售趋势失败: ' + err.message);
  }
}

module.exports = {
  getSummary,
  getMetrics,
  getTrend
};

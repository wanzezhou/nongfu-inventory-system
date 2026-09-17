// 仪表盘数据接口（2026-09-17 重构：成本口径 + 多指标趋势）
// ---------------------------------------------------------------------------
// 三类数据：
//   ① /summary —— 与时间无关的卡片（当前仅「库存总金额」），随页面刷新一次
//   ② /metrics —— 周期卡片（总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润）
//      周期由前端按卡片选择（月/季/年），故本接口接受 range 参数，一次返回该周期全部指标；
//      前端对同一 range 只请求一次，多张卡片共用同一份结果
//   ③ /trends  —— 趋势图（销售件数 / 营收 / 成本 / 利润），按 granularity 分桶
//      （日/周/月/季/年），一次返回四张图所需的全部序列，前端按粒度缓存复用
//
// ⚠️ 金额口径一律复用单源表达式，禁止在本文件另写公式：
//   营收 = utils/revenueExpr.itemRevenueExpr（订单类）+ machine_sales（机台 4/6）
//   订单成本 = utils/costExpr.costExpr（按 o.order_type 分派，含机台供货订单成本）
//   工资 = services/salarySummary 的 summary.totalDue（应发 = 订单工人配送费，仅在职员工）；
//          趋势分桶时复用同一 deliveryFeeExpr 表达式直算，口径必须逐条对齐（见 getTrends 注释）
//   其他支出 = other_expenses.amount（按 expense_date）
//
// 成本口径（业务方 2026-09-17 确认）：**总成本 = 订单商品成本（全部订单类型）+ 工资 + 其他支出**
//   ⇒ 总利润 = 总营收 − 总成本（即已扣工资与其他支出）。
//   ⚠️ 与「成本汇总」页的「成本合计」**并不完全相等**：该页合计只取类型2（直营水站）成本
//      + 工资 + 其他支出（页面文案与实现一致），不含其余订单类型的商品成本。
//      仪表盘的成本要覆盖全部类型的营收，就必须用全类型成本，否则利润被系统性夸大。
//   ⚠️ 工资一律走「在职员工」口径（与工资统计页一致）：离职员工名下的历史配送费不计入。
// ---------------------------------------------------------------------------
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere } = require('../utils/dateRange');
const { itemRevenueExpr } = require('../utils/revenueExpr');
const { costExpr } = require('../utils/costExpr');
const { loadSalarySummary, deliveryFeeExpr } = require('../services/salarySummary');
const { VALID_ORDER_TYPES } = require('../constants/order');
const { GRANULARITIES, bucketExpr, buildBuckets } = require('../utils/trendBuckets');

// 卡片可选周期白名单（月/季/年）—— 非法值直接 400，不静默回退成本月
const CARD_RANGES = ['month', 'quarter', 'year'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 全部合法订单类型的 SQL 片段（由常量派生，禁硬编码 IN 列表）
const ORDER_TYPE_IN = `o.order_type IN (${VALID_ORDER_TYPES.join(',')})`;

// 其他支出合计（口径同「其他支出」页与成本汇总页：全表求和，按 expense_date 过滤）
async function loadOtherExpense(r) {
  const ew = buildRangeWhere('expense_date', r);
  const [rows] = await pool.execute(
    `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS other_expense
     FROM other_expenses WHERE ${ew.clause}`,
    ew.params
  );
  return round2(rows[0].other_expense);
}

// 获取与时间无关的统计（当前仅「库存总金额」）
// 注：原「待配送订单」查询已于 2026-09-16（晚 4）随卡片下线一并移除（业务方确认不使用）
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

    // 历史说明：原「本月销售额」(monthSales) 已由「总营收（可选月/季/年）」取代（9/16 晚 3）；
    //          「水站欠款总额」已于 9/16 随卡片下线。
    return success(res, { totalInventoryValue });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    return error(res, '获取统计数据失败: ' + err.message);
  }
}

/**
 * 周期指标（仪表盘 6 张可切换周期的卡片共用一次查询结果）
 * GET /api/dashboard/metrics?range=month|quarter|year
 *
 * 口径（业务方 2026-09-17 确认）：
 *   - 总销量   = Σ order_items.quantity（全部合法订单类型，含机台供货件数）+ Σ machine_sales.quantity
 *   - 总订单数 = 区间内未取消订单数（含机台供货订单）
 *   - 总营收   = 订单类营收(类型1/2/3/5，itemRevenueExpr) + 机台销量营收(machine_sales)
 *   - 总成本   = 订单商品成本(costExpr，全部类型) + 工资(应发配送费，在职员工) + 其他支出
 *                （口径来源与差异说明见文件头注释）
 *   - 工资统计 = 区间内应发工资合计（loadSalarySummary，与工资统计页同口径）
 *   - 总利润   = 总营收 − 总成本（成本已含工资与其他支出）
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

    // ③ 工资（复用工资统计页单源函数；取「应发」口径 totalDue —— 只有它能按时间粒度拆分，
    //    且与趋势图的工资分桶天然一致。工资统计页的 totalDeliveryFee 是含预支抵扣的结算口径）
    const { summary: salarySummary } = await loadSalarySummary(r);

    // ④ 其他支出
    const otherExpense = await loadOtherExpense(r);

    const orderQty = Number(orderRows[0].order_qty) || 0;
    const machineQty = Number(machineRows[0].machine_qty) || 0;
    const orderRevenue = Number(orderRows[0].order_revenue) || 0;
    const machineRevenue = Number(machineRows[0].machine_revenue) || 0;
    const revenue = round2(orderRevenue + machineRevenue);
    const orderCost = round2(orderRows[0].order_cost);
    const salary = round2(salarySummary.totalDue);
    // 总成本 = 订单商品成本 + 工资 + 其他支出
    const cost = round2(orderCost + salary + otherExpense);
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
      otherExpense,
      profit,
      // 拆分明细：便于卡片副文案标注口径来源，也便于排障对账
      detail: { orderQty, machineQty, orderRevenue, machineRevenue, orderCost, salary, otherExpense }
    });
  } catch (err) {
    console.error('获取仪表盘周期指标失败:', err);
    return error(res, '获取仪表盘周期指标失败: ' + err.message);
  }
}

/**
 * 趋势（销售件数 / 营收 / 成本 / 利润），按粒度分桶
 * GET /api/dashboard/trends?granularity=day|week|month|quarter|year
 *
 * 返回：{ granularity, start, end, buckets: [{ key, label, salesQty, revenue, cost, profit, ... }] }
 *   - 分桶规则与「完整自然周期」约定见 utils/trendBuckets.js
 *   - 平均每档：日 30 天 / 周 12 周 / 月 12 个月 / 季 8 个季度 / 年 5 年
 *   - 一次返回四张趋势图所需的全部序列（同一粒度只查一次，前端按粒度缓存）
 *
 * 口径与 /metrics 完全一致（同一批单源表达式），因此「某粒度各桶合计」应与
 * 「/metrics 取该粒度对应周期」的数字相等 —— 端到端核对即基于此。
 */
async function getTrends(req, res) {
  try {
    const granularity = req.query.granularity || 'month';
    if (!GRANULARITIES.includes(granularity)) {
      return error(res, `趋势粒度不合法：支持 ${GRANULARITIES.join('/')}`, 400);
    }
    const { list, start, end } = buildBuckets(granularity);

    const exprOrder = bucketExpr('o.created_at', granularity);
    const exprSale = bucketExpr('sale_date', granularity);
    const exprExpense = bucketExpr('expense_date', granularity);

    // ① 订单类：件数 / 营收 / 成本 / 工资
    //    工资口径必须与 services/salarySummary 完全一致，否则趋势与卡片对不上：
    //      a) 订单需配送(delivery_type 1/2) 且已指派员工
    //      b) 员工仍为在职(status=1) —— 工资统计页只统计在职员工（`WHERE w.status = 1`），
    //         离职员工名下的历史配送费不计入工资；若这里漏掉该条件，
    //         有离职员工时会「趋势工资 > 卡片工资」（实测库中即存在此场景）
    const feeExpr = deliveryFeeExpr();
    const [orderRows] = await pool.execute(
      `SELECT ${exprOrder} AS bucket,
              COALESCE(SUM(oi.quantity), 0) AS qty,
              ROUND(COALESCE(SUM(${itemRevenueExpr()}), 0), 2) AS revenue,
              ROUND(COALESCE(SUM(${costExpr()}), 0), 2) AS cost,
              ROUND(COALESCE(SUM(CASE WHEN o.delivery_type IN (1, 2) AND o.worker_id IS NOT NULL
                                      AND wk.status = 1
                                      THEN ${feeExpr} * oi.quantity ELSE 0 END), 0), 2) AS salary
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
       LEFT JOIN workers wk ON wk.worker_id = o.worker_id
       WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN}
         AND o.created_at >= ? AND o.created_at < ?
       GROUP BY bucket`,
      [start, end]
    );

    // ② 机台销量（营收按 sale_date，与 /metrics 一致）
    const [machineRows] = await pool.execute(
      `SELECT ${exprSale} AS bucket,
              COALESCE(SUM(quantity), 0) AS qty,
              ROUND(COALESCE(SUM(sale_price * quantity), 0), 2) AS revenue
       FROM machine_sales
       WHERE sale_date >= ? AND sale_date < ?
       GROUP BY bucket`,
      [start, end]
    );

    // ③ 其他支出
    const [expenseRows] = await pool.execute(
      `SELECT ${exprExpense} AS bucket,
              ROUND(COALESCE(SUM(amount), 0), 2) AS amount
       FROM other_expenses
       WHERE expense_date >= ? AND expense_date < ?
       GROUP BY bucket`,
      [start, end]
    );

    // ④ 按桶合并：SQL 查不到的桶补 0（x 轴刻度必须连续，不能出现断点）
    const map = new Map();
    list.forEach((b) => map.set(b.key, {
      key: b.key,
      label: b.label,
      salesQty: 0,
      machineQty: 0,
      revenue: 0,
      orderRevenue: 0,
      machineRevenue: 0,
      orderCost: 0,
      salary: 0,
      otherExpense: 0,
      cost: 0,
      profit: 0
    }));

    orderRows.forEach((x) => {
      const b = map.get(x.bucket);
      if (!b) return;
      b.salesQty += Number(x.qty) || 0;
      b.orderRevenue = round2(b.orderRevenue + (Number(x.revenue) || 0));
      b.orderCost = round2(b.orderCost + (Number(x.cost) || 0));
      b.salary = round2(b.salary + (Number(x.salary) || 0));
    });
    machineRows.forEach((x) => {
      const b = map.get(x.bucket);
      if (!b) return;
      b.salesQty += Number(x.qty) || 0;
      b.machineQty = Number(x.qty) || 0;
      b.machineRevenue = round2(Number(x.revenue) || 0);
    });
    expenseRows.forEach((x) => {
      const b = map.get(x.bucket);
      if (b) b.otherExpense = round2(Number(x.amount) || 0);
    });

    const buckets = list.map((b) => {
      const x = map.get(b.key);
      x.revenue = round2(x.orderRevenue + x.machineRevenue);
      // 成本 = 订单商品成本 + 工资 + 其他支出（与 /metrics 同口径）
      x.cost = round2(x.orderCost + x.salary + x.otherExpense);
      x.profit = round2(x.revenue - x.cost);
      return x;
    });

    return success(res, { granularity, start, end, buckets });
  } catch (err) {
    console.error('获取仪表盘趋势失败:', err);
    return error(res, '获取仪表盘趋势失败: ' + err.message);
  }
}

module.exports = {
  getSummary,
  getMetrics,
  getTrends
};

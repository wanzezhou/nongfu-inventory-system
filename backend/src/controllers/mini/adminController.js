// 小程序管理员端 · 只读仪表盘（文档 §28 / §43 Phase 8a）
// ===========================================================================
// Phase 8a 目标（§43）：「先让管理员在手机上『看得见』，不等 17 个业务域全做完」。
// 因此本文件**只有读**，且全部指标来自服务端聚合（§28 末句：不在小程序 JS 自己汇总）。
//
// ⚠️ 口径单源（§53：对账取数必须单源，禁止在各自 controller 里各写一份聚合 SQL）：
//     订单营收  → utils/revenueExpr.itemRevenueExpr
//     订单成本  → utils/costExpr.costExpr
//     订单类型集 → services/salarySummary.ORDER_TYPE_IN
//     工资      → services/salarySummary.loadSalarySummary（取**应发** totalDue 口径）
//     其他支出  → services/otherLedgerSummary.loadOtherExpenseTotal
//     其他收入  → services/otherLedgerSummary.loadOtherIncomeTotal
//     时间区间  → utils/dateRange.resolveRange + buildRangeWhere（**start 含、end 不含**）
//
//   总口径与 Web 仪表盘 / 利润页完全一致：
//     总营收 = 订单类(1/2/3/5) + 机台(4/6) + 其他收入
//     总成本 = 订单商品成本(全类型) + 工资 + 其他支出
//     总利润 = 总营收 − 总成本
//   ⚠️ 机台营收按 machine_sales.sale_date、机台成本按供货订单 created_at —— 二者时间口径
//      不同属**预期**（machine_sales 人工录入、不强制关联订单），与利润统计页保持一致。
//   ⚠️ 订单类营收排除已取消订单（`o.canceled_at IS NULL`），与 financialController 同一口径。
//
// ⚠️ 本期不含写操作：§5.3.1 明确 8b（写全覆盖）须逐域验收，且每个写操作域
//    必须挂 requireMiniAdmin + 审计日志。写操作请使用 Web 管理端。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error } = require('../../utils/response');
const { itemRevenueExpr } = require('../../utils/revenueExpr');
const { costExpr } = require('../../utils/costExpr');
const { resolveRange, buildRangeWhere } = require('../../utils/dateRange');
const { ORDER_TYPE_IN, loadSalarySummary } = require('../../services/salarySummary');
const { loadOtherExpenseTotal, loadOtherIncomeTotal } = require('../../services/otherLedgerSummary');
const { sumBalanceByOwnerType } = require('../../services/walletSummary');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 库存预警展示阈值（低库存带宽）
 * ⚠️ 这**不是业务规则**，只是一个展示用的分档阈值：系统内没有「安全库存」配置项，
 *    为避免凭空造一条业务规则，这里显式声明为「展示阈值」并随响应回传，
 *    前端会把它显示出来，不让人误以为它是配置。
 */
const LOW_STOCK_DISPLAY_THRESHOLD = 10;

/** 单个时间粒度内的营收 / 成本聚合 */
async function aggregateRange(rangeKey) {
  const r = resolveRange({ range: rangeKey });
  if (!r) throw new Error(`时间区间解析失败: ${rangeKey}`);

  const rw = buildRangeWhere('o.created_at', r);
  const [orderRows] = await pool.execute(
    `SELECT COUNT(DISTINCT o.order_id) AS order_count,
            ROUND(COALESCE(SUM(${itemRevenueExpr()}), 0), 2) AS order_revenue,
            ROUND(COALESCE(SUM(${costExpr()}), 0), 2) AS order_cost
       FROM orders o
       JOIN order_items oi ON o.order_id = oi.order_id
      WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN} AND ${rw.clause}`,
    rw.params
  );

  // 机台销量（类型 4/6 的营收来源；按 sale_date 统计）
  const mParts = [];
  const mParams = [];
  if (r.start) {
    mParts.push('sale_date >= ?');
    mParams.push(r.start);
  }
  if (r.end) {
    mParts.push('sale_date < ?');
    mParams.push(r.end);
  }
  const [machineRows] = await pool.execute(
    `SELECT ROUND(COALESCE(SUM(sale_price * quantity), 0), 2) AS machine_revenue
       FROM machine_sales ${mParts.length ? 'WHERE ' + mParts.join(' AND ') : ''}`,
    mParams
  );

  const { summary } = await loadSalarySummary(r);
  const otherExpense = await loadOtherExpenseTotal(r);
  const otherIncome = await loadOtherIncomeTotal(r);

  const orderRevenue = round2(orderRows[0].order_revenue);
  const orderCost = round2(orderRows[0].order_cost);
  const machineRevenue = round2(machineRows[0].machine_revenue);
  const salary = round2(summary.totalDue);

  const totalRevenue = round2(orderRevenue + machineRevenue + otherIncome);
  const totalCost = round2(orderCost + salary + otherExpense);

  return {
    range: { key: rangeKey, start: r.start, end: r.end, endExclusive: true },
    orderCount: Number(orderRows[0].order_count) || 0,
    revenue: {
      order: orderRevenue,
      machine: machineRevenue,
      otherIncome,
      total: totalRevenue
    },
    cost: {
      order: orderCost,
      salary,
      otherExpense,
      total: totalCost
    },
    profit: round2(totalRevenue - totalCost)
  };
}

/** 履约与待办（§28 的「待处理订单 / 待处理水票 / 待退款订单」） */
async function aggregatePipeline(conn) {
  // ⚠️ Web 订单尚未接入 fulfillment_status（§16 明确「orders 没有退款状态机，本节四字段是从零建立」），
  //    因此「待备货 / 在途」只统计**小程序订单**，避免把未接入该字段的 Web 订单一律算成待处理
  //    （那会让数字等于「全部未取消订单」，失去可操作性）。
  const [miniStages] = await conn.execute(
    `SELECT fulfillment_status, COUNT(*) AS cnt
       FROM orders
      WHERE order_source = 'MINI_PROGRAM' AND canceled_at IS NULL
      GROUP BY fulfillment_status`
  );
  const stage = {};
  for (const r of miniStages) stage[r.fulfillment_status || 'NULL'] = Number(r.cnt) || 0;

  // 未收款订单（全来源；Web 订单的 payment_status 是既有字段，可信）
  const [unpaid] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM orders WHERE canceled_at IS NULL AND payment_status = 0`
  );

  // 待退款订单（小程序侧 refund_status 独立字段，§16.1）
  const [refunding] = await conn.execute(`SELECT COUNT(*) AS cnt FROM orders WHERE refund_status = 'REFUNDING'`);
  const [refundedToday] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM orders WHERE refund_status = 'REFUNDED' AND DATE(updated_at) = CURDATE()`
  );

  return {
    pendingStock: (stage.PAID || 0) + (stage.PROCESSING || 0),
    delivering: stage.DELIVERING || 0,
    // ⚠️ 2026-09-20 自提下线：原 `readyForPickup` 计数已删除
    completed: stage.COMPLETED || 0,
    canceled: stage.CANCELED || 0,
    unpaidOrders: Number(unpaid[0].cnt) || 0,
    refunding: Number(refunding[0].cnt) || 0,
    refundedToday: Number(refundedToday[0].cnt) || 0
  };
}

/** 库存预警（§28） */
async function aggregateInventory(conn) {
  // 仅启用商品；库存记录可能缺失（inventory 与 products 一对一，但历史数据可能未建行）
  const [rows] = await conn.execute(
    `SELECT
        SUM(CASE WHEN COALESCE(i.quantity, 0) <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN COALESCE(i.quantity, 0) > 0 AND i.quantity <= ? THEN 1 ELSE 0 END) AS low_stock,
        COUNT(*) AS total
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.product_id
      WHERE p.status = 1`,
    [LOW_STOCK_DISPLAY_THRESHOLD]
  );

  // 缺货明细（最多 10 条，供手机端直接下单补货）
  const [detail] = await conn.execute(
    `SELECT p.product_id, p.product_code, p.product_name, p.specification, p.unit,
            COALESCE(i.quantity, 0) AS quantity
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.product_id
      WHERE p.status = 1 AND COALESCE(i.quantity, 0) <= ?
      ORDER BY COALESCE(i.quantity, 0) ASC, p.product_code ASC
      LIMIT 10`,
    [LOW_STOCK_DISPLAY_THRESHOLD]
  );

  return {
    outOfStock: Number(rows[0].out_of_stock) || 0,
    lowStock: Number(rows[0].low_stock) || 0,
    totalProducts: Number(rows[0].total) || 0,
    /** 展示阈值（非业务规则，见常量注释） */
    threshold: LOW_STOCK_DISPLAY_THRESHOLD,
    detail: detail.map(r => ({
      productId: r.product_id,
      productCode: r.product_code,
      productName: r.product_name,
      specification: r.specification,
      unit: r.unit,
      quantity: Number(r.quantity) || 0
    }))
  };
}

/** 水票（§28「待处理水票」） */
async function aggregateWaterTickets(conn) {
  const [rows] = await conn.execute(`SELECT status, COUNT(*) AS cnt FROM water_tickets GROUP BY status`);
  const byStatus = {};
  for (const r of rows) byStatus[Number(r.status)] = Number(r.cnt) || 0;
  const [issuance] = await conn.execute(
    `SELECT COUNT(*) AS cnt, COUNT(DISTINCT batch_id) AS batches FROM water_ticket_issuance`
  );
  return {
    /** 待使用 = 未核销水票张数（status=1 未用） */
    pendingUse: byStatus[1] || 0,
    used: byStatus[2] || 0,
    void: byStatus[3] || 0,
    issuanceCount: Number(issuance[0].cnt) || 0,
    batchCount: Number(issuance[0].batches) || 0,
    /** ⚠️ 本期不含「待处理发行单」概念：水票发行入账属 Phase 7，尚未接入钱包 */
    note: '水票发行积分入账属 Phase 7，本期未接入'
  };
}

/** GET /api/mini/admin/dashboard —— 管理员只读仪表盘 */
async function getDashboard(req, res) {
  const conn = await pool.getConnection();
  try {
    const [today, month, pipeline, inventory, tickets, wallet] = await Promise.all([
      aggregateRange('day'),
      aggregateRange('month'),
      aggregatePipeline(conn),
      aggregateInventory(conn),
      aggregateWaterTickets(conn),
      sumBalanceByOwnerType(conn)
    ]);

    return success(res, {
      generatedAt: new Date().toISOString(),
      today,
      month,
      pipeline,
      inventory,
      waterTickets: tickets,
      stationPoints: {
        salesmanTotal: wallet.SALESMAN || 0,
        stationTotal: wallet.STATION || 0,
        total: wallet.total || 0
      },
      /** 口径自述：让管理员知道每个数字是怎么来的（§53 显式声明区间约定） */
      methodology: {
        revenueFormula: '总营收 = 订单类(1/2/3/5) + 机台(4/6) + 其他收入；排除已取消订单',
        costFormula: '总成本 = 订单商品成本(全类型) + 工资(应发) + 其他支出',
        profitFormula: '总利润 = 总营收 − 总成本',
        rangeConvention: 'start 含、end 不含（与仪表盘/趋势图同一约定）',
        machineRevenueConvention: '机台营收按 machine_sales.sale_date 统计，与机台成本按订单日期不同属预期'
      },
      /** 写操作边界声明（§5.3.1 / §43 Phase 8b） */
      writeNotice:
        '小程序管理员端本期为只读（Phase 8a）。商品/库存/订单/水站/员工/水票等写操作请使用 Web 管理端；Phase 8b 将逐域开放并逐域验收。'
    });
  } catch (err) {
    console.error('[mini/admin] 仪表盘失败:', err);
    return error(res, '获取仪表盘数据失败');
  } finally {
    conn.release();
  }
}

module.exports = { getDashboard, LOW_STOCK_DISPLAY_THRESHOLD };

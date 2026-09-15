// 订单成本 + 机台成本表达式 —— 全系统成本口径唯一来源（财务管理 V2 · 需求 4，2026-09-15）
// ---------------------------------------------------------------------------
// 成本口径（业务方 2026-09-15 确认）：
//   所有成本均按「订单内商品」汇总（SUM over order_items），机台成本按机台供货订单(type 4/6)内商品汇总。
//
//   类型1 送水到府    成本 = (进货价 + 工人零售配送费) × 数量
//   类型5 水公社      成本 = 同送水到府
//   类型2 直营水站销售：
//       成本1（水票抵扣商品）= (进货价 + 水站分销配送费 + 工人水站配送费) × 抵扣件数
//       成本2（未抵扣商品）  = (进货价 + 工人水站配送费) × 未抵扣件数
//       → 合计 = 成本1 + 成本2
//   类型3 线下零售：
//       成本A（自有员工配送的商品）= (进货价 + 工人零售配送费) × 数量
//       成本B（无需配送的商品）    = 进货价 × 数量
//       → 判定「是否需要配送」：delivery_type = 1（自有员工配送）
//   类型4 量贩机供货  成本 = (进货价 + 工人零售机配送费) × 数量
//   类型6 零售机供货  成本 = 进货价 × 数量
//
// 说明：
//   - 抵扣件数口径与 costController.ticketQtyExpr 一致：
//       ticket_qty > 0 → ticket_qty；否则旧的整单抵扣 pricing_type=2 → quantity。
//   - 配送费缺失（NULL/0）按 0 计入，不报错。
// ---------------------------------------------------------------------------

/** 行抵扣件数（旧整单抵扣 ticket_qty=0 时按整行数量） */
function ticketQtyExpr() {
  return `IF(oi.ticket_qty > 0, oi.ticket_qty, IF(oi.pricing_type = 2, oi.quantity, 0))`;
}

/** 行未抵扣件数 */
function nonTicketQtyExpr() {
  return `(oi.quantity - ${ticketQtyExpr()})`;
}

/**
 * 成本1：水票抵扣商品成本 = (进货价 + 水站分销配送费 + 工人水站配送费) × 抵扣件数
 * 仅类型2 有意义
 */
function stationCost1Expr() {
  return `(oi.purchase_price + oi.distribution_delivery_fee + oi.worker_wholesale_delivery_fee) * ${ticketQtyExpr()}`;
}

/**
 * 成本2：未抵扣商品成本 = (进货价 + 工人水站配送费) × 未抵扣件数
 * 仅类型2 有意义
 */
function stationCost2Expr() {
  return `(oi.purchase_price + oi.worker_wholesale_delivery_fee) * ${nonTicketQtyExpr()}`;
}

/**
 * 成本A：自有员工配送商品 = (进货价 + 工人零售配送费) × 数量
 * 仅类型3 有意义（delivery_type = 1）
 */
function retailCostAExpr() {
  return `(oi.purchase_price + oi.worker_retail_delivery_fee) * oi.quantity`;
}

/** 成本B：无需配送商品 = 进货价 × 数量。仅类型3 有意义（delivery_type != 1） */
function retailCostBExpr() {
  return `oi.purchase_price * oi.quantity`;
}

/**
 * 单订单成本表达式 —— 按订单类型返回该订单应计入的成本（SQL 片段，行级）
 * 调用方需保证 oi 已 JOIN、o 为 orders 别名。
 * @param {number} orderType 1/2/3/4/5/6
 * @returns {string} SQL 行级表达式
 */
function itemCostExpr(orderType) {
  const t = Number(orderType);
  switch (t) {
    case 1: // 送水到府
    case 5: // 水公社
      return `(oi.purchase_price + oi.worker_retail_delivery_fee) * oi.quantity`;
    case 2: // 直营水站销售 = 成本1 + 成本2
      return `(${stationCost1Expr()} + ${stationCost2Expr()})`;
    case 3: // 线下零售 = 成本A（需配送）+ 成本B（无需配送），按订单 delivery_type 二选一
      return `IF(o.delivery_type = 1, ${retailCostAExpr()}, ${retailCostBExpr()})`;
    case 4: // 量贩机供货
      return `(oi.purchase_price + oi.worker_machine_delivery_fee) * oi.quantity`;
    case 6: // 零售机供货
      return `oi.purchase_price * oi.quantity`;
    default:
      return '0';
  }
}

/**
 * 通用成本表达式（按 o.order_type 自动分派）—— 用于「成本汇总」等跨类型场景
 */
function costExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN (oi.purchase_price + oi.worker_retail_delivery_fee) * oi.quantity
      WHEN 2 THEN (${stationCost1Expr()} + ${stationCost2Expr()})
      WHEN 3 THEN IF(o.delivery_type = 1,
                     ${retailCostAExpr()},
                     ${retailCostBExpr()})
      WHEN 4 THEN (oi.purchase_price + oi.worker_machine_delivery_fee) * oi.quantity
      WHEN 5 THEN (oi.purchase_price + oi.worker_retail_delivery_fee) * oi.quantity
      WHEN 6 THEN oi.purchase_price * oi.quantity
      ELSE 0 END)`;
}

/** 各类型成本构成的展示名（前端卡片/表头共用，避免多处硬编码） */
const COST_LABELS = {
  1: { main: '成本', desc: '进货价 + 工人零售配送费' },
  2: { main: '成本（成本1 + 成本2）', desc: '成本1=水票抵扣商品(进货价+水站分销配送费+工人水站配送费)；成本2=未抵扣商品(进货价+工人水站配送费)' },
  3: { main: '成本（成本A + 成本B）', desc: '成本A=自有员工配送商品(进货价+工人零售配送费)；成本B=无需配送商品(进货价)' },
  4: { main: '成本', desc: '进货价 + 工人零售机配送费' },
  5: { main: '成本', desc: '进货价 + 工人零售配送费' },
  6: { main: '成本', desc: '进货价' }
};

/** 需要按成本1/成本2 分列的订单类型 */
const SPLIT_COST_TYPES = [2];
/** 需要按成本A/成本B 分列的订单类型 */
const SPLIT_COST_TYPES_RETAIL = [3];

module.exports = {
  ticketQtyExpr,
  nonTicketQtyExpr,
  stationCost1Expr,
  stationCost2Expr,
  retailCostAExpr,
  retailCostBExpr,
  itemCostExpr,
  costExpr,
  COST_LABELS,
  SPLIT_COST_TYPES,
  SPLIT_COST_TYPES_RETAIL
};

/**
 * 订单类型常量（单一事实来源）
 * 5-线下水站返货 已停用删除（2026-08-25）；
 * 5-水公社 于 2026-09-14 启用（复用已释放的编号）。
 * 合法类型为 1/2/3/4/5/6
 */
const ORDER_TYPES = {
  1: '送水到府',
  2: '直营水站销售',
  3: '线下零售',
  4: '量贩机供货',
  5: '水公社',
  6: '零售机供货'
};

const VALID_ORDER_TYPES = [1, 2, 3, 4, 5, 6];

/**
 * 计价口径分类（orderPricingService / revenueExpr 共用，避免各处硬编码类型号）：
 *  - PURCHASE_PRICE  ：按进货价（送水到府）
 *  - MANUAL_FALLBACK：单价可手填，不填回退档案价（直营水站=分销价 / 线下零售·水公社=零售价）
 *  - NO_ITEM_PRICE  ：不计商品价格（机台供货）
 */
const PRICING_MODE = {
  1: 'PURCHASE_PRICE',
  2: 'MANUAL_FALLBACK',
  3: 'MANUAL_FALLBACK',
  4: 'NO_ITEM_PRICE',
  5: 'MANUAL_FALLBACK',
  6: 'NO_ITEM_PRICE'
};

/** 允许行级水票抵扣的订单类型（仅直营水站销售） */
const TICKET_DEDUCT_TYPES = [2];

/** 需要客户姓名/电话/地址、且固定自有员工配送的类型（送水到府 / 水公社） */
const HOME_DELIVERY_TYPES = [1, 5];

/** 不显示订单金额的类型（机台供货） */
const NO_AMOUNT_TYPES = [4, 6];

module.exports = {
  ORDER_TYPES,
  VALID_ORDER_TYPES,
  PRICING_MODE,
  TICKET_DEDUCT_TYPES,
  HOME_DELIVERY_TYPES,
  NO_AMOUNT_TYPES
};

// 订单类营收表达式 —— 全系统营收口径唯一来源（A6 治理，2026-08-28）
// financialController（营收汇总/明细/导出）与 orderController（订单详情）
// 共用本表达式，前端不再有任何营收计算实现（只展示后端返回值）。
//
// 口径说明（2026-08-27 确认，2026-09-14 增补类型5）：
//   总包配送费按商品算：商品档案 total_delivery_fee × 数量（订单 delivery_fee 已停用为 0，不作为营收配送费来源）
//   类型1 送水到府（原「官方平台销售」）：营收 = Σ((进货价 + 总包配送费) × 数量)
//   类型2 直营水站销售：分销价件数按分销价；水票抵扣件数按 (进货价 + 总包配送费)；
//       行内混合 ticket_qty>0 -> (进货价+配送费)×抵扣件数 + 分销价×剩余件数
//       旧整单抵扣数据（ticket_qty=0 且 pricing_type=2）-> 全量按 (进货价 + 总包配送费)
//   类型3 线下零售：营收 = Σ(零售价 × 数量)
//   类型4/6 机台：商品明细不计营收（营收 = 机台销量 machine_sales 的 机台售价×销量，由财务模块单独统计）
//   类型5 水公社（2026-09-14 新增）：与线下零售同口径，营收 = Σ(零售价 × 数量)
//       （原类型5「线下水站返货」已删除于 2026-08-25，编号已释放复用）
function itemRevenueExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN (oi.purchase_price + oi.total_delivery_fee) * oi.quantity
      WHEN 2 THEN IF(oi.ticket_qty > 0,
                     (oi.purchase_price + oi.total_delivery_fee) * oi.ticket_qty + oi.wholesale_price * (oi.quantity - oi.ticket_qty),
                     IF(oi.pricing_type = 2, (oi.purchase_price + oi.total_delivery_fee), oi.wholesale_price) * oi.quantity)
      WHEN 3 THEN oi.retail_price * oi.quantity
      WHEN 5 THEN oi.retail_price * oi.quantity -- 水公社：与线下零售同口径（2026-09-14）
      WHEN 4 THEN 0 -- 量贩机供货：不计算商品价格，营收按机台销量统计（2026-08-27）
      WHEN 6 THEN 0 -- 零售机供货：不计算商品价格，营收按机台销量统计（2026-08-27）
      ELSE 0 END)`;
}

module.exports = { itemRevenueExpr };

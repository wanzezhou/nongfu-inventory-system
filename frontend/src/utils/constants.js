/**
 * 前端全局常量（与后端 src/constants/order.js 保持一致）
 * 5-线下水站返货 已停用删除（2026-08-25），合法类型为 1/2/3/4/6
 */
export const ORDER_TYPE_TEXT = {
  1: '官方平台销售',
  2: '直营水站销售',
  3: '线下零售',
  4: '量贩机供货',
  6: '零售机供货'
}

export const VALID_ORDER_TYPES = [1, 2, 3, 4, 6]

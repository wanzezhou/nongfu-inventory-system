import request from './request'

// 直营水站成本统计：按水站汇总水票抵扣成本（月份 YYYY-MM）
export function getStationCostSummary(params) {
  return request({
    url: '/cost/station-summary',
    method: 'get',
    params
  })
}

// 指定水站当月抵扣订单明细
export function getStationCostOrders(params) {
  return request({
    url: '/cost/station-orders',
    method: 'get',
    params
  })
}

// 订单内水票抵扣商品行成本
export function getCostOrderItems(params) {
  return request({
    url: '/cost/order-items',
    method: 'get',
    params
  })
}

// ---- 需求 4（2026-09-15）：按订单类型的成本统计 ----

// 成本总览（全部类型横向对比）
export function getCostOverview(params) {
  return request({ url: '/cost/overview', method: 'get', params })
}

// 单类型成本统计（orderType=1..6）
export function getCostByType(params) {
  return request({ url: '/cost/by-type', method: 'get', params })
}

// 机台成本（machineType 1=量贩机 / 2=零售机）
export function getMachineCost(params) {
  return request({ url: '/cost/machine', method: 'get', params })
}

// 成本明细行（按 orderId 或 orderType+range）
export function getCostOrderLines(params) {
  return request({ url: '/cost/order-lines', method: 'get', params })
}

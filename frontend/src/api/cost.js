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

import request from './request'

// 工资统计：按员工汇总配送费（月份 YYYY-MM）
export function getSalarySummary(params) {
  return request({
    url: '/salary/summary',
    method: 'get',
    params
  })
}

// 指定员工当月配送订单明细
export function getSalaryOrders(params) {
  return request({
    url: '/salary/orders',
    method: 'get',
    params
  })
}

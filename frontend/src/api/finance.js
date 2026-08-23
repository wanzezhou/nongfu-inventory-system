import request from './request'

// 财务汇总（按订单类型统计各类指标）
export function getFinanceSummary(params) {
  return request({
    url: '/finance/summary',
    method: 'get',
    params
  })
}

// 财务逐单明细（分页）
export function getFinanceOrders(params) {
  return request({
    url: '/finance/orders',
    method: 'get',
    params
  })
}

// 导出财务逐单明细
export function exportFinanceOrders(params) {
  return request({
    url: '/finance/orders/export',
    method: 'get',
    params,
    responseType: 'blob'
  })
}

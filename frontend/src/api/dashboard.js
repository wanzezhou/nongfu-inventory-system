import request from './request'

// 与时间无关的统计（当前仅「库存总金额」）
export function getDashboardSummary() {
  return request({
    url: '/dashboard/summary',
    method: 'get'
  })
}

// 周期指标：range = month | quarter | year（仪表盘卡片各自选择周期）
// 返回总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润
export function getDashboardMetrics(range = 'month') {
  return request({
    url: '/dashboard/metrics',
    method: 'get',
    params: { range }
  })
}

// 月销售趋势（本年度 1~12 月，按商品件数）
export function getDashboardTrend() {
  return request({
    url: '/dashboard/trend',
    method: 'get'
  })
}

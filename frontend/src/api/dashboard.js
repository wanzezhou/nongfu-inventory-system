import request from './request'

// 与时间无关的统计（当前仅「库存总金额」）
export function getDashboardSummary() {
  return request({
    url: '/dashboard/summary',
    method: 'get'
  })
}

// 周期指标：range = month | quarter | year（仪表盘卡片各自选择周期）
// 返回总销量 / 总订单数 / 总营收 / 总成本（含工资与其他支出）/ 工资统计 / 总利润
export function getDashboardMetrics(range = 'month') {
  return request({
    url: '/dashboard/metrics',
    method: 'get',
    params: { range }
  })
}

// 趋势：granularity = day | week | month | quarter | year
// 一次返回四张趋势图（销售件数 / 营收 / 成本 / 利润）所需的全部序列
export function getDashboardTrends(granularity = 'month') {
  return request({
    url: '/dashboard/trends',
    method: 'get',
    params: { granularity }
  })
}

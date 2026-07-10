import request from './request'

export function getDashboardSummary() {
  return request({
    url: '/dashboard/summary',
    method: 'get'
  })
}

export function getDashboardTrend() {
  return request({
    url: '/dashboard/trend',
    method: 'get'
  })
}

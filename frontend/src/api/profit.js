import request from './request'

// 利润总览（全部类型横向对比）
export function getProfitOverview(params) {
  return request({ url: '/profit/overview', method: 'get', params })
}

// 单类型利润（orderType=1..6；2=直营水站拆利润1/利润2；4/6=机台）
export function getProfitByType(params) {
  return request({ url: '/profit/by-type', method: 'get', params })
}

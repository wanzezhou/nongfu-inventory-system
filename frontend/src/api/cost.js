import request from './request'

// ---- 需求 4（2026-09-15）：按订单类型的成本统计 ----
// 注：原 station-summary / station-orders / order-items 三接口（直营水站成本明细页）
//     已于 2026-09-15 随「水站成本明细」入口一并删除，口径并入 /cost/overview + /cost/by-type。

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

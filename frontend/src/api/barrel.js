import request from './request'

// 桶型配置
export function getBarrelConfigs() {
  return request({ url: '/barrel/configs', method: 'get' })
}
export function createBarrelConfig(data) {
  return request({ url: '/barrel/configs', method: 'post', data })
}
export function updateBarrelConfig(id, data) {
  return request({ url: `/barrel/configs/${id}`, method: 'put', data })
}
export function deleteBarrelConfig(id) {
  return request({ url: `/barrel/configs/${id}`, method: 'delete' })
}

// 押金登记（collect 收取 / return 退回）
export function createDeposit(data) {
  return request({ url: '/barrel/deposits', method: 'post', data })
}

// 押金流水列表
export function getDeposits(params) {
  return request({ url: '/barrel/deposits', method: 'get', params })
}

// 押金台账汇总
export function getBarrelSummary(params) {
  return request({ url: '/barrel/deposits/summary', method: 'get', params })
}

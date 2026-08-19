import request from './request'

export function getMiniAccountList(params) {
  return request({ url: '/mini-accounts', method: 'get', params })
}
export function getEntityOptions(role) {
  return request({ url: '/mini-accounts/entities', method: 'get', params: { role } })
}
export function addMiniAccount(data) {
  return request({ url: '/mini-accounts', method: 'post', data })
}
export function updateMiniAccount(id, data) {
  return request({ url: `/mini-accounts/${id}`, method: 'put', data })
}
export function deleteMiniAccount(id) {
  return request({ url: `/mini-accounts/${id}`, method: 'delete' })
}
export function toggleMiniAccount(id) {
  return request({ url: `/mini-accounts/${id}/toggle`, method: 'put' })
}

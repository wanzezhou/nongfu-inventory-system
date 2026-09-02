import request from './request'

// 公司账户管理
export function getAccounts() {
  return request({ url: '/finance-accounts', method: 'get' })
}
export function createAccount(data) {
  return request({ url: '/finance-accounts', method: 'post', data })
}
export function updateAccount(id, data) {
  return request({ url: `/finance-accounts/${id}`, method: 'put', data })
}
export function deleteAccount(id) {
  return request({ url: `/finance-accounts/${id}`, method: 'delete' })
}
// 人工调账 income / expense
export function adjustAccount(id, data) {
  return request({ url: `/finance-accounts/${id}/adjust`, method: 'post', data })
}
// 账户间转账
export function transferBetween(data) {
  return request({ url: '/finance-accounts/transfer', method: 'post', data })
}
// 账户流水
export function getAccountTransactions(id, params) {
  return request({ url: `/finance-accounts/${id}/transactions`, method: 'get', params })
}

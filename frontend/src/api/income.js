import request from './request'

// 其他收入
export function getIncomes(params) {
  return request({ url: '/incomes', method: 'get', params })
}
export function getIncomeCategories() {
  return request({ url: '/incomes/categories', method: 'get' })
}
export function createIncome(data) {
  return request({ url: '/incomes', method: 'post', data })
}
export function updateIncome(id, data) {
  return request({ url: `/incomes/${id}`, method: 'put', data })
}
export function deleteIncome(id) {
  return request({ url: `/incomes/${id}`, method: 'delete' })
}
export function downloadIncomeTemplate() {
  return request({ url: '/incomes/template', method: 'get', responseType: 'blob' })
}
export function exportIncomes(params) {
  return request({ url: '/incomes/export', method: 'get', params, responseType: 'blob' })
}
export function importIncomes(formData) {
  return request({ url: '/incomes/import', method: 'post', data: formData })
}

// 账户（与其他支出页共用同一封装，故从 expense.js 复用同一端点）
export function getFinanceAccounts() {
  return request({ url: '/finance-accounts', method: 'get' })
}

import request from './request'

// 其他支出
export function getExpenses(params) {
  return request({ url: '/expenses', method: 'get', params })
}
export function getExpenseCategories() {
  return request({ url: '/expenses/categories', method: 'get' })
}
export function createExpense(data) {
  return request({ url: '/expenses', method: 'post', data })
}
export function updateExpense(id, data) {
  return request({ url: `/expenses/${id}`, method: 'put', data })
}
export function deleteExpense(id) {
  return request({ url: `/expenses/${id}`, method: 'delete' })
}
export function downloadExpenseTemplate() {
  return request({ url: '/expenses/template', method: 'get', responseType: 'blob' })
}
export function exportExpenses(params) {
  return request({ url: '/expenses/export', method: 'get', params, responseType: 'blob' })
}
export function importExpenses(formData) {
  return request({ url: '/expenses/import', method: 'post', data: formData })
}

// 账户
export function getFinanceAccounts() {
  return request({ url: '/finance-accounts', method: 'get' })
}

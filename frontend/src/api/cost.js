import request from './request'

// ---- 营业成本 ----
export const getCostSummary = (params) => request.get('/cost/summary', { params })
export const getCostOrders = (params) => request.get('/cost/orders', { params })
export const exportCost = (params) => request.get('/cost/export', { params, responseType: 'blob' })

// ---- 固定支出 ----
export const getFixedSummary = (params) => request.get('/cost/fixed-summary', { params })
export const getReturnDeliveryFeeSummary = (params) => request.get('/cost/return-delivery-summary', { params })
export const getFixedExpenses = (params) => request.get('/cost/fixed-expenses', { params })
export const getExpenseTypes = () => request.get('/cost/expense-types')
export const createFixedExpense = (data) => request.post('/cost/fixed-expenses', data)
export const updateFixedExpense = (id, data) => request.put(`/cost/fixed-expenses/${id}`, data)
export const deleteFixedExpense = (id) => request.delete(`/cost/fixed-expenses/${id}`)
export const exportFixed = (params) => request.get('/cost/fixed-export', { params, responseType: 'blob' })

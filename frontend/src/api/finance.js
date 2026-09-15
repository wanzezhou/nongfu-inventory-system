import request from './request'

// 营收汇总（订单类型 1/2/3/5 + 机台 4/6）
export const getFinanceSummary = (params) => request.get('/finance/summary', { params })

// 订单营收明细（分页）
export const getFinanceOrders = (params) => request.get('/finance/orders', { params })

// 机台销量明细（分页）
export const getMachineSales = (params) => request.get('/finance/machine-sales', { params })

// 录入机台销量
export const createMachineSale = (data) => request.post('/finance/machine-sales', data)

// 删除机台销量
export const deleteMachineSale = (id) => request.delete(`/finance/machine-sales/${id}`)

// 机台销量一键导入（Excel）
export const importMachineSales = (formData) =>
  request.post('/finance/machine-sales/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })

// 下载机台销量导入模板
export const downloadMachineSaleTemplate = () =>
  request.get('/finance/machine-sales/template', { responseType: 'blob' })

// 一键导出
export const exportFinance = (params) => request.get('/finance/export', { params, responseType: 'blob' })

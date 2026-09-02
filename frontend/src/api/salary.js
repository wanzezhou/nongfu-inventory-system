import request from './request'

// 工资统计：按员工汇总配送费（月份 YYYY-MM）
export function getSalarySummary(params) {
  return request({
    url: '/salary/summary',
    method: 'get',
    params
  })
}

// 指定员工当月配送订单明细
export function getSalaryOrders(params) {
  return request({
    url: '/salary/orders',
    method: 'get',
    params
  })
}

// 指定订单的商品配送明细
export function getSalaryOrderItems(params) {
  return request({
    url: '/salary/order-items',
    method: 'get',
    params
  })
}

// 单员工当月配送费与发放状态
export function getWorkerSalarySummary(params) {
  return request({
    url: '/salary/worker-summary',
    method: 'get',
    params
  })
}

// 确认发放（记录发放 + 公司账户支出）
export function payWorkerSalary(data) {
  return request({
    url: '/salary/pay',
    method: 'post',
    data
  })
}

// 撤销发放（回补账户余额）
export function revokeSalaryPayment(id) {
  return request({
    url: `/salary/payments/${id}`,
    method: 'delete'
  })
}

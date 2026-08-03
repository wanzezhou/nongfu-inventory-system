import request from './request'

export function getOrders(params) {
  return request({
    url: '/orders',
    method: 'get',
    params
  })
}

export function getOrderDetail(id) {
  return request({
    url: `/orders/${id}`,
    method: 'get'
  })
}

export function createOrder(data) {
  return request({
    url: '/orders',
    method: 'post',
    data
  })
}

export function updateOrder(id, data) {
  return request({
    url: `/orders/${id}`,
    method: 'put',
    data
  })
}

export function updateOrderStatus(id, order_status) {
  return request({
    url: `/orders/${id}/status`,
    method: 'put',
    data: { order_status }
  })
}

export function cancelOrder(id) {
  return request({
    url: `/orders/${id}`,
    method: 'delete'
  })
}

export function hardDeleteOrder(id) {
  return request({
    url: `/orders/${id}/force`,
    method: 'delete'
  })
}

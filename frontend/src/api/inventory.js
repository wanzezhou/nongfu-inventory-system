import request from './request'

export function getInventoryList(params) {
  return request({
    url: '/inventory',
    method: 'get',
    params
  })
}

export function getInventoryDetail(productId) {
  return request({
    url: `/inventory/${productId}`,
    method: 'get'
  })
}

export function stockIn(data) {
  return request({
    url: '/inventory/in',
    method: 'post',
    data
  })
}

export function stockOut(data) {
  return request({
    url: '/inventory/out',
    method: 'post',
    data
  })
}

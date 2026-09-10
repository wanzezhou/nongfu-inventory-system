import request from './request'

export function getProductList(params) {
  return request({
    url: '/products',
    method: 'get',
    params
  })
}

export function addProduct(data) {
  return request({
    url: '/products',
    method: 'post',
    data
  })
}

export function updateProduct(id, data) {
  return request({
    url: `/products/${id}`,
    method: 'put',
    data
  })
}

export function deleteProduct(id) {
  return request({
    url: `/products/${id}`,
    method: 'delete'
  })
}

export function getCategoryList() {
  return request({
    url: '/products/categories',
    method: 'get'
  })
}

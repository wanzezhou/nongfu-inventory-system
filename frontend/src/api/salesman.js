import request from './request'

export function getSalesmanList(params) {
  return request({ url: '/salesmen', method: 'get', params })
}
export function getAllSalesmen() {
  return request({ url: '/salesmen/all', method: 'get' })
}
export function getSalesman(id) {
  return request({ url: `/salesmen/${id}`, method: 'get' })
}
export function addSalesman(data) {
  return request({ url: '/salesmen', method: 'post', data })
}
export function updateSalesman(id, data) {
  return request({ url: `/salesmen/${id}`, method: 'put', data })
}
export function deleteSalesman(id) {
  return request({ url: `/salesmen/${id}`, method: 'delete' })
}

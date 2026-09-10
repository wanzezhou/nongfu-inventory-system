import request from './request'

export function getWorkerList(params) {
  return request({
    url: '/workers',
    method: 'get',
    params
  })
}

export function getAllWorkers() {
  return request({
    url: '/workers/all',
    method: 'get'
  })
}

export function addWorker(data) {
  return request({
    url: '/workers',
    method: 'post',
    data
  })
}

export function updateWorker(id, data) {
  return request({
    url: `/workers/${id}`,
    method: 'put',
    data
  })
}

export function deleteWorker(id) {
  return request({
    url: `/workers/${id}`,
    method: 'delete'
  })
}

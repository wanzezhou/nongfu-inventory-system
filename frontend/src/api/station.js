import request from './request'

export function getStations(params) {
  return request({
    url: '/stations',
    method: 'get',
    params
  })
}

export function createStation(data) {
  return request({
    url: '/stations',
    method: 'post',
    data
  })
}

export function updateStation(id, data) {
  return request({
    url: `/stations/${id}`,
    method: 'put',
    data
  })
}

export function deleteStation(id) {
  return request({
    url: `/stations/${id}`,
    method: 'delete'
  })
}

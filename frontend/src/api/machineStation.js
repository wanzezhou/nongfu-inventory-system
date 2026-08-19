import request from './request'

// 机台管理（量贩机/零售机通用，通过 type 区分）
export function getMachineStations(params) {
  return request({
    url: '/machine-stations',
    method: 'get',
    params
  })
}

export function getMachineStation(id) {
  return request({
    url: `/machine-stations/${id}`,
    method: 'get'
  })
}

export function createMachineStation(data) {
  return request({
    url: '/machine-stations',
    method: 'post',
    data
  })
}

export function updateMachineStation(id, data) {
  return request({
    url: `/machine-stations/${id}`,
    method: 'put',
    data
  })
}

export function deleteMachineStation(id) {
  return request({
    url: `/machine-stations/${id}`,
    method: 'delete'
  })
}

import request from './request'

/**
 * 机台下拉选项（不分页全量）
 * ⚠️ 下拉/选项类数据一律用本接口，不要再调 getMachineStations({ pageSize: N })
 * （分页上限导致选项静默缺失，2026-09-18 代码审查 #1）。
 */
export function getAllMachineStations(params) {
  return request({
    url: '/machine-stations/all',
    method: 'get',
    params
  })
}

// 机台管理（量贩机/零售机通用，通过 type 区分）
export function getMachineStations(params) {
  return request({
    url: '/machine-stations',
    method: 'get',
    params
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

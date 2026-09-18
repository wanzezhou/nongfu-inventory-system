import request from './request'

/**
 * 水站下拉选项（不分页全量）
 * ⚠️ 下拉/选项类数据一律用本接口，不要再调 getStations({ pageSize: N })
 * （分页上限导致选项静默缺失，2026-09-18 代码审查 #1）。返回字段为蛇形，与列表接口一致。
 */
export function getAllStations(params) {
  return request({
    url: '/stations/all',
    method: 'get',
    params
  })
}

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

import request from './request'

/**
 * 库存下拉选项（不分页全量）
 * ⚠️ 下拉/选项类数据一律用本接口，不要再调 getInventoryList({ pageSize: N })
 * （分页上限导致选项静默缺失，2026-09-18 代码审查 #1）。
 */
export function getInventoryOptions(params) {
  return request({
    url: '/inventory/options',
    method: 'get',
    params
  })
}

export function getInventoryList(params) {
  return request({
    url: '/inventory',
    method: 'get',
    params
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

// 入库记录列表
export function getPurchaseRecords(params) {
  return request({
    url: '/inventory/purchases',
    method: 'get',
    params
  })
}

// 作废入库单（回退库存 + 原路退回）
export function voidPurchaseRecord(purchaseId, data) {
  return request({
    url: `/inventory/purchases/${purchaseId}/void`,
    method: 'post',
    data
  })
}

// 出库台账列表
export function getStockOutRecords(params) {
  return request({
    url: '/inventory/stock-out-records',
    method: 'get',
    params
  })
}

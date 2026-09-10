import request from './request'

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

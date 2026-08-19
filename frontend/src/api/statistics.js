import request from './request'

// 商品销售统计
export function getProductSales(params) {
  return request({
    url: '/statistics/product-sales',
    method: 'get',
    params
  })
}

// 一键导出商品销售统计
export function exportProductSales(params) {
  return request({
    url: '/statistics/product-sales/export',
    method: 'get',
    params,
    responseType: 'blob'
  })
}

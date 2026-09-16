import request from './request'

// 销售单打印店长（全系统唯一一位，打印预览「店长联系电话」用）
export function getPrintManager() {
  return request({
    url: '/system-settings/print-manager',
    method: 'get'
  })
}

// 设置打印店长；workerId 传 null / '' 表示清空（回退为第一位启用的店长）
export function updatePrintManager(workerId) {
  return request({
    url: '/system-settings/print-manager',
    method: 'put',
    data: { workerId }
  })
}

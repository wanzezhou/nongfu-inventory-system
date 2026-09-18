import request from './request'

// ⚠️ 超时策略（2026-09-18 代码审查 #3）
// request.js 的全局超时是 10 秒，而 Excel 导入在后端是**事务内逐行写入**：
// multer 上限 5MB，一个 5MB 的 xlsx 可达数千行，逐行 execute 远超 10 秒。
// 后果是「前端报超时，但服务端可能仍在执行 / 已提交 / 已回滚」三态不可区分，
// 用户重试还可能造成重复导入。故导出/导入单独放宽超时。
const EXPORT_TIMEOUT = 60000 // 导出：服务端聚合 + 生成 xlsx
const IMPORT_TIMEOUT = 120000 // 导入：事务内逐行写库
const TEMPLATE_TIMEOUT = 30000 // 模板：静态文件，给足网络余量

// 导出数据
export function exportData(module) {
  return request({
    url: `/excel/${module}/export`,
    method: 'get',
    responseType: 'blob',
    timeout: EXPORT_TIMEOUT
  })
}

// 下载导入模板
export function downloadTemplate(module) {
  return request({
    url: `/excel/${module}/template`,
    method: 'get',
    responseType: 'blob',
    timeout: TEMPLATE_TIMEOUT
  })
}

// 导入数据
export function importData(module, file) {
  const formData = new FormData()
  formData.append('file', file)
  return request({
    url: `/excel/${module}/import`,
    method: 'post',
    data: formData,
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    timeout: IMPORT_TIMEOUT
  })
}

// 通用下载blob文件
export function downloadBlob(data, filename) {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

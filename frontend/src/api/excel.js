import request from './request'

// 导出数据
export function exportData(module) {
  return request({
    url: `/excel/${module}/export`,
    method: 'get',
    responseType: 'blob'
  })
}

// 下载导入模板
export function downloadTemplate(module) {
  return request({
    url: `/excel/${module}/template`,
    method: 'get',
    responseType: 'blob'
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
    }
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

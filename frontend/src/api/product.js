import request from './request'

/**
 * 商品下拉选项（不分页全量）
 * ⚠️ 下拉/选项类数据一律用本接口，**不要**再调 getProductList({ pageSize: N }) ——
 * 分页接口有上限，实体数一超上限选项就静默缺失（2026-09-18 代码审查 #1）。
 */
export function getProductOptions(params) {
  return request({
    url: '/products/options',
    method: 'get',
    params
  })
}

export function getProductList(params) {
  return request({
    url: '/products',
    method: 'get',
    params
  })
}

export function addProduct(data) {
  return request({
    url: '/products',
    method: 'post',
    data
  })
}

export function updateProduct(id, data) {
  return request({
    url: `/products/${id}`,
    method: 'put',
    data
  })
}

export function deleteProduct(id) {
  return request({
    url: `/products/${id}`,
    method: 'delete'
  })
}

export function getCategoryList() {
  return request({
    url: '/products/categories',
    method: 'get'
  })
}

/**
 * 上传商品图片（multipart/form-data）
 * 返回 { path: '/product_images/xxx.png', url: 'http://.../product_images/xxx.png', ... }
 * 商品保存时提交返回的 path（相对路径），不要提交 base64
 */
export function uploadProductImage(file) {
  const formData = new FormData()
  formData.append('file', file)
  return request({
    url: '/products/upload-image',
    method: 'post',
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000 // 图片上传放宽超时（默认 10s 对大图偏紧）
  })
}

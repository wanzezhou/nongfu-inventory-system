import { ElMessage } from 'element-plus'

/**
 * 后端错误提示的统一取法（前端「两层提示」约定的唯一实现）
 * ---------------------------------------------------------------------------
 * request.js 拦截器的行为：
 *   · HTTP 4xx/5xx + {code,message} → 只打日志、**不弹**，需要页面自己提示（该错误对象带 `response`）
 *   · 信封错误（HTTP 200 且 code!==200）→ **拦截器已弹过**，并 reject 一个**没有 `response` 字段**的
 *     Error，因此页面用本函数时不会重复弹
 *
 * 用法：页面 catch 里调用 `toastIfHttpError(error, '删除失败，请稍后重试')`。
 * ⚠️ 不要再用 `ElMessage.error(error.message)` —— 信封错误会被弹两次；更要杜绝 catch 里报成功。
 */
export const bizMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback

export const toastIfHttpError = (error, fallback = '操作失败，请稍后重试') => {
  if (error?.response) ElMessage.error(bizMessage(error, fallback))
}

import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 10000
})

request.interceptors.request.use(
  config => {
    // 运行时惰性取 store（此时 Pinia 已安装）
    const auth = useAuthStore()
    if (auth.token) {
      config.headers['Authorization'] = `Bearer ${auth.token}`
    }
    return config
  },
  error => {
    console.error('请求错误:', error)
    return Promise.reject(error)
  }
)

request.interceptors.response.use(
  response => {
    // blob 响应（文件下载）直接返回
    if (response.config.responseType === 'blob') {
      return response
    }
    const res = response.data
    if (res.code !== undefined && res.code !== 200) {
      if (res.code === 401) {
        useAuthStore().clear()
        router.push('/login')
      }
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    return res
  },
  error => {
    // blob 响应的错误处理（如导出失败时服务器返回 JSON 错误信息）
    if (error.response && error.response.data instanceof Blob) {
      error.response.data.text().then(text => {
        try {
          const errData = JSON.parse(text)
          ElMessage.error(errData.message || '导出失败')
        } catch {
          ElMessage.error('请求失败')
        }
      })
    } else if (error.response && error.response.data && error.response.data.message) {
      // 后端已返回结构化业务错误（HTTP 4xx/5xx + {code, message}）：
      // 文案交由调用方 catch 展示（各页面统一读 e.response.data.message），
      // 此处只打日志，避免与页面提示重复弹出、也不再暴露 axios 的英文原文。
      console.error('业务错误:', error.response.data.message)
    } else {
      console.error('响应错误:', error)
      ElMessage.error(error.message || '网络错误')
    }
    return Promise.reject(error)
  }
)

export default request

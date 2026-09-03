import { defineStore } from 'pinia'

const TOKEN_KEY = 'token'
const USER_KEY = 'userInfo'

/**
 * 登录态管理（A5：Pinia 落地）
 * localStorage 仍作为持久化层（刷新恢复），但读写统一收敛到本 store，
 * 业务代码禁止再直接操作 token/userInfo 的 localStorage。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: safeParse(localStorage.getItem(USER_KEY))
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    role: (s) => s.user?.role || '',
    displayName: (s) => s.user?.displayName || s.user?.username || '用户'
  },
  actions: {
    /** 登录成功：写入内存 + localStorage */
    setAuth(token, user) {
      this.token = token
      this.user = user || {}
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(this.user))
    },
    /** 退出/登录失效：清空内存 + localStorage */
    clear() {
      this.token = ''
      this.user = {}
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    }
  }
})

function safeParse(raw) {
  try {
    return JSON.parse(raw || '{}') || {}
  } catch {
    return {}
  }
}

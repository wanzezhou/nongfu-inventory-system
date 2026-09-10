import request from './request'

export function login(data) {
  return request({
    url: '/auth/login',
    method: 'post',
    data
  })
}

export function changePassword(data) {
  return request({
    url: '/auth/password',
    method: 'put',
    data
  })
}

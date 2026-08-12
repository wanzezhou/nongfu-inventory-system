const config = require('./config.js');

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('mini_token') || '';

    wx.request({
      url: config.BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign(
        {
          'Content-Type': 'application/json'
        },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      success: (res) => {
        const body = res.data;
        if (res.statusCode === 200 && body && body.code !== undefined) {
          if (body.code === 200) {
            resolve(body.data === undefined ? null : body.data);
          } else if (body.code === 401) {
            wx.showToast({ title: '登录已过期', icon: 'none' });
            const app = getApp();
            if (app && app.clearLoginState) app.clearLoginState();
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/login/login' });
            }, 500);
            reject(new Error(body.message || '未登录'));
          } else {
            wx.showToast({ title: body.message || '请求失败', icon: 'none' });
            reject(new Error(body.message || '请求失败'));
          }
        } else {
          resolve(body);
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络连接失败', icon: 'none' });
        reject(err);
      }
    });
  });
}

function toQuery(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';
  const pairs = keys.filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
  return '?' + pairs.join('&');
}

module.exports = {
  get:    (url, params = {}) => request({ url: url + toQuery(params), method: 'GET' }),
  post:   (url, data = {})  => request({ url, method: 'POST', data }),
  put:    (url, data = {})  => request({ url, method: 'PUT', data }),
  delete: (url, data = {})  => request({ url, method: 'DELETE', data }),
  raw:    request
};

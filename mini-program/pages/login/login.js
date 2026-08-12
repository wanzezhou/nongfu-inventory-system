const app = getApp();
const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    username: '',
    password: '',
    loading: false
  },

  onLoad() {
    // 已登录则直接进入首页
    if (auth.getToken() && auth.getRole()) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },

  onUsernameInput(e) { this.setData({ username: e.detail.value }); },
  onPasswordInput(e) { this.setData({ password: e.detail.value }); },

  handleLogin() {
    if (this.data.loading) return;

    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username) {
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    wx.showLoading({ title: '登录中...', mask: true });

    request.post('/mini/auth/password-login', { username, password })
      .then((data) => {
        wx.hideLoading();
        this.setData({ loading: false });
        this._onLoginSuccess(data);
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ loading: false });
        // 具体错误文案已由 request.js 统一 toast（如 账号或密码错误）
        console.error('登录失败:', err && err.message);
      });
  },

  // 登录成功收尾：保存登录态并进入首页
  _onLoginSuccess(data) {
    if (!data || !data.token) {
      wx.showToast({ title: '登录响应异常', icon: 'none' });
      return;
    }
    const userInfo = data.userInfo || {};
    const role = userInfo.role || '';
    app.setLoginState(data.token, role, userInfo);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/home/home' });
    }, 500);
  }
});

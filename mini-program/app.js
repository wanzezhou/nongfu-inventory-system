const auth = require('./utils/auth.js');
const config = require('./utils/config.js');

App({
  globalData: {
    userInfo: null,
    token: '',
    role: '',
    BASE_URL: config.BASE_URL
  },

  onLaunch() {
    const token = auth.getToken();
    const role = auth.getRole();
    if (token && role) {
      this.globalData.token = token;
      this.globalData.role = role;
      this.globalData.userInfo = auth.getUserInfo();
    }
  },

  setLoginState(token, role, userInfo) {
    auth.setToken(token);
    auth.setRole(role);
    auth.setUserInfo(userInfo);
    this.globalData.token = token;
    this.globalData.role = role;
    this.globalData.userInfo = userInfo;
  },

  clearLoginState() {
    auth.clearToken();
    auth.clearRole();
    auth.clearUserInfo();
    this.globalData.token = '';
    this.globalData.role = '';
    this.globalData.userInfo = null;
  },

  toLogin() {
    this.clearLoginState();
    wx.reLaunch({ url: '/pages/login/login' });
  }
});

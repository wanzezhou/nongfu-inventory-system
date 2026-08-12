const request = require('../../../utils/request.js');
const auth = require('../../../utils/auth.js');
const fmt = require('../../../utils/format.js');

Page({
  data: {
    name: '',
    role: '',
    roleText: '',
    phone: '',
    avatar: '',
    stationName: '',
    menu: []
  },

  onShow() {
    this._loadMe();
  },

  _loadMe() {
    request.get('/mini/auth/me')
      .then((info) => {
        if (!info) return;
        const role = info.role || auth.getRole() || '';
        this.setData({
          name: info.name || '',
          role,
          roleText: fmt.roleLabel(role),
          phone: fmt.maskPhone(info.phone || ''),
          avatar: info.avatar || '',
          stationName: info.stationName || ''
        });
        this._renderMenu(role);
        // 同步到本地缓存
        const stored = auth.getUserInfo() || {};
        auth.setUserInfo(Object.assign({}, stored, info));
      })
      .catch(() => {
        // 接口失败时使用本地缓存兜底
        const u = auth.getUserInfo() || {};
        const role = auth.getRole() || '';
        this.setData({
          name: u.name || '',
          role,
          roleText: fmt.roleLabel(role),
          phone: fmt.maskPhone(u.phone || ''),
          avatar: u.avatar || ''
        });
        this._renderMenu(role);
      });
  },

  _renderMenu(role) {
    const menu = [
      { url: '/pages/profile/change-phone/change-phone', icon: '📱', label: '修改手机号', desc: '更换绑定手机号' }
    ];
    if (role !== 'station') {
      menu.push({ url: '/pages/reimburse/list/list', icon: '🧾', label: '报销记录', desc: '我的费用报销' });
    }
    menu.push({ url: '/pages/deposit/list/list', icon: '🪣', label: '桶押金记录', desc: '押金收支明细' });
    this.setData({ menu });
  },

  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },

  logout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      confirmColor: '#C7000B',
      success: (res) => {
        if (!res.confirm) return;
        request.post('/mini/auth/logout').catch(() => {});
        const app = getApp();
        if (app && app.clearLoginState) app.clearLoginState();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});

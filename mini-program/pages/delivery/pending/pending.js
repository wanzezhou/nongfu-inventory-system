const request = require('../../../utils/request.js');
const auth = require('../../../utils/auth.js');

Page({
  data: {
    role: '',
    list: [],
    loading: false,
    accepting: false
  },

  onLoad() {
    this.setData({ role: auth.getRole() || 'admin' });
    this._fetch();
  },

  onShow() {
    // 返回本页时刷新（接单/完成后的状态变化）
    this._fetch();
  },

  onPullDownRefresh() {
    this._fetch().then(() => wx.stopPullDownRefresh());
  },

  _fetch() {
    if (this.data.loading) return Promise.resolve();
    this.setData({ loading: true });
    return request.get('/mini/delivery/pending')
      .then((data) => {
        this.setData({ list: data.list || [], loading: false });
      })
      .catch(() => this.setData({ loading: false }));
  },

  onAccept(e) {
    if (this.data.accepting) return;
    const id = e.detail.id;
    wx.showModal({
      title: '确认接单',
      content: '确定接取该配送订单吗？',
      confirmColor: '#C7000B',
      success: (res) => {
        if (res.confirm) this._doAccept(id);
      }
    });
  },

  _doAccept(id) {
    this.setData({ accepting: true });
    wx.showLoading({ title: '接单中...', mask: true });
    request.post('/mini/delivery/accept/' + id)
      .then(() => {
        wx.hideLoading();
        this.setData({ accepting: false });
        wx.showToast({ title: '接单成功', icon: 'success' });
        this._fetch();
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ accepting: false });
        // 409 订单已被接取 → 刷新列表
        if (err && err.message && err.message.indexOf('已被') > -1) {
          this._fetch();
        }
      });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/order/detail/detail?id=' + e.detail.id });
  }
});

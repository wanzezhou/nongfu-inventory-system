const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    role: '',
    periods: [
      { value: 'today', label: '今天' },
      { value: 'week', label: '本周' },
      { value: 'month', label: '本月' }
    ],
    periodIndex: 2,
    data: null,
    loading: false
  },

  onLoad() {
    this.setData({ role: auth.getRole() || 'admin' });
    this._fetch();
  },

  onPullDownRefresh() {
    this._fetch().then(() => wx.stopPullDownRefresh());
  },

  onPeriodTap(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx === this.data.periodIndex) return;
    this.setData({ periodIndex: idx }, () => this._fetch());
  },

  _fetch() {
    const period = this.data.periods[this.data.periodIndex].value;
    this.setData({ loading: true });
    return request.get('/mini/performance', { period })
      .then((data) => {
        this.setData({ data, loading: false });
      })
      .catch(() => this.setData({ loading: false }));
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order/detail/detail?id=' + id });
  }
});

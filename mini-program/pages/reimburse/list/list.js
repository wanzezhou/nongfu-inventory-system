const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    finished: false,
    isAdmin: false
  },

  onLoad() {
    this.setData({ isAdmin: auth.getRole() === 'admin' });
  },

  onShow() {
    this._fetch(true);
  },

  onPullDownRefresh() {
    this._fetch(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this._fetch(false);
  },

  _fetch(reset) {
    if (this.data.loading) return Promise.resolve();
    if (!reset && this.data.finished) return Promise.resolve();

    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    return request.get('/mini/reimbursements', { page, pageSize: this.data.pageSize })
      .then((res) => {
        const list = (res.list || []).map(it => Object.assign({}, it, {
          statusText: this._statusText(it.status),
          statusClass: this._statusClass(it.status),
          amountText: '¥' + fmt.formatAmount(it.amount),
          approvedText: it.approvedAmount !== null && it.approvedAmount !== undefined
            ? '¥' + fmt.formatAmount(it.approvedAmount) : ''
        }));
        const total = res.total || 0;
        const merged = reset ? list : this.data.list.concat(list);
        this.setData({
          list: merged,
          total,
          page: page + 1,
          loading: false,
          finished: merged.length >= total
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  _statusText(s) {
    if (s === 2) return '已通过';
    if (s === 3) return '已拒绝';
    return '待审核';
  },

  _statusClass(s) {
    if (s === 2) return 'tag-success';
    if (s === 3) return 'tag-danger';
    return 'tag-warning';
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/reimburse/create/create' });
  },

  goApprove() {
    wx.navigateTo({ url: '/pages/reimburse/approve/approve' });
  }
});

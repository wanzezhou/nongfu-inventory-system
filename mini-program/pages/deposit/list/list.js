const request = require('../../../utils/request.js');

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    finished: false
  },

  onLoad() {
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

    return request.get('/mini/deposits', { page, pageSize: this.data.pageSize })
      .then((res) => {
        const list = (res.list || []).map(it => Object.assign({}, it, {
          depositTypeText: it.depositType === 'return' ? '退押金' : '收押金'
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

  goCreate() {
    wx.navigateTo({ url: '/pages/deposit/create/create' });
  }
});

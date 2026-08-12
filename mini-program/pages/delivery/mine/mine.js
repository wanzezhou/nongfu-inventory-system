const request = require('../../utils/request.js');

Page({
  data: {
    tabs: [
      { label: '配送中', status: 'pending' },
      { label: '已完成', status: 'completed' },
      { label: '全部', status: '' }
    ],
    activeTab: 0,
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

  onTabTap(e) {
    const idx = e.currentTarget.dataset.index;
    if (idx === this.data.activeTab) return;
    this.setData({ activeTab: idx, list: [], page: 1, finished: false }, () => this._fetch(true));
  },

  _fetch(reset) {
    if (this.data.loading) return Promise.resolve();
    if (!reset && this.data.finished) return Promise.resolve();

    const page = reset ? 1 : this.data.page;
    const tab = this.data.tabs[this.data.activeTab];
    this.setData({ loading: true });

    return request.get('/mini/delivery/mine', {
      page,
      pageSize: this.data.pageSize,
      status: tab.status
    }).then((res) => {
      const list = res.list || [];
      const total = res.total || 0;
      const merged = reset ? list : this.data.list.concat(list);
      this.setData({
        list: merged,
        total,
        page: page + 1,
        loading: false,
        finished: merged.length >= total
      });
    }).catch(() => this.setData({ loading: false }));
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/order/detail/detail?id=' + e.detail.id });
  }
});

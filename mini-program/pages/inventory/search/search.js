const request = require('../../../utils/request.js');
const fmt = require('../../../utils/format.js');
const config = require('../../../utils/config.js');

Page({
  data: {
    keyword: '',
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

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.setData({ list: [], page: 1, finished: false }, () => this._fetch(true));
  },

  _fetch(reset) {
    if (this.data.loading) return Promise.resolve();
    if (!reset && this.data.finished) return Promise.resolve();

    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    return request.get('/mini/inventory/search', {
      page,
      pageSize: this.data.pageSize,
      keyword: this.data.keyword
    }).then((res) => {
      const list = (res.list || []).map(it => {
        let imageUrl = it.imageUrl || '';
        if (imageUrl && imageUrl.indexOf('http') !== 0) {
          imageUrl = config.BASE_URL + imageUrl;
        }
        return Object.assign({}, it, {
          imageUrl,
          stockCls: fmt.stockClass(it.quantity),
          stockStatus: it.stockStatus || 'sufficient'
        });
      });
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

  stockStatusText(s) {
    const map = { sufficient: '充足', low: '偏低', out: '缺货' };
    return map[s] || '充足';
  }
});

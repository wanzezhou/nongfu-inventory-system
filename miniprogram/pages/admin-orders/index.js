// 订单管理 · 列表（管理员 · Phase 8b 第 9 域）
// 全来源订单（Web + 小程序），支持状态筛选与关键词搜索；点行进详情做推进/取消。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

const TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING_STOCK', label: '待备货' },
  { key: 'DELIVERING', label: '配送中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELED', label: '已取消' },
  { key: 'REFUNDED', label: '已退款' }
];

Page({
  data: {
    tabs: TABS,
    status: 'ALL',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: false,
    loading: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch(true);
  },

  onPullDownRefresh() {
    this.fetch(true).then(() => wx.stopPullDownRefresh());
  },

  async fetch(reset) {
    const page = reset ? 1 : this.data.page + 1;
    if (this.data.loading) return this.data._pending || Promise.resolve();
    this.setData({ loading: true, loadError: '' });
    try {
      const q = { page: String(page), pageSize: '15', status: this.data.status };
      if (this.data.keyword.trim()) q.keyword = this.data.keyword.trim();
      const res = await ui.request.get('/admin/orders', q, { silent: true });
      const rows = (res.list || []).map(r =>
        Object.assign({}, r, {
          orderAmountText: fmt.money(r.orderAmount),
          createdAtText: fmt.dateOnly(r.createdAt),
          refunded: r.refundStatus === 'REFUNDED'
        })
      );
      this.setData({
        list: reset ? rows : this.data.list.concat(rows),
        page,
        total: res.total || 0,
        hasMore: rows.length >= 15 && this.data.list.length + rows.length < (res.total || 0)
      });
    } catch (e) {
      this.setData({ loadError: e.message || '订单列表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  loadMore() {
    if (this.data.hasMore) this.fetch(false);
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.status) return;
    this.setData({ status: key });
    this.fetch(true);
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.fetch(true);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    ui.navTo('/pages/admin-order-detail/index?id=' + id);
  }
});

// 公司账户 · 列表（管理员 · Phase 8b 第 10 域）
// 余额只读；管理动作只有「新增 / 编辑（含停用）/ 转账」三件，全部在其它页面完成。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

const TABS = [
  { key: 'all', label: '全部' },
  { key: '1', label: '启用' },
  { key: '0', label: '已停用' }
];

Page({
  data: {
    tabs: TABS,
    status: 'all',
    keyword: '',
    list: [],
    total: 0,
    totalBalanceText: '0.00',
    loading: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch();
  },

  onShow() {
    // 从编辑/转账页返回时刷新（余额可能已变）
    if (this.data.list.length) this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(() => wx.stopPullDownRefresh());
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const q = { page: '1', pageSize: '50' };
      if (this.data.status !== 'all') q.status = this.data.status;
      if (this.data.keyword.trim()) q.keyword = this.data.keyword.trim();
      const res = await ui.request.get('/admin/accounts', q, { silent: true });
      this.setData({
        list: (res.list || []).map(a => Object.assign({}, a, { currentBalanceText: fmt.money(a.currentBalance) })),
        total: res.total || 0,
        totalBalanceText: fmt.money(res.totalBalance || 0)
      });
    } catch (e) {
      this.setData({ loadError: e.message || '账户列表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.status) return;
    this.setData({ status: key });
    this.fetch();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.fetch();
  },

  goCreate() {
    ui.navTo('/pages/admin-account-edit/index');
  },

  goTransfer() {
    ui.navTo('/pages/admin-account-transfer/index');
  },

  goDetail(e) {
    ui.navTo('/pages/admin-account-edit/index?id=' + e.currentTarget.dataset.id);
  }
});

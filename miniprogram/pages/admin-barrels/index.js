// 押金台账（回桶 · 管理员 · Phase 8b 第 16 域）
// ⚠️ 本页只读：押金是一笔已发生的收付，**没有编辑/删除入口** ——
//    记错了要开一笔反向流水（退回/再收），不能改历史（与「入库单只能作废」同一原则）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

const PARTY_TABS = [
  { key: 'all', label: '全部' },
  { key: 'station', label: '水站' },
  { key: 'customer', label: '零售客户' }
];

Page({
  data: {
    tabs: PARTY_TABS,
    partyType: 'all',
    summary: [],
    list: [],
    total: 0,
    loading: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch();
  },

  onShow() {
    if (this.data.list.length || this.data.summary.length) this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    const q = {};
    if (this.data.partyType !== 'all') q.partyType = this.data.partyType;
    try {
      const sum = await ui.request.get('/admin/barrels/summary', q, { silent: true });
      const dep = await ui.request.get('/admin/barrels/deposits', Object.assign({ page: '1', pageSize: '30' }, q), {
        silent: true
      });
      this.setData({
        summary: (sum.list || []).map(function (s) {
          return Object.assign({}, s, {
            pendingAmountText: fmt.money(s.pendingAmount),
            unitPriceText: fmt.money(s.unitPrice)
          });
        }),
        list: (dep.list || []).map(function (d) {
          return Object.assign({}, d, {
            amountText: fmt.money(d.amount),
            unitPriceText: fmt.money(d.unitPrice),
            isCollect: d.depositType === 'collect'
          });
        }),
        total: dep.total || 0
      });
    } catch (e) {
      this.setData({ loadError: e.message || '押金台账加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.partyType) return;
    this.setData({ partyType: key });
    this.fetch();
  },

  goDeposit() {
    ui.navTo('/pages/admin-barrel-deposit/index');
  },

  goConfigs() {
    ui.navTo('/pages/admin-barrel-configs/index');
  }
});

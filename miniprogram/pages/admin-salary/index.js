// 工资发放 · 汇总（管理员 · Phase 8b 第 11 域）
// ===========================================================================
// 本页只做「核对 + 发起」：**所有金额都来自服务端**（应发/待扣预支/实发/汇总）。
// 页面不自己算一份 —— 页面算一份、服务端算一份，两边口径必然分叉，
// 而分叉时用户只会认为自己看错了（这正是仓库里「两套区间约定」那类事故的形态）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

Page({
  data: {
    month: '',
    list: [],
    summary: {},
    summaryText: { totalDue: '0.00', totalPendingAdvance: '0.00' },
    loading: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.setData({ month: this.currentMonth() });
    this.fetch();
  },

  onShow() {
    // 从发放页 / 预支页返回时刷新（状态与金额可能已变）
    if (this.data.month) this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  currentMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/salary/summary', { month: this.data.month }, { silent: true });
      const s = res.summary || {};
      this.setData({
        list: (res.list || []).map(function (x) {
          return Object.assign({}, x, {
            calcFeeText: fmt.money(x.calcFee),
            dueText: fmt.money(x.due),
            pendingText: fmt.money(x.pendingAdvance),
            netText: fmt.money(x.net),
            paidText: x.paidAmount === null || x.paidAmount === undefined ? '' : fmt.money(x.paidAmount)
          });
        }),
        summary: s,
        summaryText: {
          totalDue: fmt.money(s.totalDue || 0),
          totalPendingAdvance: fmt.money(s.totalPendingAdvance || 0)
        }
      });
    } catch (e) {
      this.setData({ loadError: e.message || '工资汇总加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value });
    this.fetch();
  },

  goPay(e) {
    ui.navTo('/pages/admin-salary-pay/index?workerId=' + e.currentTarget.dataset.id + '&month=' + this.data.month);
  },

  goAdvances() {
    ui.navTo('/pages/admin-advances/index');
  }
});

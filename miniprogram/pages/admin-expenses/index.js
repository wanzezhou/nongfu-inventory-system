// 支出台账 · 列表（管理员 · 文档 §5.3「支出/费用」/ §43 Phase 8b 第 1 域）
// ===========================================================================
// ⚠️ 三条与安全/口径相关的约定，改这页时别丢：
//
//   ① 区间筛选**只传后端 `resolveRange` 认得的预设键**（month / lastMonth / year），
//      不自己拼 startDate/endDate。本仓库有两套区间约定（end 含 / end 不含），
//      前端自己拼极容易选错那一套 —— 表现为「今天记的支出在列表里看不到」。
//      传空串表示不限区间，此时**整个 range 参数不下发**（后端以 `range || month` 判空）。
//
//   ② 金额只展示后端返回值（含合计 sumAmount 由服务端 SUM 得出），
//      前端不做任何累加 —— 前端算钱一律违规（§22.1 / §22.6）。
//
//   ③ 页面里的角色判断只是体验优化。真正的边界在服务端 `requireMiniAdmin`：
//      非管理员即使绕过前端也拿不到数据。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 15;

/** 区间预设（与后端 utils/dateRange.js 的 resolveRange 白名单一致） */
const RANGES = [
  { key: 'month', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'year', label: '本年' },
  { key: '', label: '全部' }
];

Page({
  data: {
    ranges: RANGES,
    range: 'month',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    sumAmountText: '0.00',
    hasMore: true,
    loading: false,
    loadError: '',
    blocked: ''
  },

  onLoad() {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    this.setData({
      blocked: ui.blockedBanner(),
      loadError: role === ROLES.ADMIN ? '' : '当前身份不是管理员，无权查看支出台账'
    });
  },

  onShow() {
    // 从编辑页返回后要看到最新数据（新增/删除都会改变列表）
    if (!this.data.loadError) this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onRangeTap(e) {
    const range = e.currentTarget.dataset.key;
    if (range === this.data.range) return;
    this.setData({ range });
    this.reload();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  async reload() {
    this.setData({ page: 1, list: [], hasMore: true, loadError: '' });
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page + 1;

    const query = { page, pageSize: PAGE_SIZE };
    if (this.data.range) query.range = this.data.range;
    const kw = String(this.data.keyword || '').trim();
    if (kw) query.keyword = kw;

    try {
      const res = await ui.request.get('/admin/expenses', query, { silent: true });
      const shaped = (res.list || []).map(it => ({
        expenseId: it.expenseId,
        expenseName: it.expenseName,
        category: it.category,
        amountText: fmt.money(it.amount),
        expenseDate: it.expenseDate,
        accountName: it.accountName
      }));
      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({
        list,
        page,
        total: res.total,
        sumAmountText: fmt.money(res.sumAmount),
        hasMore: list.length < res.total,
        loading: false
      });
    } catch (e) {
      // 失败**不清空列表**、也不报成功（红线：失败分支不得误报成功）
      this.setData({ loading: false, loadError: e.message || '支出台账加载失败' });
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    ui.navTo(`/pages/admin-expense-edit/index?id=${id}`);
  },

  onCreate() {
    ui.navTo('/pages/admin-expense-edit/index');
  }
});

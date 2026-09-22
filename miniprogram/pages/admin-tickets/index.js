// 水票（管理员 · Phase 8b 第 15 域）
// ===========================================================================
// ⚠️ 本页**只有查 + 作废单张**，没有发行入口 —— 这是范围决定，不是缺功能：
//    · 发行 / 批次删除 / 账户与配送费调整属 Phase 7（水票积分）批次（docs §7.2）；
//    · §12.10 要求「配送费积分由服务端从商品档案重取」，而现发行接口信任客户端传入值 ——
//      手机端开放发行等于把「公司欠水站多少积分」的定价权交给客户端。
//    页面上明确写出这件事，用户不会去找一个不存在的按钮。
// ⚠️ 三个 tab 的形状不同（库存按水站×商品、明细按张、发行记录按批次），
//    所以这里**不是**配置驱动的同构页面，而是共享筛选器 + 各自渲染。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

const TABS = [
  { key: 'inventory', label: '库存', routes: { list: '/admin/water-tickets/inventory' } },
  { key: 'list', label: '明细', routes: { list: '/admin/water-tickets/list' } },
  { key: 'issuances', label: '发行记录', routes: { list: '/admin/water-tickets/issuances' } }
];

Page({
  data: {
    tabs: TABS.map(function (t) {
      return { key: t.key, label: t.label };
    }),
    tab: 'inventory',
    stations: [],
    stationLabels: ['全部水站'],
    stationIndex: 0,
    month: '',
    rows: [],
    total: 0,
    notice: '',
    loading: false,
    busy: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetchOptions();
    this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  currentTab() {
    for (let i = 0; i < TABS.length; i++) if (TABS[i].key === this.data.tab) return TABS[i];
    return TABS[0];
  },

  async fetchOptions() {
    try {
      const res = await ui.request.get('/admin/water-tickets/options', null, { silent: true });
      const st = res.stations || [];
      this.setData({
        stations: st,
        stationLabels: ['全部水站'].concat(
          st.map(function (s) {
            return s.stationName;
          })
        ),
        month: res.month || this.data.month
      });
    } catch (e) {
      this.setData({ loadError: e.message || '选项加载失败' });
    }
  },

  async fetch() {
    const cur = this.currentTab();
    this.setData({ loading: true, loadError: '' });
    const q = { page: '1', pageSize: '30' };
    const s = this.data.stations[this.data.stationIndex - 1];
    if (this.data.stationIndex > 0 && s) q.stationId = s.stationId;
    try {
      const res = await ui.request.get(cur.routes.list, q, { silent: true });
      let rows = res.list || [];
      if (cur.key === 'inventory') {
        rows = rows.map(function (x) {
          return Object.assign({}, x, { feeText: fmt.money(x.stationDeliveryFee) });
        });
      } else if (cur.key === 'issuances') {
        rows = rows.map(function (b) {
          return Object.assign({}, b, {
            feeText: fmt.money(b.totalFee),
            items: (b.items || []).map(function (it) {
              return Object.assign({}, it, { feeText: fmt.money(it.distributionDeliveryFee) });
            })
          });
        });
      }
      this.setData({ rows: rows, total: res.total || rows.length, notice: res.notice || '' });
    } catch (e) {
      this.setData({ loadError: e.message || '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.tab) return;
    this.setData({ tab: key, rows: [], total: 0, notice: '' });
    this.fetch();
  },

  onStationChange(e) {
    this.setData({ stationIndex: Number(e.detail.value) });
    this.fetch();
  },

  async onCancelTicket(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const ok = await ui.confirm(
      '作废这张水票？',
      '作废后该票不能再核销；**不涉及积分回退**（配送费积分在发行时已发生）。操作不可撤销。',
      '确认作废'
    );
    if (!ok) return;
    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const key = idem.acquireKey({ scope: 'CANCEL_TICKET_ADMIN', ownerKey: ownerKey, payload: { ticketId: id } });
    try {
      await ui.request.post('/admin/water-tickets/' + id + '/cancel', { clientRequestId: key }, { silent: true });
      idem.releaseKey();
      wx.showToast({ title: '已作废', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '作废失败' });
    } finally {
      this.setData({ busy: false });
    }
  }
});

// 水票（管理员 · Phase 8b 第 15 域 + Phase 7 补齐）
// ===========================================================================
// ✅ **Phase 7 已落地（2026-09-22）**：发行与改数量已开放（发行入口在本页顶部，
//    表单在 pages/admin-ticket-issue）。落地顺序：先收定价权（§12.6 单件值落库 +
//    §12.10 服务端重取 + §12.9 停用改历史金额的端点），才敢把发行搬到公网弱网环境。
// ⚠️ **批次删除仍只在 Web**：破坏性操作（整批删除 + 按净入账回冲积分），手机误触代价过高。
//    冒烟有反向断言（该路径必须 404），防止将来被「顺手」打开。
// ⚠️ 作废与改数量都会**回冲积分**（按单件值，方向 OUT）；水站已把积分花掉时会被拒
//    （余额不足 → 事务回滚、票保持未用）。页面文案必须与之一致，别再说「不涉及积分」。
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
              return Object.assign({}, it, {
                feeText: fmt.money(it.distributionDeliveryFee),
                // 单件值由服务端下发（不要用「总额 ÷ 数量」反推 —— 除不尽会引入误差）
                unitFeeText: fmt.money(it.unitFee)
              });
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

  /** 去发行页（返货清单录入；发行会给水站入账积分） */
  goIssue() {
    ui.navTo('/pages/admin-ticket-issue/index');
  },

  /**
   * 改数量（按差额补/冲积分）
   * ⚠️ 金额不可改：单件值来自商品档案，总额 = 单件值 × 数量（服务端算）。
   * ⚠️ 这是资金动作 → 必须带幂等键；改错数量应「改数量」而不是重新发行一次。
   */
  async onEditQuantity(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const cur = Number(e.currentTarget.dataset.qty) || 0;
    const name = e.currentTarget.dataset.name || '该商品';
    const input = await ui.prompt('修改数量（当前 ' + cur + '）', '输入新的数量（正整数）');
    if (input === null) return;
    const qty = Number(input);
    if (!(qty > 0) || String(qty) !== String(input).trim()) {
      this.setData({ loadError: '数量必须是大于 0 的整数' });
      return;
    }
    if (qty === cur) {
      wx.showToast({ title: '数量未变', icon: 'none' });
      return;
    }
    const ok = await ui.confirm(
      '确认修改数量？',
      name + '：' + cur + ' → ' + qty + ' 件。加量会补发水票并补入积分；减量会作废未用水票并回冲积分。',
      '确认修改'
    );
    if (!ok) return;

    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = { id: id, quantity: qty };
    const key = idem.acquireKey({ scope: 'UPDATE_TICKET_ISSUANCE_ADMIN', ownerKey: ownerKey, payload: payload });
    try {
      await ui.request.put('/admin/water-tickets/issuances/' + id, Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已修改', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '修改失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onCancelTicket(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const ok = await ui.confirm(
      '作废这张水票？',
      '作废后该票不能再核销，并按该票所属发行记录的单件配送费**回冲水站积分**。操作不可撤销。',
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

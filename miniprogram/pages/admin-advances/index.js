// 预支台账（管理员 · Phase 8b 第 11 域）
// ⚠️ 只有「未参与结算」（deductedAmount = 0）的预支能撤销 —— 已抵扣的抵扣明细挂在发放单上，
//    直接删会让撤销发放时还原不动。页面据此置灰按钮，但**真正的拦截在服务端**。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    workers: [],
    workerLabels: ['全部员工'],
    workerIndex: 0,
    statusLabels: ['全部状态', '未结清', '已结清'],
    statusIndex: 0,
    list: [],
    total: 0,
    loading: false,
    busy: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetchOptions();
    this.fetch();
  },

  onShow() {
    if (this.data.list.length) this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  async fetchOptions() {
    try {
      const res = await ui.request.get('/admin/salary/options', null, { silent: true });
      const ws = res.workers || [];
      this.setData({
        workers: ws,
        workerLabels: ['全部员工'].concat(
          ws.map(function (w) {
            return w.workerName + '（' + w.employeeTypeName + '）';
          })
        )
      });
    } catch (e) {
      this.setData({ loadError: e.message || '员工列表加载失败' });
    }
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    const q = { page: '1', pageSize: '50' };
    const w = this.data.workers[this.data.workerIndex - 1];
    if (this.data.workerIndex > 0 && w) q.workerId = w.workerId;
    if (this.data.statusIndex === 1) q.status = '0';
    if (this.data.statusIndex === 2) q.status = '1';
    try {
      const res = await ui.request.get('/admin/salary/advances', q, { silent: true });
      this.setData({
        list: (res.list || []).map(function (x) {
          return Object.assign({}, x, {
            amountText: fmt.money(x.amount),
            deductedText: fmt.money(x.deductedAmount),
            pendingText: fmt.money(x.pendingAmount)
          });
        }),
        total: res.total || 0
      });
    } catch (e) {
      this.setData({ loadError: e.message || '预支台账加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWorkerChange(e) {
    this.setData({ workerIndex: Number(e.detail.value) });
    this.fetch();
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value) });
    this.fetch();
  },

  goCreate() {
    ui.navTo('/pages/admin-advance-edit/index');
  },

  async onRevoke(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const ok = await ui.confirm(
      '撤销这笔预支？',
      '会删除该预支的支出流水并回补公司账户余额，操作不可撤销。',
      '撤销预支'
    );
    if (!ok) return;
    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const key = idem.acquireKey({ scope: 'DELETE_SALARY_ADVANCE', ownerKey: ownerKey, payload: { id: id } });
    try {
      await ui.request.del('/admin/salary/advances/' + id + '?clientRequestId=' + encodeURIComponent(key), null, {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已撤销预支', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '撤销失败' });
    } finally {
      this.setData({ busy: false });
    }
  }
});

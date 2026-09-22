// 预支登记（管理员 · Phase 8b 第 11 域）
// ⚠️ 这是**资金动作**：登记即从公司账户扣款并产生支出流水（「工资预支」）。
//    因此必须让用户在提交前看清「从哪个账户扣多少」。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    workers: [],
    workerLabels: [],
    workerIndex: 0,
    accounts: [],
    accLabels: [],
    accIndex: 0,
    amount: '',
    date: '',
    remark: '',
    loading: false,
    submitting: false,
    loadError: '',
    formError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    const d = new Date();
    this.setData({
      date: d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
    });
    this.fetchOptions();
  },

  async fetchOptions() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/salary/options', null, { silent: true });
      const ws = res.workers || [];
      const as = res.activeAccounts || [];
      this.setData({
        workers: ws,
        workerLabels: ws.map(function (w) {
          return w.workerName + '（' + w.employeeTypeName + '）';
        }),
        accounts: as,
        accLabels: as.map(function (a) {
          return a.accountName + '（余额 ¥' + fmt.money(a.currentBalance) + '）';
        }),
        accIndex: 0
      });
    } catch (e) {
      this.setData({ loadError: e.message || '选项加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWorkerChange(e) {
    this.setData({ workerIndex: Number(e.detail.value) });
  },

  onAccChange(e) {
    this.setData({ accIndex: Number(e.detail.value) });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const w = this.data.workers[this.data.workerIndex];
    const acc = this.data.accounts[this.data.accIndex];
    const amt = Number(this.data.amount) || 0;
    if (!w) {
      this.setData({ formError: '请选择员工' });
      return;
    }
    if (!(amt > 0)) {
      this.setData({ formError: '预支金额必须为大于 0 的数字' });
      return;
    }
    if (!acc) {
      this.setData({ formError: '请选择付款账户' });
      return;
    }
    const ok = await ui.confirm(
      '确认登记预支？',
      '给「' +
        w.workerName +
        '」登记预支 ¥' +
        fmt.money(amt) +
        '，从「' +
        acc.accountName +
        '」扣款（当前余额 ¥' +
        fmt.money(acc.currentBalance) +
        '）。该金额会在后续发工资时抵扣。',
      '确认登记'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = {
      workerId: w.workerId,
      amount: amt,
      advanceDate: this.data.date,
      accountId: acc.accountId,
      remark: this.data.remark
    };
    const key = idem.acquireKey({ scope: 'CREATE_SALARY_ADVANCE', ownerKey: ownerKey, payload: payload });
    try {
      await ui.request.post('/admin/salary/advances', Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '预支已登记', icon: 'success' });
      setTimeout(function () {
        wx.navigateBack();
      }, 600);
    } catch (e) {
      // 失败不释放幂等键：原地重试复用同一个键，否则可能真的预支两笔
      this.setData({ formError: e.message || '预支登记失败' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});

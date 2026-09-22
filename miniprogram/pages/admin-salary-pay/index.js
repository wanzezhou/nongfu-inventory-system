// 工资发放（管理员 · Phase 8b 第 11 域）
// ===========================================================================
// 资金动作。三条纪律：
//   ① 提交前让用户看清「应发 − 待扣预支 = 实发」以及从哪个账户扣多少；
//   ② 实发为负时**不扣账户**（挂账下月继续扣）—— 页面上要讲明，否则用户会以为少发了钱；
//   ③ 幂等键在提交那一刻生成、失败不释放（弱网重试复用同一个键，服务端合并为一次）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    workerId: '',
    month: '',
    workerName: '',
    employeeTypeName: '',
    calcFee: 0,
    due: '',
    pendingAdvance: 0,
    pendingAdvances: [],
    net: 0,
    netText: '0.00',
    accounts: [],
    accLabels: [],
    accIndex: 0,
    acc: null,
    insufficient: false,
    paid: false,
    payment: null,
    remark: '',
    loading: false,
    submitting: false,
    loadError: '',
    formError: ''
  },

  onLoad(q) {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.setData({ workerId: q.workerId || '', month: q.month || '' });
    if (!q.workerId || !q.month) {
      this.setData({ loadError: '缺少员工或月份参数，请从工资汇总页进入' });
      return;
    }
    this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const prev = await ui.request.get(
        '/admin/salary/worker/' + this.data.workerId,
        { month: this.data.month },
        { silent: true }
      );
      const opts = await ui.request.get('/admin/salary/options', null, { silent: true });
      const accounts = opts.activeAccounts || [];
      const labels = accounts.map(function (a) {
        return a.accountName + '（余额 ¥' + fmt.money(a.currentBalance) + '）';
      });
      this.setData({
        workerName: prev.workerName,
        employeeTypeName: prev.employeeTypeName,
        calcFee: prev.calcFee,
        due: String(prev.due),
        pendingAdvance: prev.pendingAdvance,
        pendingAdvances: prev.pendingAdvances || [],
        paid: prev.paid,
        payment: prev.payment,
        accounts: accounts,
        accLabels: labels,
        accIndex: 0
      });
      this.recalc();
    } catch (e) {
      this.setData({ loadError: e.message || '发放信息加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  recalc() {
    const due = Number(this.data.due) || 0;
    const net = Math.round((due - Number(this.data.pendingAdvance || 0)) * 100) / 100;
    const acc = this.data.accounts[this.data.accIndex] || null;
    this.setData({
      net: net,
      netText: fmt.money(net),
      acc: acc,
      insufficient: !!acc && net > 0 && Number(acc.currentBalance) < net
    });
  },

  onDueInput(e) {
    this.setData({ due: e.detail.value });
    this.recalc();
  },

  onAccChange(e) {
    this.setData({ accIndex: Number(e.detail.value) });
    this.recalc();
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (this.data.paid) {
      this.setData({ formError: '该员工本月工资已发放。如需重发，请先撤销上一条发放记录。' });
      return;
    }
    const due = Number(this.data.due) || 0;
    if (!(due > 0)) {
      this.setData({ formError: '应发金额必须大于 0（当月无配送费时，可手动填写应发用于补加其他工资）' });
      return;
    }
    const net = this.data.net;
    if (net > 0 && !this.data.acc) {
      this.setData({ formError: '请选择发放账户' });
      return;
    }
    const tail =
      net > 0
        ? '，从「' + this.data.acc.accountName + '」扣款 ¥' + this.data.netText
        : '（实发为负 = 挂账下月继续扣，本次不动账户）';
    const ok = await ui.confirm(
      '确认发放？',
      '「' +
        this.data.workerName +
        '」' +
        this.data.month +
        '：应发 ¥' +
        fmt.money(due) +
        ' − 待扣预支 ¥' +
        fmt.money(this.data.pendingAdvance) +
        ' = 实发 ¥' +
        this.data.netText +
        tail,
      '确认发放'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = {
      workerId: this.data.workerId,
      month: this.data.month,
      amount: due,
      accountId: net > 0 && this.data.acc ? this.data.acc.accountId : null,
      remark: this.data.remark
    };
    // ⚠️ acquireKey 的契约是对象（{scope, ownerKey, payload}），不是字符串
    const key = idem.acquireKey({ scope: 'PAY_SALARY', ownerKey: ownerKey, payload: payload });
    try {
      const r = await ui.request.post('/admin/salary/pay', Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      await ui.confirm(
        '发放成功',
        '实发 ¥' +
          fmt.money(r.amount) +
          '（应发 ¥' +
          fmt.money(r.due) +
          ' − 待扣预支 ¥' +
          fmt.money(r.pendingAdvance) +
          '）',
        '知道了'
      );
      this.fetch();
    } catch (e) {
      // 失败不释放幂等键：原地重试要复用同一个键
      this.setData({ formError: e.message || '发放失败' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onRevoke() {
    if (this.data.submitting) return;
    const pay = this.data.payment;
    if (!pay) return;
    const ok = await ui.confirm(
      '撤销这次发放？',
      '会回补公司账户 ¥' + fmt.money(pay.amount) + '、删除对应支出流水，并把本次抵扣的预支退回挂账。操作不可撤销。',
      '撤销发放'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const key = idem.acquireKey({
      scope: 'REVOKE_SALARY_PAYMENT',
      ownerKey: ownerKey,
      payload: { id: pay.paymentId }
    });
    try {
      await ui.request.del(
        '/admin/salary/payments/' + pay.paymentId + '?clientRequestId=' + encodeURIComponent(key),
        null,
        { silent: true }
      );
      idem.releaseKey();
      wx.showToast({ title: '已撤销发放', icon: 'success' });
      this.fetch();
    } catch (e) {
      this.setData({ formError: e.message || '撤销失败' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});

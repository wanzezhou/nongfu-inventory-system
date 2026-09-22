// 账户间转账（管理员 · Phase 8b 第 10 域）
// 资金动作：提交前做「余额是否够」的提前提示（**非安全边界**，真正的拦截在服务端）。
// 幂等键在提交那一刻生成，失败不释放 —— 弱网重试复用同一个键，服务端合并为一次转账。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const { acquireKey } = require('../../utils/idempotency');

Page({
  data: {
    activeAccounts: [],
    fromLabels: [],
    toLabels: [],
    fromIndex: 0,
    toIndex: 0,
    fromAccount: null,
    toAccount: null,
    amount: '',
    amountText: '0.00',
    remark: '',
    insufficient: false,
    loading: false,
    submitting: false,
    loadError: '',
    formError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetchOptions();
  },

  async fetchOptions() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/accounts/options', null, { silent: true });
      const accounts = res.activeAccounts || [];
      // 只列启用账户（停用账户转账必然被拒 —— 列出来是自造失败）
      const labels = accounts.map(a => `${a.accountName}（余额 ¥${fmt.money(a.currentBalance)}）`);
      this.setData({
        activeAccounts: accounts,
        fromLabels: labels,
        toLabels: labels,
        // 默认：转出第 1 个、转入第 2 个（若存在），避免默认选中同一账户
        fromIndex: 0,
        toIndex: accounts.length > 1 ? 1 : 0
      });
      this.syncAccounts();
    } catch (e) {
      this.setData({ loadError: e.message || '账户列表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  syncAccounts() {
    const list = this.data.activeAccounts;
    const from = list[this.data.fromIndex] || null;
    const to = list[this.data.toIndex] || null;
    const amt = Number(this.data.amount) || 0;
    this.setData({
      fromAccount: from,
      toAccount: to,
      amountText: fmt.money(amt),
      insufficient: !!from && amt > 0 && Number(from.currentBalance) < amt
    });
  },

  onFromChange(e) {
    this.setData({ fromIndex: Number(e.detail.value) });
    this.syncAccounts();
  },

  onToChange(e) {
    this.setData({ toIndex: Number(e.detail.value) });
    this.syncAccounts();
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value });
    this.syncAccounts();
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const from = this.data.fromAccount;
    const to = this.data.toAccount;
    const amt = Number(this.data.amount) || 0;
    if (!from || !to) {
      this.setData({ formError: '请选择转出与转入账户' });
      return;
    }
    if (from.accountId === to.accountId) {
      this.setData({ formError: '转出与转入账户不能相同' });
      return;
    }
    if (!(amt > 0)) {
      this.setData({ formError: '金额必须为大于 0 的数字' });
      return;
    }
    const ok = await ui.confirm(
      '确认转账？',
      `从「${from.accountName}」转出 ¥${fmt.money(amt)} 到「${to.accountName}」，操作不可撤销。`,
      '确认转账'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const key = acquireKey('account-xfer-' + from.accountId + '-' + to.accountId + '-' + amt);
    try {
      const r = await ui.request.post(
        '/admin/accounts/transfer',
        {
          clientRequestId: key,
          fromId: from.accountId,
          toId: to.accountId,
          amount: amt,
          remark: this.data.remark
        },
        { silent: true }
      );
      ui.confirm(
        '转账成功',
        `余额已更新：${from.accountName} → ¥${fmt.money(r.fromBalance)}；${to.accountName} → ¥${fmt.money(r.toBalance)}`,
        '知道了'
      );
      this.setData({ submitting: false, amount: '' });
      this.fetchOptions();
    } catch (e) {
      // 失败不释放幂等键：重试复用同一个键
      this.setData({ submitting: false, formError: e.message || '转账失败' });
    }
  }
});

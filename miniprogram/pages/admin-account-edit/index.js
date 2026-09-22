// 账户 新增 / 编辑（管理员 · Phase 8b 第 10 域）
// ⚠️ 编辑只改开户信息/备注/状态：名称、类型、余额都不提交（服务端也不接受这三个入参）。
//    幂等键在点提交那一刻生成，失败不释放以便重试复用。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const { acquireKey, releaseKey } = require('../../utils/idempotency');

Page({
  data: {
    isEdit: false,
    accountId: '',
    account: null,
    transactions: [],
    form: {
      accountName: '',
      accountType: 1,
      initialBalance: '',
      bankName: '',
      bankAccount: '',
      remark: '',
      status: true
    },
    types: [],
    typeLabels: [],
    typeIndex: 0,
    balanceText: '0.00',
    initialText: '0.00',
    loading: false,
    submitting: false,
    loadError: '',
    formError: ''
  },

  onLoad(query) {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    const id = query.id || '';
    this.setData({ isEdit: !!id, accountId: id });
    this.fetchOptions().then(() => {
      if (id) this.fetchAccount();
    });
  },

  async fetchOptions() {
    try {
      const res = await ui.request.get('/admin/accounts/options', null, { silent: true });
      const labels = (res.types || []).map(t => t.label);
      this.setData({
        types: res.types || [],
        typeLabels: labels,
        typeIndex: Math.max(
          0,
          (res.types || []).findIndex(t => t.value === 1)
        )
      });
    } catch (e) {
      this.setData({ loadError: e.message || '表单选项加载失败' });
    }
  },

  async fetchAccount() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/accounts/' + this.data.accountId, null, { silent: true });
      const a = res.account || {};
      const types = this.data.types || [];
      this.setData({
        account: a,
        balanceText: fmt.money(a.currentBalance),
        initialText: fmt.money(a.initialBalance),
        typeIndex: Math.max(
          0,
          types.findIndex(t => t.value === a.accountType)
        ),
        form: {
          accountName: a.accountName, // 只读展示用，提交时不带
          accountType: a.accountType,
          initialBalance: String(a.initialBalance),
          bankName: a.bankName || '',
          bankAccount: a.bankAccount || '',
          remark: a.remark || '',
          status: a.status
        },
        transactions: (res.transactions || []).map(t =>
          Object.assign({}, t, {
            amountText: fmt.money(t.amount),
            balanceAfterText: fmt.money(t.balanceAfter)
          })
        )
      });
    } catch (e) {
      this.setData({ loadError: e.message || '账户详情加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value);
    const t = this.data.types[idx];
    this.setData({ typeIndex: idx, 'form.accountType': t ? t.value : 1 });
  },

  onStatusChange(e) {
    this.setData({ 'form.status': e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    if (!this.data.isEdit) {
      if (!String(f.accountName || '').trim()) {
        this.setData({ formError: '账户名称不能为空' });
        return;
      }
      const initial = Number(f.initialBalance) || 0;
      if (initial < 0) {
        this.setData({ formError: '期初余额不能为负' });
        return;
      }
    }
    this.setData({ submitting: true, formError: '' });
    // ⚠️ acquireKey 的契约是**对象**（{scope, ownerKey, payload}），不是字符串。
    //    传字符串会让 scope / ownerKey / 内容指纹一起退化成 undefined 与常量「{}」，
    //    于是「键内容没变 → 复用同一个键」这条正常逻辑被永久触发：
    //    同一台设备 24h 内的**下一次**操作会复用上一次的键，被服务端判成
    //    「同键不同参数」而 400 —— 用户看到的是「重复提交的请求内容不一致」，
    //    根本联想不到幂等键。门禁已加静态检查（check-project.js）。
    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const scope = this.data.isEdit ? 'UPDATE_ACCOUNT' : 'CREATE_ACCOUNT';
    const keyPayload = this.data.isEdit
      ? {
          id: this.data.accountId,
          bankName: f.bankName,
          bankAccount: f.bankAccount,
          remark: f.remark,
          status: f.status
        }
      : {
          accountName: String(f.accountName).trim(),
          accountType: f.accountType,
          initialBalance: Number(f.initialBalance) || 0,
          bankName: f.bankName,
          bankAccount: f.bankAccount,
          remark: f.remark
        };
    const key = acquireKey({ scope, ownerKey, payload: keyPayload });
    try {
      if (this.data.isEdit) {
        // 只提交可改字段（名称/类型/余额不在其中）
        await ui.request.put(
          '/admin/accounts/' + this.data.accountId,
          {
            clientRequestId: key,
            bankName: f.bankName,
            bankAccount: f.bankAccount,
            remark: f.remark,
            status: f.status
          },
          { silent: true }
        );
      } else {
        await ui.request.post(
          '/admin/accounts',
          {
            clientRequestId: key,
            accountName: String(f.accountName).trim(),
            accountType: f.accountType,
            initialBalance: Number(f.initialBalance) || 0,
            bankName: f.bankName,
            bankAccount: f.bankAccount,
            remark: f.remark
          },
          { silent: true }
        );
      }
      releaseKey(); // 成功后释放：下一次保存是一次新操作，不能复用本次的键
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => ui.navTo('/pages/admin-accounts/index'), 600);
    } catch (e) {
      // 失败不释放幂等键：重试复用同一个键
      this.setData({ submitting: false, formError: e.message || '保存失败' });
      return;
    }
    this.setData({ submitting: false });
  },

  async onRemove() {
    const ok = await ui.confirm(
      '删除该账户？',
      '只有「余额为 0 且无任何流水」的账户能删除；否则服务端会拒绝并提示改用停用。',
      '删除'
    );
    if (!ok) return;
    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const key = acquireKey({ scope: 'DELETE_ACCOUNT', ownerKey, payload: { id: this.data.accountId } });
    try {
      await ui.request.del(
        '/admin/accounts/' + this.data.accountId + '?clientRequestId=' + encodeURIComponent(key),
        null,
        { silent: true }
      );
      releaseKey();
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => ui.navTo('/pages/admin-accounts/index'), 600);
    } catch (e) {
      this.setData({ formError: e.message || '删除失败' });
    }
  }
});

// 支出 · 新增 / 编辑（管理员 · Phase 8b 第 1 域）
// ===========================================================================
// ⚠️ 四条要点：
//
//   ① **幂等键在「用户点保存的那一刻」生成并持久化**（§23.1），重试复用同一个键。
//      这是移动端最容易被忽略的一环：弱网下用户会连点两次「保存」，
//      没有幂等键就会生成两笔支出，而两笔都合法、账面上看不出任何异常。
//      保存期间按钮同时置灰（双保险）。
//
//   ② **金额与日期必须与后端校验口径一致**：金额 > 0、日期 YYYY-MM-DD。
//      前端校验只是为了少一次往返，**不是安全边界** —— 后端 validateBody 才是。
//
//   ③ 账户可留空 = 只登记台账不动账（后端 applyExpenseLedger 在 account_id 为空时直接返回）。
//      编辑/删除都会由后端**撤销旧流水再重记**，前端不做任何调账。
//
//   ④ 删除要二次确认：删支出会**回补账户余额**（钱没花出去），是不可逆的资金动作。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');

const MAX_AMOUNT = 100000000; // 与后端 decimal(10,2) 量级相符，仅作前端提示上限

/** 今天（YYYY-MM-DD）—— 不用 toISOString（那是 UTC，东八区会差一天） */
function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page({
  data: {
    expenseId: '',
    isEdit: false,

    expenseName: '',
    amount: '',
    expenseDate: '',
    category: '',
    remark: '',

    // 会计科目（账户）下拉：第 0 项固定为「不记账」
    accounts: [],
    accountLabels: ['不记账（仅登记台账）'],
    accountIndex: 0,

    categories: [],
    categoryIndex: 0,

    submitting: false,
    loadError: '',
    blocked: ''
  },

  onLoad(query) {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    if (role !== 'admin') {
      this.setData({ loadError: '当前身份不是管理员，无权操作支出台账' });
      return;
    }

    const expenseId = (query && query.id) || '';
    this.setData({
      blocked: ui.blockedBanner(),
      expenseId,
      isEdit: !!expenseId,
      expenseDate: todayStr()
    });

    this.loadOptions().then(() => {
      if (expenseId) this.loadRecord(expenseId);
    });
  },

  /** 表单选项：可用账户（仅启用）+ 类别（预置 + 历史自定义） */
  async loadOptions() {
    try {
      const res = await ui.request.get('/admin/expenses/options', null, { silent: true });
      const accounts = (res.accounts || []).map(a => ({
        accountId: a.accountId,
        accountName: a.accountName,
        balanceText: fmt.money(a.currentBalance)
      }));
      const categories = [...(res.presetCategories || []), ...(res.customCategories || [])];
      this.setData({
        accounts,
        accountLabels: ['不记账（仅登记台账）', ...accounts.map(a => `${a.accountName}（余额 ¥${a.balanceText}）`)],
        categories,
        categoryIndex: categories.length ? 0 : 0
      });
      if (!this.data.category && categories.length) {
        this.setData({ category: categories[0] });
      }
    } catch (e) {
      this.setData({ loadError: e.message || '表单选项加载失败' });
    }
  },

  async loadRecord(expenseId) {
    try {
      const r = await ui.request.get(`/admin/expenses/${expenseId}`, null, { silent: true });
      // 账户下拉回填：找到对应下标；找不到（账户已停用）则退回「不记账」，
      // 但**不静默改成别的账户** —— 那会把账记到错误的账户上
      let accountIndex = 0;
      if (r.accountId) {
        const i = this.data.accounts.findIndex(a => a.accountId === r.accountId);
        accountIndex = i >= 0 ? i + 1 : 0;
      }
      const catIndex = this.data.categories.indexOf(r.category);
      this.setData({
        expenseName: r.expenseName || '',
        amount: r.amount !== undefined && r.amount !== null ? String(r.amount) : '',
        expenseDate: r.expenseDate || todayStr(),
        category: r.category || '',
        remark: r.remark || '',
        accountIndex,
        categoryIndex: catIndex >= 0 ? catIndex : 0
      });
    } catch (e) {
      this.setData({ loadError: e.message || '记录加载失败' });
    }
  },

  onNameInput(e) {
    this.setData({ expenseName: e.detail.value });
  },
  onAmountInput(e) {
    this.setData({ amount: e.detail.value });
  },
  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },
  onDateChange(e) {
    this.setData({ expenseDate: e.detail.value });
  },
  onCategoryChange(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ categoryIndex: i, category: this.data.categories[i] || '' });
  },
  onAccountChange(e) {
    this.setData({ accountIndex: Number(e.detail.value) || 0 });
  },

  /** 前端预校验（与后端 validateBody 同口径；真正的校验在服务端） */
  validate() {
    const name = String(this.data.expenseName || '').trim();
    if (!name) return '支出名称不能为空';
    const amt = Number(this.data.amount);
    if (this.data.amount === '' || isNaN(amt) || amt <= 0) return '金额必须为大于 0 的数字';
    if (amt > MAX_AMOUNT) return '金额过大，请核对';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data.expenseDate)) return '日期格式应为 YYYY-MM-DD';
    if (!String(this.data.category || '').trim()) return '请选择支出类别';
    return '';
  },

  buildPayload() {
    const accountId =
      this.data.accountIndex > 0 ? (this.data.accounts[this.data.accountIndex - 1] || {}).accountId : '';
    return {
      expenseName: String(this.data.expenseName || '').trim(),
      amount: Number(this.data.amount),
      expenseDate: this.data.expenseDate,
      category: String(this.data.category || '').trim(),
      accountId: accountId || undefined,
      remark: String(this.data.remark || '').trim() || undefined
    };
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const err = this.validate();
    if (err) {
      ui.showError(new Error(err));
      return;
    }
    if (auth.isBlocked()) {
      ui.showError(new Error(ui.blockedBanner()));
      return;
    }

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const payload = this.buildPayload();
    const scope = this.data.isEdit ? 'UPDATE_EXPENSE' : 'CREATE_EXPENSE';
    // 幂等键：同一份内容的重试复用同一个键；内容改了则换新键（否则后端判「同键不同参数」而 400）
    const keyPayload = this.data.isEdit ? Object.assign({ id: this.data.expenseId }, payload) : payload;
    const clientRequestId = idem.acquireKey({ scope, ownerKey, payload: keyPayload });

    this.setData({ submitting: true });
    try {
      if (this.data.isEdit) {
        await ui.request.put(`/admin/expenses/${this.data.expenseId}`, Object.assign({ clientRequestId }, payload), {
          silent: true
        });
      } else {
        await ui.request.post('/admin/expenses', Object.assign({ clientRequestId }, payload), { silent: true });
      }
      idem.releaseKey();
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已记录', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      // ⚠️ 失败**不释放幂等键**：用户原地重试要复用同一个键，
      //    否则失败后重试会生成新键 → 真的记两笔
      ui.showError(e, '保存失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDelete() {
    if (this.data.submitting) return;
    const ok = await ui.confirm('删除这笔支出？', '删除会同时撤销该账户的资金流水并回补余额，操作不可撤销。', '删除');
    if (!ok) return;

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({
      scope: 'DELETE_EXPENSE',
      ownerKey,
      payload: { id: this.data.expenseId }
    });

    this.setData({ submitting: true });
    try {
      // 幂等键走查询参数：DELETE 的请求体并非所有客户端都会保留（后端两种都收）
      await ui.request.del(
        `/admin/expenses/${this.data.expenseId}?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        null,
        { silent: true }
      );
      idem.releaseKey();
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      ui.showError(e, '删除失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  }
});

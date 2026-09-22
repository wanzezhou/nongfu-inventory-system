// 小程序账号管理（管理员 · 运维域 —— 不计入 17 个业务域）
// ===========================================================================
// 背景：禁用 / 改绑定 / 解绑此前只能改 SQL。服务端的每请求校验早已生效
//      （禁用即时拦住写操作、改绑定即让旧令牌失效），缺的只是这个入口。
//
// ⚠️ 三条硬边界（服务端强制，本页只是把按钮藏起来 —— 别把前端隐藏当鉴权）：
//    ① 不能操作自己（会当场失去管理权限）；
//    ② 管理员角色账号在此**只读展示**（否则「管理员令牌 → 提权成 admin」这条链成立）；
//    ③ 改绑定只能选**已启用**的主体，且不能被别的启用中账号占用。
//
// ⚠️⚠️ **禁用 ≠ 解绑**（本页最容易误操作的地方，文案必须写清）：
//    · 禁用：账号还在，该微信登不进、也改不了数据（写操作 401，读自己的历史仍可用）；
//      想恢复随时「启用」。唯一键占位同时释放 → 别人可以绑到同一主体。
//    · 解绑：**删除绑定关系**，账号不在了。用它来「换个微信继续用同一个业务员/水站」——
//      换绑后钱包余额按**主体**连续（不随微信走）。
//    ⚠️ 不能用「禁用」充当解绑：那样这个微信想重绑也永远登不进去。
//
// ⚠️ 改绑定/解绑后对方**需重新登录**（旧令牌立即失效，令牌里带着 role/target_id）。
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

const ROLE_FILTERS = [
  { value: '', label: '全部角色' },
  { value: 'salesman', label: '业务员' },
  { value: 'station', label: '直营水站' },
  { value: 'admin', label: '管理员' }
];
const STATUS_FILTERS = [
  { value: '', label: '全部状态' },
  { value: '1', label: '启用' },
  { value: '0', label: '禁用' }
];

Page({
  data: {
    roleFilters: ROLE_FILTERS,
    roleLabels: ROLE_FILTERS.map(function (r) {
      return r.label;
    }),
    roleIndex: 0,
    statusFilters: STATUS_FILTERS,
    statusLabels: STATUS_FILTERS.map(function (s) {
      return s.label;
    }),
    statusIndex: 0,
    keyword: '',
    list: [],
    total: 0,
    notice: '',
    /* 改绑：选中某个账号后展开主体选择器 */
    rebindId: 0,
    rebindName: '',
    bindOptions: [],
    bindLabels: [],
    bindIndex: 0,
    loading: false,
    busy: false,
    loadError: '',
    page: 1,
    hasMore: false
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetchOptions();
    this.fetch();
  },

  async fetchOptions() {
    try {
      const res = await ui.request.get('/admin/mini-accounts/options', null, { silent: true });
      const opts = [];
      (res.salesmanTargets || []).forEach(function (t) {
        opts.push({ role: 'salesman', targetId: t.targetId, label: '业务员 · ' + t.targetName });
      });
      (res.stationTargets || []).forEach(function (t) {
        opts.push({ role: 'station', targetId: t.targetId, label: '直营水站 · ' + t.targetName });
      });
      this.setData({
        bindOptions: opts,
        bindLabels: opts.map(function (o) {
          return o.label;
        }),
        notice: res.notice || ''
      });
    } catch (e) {
      this.setData({ loadError: e.message || '选项加载失败' });
    }
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/mini-accounts', this.query(), { silent: true });
      this.setData({
        list: res.list || [],
        total: Number(res.total) || 0,
        page: res.page || 1,
        hasMore: (res.page || 1) * (res.pageSize || 10) < (Number(res.total) || 0)
      });
    } catch (e) {
      this.setData({ loadError: e.message || '账号列表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  query() {
    const q = { page: this.data.page, pageSize: 20 };
    const role = this.data.roleFilters[this.data.roleIndex].value;
    const status = this.data.statusFilters[this.data.statusIndex].value;
    if (role) q.role = role;
    if (status !== '') q.status = status;
    const kw = String(this.data.keyword || '').trim();
    if (kw) q.keyword = kw;
    return q;
  },

  onRoleChange(e) {
    this.setData({ roleIndex: Number(e.detail.value), page: 1 });
    this.fetch();
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value), page: 1 });
    this.fetch();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.setData({ page: 1 });
    this.fetch();
  },

  onNextPage() {
    if (!this.data.hasMore) return;
    this.setData({ page: this.data.page + 1 });
    this.fetch();
  },

  onPrevPage() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.fetch();
  },

  /** 启用 / 禁用 */
  async onToggleStatus(e) {
    if (this.data.busy) return;
    const id = Number(e.currentTarget.dataset.id);
    const cur = Number(e.currentTarget.dataset.status);
    const name = e.currentTarget.dataset.name || '该账号';
    const next = cur === 1 ? 0 : 1;
    const ok = await ui.confirm(
      next === 0 ? '确认禁用？' : '确认启用？',
      next === 0
        ? name + '：该微信将**登不进**、也改不了数据（写操作立即被拒，读自己的历史仍可用）。账号还在，随时可启用。'
        : name + '：该微信可以重新登录并操作。',
      next === 0 ? '确认禁用' : '确认启用'
    );
    if (!ok) return;

    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = { id: id, status: next };
    const key = idem.acquireKey({ scope: 'UPDATE_MINI_ACCOUNT_STATUS', ownerKey: ownerKey, payload: payload });
    try {
      await ui.request.put(
        '/admin/mini-accounts/' + id + '/status',
        { clientRequestId: key, status: next },
        { silent: true }
      );
      idem.releaseKey();
      wx.showToast({ title: next === 0 ? '已禁用' : '已启用', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '状态修改失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 展开改绑主体选择器 */
  onOpenRebind(e) {
    this.setData({
      rebindId: Number(e.currentTarget.dataset.id),
      rebindName: (e.currentTarget.dataset.roleLabel || '') + ' · ' + (e.currentTarget.dataset.name || ''),
      bindIndex: 0,
      loadError: ''
    });
  },

  onCancelRebind() {
    this.setData({ rebindId: 0, rebindName: '' });
  },

  onBindChange(e) {
    this.setData({ bindIndex: Number(e.detail.value) });
  },

  /** 确认改绑（服务端会校验目标存在且启用、且未被别的启用中账号占用） */
  async onConfirmRebind() {
    if (this.data.busy) return;
    const target = this.data.bindOptions[this.data.bindIndex];
    if (!target) {
      this.setData({ loadError: '没有可绑定的主体（请先在主数据里新增启用的业务员/水站）' });
      return;
    }
    const ok = await ui.confirm(
      '确认改绑？',
      this.data.rebindName + ' → ' + target.label + '。改绑后对方**需重新登录**（旧令牌立即失效）。',
      '确认改绑'
    );
    if (!ok) return;

    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = { id: this.data.rebindId, role: target.role, targetId: target.targetId };
    const key = idem.acquireKey({ scope: 'UPDATE_MINI_ACCOUNT_BINDING', ownerKey: ownerKey, payload: payload });
    try {
      await ui.request.put(
        '/admin/mini-accounts/' + this.data.rebindId + '/binding',
        Object.assign({ clientRequestId: key }, payload),
        { silent: true }
      );
      idem.releaseKey();
      wx.showToast({ title: '已改绑', icon: 'success' });
      this.setData({ rebindId: 0, rebindName: '' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '改绑失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 解绑（删除绑定关系；同一微信可重新登录重绑） */
  async onUnbind(e) {
    if (this.data.busy) return;
    const id = Number(e.currentTarget.dataset.id);
    const name = e.currentTarget.dataset.name || '该账号';
    const ok = await ui.confirm(
      '确认解绑？',
      name +
        '：将**删除绑定关系**（不是禁用）。该微信之后可以重新登录并重绑；若只是想临时停用此人，请用「禁用」。' +
        '解绑后对方需重新登录，钱包余额按主体保留。',
      '确认解绑'
    );
    if (!ok) return;

    this.setData({ busy: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = { id: id };
    const key = idem.acquireKey({ scope: 'UNBIND_MINI_ACCOUNT', ownerKey: ownerKey, payload: payload });
    try {
      await ui.request.del('/admin/mini-accounts/' + id + '?clientRequestId=' + encodeURIComponent(key), null, {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已解绑', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '解绑失败' });
    } finally {
      this.setData({ busy: false });
    }
  }
});

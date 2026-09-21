// 主数据列表（管理员 · Phase 8b 第 4~7 域）
// ===========================================================================
// 一套页面覆盖供应商/员工/水站/机台，四个域的全部差异来自 config/masterData.js。
//
// ⚠️ 三条约定，改这页时别丢：
//   ① 切换域时**必须重置分页与列表**（否则会把上一个域的第 2 页接到新域的第 1 页后面，
//      表现为"列表里混进了别的东西"，而接口本身没有任何异常）。
//   ② 「停用」在列表里是**状态标签**而不是过滤掉的行 —— 停用的水站/供应商仍需可查可改，
//      很多业务问题的排查起点正是"某个停用的档案还有没有引用"。
//   ③ 金额/状态只展示后端返回值；本页不做任何推算。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const { ROLES } = require('../../config/index');
const { DOMAINS, DOMAIN_KEYS, optionLabel, optionsOf } = require('../../config/masterData');

const PAGE_SIZE = 15;

const STATUS_OPTIONS = [
  { key: '', label: '全部' },
  { key: '1', label: '启用' },
  { key: '0', label: '停用' }
];

/** 列表摘要：取配置里的 summaryKeys，枚举字段转文案，空值略过 */
function buildSummary(domain, row) {
  const parts = domain.summaryKeys
    .map(k => {
      if (k === 'employeeTypeLabel') return optionLabel(optionsOf('employeeType'), row.employeeType);
      if (k === 'machineTypeLabel') return optionLabel(optionsOf('machineType'), row.machineType);
      const v = row[k];
      return v === null || v === undefined || v === '' ? '' : String(v);
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

Page({
  data: {
    domains: DOMAIN_KEYS.map(k => ({ key: k, label: DOMAINS[k].label })),
    domainKey: 'supplier',
    domain: DOMAINS.supplier,
    statusOptions: STATUS_OPTIONS,
    status: '1',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: '',
    blocked: ''
  },

  onLoad(options) {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    const key = options && options.type && DOMAINS[options.type] ? options.type : 'supplier';
    const isAdmin = role === ROLES.ADMIN;
    this.setData({
      blocked: ui.blockedBanner(),
      domainKey: key,
      domain: DOMAINS[key],
      loadError: isAdmin ? '' : '当前身份不是管理员，无权管理主数据'
    });
    wx.setNavigationBarTitle({ title: `${DOMAINS[key].label}管理` });
  },

  onShow() {
    if (!this.data.loadError) this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onDomainTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.domainKey || !DOMAINS[key]) return;
    // ⚠️ 换域必须清空列表与分页（见文件头第 ① 条）
    this.setData({
      domainKey: key,
      domain: DOMAINS[key],
      keyword: '',
      list: [],
      page: 1,
      total: 0,
      hasMore: true,
      loadError: ''
    });
    wx.setNavigationBarTitle({ title: `${DOMAINS[key].label}管理` });
    this.fetch(true);
  },

  onStatusTap(e) {
    const status = e.currentTarget.dataset.key;
    if (status === this.data.status) return;
    this.setData({ status });
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
    const domain = this.data.domain;

    const query = { page, pageSize: PAGE_SIZE };
    if (this.data.status !== '') query.status = this.data.status;
    const kw = String(this.data.keyword || '').trim();
    if (kw) query.keyword = kw;

    try {
      // 路径取自配置的**字面量**（不拼接），以便静态门禁能识别（见 config/masterData.js 注释）
      const res = await ui.request.get(domain.routes.list, query, { silent: true });
      const shaped = (res.list || []).map(it => ({
        id: it.id,
        name: it[domain.nameKey] || '(未命名)',
        status: Number(it.status) === 1,
        summary: buildSummary(domain, it)
      }));
      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({
        list,
        page,
        total: res.total,
        hasMore: list.length < res.total,
        loading: false
      });
    } catch (e) {
      // 失败**不清空列表**、也不报成功（红线：失败分支不得误报成功）
      this.setData({ loading: false, loadError: e.message || `${domain.label}列表加载失败` });
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    ui.navTo(`/pages/admin-master-edit/index?type=${this.data.domainKey}&id=${id}`);
  },

  onCreate() {
    ui.navTo(`/pages/admin-master-edit/index?type=${this.data.domainKey}`);
  }
});

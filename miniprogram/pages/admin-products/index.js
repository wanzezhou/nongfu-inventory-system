// 商品管理 · 列表（管理员 · 文档 §5.3「商品」/ §43 Phase 8b 第 3 域）
// ===========================================================================
// ⚠️ 三条与安全/口径相关的约定，改这页时别丢：
//
//   ① 筛选只传后端 `buildProductListWhere` 认得的键（keyword / category / status），
//      不自己拼 SQL 语义。`status` 空串表示「不限」—— 这个细节后端已定义，
//      前端只负责别把 undefined 传成字符串 "undefined"。
//
//   ② 「业务员可售」是**两个条件的与**（§8.5）：开关开启 **且** 最低价已配置。
//      后端已下发派生字段 `salesmanReady`，本页直接用 —— 前端不重算，
//      否则两处判定分叉时会呈现出「列表说可售、下单却被拒」这种最坏组合。
//      ⚠️ `salesmanMiniEnabled=1 但最低价为空` 是**非法组合**（后端写入时已拒绝），
//         但历史数据可能有，故本页仍给它单独一档文案，不并进「可售」也不并进「未开启」。
//
//   ③ 页面里的角色判断只是体验优化；真正的边界在服务端 `requireMiniAdmin`。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 15;

const STATUS_OPTIONS = [
  { key: '', label: '全部' },
  { key: '1', label: '启用' },
  { key: '0', label: '停用' }
];

Page({
  data: {
    statusOptions: STATUS_OPTIONS,
    status: '1',
    keyword: '',
    category: '',
    categoryOptions: ['全部类别'],
    categoryIndex: 0,
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: '',
    blocked: ''
  },

  onLoad() {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    this.setData({
      blocked: ui.blockedBanner(),
      loadError: role === ROLES.ADMIN ? '' : '当前身份不是管理员，无权管理商品'
    });
    if (role === ROLES.ADMIN) this.loadCategories();
  },

  onShow() {
    // 从编辑页返回后要看到最新数据（新增/编辑/停用都会改变列表）
    if (!this.data.loadError) this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  /** 类别选项：来自后端 DISTINCT（与 Web 端同一段取数） */
  async loadCategories() {
    try {
      const res = await ui.request.get('/admin/products/options', null, { silent: true });
      const categories = (res && res.categories) || [];
      this.setData({ categoryOptions: ['全部类别'].concat(categories) });
    } catch (e) {
      // 类别拉不到不影响列表：只是筛选少一个维度，故不打断页面
    }
  },

  onStatusTap(e) {
    const status = e.currentTarget.dataset.key;
    if (status === this.data.status) return;
    this.setData({ status });
    this.reload();
  },

  onCategoryChange(e) {
    const idx = Number(e.detail.value);
    const category = idx === 0 ? '' : this.data.categoryOptions[idx];
    this.setData({ category, categoryIndex: idx });
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

    const query = { page, pageSize: PAGE_SIZE };
    if (this.data.status !== '') query.status = this.data.status;
    if (this.data.category) query.category = this.data.category;
    const kw = String(this.data.keyword || '').trim();
    if (kw) query.keyword = kw;

    try {
      const res = await ui.request.get('/admin/products', query, { silent: true });
      const shaped = (res.list || []).map(it => {
        const enabled = Number(it.salesmanMiniEnabled) === 1;
        const hasMin = it.salesmanMinPrice !== null && it.salesmanMinPrice !== undefined;
        // 三档互斥文案：可售 / 开了但没配价（历史脏数据）/ 未开启
        let salesmanTag = '业务员不可售';
        let tagClass = 'pr-tag-off';
        if (it.salesmanReady) {
          salesmanTag = `业务员可售（最低 ¥${fmt.money(it.salesmanMinPrice)}）`;
          tagClass = 'pr-tag-ok';
        } else if (enabled && !hasMin) {
          salesmanTag = '已开启但未配最低价 → 实际不可售';
          tagClass = 'pr-tag-warn';
        }
        return {
          productId: it.productId,
          productName: it.productName,
          productCode: it.productCode,
          specText: [it.specification, it.unit].filter(Boolean).join(' · ') || '未填规格',
          retailPriceText: fmt.money(it.retailPrice),
          imageFull: fmt.imageUrl(it.imageUrl),
          initial: fmt.productInitial(it.productName),
          status: Number(it.status),
          salesmanTag,
          tagClass
        };
      });
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
      this.setData({ loading: false, loadError: e.message || '商品列表加载失败' });
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    ui.navTo(`/pages/admin-product-edit/index?id=${id}`);
  },

  onCreate() {
    ui.navTo('/pages/admin-product-edit/index');
  }
});

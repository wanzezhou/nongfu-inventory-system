// 库存列表（管理员 · 文档 §5.3「库存」/ §43 Phase 8b 第 8 域）
// ===========================================================================
// ⚠️ 三条别丢的约定：
//
//   ① 库存价值合计由**服务端**按 Σ max(库存,0) × 进货价 全量计算（不受分页影响），
//      前端只展示。翻页时若前端自己累加，合计会随翻页变小 —— 且看起来"正常"。
//
//   ② 排序字段必须是后端 `INVENTORY_SORT_FIELDS` 白名单里的值（quantity / product_name）。
//      传白名单外的值不会报错，后端会**静默回退**成按数量排序 —— 表现为「点了按名称排，
//      顺序没变」，很容易被当成前端 bug 去查。所以本页只提供白名单内的两档。
//
//   ③ 角色判断只是体验优化；真正的边界是服务端 `requireMiniAdmin`。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 15;

/** 展示提示阈值（与仪表盘「库存预警」同口径的显示值，**不是**业务规则，不拦截操作） */
const LOW_STOCK_HINT = 10;

/** 排序档位：字段名取自后端 INVENTORY_SORT_FIELDS 白名单 */
const SORTS = [
  { key: 'quantity', order: 'desc', label: '库存量' },
  { key: 'product_name', order: 'asc', label: '商品名' }
];

Page({
  data: {
    sorts: SORTS,
    sortKey: 'quantity',
    sortOrder: 'desc',
    lowStockHint: LOW_STOCK_HINT,
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    totalValueText: '0.00',
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
      loadError: role === ROLES.ADMIN ? '' : '当前身份不是管理员，无权查看库存'
    });
  },

  onShow() {
    // 入库/出库后返回要看到最新库存
    if (this.data.loadError) {
      const me = auth.me();
      const role = me && me.account ? me.account.role : '';
      if (role !== ROLES.ADMIN) return;
      this.setData({ loadError: '' });
    }
    this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onSortTap(e) {
    const { sort, order } = e.currentTarget.dataset;
    if (sort === this.data.sortKey && order === this.data.sortOrder) return;
    this.setData({ sortKey: sort, sortOrder: order });
    this.reload();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  async reload() {
    this.setData({ page: 1, list: [], hasMore: true });
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page + 1;

    const query = {
      page,
      pageSize: PAGE_SIZE,
      sortBy: this.data.sortKey,
      sortOrder: this.data.sortOrder
    };
    const kw = String(this.data.keyword || '').trim();
    if (kw) query.keyword = kw;

    try {
      const res = await ui.request.get('/admin/inventory', query, { silent: true });
      const shaped = (res.list || []).map(it => ({
        id: it.id,
        name: it.name,
        code: it.code,
        spec: it.spec,
        unit: it.unit || '',
        stock: Number(it.stock) || 0,
        purchasePriceText: fmt.money(it.purchasePrice),
        lastInText: it.lastStockInTime ? fmt.dateOnly(it.lastStockInTime) : '—'
      }));
      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({
        list,
        page,
        total: res.total,
        totalValueText: fmt.money(res.totalValue),
        hasMore: list.length < res.total,
        loading: false,
        loadError: ''
      });
    } catch (e) {
      // 失败**不清空列表**、也不报成功（红线：失败分支不得误报成功）
      this.setData({ loading: false, loadError: e.message || '库存加载失败' });
    }
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    ui.navTo(`/pages/admin-inventory-out/index?productId=${id}`);
  },

  onStockIn() {
    ui.navTo('/pages/admin-inventory-in/index');
  },

  onStockOut() {
    ui.navTo('/pages/admin-inventory-out/index');
  }
});

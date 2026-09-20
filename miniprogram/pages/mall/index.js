// 商城（文档 §5.1「商城」/ §5.2「订货商城」/ §35 商品可售状态按渠道区分）
// ===========================================================================
// ⚠️ 商品列表**必须分页拉取**，不得用「一个很大的 pageSize」把全量拉回来：
//    仓库红线 R5 记录过一次真实事故 —— 用 pageSize:100 拉商品下拉，
//    而库里商品有 159 个 → 静默少了 59 个（用户看到的是「选不到那个商品」）。
//    下拉类全量数据走专用接口（这里是 /products/categories），列表走真分页。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const cart = require('../../utils/cart');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 10;

Page({
  data: {
    role: '',
    keyword: '',
    category: '',
    categories: [],
    list: [],
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: ''
  },

  onShow() {
    ui.syncTabBar(this, '/pages/mall/index');
    const me = auth.me();
    if (me && me.account) {
      cart.setOwner(`${me.account.role}:${me.account.targetId}`);
      if (this.data.role !== me.account.role) {
        this.setData({ role: me.account.role });
      }
    }
    // 首次进入才加载，回来时不重复刷（避免来回切 tab 反复请求）
    if (!this.data.list.length) {
      this.loadCategories();
      this.reload();
    }
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadMore();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.reload();
  },

  onCategoryTap(e) {
    const value = e.currentTarget.dataset.value || '';
    // 再次点击同一分类 = 取消筛选
    this.setData({ category: this.data.category === value ? '' : value });
    this.reload();
  },

  async loadCategories() {
    try {
      const res = await ui.request.get('/products/categories', null, { silent: true });
      this.setData({ categories: res.list || [] });
    } catch (e) {
      // 分类失败不阻断商品列表（分类只是筛选增强）
      console.warn('[mall] 分类加载失败：', e.message);
    }
  },

  async reload() {
    this.setData({ page: 1, list: [], hasMore: true, loadError: '' });
    return this.fetch(true);
  },

  loadMore() {
    return this.fetch(false);
  },

  async fetch(reset) {
    if (this.data.loading) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page + 1;
    try {
      const res = await ui.request.get(
        '/products',
        {
          keyword: this.data.keyword,
          category: this.data.category,
          page,
          pageSize: PAGE_SIZE
        },
        { silent: true }
      );

      const shaped = (res.list || []).map(p => this.shapeProduct(p));
      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({
        list,
        page,
        total: res.total,
        hasMore: list.length < res.total,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '商品加载失败' });
    }
  },

  /** 商品视图整形（只补展示字段；价格一律用服务端值） */
  shapeProduct(p) {
    return Object.assign({}, p, {
      imageFull: fmt.imageUrl(p.imageUrl),
      initial: fmt.productInitial(p.productName),
      // 角色相关的价格行：业务员看「参考零售价 + 最低成交价」，水站看「分销价」
      priceText:
        this.data.role === ROLES.STATION
          ? `¥${fmt.money(p.wholesalePrice)}`
          : p.retailPrice > 0
            ? `¥${fmt.money(p.retailPrice)}`
            : '待定',
      priceLabel: this.data.role === ROLES.STATION ? '分销价' : '参考零售价',
      minPriceText:
        this.data.role === ROLES.SALESMAN && p.salesmanMinPrice !== null && p.salesmanMinPrice !== undefined
          ? `最低成交价 ¥${fmt.money(p.salesmanMinPrice)}`
          : ''
    });
  },

  goDetail(e) {
    ui.navTo(`/pages/product-detail/index?id=${e.currentTarget.dataset.id}`);
  },

  /** 列表页快速加购（默认 1 件；价格在确认订单页由服务端重算） */
  addToCart(e) {
    const id = e.currentTarget.dataset.id;
    if (auth.isBlocked()) {
      ui.showError({ message: ui.blockedBanner() });
      return;
    }
    if (!auth.permissions().canOrder) {
      ui.showError({ message: '当前身份不能下单' });
      return;
    }
    cart.add(id, 1);
    wx.showToast({ title: '已加入购物车', icon: 'success' });
  },

  goCart() {
    wx.switchTab({ url: '/pages/cart/index' });
  }
});

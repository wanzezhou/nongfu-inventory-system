// 商品详情（文档 §29 商品页 / §30 水票页）
// ===========================================================================
// ⚠️ 直营水站的「可用水票数」来自服务端（product.availableTicketQty），
//    前端**不自己数水票**：水票是资金凭证，前端算一次、后端算一次必然分叉。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const cart = require('../../utils/cart');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

Page({
  data: {
    id: '',
    role: '',
    product: null,
    quantity: 1,
    loading: true,
    loadError: '',
    cartCount: 0
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    const me = auth.me();
    if (me && me.account) {
      cart.setOwner(`${me.account.role}:${me.account.targetId}`);
      this.setData({ role: me.account.role });
    }
    this.setData({ cartCount: cart.summary().count });
    this.load();
  },

  async load() {
    if (!this.data.id) {
      this.setData({ loading: false, loadError: '缺少商品参数' });
      return;
    }
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true, loadError: '' });
    try {
      const p = await ui.request.get(`/products/${this.data.id}`, null, { silent: true });
      const role = me.account.role;
      this.setData({
        product: Object.assign({}, p, {
          imageFull: fmt.imageUrl(p.imageUrl),
          initial: fmt.productInitial(p.productName),
          priceText:
            role === ROLES.STATION
              ? `¥${fmt.money(p.wholesalePrice)}`
              : p.retailPrice > 0
                ? `¥${fmt.money(p.retailPrice)}`
                : '待定',
          priceLabel: role === ROLES.STATION ? '分销价' : '参考零售价'
        }),
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '商品加载失败' });
    }
  },

  onQtyChange(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    const next = Math.max(1, this.data.quantity + delta);
    this.setData({ quantity: next });
  },

  onQtyInput(e) {
    const v = parseInt(e.detail.value, 10);
    this.setData({ quantity: isNaN(v) || v < 1 ? 1 : v });
  },

  /** 加入购物车（只记数量与商品，不记价格 —— 价格由服务端在下单时重算） */
  addToCart() {
    if (!this.guard()) return;
    cart.add(this.data.id, this.data.quantity);
    this.setData({ cartCount: cart.summary().count });
    wx.showToast({ title: '已加入购物车', icon: 'success' });
  },

  goCart() {
    wx.switchTab({ url: '/pages/cart/index' });
  },

  /** 写操作前的统一守卫：禁用 / 无权限一律拦在前端，避免用户白填一通 */
  guard() {
    if (auth.isBlocked()) {
      ui.showError({ message: ui.blockedBanner() });
      return false;
    }
    if (!auth.permissions().canOrder) {
      ui.showError({ message: '当前身份不能下单' });
      return false;
    }
    return true;
  }
});

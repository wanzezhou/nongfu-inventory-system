// 购物车（文档 §5.1/§5.2「购物车」+ §9.2 水票抵扣选择）
// ===========================================================================
// ⚠️ 本地购物车只存 productId / quantity / 水票选择（见 utils/cart.js 的说明），
//    价格、规格、图片都从这里**实时向后端取**，保证用户看到的是最新档案值。
//    若本地缓存价格，会出现「加购时 18、下单时档案已改 20，用户看到的还是 18」。
//
//    ⚠️ 购物车里的合计**只是预览**，且仅由服务端返回的单价 × 数量得出；
//       最终金额与积分一律以下单接口返回为准（§22.1 / §22.6）。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const cart = require('../../utils/cart');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

Page({
  data: {
    role: '',
    items: [],
    totalKinds: 0,
    totalQty: 0,
    /** 仅供预览的合计，最终以服务端为准 */
    previewAmount: '0.00',
    loading: true,
    blocked: '',
    canOrder: false
  },

  onShow() {
    ui.syncTabBar(this, '/pages/cart/index');
    this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    const me = await ui.pageReady(this);
    if (!me || !me.account) {
      this.setData({ loading: false });
      return;
    }
    const role = me.account.role;
    cart.setOwner(`${role}:${me.account.targetId}`);

    const local = cart.items();
    this.setData({
      role,
      roleLabel: me.account.role,
      blocked: ui.blockedBanner(),
      canOrder: auth.permissions().canOrder && !auth.isBlocked()
    });

    if (!local.length) {
      this.setData({ items: [], totalKinds: 0, totalQty: 0, previewAmount: '0.00', loading: false });
      return;
    }

    // 逐个取商品档案（购物车天然很小；不引入「批量按 id 列表查询」的新接口，
    // 避免为一个小场景扩一套后端接口面）
    const detailList = await Promise.all(
      local.map(async it => {
        try {
          const p = await ui.request.get(`/products/${it.productId}`, null, { silent: true });
          return { local: it, product: p, failed: false };
        } catch (e) {
          // ⚠️ 商品已下架/不可售：**明确标出来**并让用户移除，不静默丢弃（红线 R1 的对偶：
          //    也不能静默“假装它还在”）。
          return { local: it, product: null, failed: true, message: e.message };
        }
      })
    );

    let preview = 0;
    let totalQty = 0;
    const items = detailList.map(({ local: it, product: p, failed, message }) => {
      totalQty += Number(it.quantity) || 0;
      if (failed || !p) {
        return {
          productId: it.productId,
          failed: true,
          message: message || '商品已不可购买',
          quantity: it.quantity,
          name: '商品已下架',
          spec: '—'
        };
      }
      const unitPrice = role === ROLES.STATION ? Number(p.wholesalePrice) : Number(p.retailPrice);
      const ticketQty = Number(it.ticketQty) || 0;
      // 预览口径与服务端一致：水票抵扣件数不计金额（§9.3）
      const billableQty = role === ROLES.STATION && it.useTicket ? Math.max(0, it.quantity - ticketQty) : it.quantity;
      preview += unitPrice * billableQty;
      return {
        productId: it.productId,
        failed: false,
        name: p.productName,
        spec: `${p.specification || '—'} · ${p.unit || '件'}`,
        imageFull: fmt.imageUrl(p.imageUrl),
        initial: fmt.productInitial(p.productName),
        quantity: it.quantity,
        unitPrice,
        unitPriceText: fmt.money(unitPrice),
        lineAmountText: fmt.money(unitPrice * billableQty),
        useTicket: !!it.useTicket,
        ticketQty,
        availableTicketQty: Number(p.availableTicketQty) || 0,
        billableQty
      };
    });

    this.setData({
      items,
      totalKinds: items.length,
      totalQty,
      previewAmount: fmt.money(preview),
      loading: false
    });
  },

  onQtyChange(e) {
    const { id, delta } = e.currentTarget.dataset;
    const item = this.data.items.find(i => i.productId === id);
    if (!item) return;
    const next = Math.max(1, Number(item.quantity) + Number(delta));
    cart.setQuantity(id, next);
    this.load();
  },

  onQtyInput(e) {
    const id = e.currentTarget.dataset.id;
    const v = parseInt(e.detail.value, 10);
    cart.setQuantity(id, isNaN(v) || v < 1 ? 1 : v);
    this.load();
  },

  async onRemove(e) {
    const id = e.currentTarget.dataset.id;
    const ok = await ui.confirm('移除商品', '确定从购物车移除该商品？', '移除');
    if (!ok) return;
    cart.remove(id);
    this.load();
  },

  async onClear() {
    const ok = await ui.confirm('清空购物车', '确定清空购物车中的全部商品？', '清空');
    if (!ok) return;
    cart.clear();
    this.load();
  },

  /** 水票抵扣开关（仅直营水站） */
  onToggleTicket(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find(i => i.productId === id);
    if (!item) return;
    if (!item.availableTicketQty) {
      ui.showError({ message: '该商品暂无可用水票' });
      return;
    }
    const use = !item.useTicket;
    // 默认抵扣「可用水票数」与「购买数量」的较小值（不超数量是服务端硬约束）
    const qty = Math.min(item.availableTicketQty, item.quantity);
    cart.setTicket(id, use, use ? qty : 0);
    this.load();
  },

  onTicketQtyInput(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find(i => i.productId === id);
    if (!item) return;
    const v = parseInt(e.detail.value, 10);
    cart.setTicket(id, true, isNaN(v) ? 0 : v);
    this.load();
  },

  goCheckout() {
    const usable = this.data.items.filter(i => !i.failed);
    if (!usable.length) {
      ui.showError({ message: '购物车中没有可购买的商品' });
      return;
    }
    if (!this.data.canOrder) {
      ui.showError({ message: ui.blockedBanner() || '当前身份不能下单' });
      return;
    }
    ui.navTo('/pages/order-confirm/index');
  },

  goMall() {
    wx.switchTab({ url: '/pages/mall/index' });
  }
});

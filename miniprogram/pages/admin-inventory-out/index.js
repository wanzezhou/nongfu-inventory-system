// 出库（管理员 · 文档 §5.3「库存」/ §43 Phase 8b 第 8 域）
// ===========================================================================
// ⚠️ 出库是全批次里**唯一不动资金**的库存写操作：只减库存 + 写出库台账。
//    因此本页没有「付款账户」这一项 —— 不是漏了，出库本来就不产生收付款。
//    （收款/付款发生在订单域；出库只是货的移动。）
//
// ⚠️ 出库类型 3（其他）允许扣成负数。这是既有语义（盘库调整），
//    服务端 `applyStockOut` 显式放行 type=3，不要在前端"好心"拦住。
//    type 的取值以 `stock_out_records.out_type` 的**列注释**为准（1/2/3），
//    不要照抄某个前端对话框里的文案。
//
// ⚠️ 从列表页点某个商品进来时会带 ?productId=，本页据此预选商品（少一次翻找）；
//    但**不预填数量** —— 数量是每次都要现场确认的数字。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');
const { ROLES } = require('../../config/index');

Page({
  data: {
    blocked: '',
    loading: true,
    loadError: '',
    products: [],
    productLabels: [],
    productIndex: -1,
    selectedProduct: null,
    outTypes: [],
    outTypeLabels: [],
    outTypeIndex: 0,
    outType: 1,
    quantity: '',
    remark: '',
    afterStockText: '—',
    canSubmit: false,
    submitting: false,
    formError: ''
  },

  onLoad(query) {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    if (role !== ROLES.ADMIN) {
      this.setData({
        loading: false,
        blocked: ui.blockedBanner(),
        loadError: '当前身份不是管理员，无权出库'
      });
      return;
    }
    this.setData({ blocked: ui.blockedBanner() });
    this.pendingProductId = (query && query.productId) || '';
    this.loadOptions();
  },

  async loadOptions() {
    const me = await ui.pageReady(this);
    if (!me) return;
    try {
      const res = await ui.request.get('/admin/inventory/options', null, { silent: true });
      const products = res.products || [];
      const outTypes = res.outTypes || [];

      // 从列表页带过来的商品直接预选
      let productIndex = -1;
      if (this.pendingProductId) {
        productIndex = products.findIndex(p => p.productId === this.pendingProductId);
      }

      this.setData({
        loading: false,
        products,
        productLabels: products.map(p => `${p.productName}${p.productCode ? '（' + p.productCode + '）' : ''}`),
        productIndex,
        selectedProduct: productIndex >= 0 ? products[productIndex] : null,
        outTypes,
        outTypeLabels: outTypes.map(t => t.label),
        outType: outTypes.length ? outTypes[0].value : 1,
        loadError: ''
      });
      this.recalc();
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '加载表单选项失败' });
    }
  },

  onProductChange(e) {
    const idx = Number(e.detail.value);
    this.setData({
      productIndex: idx,
      selectedProduct: this.data.products[idx] || null
    });
    this.recalc();
  },

  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value });
    this.recalc();
  },

  onOutTypeChange(e) {
    const idx = Number(e.detail.value) || 0;
    const t = this.data.outTypes[idx];
    this.setData({ outTypeIndex: idx, outType: t ? t.value : 1 });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  /** 重算「出库后预计库存」与按钮可用性（纯展示层） */
  recalc() {
    const qty = Number(this.data.quantity) || 0;
    const p = this.data.selectedProduct;
    this.setData({
      afterStockText: p ? `${p.stock - qty}${p.unit}` : '—',
      canSubmit: this.data.productIndex >= 0 && qty > 0
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    const p = this.data.products[this.data.productIndex];
    if (!p) {
      this.setData({ formError: '请选择商品' });
      return;
    }
    const qty = Number(this.data.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      this.setData({ formError: '出库数量必须是正整数' });
      return;
    }
    // 非「其他」类型时不允超过现有库存：服务端也会拦，这里只是提前告知
    if (this.data.outType !== 3 && qty > p.stock) {
      this.setData({
        formError: `库存不足：当前 ${p.stock}${p.unit}，本次要出 ${qty}${p.unit}（「其他」类型才允许扣成负数）`
      });
      return;
    }

    const remark = String(this.data.remark || '').trim();
    const payload = { productId: p.productId, quantity: qty, outType: this.data.outType };
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({ scope: 'STOCK_OUT', ownerKey, payload });

    this.setData({ submitting: true, formError: '' });
    try {
      const res = await ui.request.post(
        '/admin/inventory/out',
        Object.assign({ clientRequestId, remark: remark || undefined }, payload),
        { silent: true }
      );
      idem.releaseKey();
      await ui.confirm(
        res.replayed ? '该出库单已创建' : '出库成功',
        `出库单号 ${res.recordId}\n${p.productName} 出库 ${qty}${p.unit}\n出库后库存 ${res.stockAfter}${p.unit}`,
        '知道了'
      );
      ui.navTo('/pages/admin-inventory/index');
    } catch (e) {
      // 失败**不释放幂等键**：重试复用同一个键，服务端合并成一次
      this.setData({ submitting: false, formError: e.message || '出库失败' });
    }
  }
});

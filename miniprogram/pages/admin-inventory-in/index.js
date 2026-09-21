// 入库（管理员 · 文档 §5.3「库存」/ §43 Phase 8b 第 8 域）
// ===========================================================================
// ⚠️ 本页最要紧的一条：**付款账户必选**。
//    入库是「库存 + 进货记录 + 账户扣款 + 资金流水」四合一事务，
//    不存在「货到了但没记账」的中间态 —— 所以前端也不给这个选项。
//
// ⚠️ 「预计扣款」是**提示值**：前端按 单价×数量 算，只为了让用户点提交前心里有数。
//    最终金额一律由服务端在事务内重算并落流水（唯一安全边界）。所以：
//      · 前端算错了不会导致账错（服务端会覆盖）；
//      · 但**不能**拿它当校验依据去拦截（那是把提示当成规则）。
//
// ⚠️ 幂等键在「用户点提交那一刻」生成并持久化；失败**不释放**，以便用户重试时复用同一个键
//    （弱网重试若生成新键，就会真的入库两次、扣两次款，且两笔都合法）。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');
const { ROLES } = require('../../config/index');

const SUPPLIER_NONE = '不指定';

Page({
  data: {
    blocked: '',
    loading: true,
    loadError: '',
    products: [],
    productLabels: [],
    productIndex: -1,
    selectedProduct: null,
    suppliers: [],
    supplierLabels: [SUPPLIER_NONE],
    supplierIndex: 0,
    accounts: [],
    accountLabels: [],
    accountIndex: -1,
    quantity: '',
    unitPrice: '',
    remark: '',
    previewText: '0.00',
    selectedAccountBalanceText: '0.00',
    canSubmit: false,
    submitting: false,
    formError: ''
  },

  onLoad() {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    if (role !== ROLES.ADMIN) {
      this.setData({
        loading: false,
        blocked: ui.blockedBanner(),
        loadError: '当前身份不是管理员，无权入库'
      });
      return;
    }
    this.setData({ blocked: ui.blockedBanner() });
    this.loadOptions();
  },

  async loadOptions() {
    const me = await ui.pageReady(this);
    if (!me) return;
    try {
      const res = await ui.request.get('/admin/inventory/options', null, { silent: true });
      const products = res.products || [];
      const suppliers = res.suppliers || [];
      const accounts = res.accounts || [];

      this.setData({
        loading: false,
        products,
        productLabels: products.map(p => `${p.productName}${p.productCode ? '（' + p.productCode + '）' : ''}`),
        suppliers,
        supplierLabels: [SUPPLIER_NONE].concat(suppliers.map(s => s.supplierName)),
        accounts,
        accountLabels: accounts.map(a => `${a.accountName}（余额 ¥${fmt.money(a.currentBalance)}）`),
        loadError: ''
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '加载表单选项失败' });
    }
  },

  onProductChange(e) {
    const idx = Number(e.detail.value);
    const p = this.data.products[idx] || null;
    const patch = { productIndex: idx, selectedProduct: p };
    // 换商品时把单价重置为该商品的**进货价**（历史价只作参考，不静默沿用上一件商品的价格）
    if (p) patch.unitPrice = String(p.purchasePrice || '');
    this.setData(patch);
    this.recalc();
  },

  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value });
    this.recalc();
  },

  onPriceInput(e) {
    this.setData({ unitPrice: e.detail.value });
    this.recalc();
  },

  onSupplierChange(e) {
    this.setData({ supplierIndex: Number(e.detail.value) || 0 });
  },

  onAccountChange(e) {
    this.setData({ accountIndex: Number(e.detail.value) });
    this.recalc();
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  /** 重算「预计扣款」与按钮可用性（纯展示层，不影响服务端判定） */
  recalc() {
    const qty = Number(this.data.quantity) || 0;
    const price = Number(this.data.unitPrice) || 0;
    const acc = this.data.accounts[this.data.accountIndex];
    const preview = Math.round(price * qty * 100) / 100;
    this.setData({
      previewText: fmt.money(preview),
      selectedAccountBalanceText: acc ? fmt.money(acc.currentBalance) : '0.00',
      canSubmit: this.data.productIndex >= 0 && qty > 0 && this.data.accountIndex >= 0
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
      this.setData({ formError: '入库数量必须是正整数' });
      return;
    }
    if (this.data.accountIndex < 0) {
      this.setData({ formError: '请选择付款账户（入库与扣款在同一事务，不能空）' });
      return;
    }

    const supplier = this.data.supplierIndex > 0 ? this.data.suppliers[this.data.supplierIndex - 1] : null;
    const account = this.data.accounts[this.data.accountIndex];
    const unitPrice = Number(this.data.unitPrice) || 0;
    const remark = String(this.data.remark || '').trim();

    const payload = {
      productId: p.productId,
      quantity: qty,
      unitPrice,
      supplierId: supplier ? supplier.supplierId : null,
      accountId: account.accountId
    };
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({ scope: 'STOCK_IN', ownerKey, payload });

    this.setData({ submitting: true, formError: '' });
    try {
      const res = await ui.request.post(
        '/admin/inventory/in',
        Object.assign({ clientRequestId, remark: remark || undefined }, payload),
        { silent: true }
      );
      idem.releaseKey();
      await ui.confirm(
        res.replayed ? '该入库单已创建' : '入库成功',
        `入库单号 ${res.purchaseId}\n实付 ¥${fmt.money(res.paidAmount)}（${res.accountName}）\n扣款后余额 ¥${fmt.money(res.balanceAfter)}`,
        '知道了'
      );
      ui.navTo('/pages/admin-inventory/index');
    } catch (e) {
      // 失败**不释放幂等键**：用户直接重试时复用同一个键，服务端会合并成一次
      this.setData({ submitting: false, formError: e.message || '入库失败' });
    }
  }
});

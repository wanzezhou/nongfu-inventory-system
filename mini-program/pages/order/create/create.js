const request = require('../../../utils/request.js');
const auth = require('../../../utils/auth.js');
const fmt = require('../../../utils/format.js');

const ORDER_TYPE_LABELS = {
  1: '线上平台销售', 2: '线下水站分销', 3: '线下零售', 4: '零售机供货', 5: '线下水站返货'
};

// 各订单类型的可选配送方式
const DELIVERY_TYPES = {
  1: [{ value: 1, label: '自有员工配送' }],
  2: [{ value: 2, label: '水站配送' }],
  3: [{ value: 1, label: '自有员工配送' }, { value: 3, label: '无需配送' }],
  4: [{ value: 2, label: '零售机配送' }],
  5: [{ value: 2, label: '水站配送' }]
};

Page({
  data: {
    role: '',
    orderTypes: [],
    orderType: 0,
    orderTypeIndex: -1,
    typeLabel: '',

    showStation: false,
    stations: [],
    stationIndex: -1,
    stationId: '',

    customerName: '',
    customerPhone: '',
    customerAddress: '',

    showPicker: false,
    orderItems: [],
    goodsAmount: '0.00',
    deliveryFee: '0.00',
    totalAmount: '0.00',

    remark: '',

    deliveryTypes: [],
    deliveryType: 0,
    deliveryTypeIndex: -1,
    deliveryLabel: '',
    needWorker: false,
    workers: [],
    workerIndex: -1,
    workerId: '',

    submitting: false
  },

  onLoad(options) {
    const role = auth.getRole() || 'admin';
    const allowed = fmt.allowedOrderTypes(role);
    const orderTypes = allowed.map(v => ({ value: v, label: ORDER_TYPE_LABELS[v] }));
    this.setData({ role, orderTypes });
    if (options.orderType && allowed.indexOf(Number(options.orderType)) > -1) {
      this._setOrderType(Number(options.orderType));
    }
    this._loadStations();
    this._loadWorkers();
  },

  _loadStations() {
    request.get('/mini/orders/stations')
      .then(list => this.setData({ stations: list || [] }))
      .catch(() => {});
  },

  _loadWorkers() {
    request.get('/mini/orders/workers')
      .then(list => this.setData({ workers: list || [] }))
      .catch(() => {});
  },

  onOrderTypeChange(e) {
    const idx = Number(e.detail.value);
    const ot = this.data.orderTypes[idx];
    if (ot) this._setOrderType(ot.value);
  },

  _setOrderType(ot) {
    const deliveryTypes = DELIVERY_TYPES[ot] || [];
    const typeIndex = this.data.orderTypes.findIndex(t => t.value === ot);
    this.setData({
      orderType: ot,
      orderTypeIndex: typeIndex,
      typeLabel: ORDER_TYPE_LABELS[ot] || '',
      deliveryTypes,
      deliveryType: 0,
      deliveryTypeIndex: -1,
      deliveryLabel: '',
      needWorker: false,
      showStation: ot === 2 || ot === 5,
      stationId: '',
      stationIndex: -1,
      workerId: '',
      workerIndex: -1,
      orderItems: [],
      goodsAmount: '0.00',
      deliveryFee: '0.00',
      totalAmount: '0.00'
    }, () => {
      if (deliveryTypes.length > 0) this._setDeliveryType(deliveryTypes[0].value);
      this._calcAmounts();
    });
  },

  onDeliveryTypeChange(e) {
    const item = this.data.deliveryTypes[Number(e.detail.value)];
    if (item) this._setDeliveryType(item.value);
  },

  _setDeliveryType(val) {
    const types = this.data.deliveryTypes;
    const idx = types.findIndex(t => t.value === val);
    this.setData({
      deliveryType: val,
      deliveryTypeIndex: idx,
      deliveryLabel: idx > -1 ? types[idx].label : '',
      needWorker: val !== 3,
      workerId: val === 3 ? '' : this.data.workerId,
      workerIndex: val === 3 ? -1 : this.data.workerIndex
    }, () => this._calcAmounts());
  },

  onStationChange(e) {
    const idx = Number(e.detail.value);
    const s = this.data.stations[idx];
    if (!s) return;
    this.setData({
      stationIndex: idx,
      stationId: String(s.id),
      customerName: s.contact || s.name,
      customerPhone: s.phone || '',
      customerAddress: s.address || ''
    });
  },

  onWorkerChange(e) {
    const idx = Number(e.detail.value);
    const w = this.data.workers[idx];
    if (!w) return;
    this.setData({ workerIndex: idx, workerId: String(w.id) });
  },

  onCustomerName(e) { this.setData({ customerName: e.detail.value }); },
  onCustomerPhone(e) { this.setData({ customerPhone: e.detail.value }); },
  onCustomerAddress(e) { this.setData({ customerAddress: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  openPicker() {
    if (!this.data.orderType) {
      wx.showToast({ title: '请先选择订单类型', icon: 'none' });
      return;
    }
    this.setData({ showPicker: true });
  },

  closePicker() {
    this.setData({ showPicker: false });
  },

  onPickerConfirm(e) {
    const items = e.detail.items || [];
    this.setData({ orderItems: items, showPicker: false }, () => this._calcAmounts());
  },

  removeItem(e) {
    const idx = e.currentTarget.dataset.index;
    const orderItems = this.data.orderItems.slice();
    orderItems.splice(idx, 1);
    this.setData({ orderItems }, () => this._calcAmounts());
  },

  _feeField(ot) {
    switch (ot) {
      case 1: return 'workerRetailDeliveryFee';
      case 2: return 'workerWholesaleDeliveryFee';
      case 3: return 'workerRetailDeliveryFee';
      case 4: return 'workerMachineDeliveryFee';
      case 5: return 'workerWholesaleDeliveryFee';
      default: return '';
    }
  },

  _calcAmounts() {
    const ot = Number(this.data.orderType);
    const dt = Number(this.data.deliveryType);
    let goods = 0;
    let fee = 0;
    this.data.orderItems.forEach((it) => {
      goods += (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
      // 线下零售且无需配送：配送费为 0
      if (ot === 3 && dt === 3) return;
      const field = this._feeField(ot);
      if (field) fee += (Number(it[field]) || 0) * (Number(it.qty) || 0);
    });
    this.setData({
      goodsAmount: fmt.formatAmount(goods),
      deliveryFee: fmt.formatAmount(fee),
      totalAmount: fmt.formatAmount(goods + fee)
    });
  },

  submit() {
    if (this.data.submitting) return;
    const ot = Number(this.data.orderType);
    if (!ot) { wx.showToast({ title: '请选择订单类型', icon: 'none' }); return; }
    if (!this.data.customerName.trim()) { wx.showToast({ title: '请输入客户名称', icon: 'none' }); return; }
    if (ot !== 4 && !this.data.customerPhone.trim()) { wx.showToast({ title: '请输入联系电话', icon: 'none' }); return; }
    if ((ot === 2 || ot === 5) && !this.data.stationId) { wx.showToast({ title: '请选择水站', icon: 'none' }); return; }
    if (this.data.orderItems.length === 0) { wx.showToast({ title: '请选择商品', icon: 'none' }); return; }
    if (this.data.deliveryType !== 3 && !this.data.workerId) { wx.showToast({ title: '请选择配送员工', icon: 'none' }); return; }

    const payload = {
      orderType: ot,
      customerName: this.data.customerName.trim(),
      customerPhone: this.data.customerPhone.trim(),
      customerAddress: this.data.customerAddress.trim(),
      stationId: this.data.stationId || null,
      workerId: this.data.workerId || null,
      deliveryType: Number(this.data.deliveryType),
      remark: this.data.remark.trim(),
      items: this.data.orderItems.map(it => ({
        productId: it.productId,
        quantity: Number(it.qty),
        unitPrice: Number(it.unitPrice)
      }))
    };

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    request.post('/mini/orders', payload)
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});

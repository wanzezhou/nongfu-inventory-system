const request = require('../../utils/request.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    stations: [],
    stationIndex: -1,
    stationId: '',
    barrelType: '',
    quantity: '',
    unitPrice: '',
    depositTypes: [
      { value: 'collect', label: '收取押金' },
      { value: 'return', label: '退回押金' }
    ],
    depositTypeIndex: 0,
    depositType: 'collect',
    depositTypeLabel: '收取押金',
    remark: '',
    totalAmount: '0.00',
    submitting: false
  },

  onLoad() {
    this._loadStations();
  },

  _loadStations() {
    request.get('/mini/orders/stations')
      .then(list => this.setData({ stations: list || [] }))
      .catch(() => {});
  },

  onStationChange(e) {
    const idx = Number(e.detail.value);
    const s = this.data.stations[idx];
    if (!s) return;
    this.setData({ stationIndex: idx, stationId: String(s.id) });
  },

  onBarrelType(e) { this.setData({ barrelType: e.detail.value }); },
  onQuantity(e) { this.setData({ quantity: e.detail.value }, () => this._calcTotal()); },
  onUnitPrice(e) { this.setData({ unitPrice: e.detail.value }, () => this._calcTotal()); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  onDepositTypeChange(e) {
    const idx = Number(e.detail.value);
    const t = this.data.depositTypes[idx];
    this.setData({ depositTypeIndex: idx, depositType: t.value, depositTypeLabel: t.label });
  },

  _calcTotal() {
    const qty = parseFloat(this.data.quantity) || 0;
    const price = parseFloat(this.data.unitPrice) || 0;
    this.setData({ totalAmount: fmt.formatAmount(qty * price) });
  },

  submit() {
    if (this.data.submitting) return;
    if (!this.data.stationId) { wx.showToast({ title: '请选择水站', icon: 'none' }); return; }
    if (!this.data.barrelType.trim()) { wx.showToast({ title: '请输入桶类型', icon: 'none' }); return; }
    const qty = parseFloat(this.data.quantity);
    const price = parseFloat(this.data.unitPrice);
    if (isNaN(qty) || qty <= 0) { wx.showToast({ title: '请输入正确数量', icon: 'none' }); return; }
    if (isNaN(price) || price < 0) { wx.showToast({ title: '请输入正确单价', icon: 'none' }); return; }

    const payload = {
      stationId: this.data.stationId,
      barrelType: this.data.barrelType.trim(),
      quantity: qty,
      unitPrice: price,
      depositType: this.data.depositType,
      remark: this.data.remark.trim()
    };

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    request.post('/mini/deposits', payload)
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '登记成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});

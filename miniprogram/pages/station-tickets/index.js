// 我的水票（文档 §30 水票页：商品 / 可用水票数量 / 水票月份）
// ===========================================================================
// ⚠️ 只读。水票的发行入账与作废回冲属 Phase 7（§12 / §43），本期不接入 ——
//    因此这里只展示「有多少票、属于哪个月」，不提供任何核销/作废入口，
//    也不显示「积分」相关推算（那会变成前端自算，违反 §19.2）。
// ===========================================================================
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

Page({
  data: {
    list: [],
    totalAvailable: 0,
    loading: true,
    loadError: ''
  },

  onShow() {
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
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/water-tickets', null, { silent: true });
      this.setData({
        totalAvailable: res.totalAvailable,
        list: (res.list || []).map(p => ({
          productId: p.productId,
          productName: p.productName,
          productCode: p.productCode,
          specification: p.specification,
          unit: p.unit,
          imageFull: fmt.imageUrl(p.imageUrl),
          initial: fmt.productInitial(p.productName),
          wholesalePriceText: fmt.money(p.wholesalePrice),
          availableQty: p.availableQty,
          usedQty: p.usedQty,
          voidQty: p.voidQty,
          months: (p.months || []).map(m => ({
            month: m.month,
            count: m.count,
            label: m.status === 1 ? '未用' : m.status === 2 ? '已核销' : '作废'
          }))
        })),
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '水票加载失败' });
    }
  },

  goMall() {
    wx.switchTab({ url: '/pages/mall/index' });
  }
});

// 订单详情（文档 §32「订单详情必须显示」16 项）
// ===========================================================================
// §32 要求显示的清单（逐项对应到本页渲染）：
//   订单编号 / 订单来源 / 下单主体 / 客户 / 商品 / 数量 / 成交价·分销价 /
//   水票抵扣数量 / 订单积分 / 支付方式 / 钱包流水号 / 配送方式 / 配送地址 /
//   订单时间 / 履约状态 / 退款状态
//   业务员订单额外显示：最低成交价校验结果（内部审计用，见 minPriceCheck）
//
// ⚠️ 所有字段都直取后端返回值，本页**不做任何计算**（§19.2 / §41）。
// ===========================================================================
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

Page({
  data: {
    id: '',
    order: null,
    loading: true,
    loadError: '',
    showAudit: false
  },

  onLoad(options) {
    this.setData({ id: (options && options.id) || '' });
  },

  onShow() {
    this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    if (!this.data.id) {
      this.setData({ loading: false, loadError: '缺少订单号' });
      return;
    }
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true, loadError: '' });
    try {
      const o = await ui.request.get(`/orders/${this.data.id}`, null, { silent: true });
      this.setData({
        order: Object.assign({}, o, {
          createdAtText: fmt.dateTime(o.createdAt),
          canceledAtText: fmt.dateTime(o.canceledAt),
          // 金额与积分一律用服务端值，只做格式化
          totalReceivableText: fmt.money(o.amount.totalReceivable),
          orderAmountText: fmt.money(o.amount.orderAmount),
          pointsPaidText: fmt.points(o.amount.pointsPaid),
          pointsRefundedText: fmt.points(o.amount.pointsRefunded),
          items: (o.items || []).map(it => ({
            itemId: it.itemId,
            productName: it.productName,
            specification: it.specification,
            unit: it.unit,
            imageFull: fmt.imageUrl(it.imageUrl),
            initial: fmt.productInitial(it.productName),
            quantity: it.quantity,
            unitPriceText: fmt.money(it.unitPrice),
            subtotalText: fmt.money(it.subtotal),
            ticketQty: it.ticketQty,
            minPriceCheck: it.minPriceCheck
          })),
          // 业务员订单才展示最低成交价审计信息
          showAudit: me.account.role === 'salesman' && (o.items || []).some(i => i.minPriceCheck)
        }),
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '订单加载失败' });
    }
  },

  async onCancel() {
    const orderId = this.data.order.orderId;
    const ok = await ui.confirm('取消订单', '取消后本单金额将全额退回积分钱包。确定取消？', '确定取消');
    if (!ok) return;
    try {
      const res = await ui.request.post(`/orders/${orderId}/cancel`, { reason: '用户在小程序取消' }, { silent: true });
      wx.showToast({ title: res.alreadySettled ? '订单已取消' : '已取消，积分已退回', icon: 'success' });
      this.load();
    } catch (e) {
      ui.showError(e, '取消失败');
    }
  },

  async onRefund() {
    const orderId = this.data.order.orderId;
    const ok = await ui.confirm('申请退款', '首期只支持全额退款，款项将退回原付款人的积分钱包。确定申请？', '申请退款');
    if (!ok) return;
    try {
      const res = await ui.request.post(
        `/orders/${orderId}/refund`,
        { reason: '用户在小程序申请退款' },
        { silent: true }
      );
      wx.showToast({ title: res.alreadySettled ? '已退款' : '退款成功，积分已退回', icon: 'success' });
      this.load();
    } catch (e) {
      ui.showError(e, '退款申请失败');
    }
  },

  copyOrderId() {
    wx.setClipboardData({ data: this.data.order.orderId });
  }
});

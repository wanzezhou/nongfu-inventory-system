// 我的订单列表（文档 §31 订单列表筛选）
// ===========================================================================
// §31 明确两类角色的筛选项不同（自提下线后「待自提」页签已移除）：
//   业务员：全部 / 待备货 / 配送中 / 已完成 / 已取消
//   水站  ：全部 / 待备货 / 配送中 / 已完成 / 已退款
//   → 筛选项由 config/index.js 的 STATUS_FILTERS_* 提供，本页按角色取用，
//     但也支持从 URL 的 ?status= 进入（首页待办卡片跳转用）。
//     ⚠️ 页签集合必须与后端 orderController 的 STATUS_FILTERS 保持一致。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES, STATUS_FILTERS_SALESMAN, STATUS_FILTERS_STATION } = require('../../config/index');

const PAGE_SIZE = 10;

Page({
  data: {
    role: '',
    filters: [],
    status: 'ALL',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: ''
  },

  onLoad(options) {
    if (options && options.status) this.setData({ status: options.status });
  },

  onShow() {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    const filters = role === ROLES.STATION ? STATUS_FILTERS_STATION : STATUS_FILTERS_SALESMAN;
    const changed = this.data.role !== role;
    this.setData({ role, filters });
    if (changed || !this.data.list.length) this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onFilterTap(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({ status });
    this.reload();
  },

  async reload() {
    this.setData({ page: 1, list: [], hasMore: true, loadError: '' });
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page + 1;
    try {
      const res = await ui.request.get(
        '/orders',
        {
          status: this.data.status,
          page,
          pageSize: PAGE_SIZE
        },
        { silent: true }
      );

      const shaped = (res.list || []).map(o => ({
        orderId: o.orderId,
        orderType: o.orderType,
        source: o.source,
        fulfillmentType: o.fulfillmentType,
        // 自提已下线（2026-09-20）→ 恒为配送；保留字段是为了将来恢复自提时列表结构不用改
        fulfillmentLabel: '配送',
        statusLabel: o.fulfillmentStatusLabel || o.fulfillmentStatus || '-',
        refundStatus: o.refundStatus,
        refundLabel: o.refundStatus === 'REFUNDED' ? '已退款' : o.refundStatus === 'REFUNDING' ? '退款中' : '',
        amountText: fmt.money(o.orderAmount),
        customerName: o.customerName || '—',
        itemCount: o.itemCount,
        timeText: fmt.dateTime(o.createdAt),
        canCancel: o.canCancel,
        canRefund: o.canRefund && o.refundStatus === 'NONE'
      }));

      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({ list, page, total: res.total, hasMore: list.length < res.total, loading: false });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '订单加载失败' });
    }
  },

  goDetail(e) {
    ui.navTo(`/pages/order-detail/index?id=${e.currentTarget.dataset.id}`);
  },

  /** 取消订单（服务端会同时把钱退回钱包，见 miniOrderService 的取消=退款定死口径） */
  async onCancel(e) {
    const orderId = e.currentTarget.dataset.id;
    const ok = await ui.confirm('取消订单', '取消后本单金额将全额退回积分钱包。确定取消？', '确定取消');
    if (!ok) return;
    try {
      const res = await ui.request.post(`/orders/${orderId}/cancel`, { reason: '用户在小程序取消' }, { silent: true });
      wx.showToast({ title: res.alreadySettled ? '订单已取消' : '已取消，积分已退回', icon: 'success' });
      this.reload();
    } catch (err) {
      ui.showError(err, '取消失败');
    }
  },

  /** 申请退款（已发货 / 已完成） */
  async onRefund(e) {
    const orderId = e.currentTarget.dataset.id;
    const ok = await ui.confirm('申请退款', '首期只支持全额退款，款项将退回原付款人的积分钱包。确定申请？', '申请退款');
    if (!ok) return;
    try {
      const res = await ui.request.post(
        `/orders/${orderId}/refund`,
        { reason: '用户在小程序申请退款' },
        { silent: true }
      );
      wx.showToast({ title: res.alreadySettled ? '已退款' : '退款成功，积分已退回', icon: 'success' });
      this.reload();
    } catch (err) {
      ui.showError(err, '退款申请失败');
    }
  },

  goMall() {
    wx.switchTab({ url: '/pages/mall/index' });
  }
});

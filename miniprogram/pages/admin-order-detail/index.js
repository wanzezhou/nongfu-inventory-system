// 订单详情（管理员 · Phase 8b 第 9 域）
// 履约推进（只前进）+ 管理员取消（钱包单自动原路退款，现金单只回冲账务）。
// 幂等键在点操作那一刻生成，失败不释放以便重试复用（与其它写页一致）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const { acquireKey, releaseKey } = require('../../utils/idempotency');

// 履约流程（与后端 FULFILLMENT_FLOW 一致；自提下线后无 READY_FOR_PICKUP）
const FLOW = ['PAID', 'PROCESSING', 'DELIVERING', 'COMPLETED'];
const LABELS = { PAID: '已支付', PROCESSING: '备货中', DELIVERING: '配送中', COMPLETED: '已完成' };
// 每个状态的「下一步」动作文案
const NEXT_LABEL = { PAID: '开始备货', PROCESSING: '开始配送', DELIVERING: '标记完成' };

Page({
  data: {
    orderId: '',
    order: null,
    items: [],
    nextActions: [],
    loading: false,
    loadError: ''
  },

  onLoad(query) {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.setData({ orderId: query.id || '' });
    this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/orders/' + this.data.orderId, null, { silent: true });
      const o = res.order || {};
      const enriched = Object.assign({}, o, {
        orderAmountText: fmt.money(o.orderAmount),
        itemAmountText: fmt.money(o.itemAmount),
        createdAtText: fmt.dateTime(o.createdAt),
        canceledAtText: o.canceledAt ? fmt.dateTime(o.canceledAt) : '',
        sourceText: o.source === 'MINI_PROGRAM' ? '小程序' : 'Web 后台',
        walletRefundHint:
          o.paymentMethod === 'WALLET'
            ? '该订单为积分钱包支付：取消会把积分原路退回买家钱包，并恢复库存与水票。'
            : '该订单为现金/挂账单：取消只回冲账务（库存、水票、营收），不涉及钱包。'
      });
      // 推进动作：当前状态之后的所有合法目标（允许跳级，按钮按顺序展示）
      const idx = FLOW.indexOf(o.fulfillmentStatus);
      const nextActions =
        idx >= 0
          ? FLOW.slice(idx + 1).map(to => ({
              to,
              label: NEXT_LABEL[o.fulfillmentStatus] + (to === 'COMPLETED' ? '' : '（跳到' + LABELS[to] + '）')
            }))
          : [];
      this.setData({
        order: enriched,
        items: (res.items || []).map(it => Object.assign({}, it, { subtotalText: fmt.money(it.subtotal) })),
        nextActions
      });
    } catch (e) {
      this.setData({ loadError: e.message || '订单详情加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onAdvance(e) {
    const to = e.currentTarget.dataset.to;
    const ok = await ui.confirm('推进履约状态？', '将把该订单推进到「' + (LABELS[to] || to) + '」，操作不可回退。');
    if (!ok) return;
    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    // ⚠️ 契约是对象，不是字符串（传字符串会让内容指纹退化成常量 → 同一设备 24h 内
    //    第二次操作复用上一次的键而被服务端判「同键不同参数」）；门禁已加静态检查。
    const key = acquireKey({ scope: 'ADVANCE_ORDER', ownerKey, payload: { id: this.data.orderId, to } });
    try {
      await ui.request.put(
        '/admin/orders/' + this.data.orderId + '/fulfillment',
        { clientRequestId: key, to },
        { silent: true }
      );
      releaseKey(); // 推进成功 → 下一次推进（换目标状态）是一次新操作
      wx.showToast({ title: '已推进', icon: 'success' });
      this.fetch();
    } catch (err) {
      // 失败不释放幂等键：重试复用同一个键，服务端合并为一次
      this.setData({ loadError: err.message || '推进失败' });
    }
  },

  async onCancel() {
    const ok = await ui.confirm('取消该订单？', this.data.order.walletRefundHint + ' 操作不可撤销。', '取消订单');
    if (!ok) return;
    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const reason = '管理员小程序取消';
    const key = acquireKey({ scope: 'CANCEL_ORDER_ADMIN', ownerKey, payload: { id: this.data.orderId, reason } });
    try {
      await ui.request.post(
        '/admin/orders/' + this.data.orderId + '/cancel',
        { clientRequestId: key, reason },
        { silent: true }
      );
      releaseKey();
      wx.showToast({ title: '已取消', icon: 'success' });
      this.fetch();
    } catch (err) {
      this.setData({ loadError: err.message || '取消失败' });
    }
  }
});

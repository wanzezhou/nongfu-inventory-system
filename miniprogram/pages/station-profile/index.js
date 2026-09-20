// 我的水站（文档 §5.2「我的水站」/ §10.3 地址快照）
// ===========================================================================
// ⚠️ 本页**只读**：水站档案的维护归 Web 管理端（§43 Phase 8b 才逐域开放小程序写操作）。
//    这里刻意不提供编辑入口，避免出现「小程序改了档案、Web 端统计口径没跟上」的分叉。
//
// ⚠️ 地址只作展示与「下单默认地址」来源。订单一旦创建就保存**地址快照**，
//    历史订单不随水站档案地址变化（§10.3 / §44.14 ③）——页面里明确写出这一点，
//    否则业务方会以为「改了档案，历史单也该跟着变」。
// ===========================================================================
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

Page({
  data: {
    subject: null,
    wallet: null,
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
    if (me.account.role !== 'station') {
      this.setData({ loading: false, loadError: '仅直营水站可查看本页' });
      return;
    }
    this.setData({
      loading: false,
      loadError: '',
      subject: Object.assign({}, me.subject || {}, {
        phoneText: fmt.maskPhone(me.subject ? me.subject.phone : '')
      }),
      wallet: me.wallet ? Object.assign({}, me.wallet, { balanceText: fmt.points(me.wallet.balance) }) : null
    });
  },

  goTickets() {
    ui.navTo('/pages/station-tickets/index');
  },
  goOrders() {
    ui.navTo('/pages/order-list/index');
  }
});

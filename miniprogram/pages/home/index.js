// 首页（按角色分流：§29 业务员 / §30 直营水站 / §28 管理员仪表盘）
// ===========================================================================
// ⚠️ 所有数字都来自服务端聚合（§28 末句：「不在小程序 JS 自己汇总」）。
//    因此本页只做一件事：把 GET /mini/home 或 GET /mini/admin/dashboard 的结果铺到界面上，
//    **不做任何跨接口加总、不做任何金额计算**（§19.2 / §41 禁止前端自算）。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

Page({
  data: {
    role: '',
    roleLabel: '',
    loading: true,
    loadError: '',
    blocked: '',
    // 业务员 / 水站
    wallet: null,
    today: null,
    month: null,
    pipeline: null,
    waterTickets: null,
    recentOrders: [],
    notes: [],
    // 管理员
    dashboard: null
  },

  onShow() {
    ui.syncTabBar(this, '/pages/home/index');
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
    this.setData({
      role,
      roleLabel: auth.roleLabel(),
      blocked: ui.blockedBanner(),
      loadError: ''
    });

    try {
      if (role === ROLES.ADMIN) {
        // 管理员首页 = §28 仪表盘（Phase 8a 只读）
        const dashboard = await ui.request.get('/admin/dashboard', null, { silent: true });
        this.setData({ dashboard, loading: false });
      } else {
        const home = await ui.request.get('/home', null, { silent: true });
        this.setData({
          wallet: home.wallet,
          today: home.today || null,
          month: home.month || null,
          pipeline: home.pipeline || null,
          waterTickets: home.waterTickets || null,
          recentOrders: (home.recentOrders || []).map(o => this.shapeOrder(o)),
          notes: home.notes || [],
          loading: false
        });
      }
    } catch (e) {
      this.setData({
        loading: false,
        loadError: e.message || '数据加载失败'
      });
    }
  },

  /** 订单卡片视图整形（只补展示字段，不改数值） */
  shapeOrder(o) {
    return Object.assign({}, o, {
      amountText: fmt.money(o.orderAmount),
      timeText: fmt.fromNow(o.createdAt),
      statusLabel: o.fulfillmentStatusLabel || o.fulfillmentStatus || '-',
      refundLabel: o.refundStatus === 'REFUNDED' ? '已退款' : '',
      // 自提已下线（2026-09-20）→ 履约方式恒为配送。仍保留该字段展示：
      // 历史订单/将来若恢复自提时，列表不必改结构即可显示。
      fulfillmentLabel: '配送'
    });
  },

  goMall() {
    wx.switchTab({ url: '/pages/mall/index' });
  },
  goOrders() {
    ui.navTo('/pages/order-list/index');
  },
  goWallet() {
    if (this.data.role === ROLES.STATION) {
      wx.switchTab({ url: '/pages/wallet/index' });
    } else {
      ui.navTo('/pages/wallet/index');
    }
  },
  goTickets() {
    ui.navTo('/pages/station-tickets/index');
  },
  goStationProfile() {
    ui.navTo('/pages/station-profile/index');
  },
  goAdminWallet() {
    ui.navTo('/pages/admin-wallet/index');
  },
  /** Phase 8b 业务域：支出台账（逐域追加，入口与页面同时上线） */
  goAdminExpenses() {
    ui.navTo('/pages/admin-expenses/index');
  },
  /** Phase 8b 业务域：收入台账 */
  goAdminIncomes() {
    ui.navTo('/pages/admin-incomes/index');
  },
  /** Phase 8b 业务域：商品管理（含「业务员可售」开关与最低价，业务员端能否下单的总闸门） */
  goAdminProducts() {
    ui.navTo('/pages/admin-products/index');
  },
  /** Phase 8b 业务域：公司账户（余额只读；唯一资金动作是账户间转账） */
  goAdminAccounts() {
    ui.navTo('/pages/admin-accounts/index');
  },
  /** Phase 8b 业务域：订单管理（全来源，履约状态推进是全系统唯一入口） */
  goAdminOrders() {
    ui.navTo('/pages/admin-orders/index');
  },
  /** Phase 8b 业务域：主数据（供应商 / 员工 / 水站 / 机台，四个域共用一个页面，页内可切换） */
  goAdminMaster() {
    ui.navTo('/pages/admin-master/index');
  },
  goAdminSalary() {
    ui.navTo('/pages/admin-salary/index');
  },
  goAdminReports() {
    ui.navTo('/pages/admin-reports/index');
  },
  goAdminBarrels() {
    ui.navTo('/pages/admin-barrels/index');
  },

  goAdminSettings() {
    ui.navTo('/pages/admin-settings/index');
  },
  goAdminTickets() {
    ui.navTo('/pages/admin-tickets/index');
  },
  /** Phase 8b 业务域：库存（入库 / 出库；入库会在同一事务里扣付款账户余额） */
  goAdminInventory() {
    ui.navTo('/pages/admin-inventory/index');
  },
  /** Phase 8b 业务域：出入库记录（入库记录可作废，出库台账只读） */
  goAdminPurchases() {
    ui.navTo('/pages/admin-purchases/index');
  },
  goOrderDetail(e) {
    ui.navTo(`/pages/order-detail/index?id=${e.currentTarget.dataset.id}`);
  },
  viewAllPipeline() {
    ui.navTo('/pages/order-list/index?status=PENDING_STOCK');
  }
});

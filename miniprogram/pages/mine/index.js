// 我的（文档 §5.1/§5.2「我的」）
// ===========================================================================
// 本页同时也是「角色能力说明页」：把服务端下发的 permissions 如实展示出来。
// 为什么要有它：文档对三角色的能力边界做了大量规定（谁能填成交价、谁能用水票、
// 谁能看仪表盘），若只写在文档里，使用者只能靠猜。展示服务端下发的权限表，
// 既能自解释，也顺带暴露「权限与预期不符」的问题。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

/** 权限键 → 人话（服务端只给布尔，文案在前端，避免后端下发中文字符串） */
const PERMISSION_LABELS = [
  { key: 'canOrder', label: '提交订单', desc: '可使用积分钱包下单' },
  { key: 'canUseWallet', label: '积分钱包', desc: '查看余额与流水' },
  { key: 'canSellWithCustomPrice', label: '自定成交价', desc: '业务员可填成交价（受最低价约束）' },
  { key: 'canUseWaterTicket', label: '水票抵扣', desc: '下单时按明细抵扣水票' },
  { key: 'canViewAdminDashboard', label: '经营仪表盘', desc: '查看营收/成本/利润与预警' }
];

Page({
  data: {
    role: '',
    roleLabel: '',
    account: null,
    subject: null,
    wallet: null,
    blocked: '',
    permissionRows: [],
    ticketSummary: null,
    isStation: false,
    isAdmin: false,
    version: 'v1.0.0'
  },

  onShow() {
    ui.syncTabBar(this, '/pages/mine/index');
    this.load();
  },

  async load() {
    const me = await ui.pageReady(this);
    if (!me || !me.account) return;

    const perms = auth.permissions();
    const role = me.account.role;
    this.setData({
      role,
      roleLabel: auth.roleLabel(),
      isStation: role === ROLES.STATION,
      isAdmin: role === ROLES.ADMIN,
      blocked: ui.blockedBanner(),
      account: Object.assign({}, me.account, {
        lastLoginText: fmt.dateTime(me.account.lastLoginAt)
      }),
      subject: Object.assign({}, me.subject || {}, {
        phoneText: fmt.maskPhone(me.subject ? me.subject.phone : '')
      }),
      wallet: me.wallet ? Object.assign({}, me.wallet, { balanceText: fmt.points(me.wallet.balance) }) : null,
      permissionRows: PERMISSION_LABELS.map(p => ({
        label: p.label,
        desc: p.desc,
        enabled: !!perms[p.key]
      }))
    });

    // 直营水站：在入口上显示可用水票张数（GET /water-tickets/summary，§21.7）
    // ⚠️ 这是**只读辅助信息**：取不到就不显示张数（不伪造 0，也不阻断页面）
    if (role === ROLES.STATION) {
      try {
        const summary = await ui.request.get('/water-tickets/summary', null, { silent: true });
        this.setData({ ticketSummary: summary });
      } catch (e) {
        console.warn('[mine] 水票汇总读取失败：', e.message);
      }
    }
  },

  goWallet() {
    if (this.data.isStation) wx.switchTab({ url: '/pages/wallet/index' });
    else ui.navTo('/pages/wallet/index');
  },
  goOrders() {
    ui.navTo('/pages/order-list/index');
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
  goTransactions() {
    ui.navTo('/pages/wallet-transactions/index');
  },

  async onLogout() {
    const ok = await ui.confirm('退出登录', '退出后需要重新授权手机号登录，确定退出？', '退出');
    if (!ok) return;
    await auth.logout();
    wx.reLaunch({ url: '/pages/login/index' });
  }
});

// 积分钱包（文档 §33 钱包页面 / §19.4 账实恒等式）
// ===========================================================================
// §33 的核心表述：「当前积分 ≈ 当前可用订货额度」。
// 因此本页把「积分」放在最显眼位置，并明确它是**内部预存额度**，
// 不是微信零钱、不能在用户之间转移（§3.3）——这是合规表述，不能省。
//
// ⚠️ 页面的汇总数据（总收入/总支出/各类型合计）全部来自
//    GET /mini/wallet 的服务端聚合，前端不做任何加总（§53：取数单源）。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

Page({
  data: {
    role: '',
    wallet: null,
    byType: [],
    /** ★ 配送费积分按月发放明细（后端聚合，前端只做格式化） */
    feeMonths: [],
    loading: true,
    loadError: '',
    identityWarn: '',
    isTab: false
  },

  onLoad() {
    // 直营水站的「积分」是 tab 页，业务员的是普通页（不需要清 tabBar 选中态）
    const me = auth.me();
    const isTab = !!(me && me.account && me.account.role === ROLES.STATION);
    this.setData({ isTab });
  },

  onShow() {
    if (this.data.isTab || !this.data.role) {
      const me = auth.me();
      const role = me && me.account ? me.account.role : '';
      if (role === ROLES.STATION) ui.syncTabBar(this, '/pages/wallet/index');
      this.setData({ role });
    }
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
    if (me.account.role === ROLES.ADMIN) {
      this.setData({ loading: false, loadError: '管理员没有积分钱包（管理员端本期为只读）' });
      return;
    }

    this.setData({ role: me.account.role, loading: true, loadError: '' });
    try {
      const w = await ui.request.get('/wallet', null, { silent: true });
      this.setData({
        wallet: Object.assign({}, w, {
          balanceText: fmt.points(w.balance),
          // ★ 双积分（2026-09-23）：两类分账户各自成列展示 —— 业务要求
          //   「可混合抵扣但必须区分」，所以总额之外必须把构成摆出来
          rechargeBalanceText: fmt.points(w.rechargeBalance),
          deliveryFeeBalanceText: fmt.points(w.deliveryFeeBalance),
          totalInText: fmt.points(w.totalIn),
          totalOutText: fmt.points(w.totalOut),
          rmbText: fmt.money(w.equivalentRmb)
        }),
        // 配送费积分按月发放明细（服务端聚合，前端不做任何加总）
        feeMonths: (w.deliveryFeeMonthly || []).map(m => ({
          month: m.month,
          creditedText: fmt.points(m.credited),
          revertedText: fmt.points(m.reverted),
          netText: fmt.points(m.net),
          count: m.count
        })),
        byType: (w.byType || []).map(t => ({
          type: t.type,
          label: t.label,
          count: t.count,
          totalText: fmt.points(t.total),
          direction: t.direction
        })),
        // 恒等式自检：服务端已校验，这里只做展示（便于管理员/财务一眼看出异常）
        identityWarn: w.identityOk
          ? ''
          : `账实不符：账面 ${w.balance}，按流水应为 ${w.expected}（差额 ${w.diff}），请联系管理员核查`,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '积分加载失败' });
    }
  },

  goTransactions() {
    ui.navTo('/pages/wallet-transactions/index');
  },
  // ⚠️ 在线充值（微信支付）**已按业务要求下线**（2026-09-23）：充值积分改为
  //    由管理员在后台设置，因此本页不再有充值入口（页面也一并删除）。
  goTickets() {
    ui.navTo('/pages/station-tickets/index');
  }
});

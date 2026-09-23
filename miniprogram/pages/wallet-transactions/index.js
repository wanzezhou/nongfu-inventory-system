// 积分流水（文档 §33 / §11.4 流水类型）
// ===========================================================================
// ⚠️ 金额符号**直接用后端返回的 signedAmount**，不由前端「按类型判断加减」：
//    这正是文档 §11.7 第 5 条那个坑（收入类流水的撤销是 −amount，按类型推方向会反）。
//    后端已把方向显式落库（wallet_transactions.direction）并按它算好带符号金额，
//    前端只负责展示。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 15;

/** 流水类型筛选项（与后端 WALLET_TX_TYPE 对齐；不提供「全部以外」的臆造类型） */
const TYPE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'ORDER_PAYMENT', label: '订单消费' },
  { key: 'REFUND', label: '退款' },
  { key: 'RECHARGE', label: '充值积分' },
  { key: 'DISTRIBUTION_FEE', label: '分销配送费' },
  { key: 'DISTRIBUTION_FEE_REVERSAL', label: '配送费冲回' },
  { key: 'ADJUST_IN', label: '管理员增加' },
  { key: 'ADJUST_OUT', label: '管理员扣减' }
];

Page({
  data: {
    typeFilters: TYPE_FILTERS,
    type: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: '',
    isTab: false
  },

  onLoad() {
    const me = auth.me();
    this.setData({ isTab: !!(me && me.account && me.account.role === ROLES.STATION) });
  },

  onShow() {
    this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type });
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
        '/wallet/transactions',
        {
          type: this.data.type,
          page,
          pageSize: PAGE_SIZE
        },
        { silent: true }
      );

      const shaped = (res.list || []).map(t => ({
        transactionId: t.transactionId,
        transactionNo: t.transactionNo,
        type: t.type,
        typeLabel: t.typeLabel,
        // ★ 双积分（2026-09-23）：标明本笔动的是哪一类积分（充值 / 配送费）
        pointsTypeLabel: t.pointsTypeLabel || '',
        // 配送费积分的发行月份（仅发行入账有值）
        pointsMonth: t.pointsMonth || '',
        // 符号与金额直接用服务端值（见文件头说明）
        signedText: fmt.signedPoints(t.signedAmount),
        isIn: Number(t.direction) === 1,
        balanceAfterText: fmt.points(t.balanceAfter),
        relatedId: t.relatedId,
        relatedType: t.relatedType,
        remark: t.remark,
        timeText: fmt.dateTime(t.createdAt),
        canViewOrder: t.relatedType === 'ORDER' && !!t.relatedId
      }));

      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({ list, page, total: res.total, hasMore: list.length < res.total, loading: false });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '流水加载失败' });
    }
  },

  /** 点击流水行：仅「关联订单」的流水才可跳转（其余类型没有可去的地方） */
  onItemTap(e) {
    const viewable = e.currentTarget.dataset.viewable;
    if (!viewable) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    ui.navTo(`/pages/order-detail/index?id=${id}`);
  }
});

// 充值（文档 §13 微信充值 / §13.8 资质未就绪时的降级路径）
// ===========================================================================
// ⚠️ 本页**不做假充值**。
//
// 事实（文档 §13.8 / §43 Phase 6）：
//   微信支付资质（注册 → 认证 → 申请支付权限 → AppID 与商户号授权绑定）
//   是**不受开发进度控制的最长外部依赖**，Phase 6 因此被单列，本次交付范围
//   （Phase 1~5 + 8a）不含它。
//   文档给了明确的降级路径：
//     「资质就绪前：钱包正向入账来源 = 管理员手工调增积分（§18）+ 水票发行分销配送费（§12）
//       → 业务员/水站订单链路、钱包扣减、退款、对账 均可端到端开发与验证；
//       → 仅『微信充值』这一期（Phase 6）挂起」
//   并且明确约束：「降级期间**不要造假数据**（不得写测试用的"已充值"流水进生产库）」。
//
// 因此本页的正确形态是：**如实说明状态 + 指引替代路径**，
// 而不是放一个点了没反应或伪造成功的按钮。
// ===========================================================================
const ui = require('../../utils/ui');

Page({
  data: {
    probeDone: false,
    open: false,
    message: '',
    balance: null,
    amount: ''
  },

  onShow() {
    this.checkAvailability();
  },

  /** 向后端探一次「充值能力是否开放」，结果如实展示（不预设、不伪造） */
  async checkAvailability() {
    const me = await ui.pageReady(this);
    if (!me || !me.account) return;
    try {
      const wallet = await ui.request.get('/wallet', null, { silent: true });
      this.setData({ balance: wallet.balance });
    } catch (e) {
      console.warn('[recharge] 读取积分失败：', e.message);
    }
    try {
      // 用一个极小金额探一次：后端返回 503 = 未开通；返回其它业务错误也说明接口是通的
      await ui.request.post(
        '/wallet/recharge',
        { amount: 1, clientRequestId: `probe_${Date.now()}` },
        { silent: true, loading: false }
      );
      this.setData({ probeDone: true, open: true });
    } catch (e) {
      // 503 = 明确「未开通」；其它错误（如 400 参数）说明接口本身存在
      const notOpen = e.httpStatus === 503 || /未开通|未就绪/.test(e.message || '');
      this.setData({
        probeDone: true,
        open: !notOpen,
        message: e.message || ''
      });
    }
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value });
  },

  onRecharge() {
    wx.showModal({
      title: '微信充值未开通',
      content:
        '微信支付资质尚未就绪（文档 §43 Phase 6）。现阶段请由管理员在后台为账号调增积分，调增会生成独立流水并记录操作原因与操作人。',
      showCancel: false,
      confirmColor: '#c8102e'
    });
  },

  goTransactions() {
    ui.navTo('/pages/wallet-transactions/index');
  }
});

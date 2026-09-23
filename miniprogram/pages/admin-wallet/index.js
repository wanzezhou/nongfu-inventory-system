// 管理员 · 积分钱包后台（文档 §18 / §21.8 / §43 Phase 5）
// ===========================================================================
// 为什么这一页属于本期范围：§43 的 **Phase 5 = 钱包** 明确包含
//   「管理员调整（强制填写原因/备注/操作人 §18）」。
// 因此它不是 Phase 8b 的「写操作全覆盖」，而是钱包本体的必要组成部分 ——
// 在微信充值（Phase 6）未开通的降级路径下，这里是**唯一**的正向入账来源
// （§13.8：「钱包正向入账来源 = 管理员手工调增积分 + 水票发行分销配送费」）。
//
// 硬约束（§18 / §40 / §45）：
//   ① 必须强制填写**操作原因**；备注可选；操作人取自令牌（不接受前端传入）。
//   ② 每次调整生成**独立流水**（服务端 ADJUST_IN / ADJUST_OUT + 审计日志）。
//   ③ 幂等：同一次点击重试复用同一个 clientRequestId，避免「重复点击多扣一笔」（§45 必测项）。
//   ④ 权限：服务端 requireMiniAdmin 校验，不复用 Web 的 requireAdmin（§22.4）。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');
const { WALLET_OWNER_LABEL } = require('../../config/index');

Page({
  data: {
    tab: 'list', // list | detail
    wallets: [],
    totals: null,
    ownerType: '', // '' | SALESMAN | STATION
    wallet: null,
    walletOwnerLabel: '',
    transactions: [],
    reconciliation: null,
    loading: true,
    loadError: '',
    // 调整表单
    adjustDirection: 'IN',
    // ★ 双积分（2026-09-23）：指定加到/扣减哪一类积分，**默认充值积分**
    //   （「充值积分 = 管理员后台设置的那一类」是业务方确认的口径）
    adjustPointsType: 'RECHARGE',
    adjustAmount: '',
    adjustReason: '',
    adjustRemark: '',
    submitting: false
  },

  onShow() {
    if (!this.ensureAdmin()) return;
    if (this.data.tab === 'detail' && this.data.wallet) this.loadDetail();
    else this.loadList();
  },

  /** 双重守卫：前端先拦一道，服务端仍会校验（§22.4） */
  ensureAdmin() {
    const me = auth.me();
    if (!me || !me.account) return false;
    if (me.account.role !== 'admin') {
      ui.showError({ message: '仅管理员可访问' });
      wx.navigateBack();
      return false;
    }
    return true;
  },

  onFilterChange(e) {
    this.setData({ ownerType: e.currentTarget.dataset.type });
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get(
        '/wallet/admin/overview',
        {
          ownerType: this.data.ownerType || ''
        },
        { silent: true }
      );
      this.setData({
        wallets: (res.list || []).map(w => ({
          walletId: w.walletId,
          ownerType: w.ownerType,
          ownerLabel: WALLET_OWNER_LABEL[w.ownerType] || w.ownerType,
          ownerId: w.ownerId,
          ownerName: w.ownerName || w.ownerId,
          balanceText: fmt.points(w.balance),
          // ★ 双积分：列出构成（充值 / 配送费）—— 只给总额无法判断能不能抵扣
          rechargeBalanceText: fmt.points(w.rechargeBalance),
          deliveryFeeBalanceText: fmt.points(w.deliveryFeeBalance),
          statusText: w.status === 1 ? '启用' : '停用',
          txCount: w.txCount,
          lastTxText: fmt.fromNow(w.lastTxAt)
        })),
        totals: res.totals,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '钱包列表加载失败' });
    }
  },

  async openWallet(e) {
    const walletId = e.currentTarget.dataset.id;
    this.setData({ tab: 'detail', wallet: { walletId }, loading: true, loadError: '' });
    await this.loadDetail();
  },

  async loadDetail() {
    const walletId = this.data.wallet.walletId;
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get(
        `/wallet/admin/${walletId}/transactions`,
        {
          page: 1,
          pageSize: 50
        },
        { silent: true }
      );

      const w = res.wallet;
      this.setData({
        wallet: Object.assign({}, w, {
          balanceText: fmt.points(w.balance),
          rechargeBalanceText: fmt.points(w.rechargeBalance),
          deliveryFeeBalanceText: fmt.points(w.deliveryFeeBalance),
          totalInText: fmt.points(w.totalIn),
          totalOutText: fmt.points(w.totalOut),
          ownerLabel: WALLET_OWNER_LABEL[w.ownerType] || w.ownerType,
          statusText: w.status === 1 ? '启用' : '停用',
          identityOk: w.identityOk
        }),
        walletOwnerLabel: `${WALLET_OWNER_LABEL[w.ownerType] || w.ownerType} · ${w.ownerName || w.ownerId}`,
        transactions: (res.transactions || []).map(t => ({
          transactionId: t.transactionId,
          transactionNo: t.transactionNo,
          typeLabel: t.typeLabel,
          // ★ 双积分：本笔动的是哪一类积分（充值 / 配送费）
          pointsTypeLabel: t.pointsTypeLabel || '',
          signedText: fmt.signedPoints(t.signedAmount),
          isIn: Number(t.direction) === 1,
          balanceAfterText: fmt.points(t.balanceAfter),
          operatorId: t.operatorId,
          remark: t.remark,
          timeText: fmt.dateTime(t.createdAt)
        })),
        reconciliation: res.reconciliation,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, loadError: e.message || '钱包详情加载失败' });
    }
  },

  backToList() {
    this.setData({
      tab: 'list',
      wallet: null,
      transactions: [],
      reconciliation: null,
      adjustAmount: '',
      adjustReason: '',
      adjustRemark: ''
    });
    this.loadList();
  },

  onDirChange(e) {
    this.setData({ adjustDirection: e.currentTarget.dataset.dir });
  },

  /** ★ 双积分：切换调整的积分类型（充值积分 / 配送费积分） */
  onPointsTypeChange(e) {
    this.setData({ adjustPointsType: e.currentTarget.dataset.pt });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch[field] = e.detail.value;
    this.setData(patch);
  },

  /** 提交手工增减积分（§18 强制原因 + §45 幂等） */
  async submitAdjust() {
    if (this.data.submitting) return;
    const amount = Number(this.data.adjustAmount);
    const reason = String(this.data.adjustReason || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      ui.showError({ message: '积分数量必须为正数' });
      return;
    }
    if (!reason) {
      ui.showError({ message: '必须填写操作原因（文档 §18 硬要求）' });
      return;
    }

    const dirLabel = this.data.adjustDirection === 'IN' ? '增加' : '扣减';
    const typeLabel = this.data.adjustPointsType === 'DELIVERY_FEE' ? '配送费积分' : '充值积分';
    const ok = await ui.confirm(
      `确认${dirLabel}${typeLabel}`,
      `将从「${this.data.walletOwnerLabel}」${dirLabel} ${amount} ${typeLabel}。\n原因：${reason}\n该操作会生成独立流水并留审计。`,
      `确认${dirLabel}`
    );
    if (!ok) return;

    const me = auth.me();
    const ownerKey = `admin:${me.account.targetId || me.account.id}`;
    const payload = {
      walletId: this.data.wallet.walletId,
      direction: this.data.adjustDirection,
      // ★ 双积分：作用于哪一类（默认充值积分；补发配送费积分是真实场景）
      pointsType: this.data.adjustPointsType,
      amount,
      reason,
      remark: String(this.data.adjustRemark || '').trim() || undefined
    };
    // 幂等键：同内容重试复用同一个键，避免「重复点击多扣一笔」（§45）
    const clientRequestId = idem.acquireKey({ scope: 'WALLET_ADJUST', ownerKey, payload });

    this.setData({ submitting: true });
    try {
      const res = await ui.request.post('/wallet/admin/adjust', Object.assign({ clientRequestId }, payload), {
        silent: true,
        loadingText: '提交中'
      });
      idem.releaseKey();
      wx.showToast({ title: res.replayed ? '已处理（重复请求已合并）' : '调整成功', icon: 'success' });
      this.setData({ adjustAmount: '', adjustReason: '', adjustRemark: '' });
      await this.loadDetail();
    } catch (e) {
      // 失败不释放幂等键，便于用户直接重试
      ui.showError(e, '调整失败');
    } finally {
      this.setData({ submitting: false });
    }
  }
});

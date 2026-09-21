// 出入库记录（管理员 · 文档 §5.3「库存」/ §43 Phase 8b 第 8 域）
// ===========================================================================
// 本页是第 8 域的**纠错入口**：入库记错了要在这里作废重开。
//
// ⚠️ 作废是**撤销类**操作（项目铁律 §8 第 4 条），三件事必须同时发生：
//      回退库存 + 款项**原路退回**（收入方向）+ 生成反向流水，且在同一事务内。
//    这三件事全部在服务端 `applyPurchaseVoid` 里（Web 端也走同一段代码），
//    前端**只负责**：① 把后果讲清楚 ② 强制填原因 ③ 带幂等键。
//
// ⚠️ 强制填原因不是形式主义：作废原因会写进 `purchase_records.void_reason`
//    与审计日志。事后查「这笔钱为什么退回来了」，唯一的线索就是它。
//    所以原因留空 = 取消操作（见 `ui.prompt` 的约定），不允许空原因作废。
//
// ⚠️ 幂等键的指纹**包含单号与原因**：同一把键用在别的入库单上会被服务端判为
//    「同键不同参数」而 400 —— 这正确，那属于客户端用错了键。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');
const { ROLES } = require('../../config/index');

const PAGE_SIZE = 15;

/** 入库记录状态筛选（与后端 pr.status 一致：1 有效 / 2 已作废） */
const STATUS_FILTERS = [
  { key: '', label: '全部' },
  { key: '1', label: '有效' },
  { key: '2', label: '已作废' }
];

Page({
  data: {
    tab: 'purchase',
    statusFilters: STATUS_FILTERS,
    statusFilter: '',
    keyword: '',
    list: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    loadError: '',
    blocked: '',
    voiding: false
  },

  onLoad() {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    this.setData({
      blocked: ui.blockedBanner(),
      loadError: role === ROLES.ADMIN ? '' : '当前身份不是管理员，无权查看出入库记录'
    });
  },

  onShow() {
    if (this.data.loadError) {
      const me = auth.me();
      const role = me && me.account ? me.account.role : '';
      if (role !== ROLES.ADMIN) return;
      this.setData({ loadError: '' });
    }
    this.reload();
  },

  async onPullDownRefresh() {
    await this.reload();
    wx.stopPullDownRefresh();
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.fetch(false);
  },

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    // 两套列表字段不同，切页签必须**清空重拉**，不能沿用上一页签的数据
    this.setData({ tab, list: [], page: 1, hasMore: true, loadError: '' });
    this.reload();
  },

  onStatusTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.statusFilter) return;
    this.setData({ statusFilter: key });
    this.reload();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  async reload() {
    this.setData({ page: 1, list: [], hasMore: true });
    return this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page + 1;
    const isPurchase = this.data.tab === 'purchase';

    const query = { page, pageSize: PAGE_SIZE };
    const kw = String(this.data.keyword || '').trim();
    if (kw) query.keyword = kw;
    // ⚠️ 只传非空值：status='' 会被后端当成「未筛选」，但显式传空串语义上更含糊，索性不下发
    if (isPurchase && this.data.statusFilter) query.status = this.data.statusFilter;

    try {
      // ⚠️ 两个页签的路径必须**各自写成字面量**，不能写成
      //    `ui.request.get(isPurchase ? '/admin/purchases' : '/admin/stock-out-records', …)` ——
      //    `check-api-paths.js` 是正则抽取，只认紧跟在 `(` 后的字符串字面量；
      //    写成三元表达式会让两个接口在门禁里**静默消失**（实测：交叉校验报
      //    「后端已注册但小程序未调用 2 条」，而其实调用了）。
      //    代价是多 4 行；换来的是「接口有没有被前端调用」这件事可被机器回答。
      let res;
      if (isPurchase) {
        res = await ui.request.get('/admin/purchases', query, { silent: true });
      } else {
        res = await ui.request.get('/admin/stock-out-records', query, { silent: true });
      }
      const shaped = (res.list || []).map(it =>
        isPurchase
          ? {
              purchaseId: it.purchaseId,
              productName: it.productName,
              unit: it.unit || '',
              quantity: it.quantity,
              unitPriceText: fmt.money(it.unitPrice),
              totalAmountText: fmt.money(it.totalAmount),
              accountName: it.accountName,
              supplierName: it.supplierName,
              status: it.status,
              voidReason: it.voidReason,
              createdAtText: fmt.dateTime(it.createdAt)
            }
          : {
              recordId: it.recordId,
              productName: it.productName,
              unit: '',
              quantity: it.quantity,
              outTypeLabel: it.outTypeLabel,
              stockAfter: it.stockAfter,
              remark: it.remark,
              createdAtText: fmt.dateTime(it.createdAt)
            }
      );
      const list = reset ? shaped : this.data.list.concat(shaped);
      this.setData({
        list,
        page,
        total: res.total,
        hasMore: list.length < res.total,
        loading: false,
        loadError: ''
      });
    } catch (e) {
      // 失败**不清空列表**、也不报成功
      this.setData({ loading: false, loadError: e.message || '记录加载失败' });
    }
  },

  /** 作废入库单：二次确认 → 强制填原因 → 提交（幂等） */
  async onVoidTap(e) {
    const purchaseId = e.currentTarget.dataset.id;
    if (!purchaseId || this.data.voiding) return;
    const me = await ui.pageReady(this);
    if (!me) return;

    const ok = await ui.confirm(
      '作废这张入库单？',
      '作废会同时：\n· 回退库存（扣回入库数量）\n· 款项原路退回付款账户\n· 生成反向资金流水\n\n操作不可撤销。',
      '继续'
    );
    if (!ok) return;

    const reason = await ui.prompt('填写作废原因', '如：录错数量 / 供应商退货');
    if (!reason) {
      // 留空 = 取消。理由要进台账与审计，空原因等于失去可追溯性
      ui.showError({ message: '未填写原因，已取消作废' });
      return;
    }

    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({
      scope: 'VOID_PURCHASE',
      ownerKey,
      payload: { purchaseId, reason }
    });

    this.setData({ voiding: true });
    try {
      const res = await ui.request.post(
        `/admin/purchases/${purchaseId}/void`,
        { clientRequestId, reason },
        { silent: true }
      );
      idem.releaseKey();
      const tip =
        res.balanceAfter === null || res.balanceAfter === undefined
          ? `已作废，退回 ¥${fmt.money(res.refundAmount)}`
          : `已作废，退回 ¥${fmt.money(res.refundAmount)}（账户余额现为 ¥${fmt.money(res.balanceAfter)}）`;
      await ui.confirm(res.replayed ? '该入库单已作废' : '作废成功', tip, '知道了');
      this.reload();
    } catch (err) {
      // 失败**不释放幂等键**：重试复用同一个键
      ui.showError(err);
    } finally {
      this.setData({ voiding: false });
    }
  }
});

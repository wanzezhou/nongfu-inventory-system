// 水票 · 返货发行（管理员 · Phase 7 补齐）
// ===========================================================================
// ⚠️ 这是**资金动作**：发行会给该水站的积分钱包入账（单件配送费 × 数量；
//    1 积分 = 1 元，水站下单时可直接抵扣）。因此：
//    · 必须带**幂等键** —— 弱网重试一次就是真的多发一笔积分，两笔都合法、账面看不出异常；
//    · 页面金额只作**展示**：单件值由服务端从商品档案重取（§12.10），回传的金额会被忽略，
//      所以下面算出的「预计入账」只是让操作员心里有数，**改不动物价**；
//    · 提交前的确认框必须写清「给谁、几个商品、共几张票、预计入账多少积分」。
// ⚠️ 数量已提交后要改，走「发行记录」tab 的「改数量」（会按差额补/冲积分），
//    而不是重新发行一次 —— 后者会变成两笔发行、两张批次。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    stations: [],
    stationLabels: [],
    stationIndex: 0,
    products: [],
    productLabels: [],
    month: '',
    rows: [],
    remark: '',
    totalText: '0.00',
    loading: false,
    submitting: false,
    loadError: '',
    formError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetchOptions();
  },

  async fetchOptions() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/water-tickets/options', null, { silent: true });
      const st = res.stations || [];
      const pr = res.products || [];
      this.setData({
        stations: st,
        stationLabels: st.map(function (s) {
          return s.stationName;
        }),
        stationIndex: 0,
        products: pr,
        productLabels: pr.map(function (p) {
          return p.productName + (p.specification ? '（' + p.specification + '）' : '');
        }),
        month: res.month || '',
        rows: [this.blankRow()]
      });
      this.recalc();
    } catch (e) {
      this.setData({ loadError: e.message || '选项加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  blankRow() {
    return {
      productIndex: -1,
      productName: '请选择商品',
      quantity: '1',
      unitFee: 0,
      unitFeeText: '0.00',
      feeText: '0.00'
    };
  },

  onStationChange(e) {
    this.setData({ stationIndex: Number(e.detail.value) });
  },

  onMonthInput(e) {
    this.setData({ month: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  onProductChange(e) {
    const idx = Number(e.detail.value);
    const i = Number(e.currentTarget.dataset.index);
    const p = this.data.products[idx];
    const rows = this.data.rows.slice();
    rows[i] = Object.assign({}, rows[i], {
      productIndex: idx,
      productName: p ? p.productName : '请选择商品',
      // ⚠️ 数值与展示串**分开存**：fmt.money 可能带千分位，拿展示串去算会变成 NaN
      unitFee: p ? Number(p.unitDeliveryFee) || 0 : 0,
      unitFeeText: fmt.money(p ? p.unitDeliveryFee : 0)
    });
    this.setData({ rows: rows });
    this.recalc();
  },

  onQtyInput(e) {
    const i = Number(e.currentTarget.dataset.index);
    const rows = this.data.rows.slice();
    rows[i] = Object.assign({}, rows[i], { quantity: e.detail.value });
    this.setData({ rows: rows });
    this.recalc();
  },

  addRow() {
    const rows = this.data.rows.slice();
    rows.push(this.blankRow());
    this.setData({ rows: rows, formError: '' });
  },

  removeRow(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (this.data.rows.length <= 1) {
      this.setData({ formError: '至少保留一行' });
      return;
    }
    const rows = this.data.rows.slice();
    rows.splice(i, 1);
    this.setData({ rows: rows, formError: '' });
    this.recalc();
  },

  /** 逐行重算「该行入账」与合计（纯展示；服务端会重取单件值） */
  recalc() {
    let total = 0;
    const src = this.data.rows;
    const rows = src.map(function (r) {
      const fee = (Number(r.unitFee) || 0) * (Number(r.quantity) || 0);
      total += fee;
      return Object.assign({}, r, { feeText: fmt.money(fee) });
    });
    this.setData({ rows: rows, totalText: fmt.money(total) });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const station = this.data.stations[this.data.stationIndex];
    if (!station) {
      this.setData({ formError: '请选择水站' });
      return;
    }
    const month = String(this.data.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      this.setData({ formError: '月份格式应为 YYYY-MM' });
      return;
    }
    const items = [];
    const rows = this.data.rows;
    for (let i = 0; i < rows.length; i++) {
      const p = this.data.products[rows[i].productIndex];
      const qty = Number(rows[i].quantity) || 0;
      if (!p) {
        this.setData({ formError: '第 ' + (i + 1) + ' 行还没有选择商品' });
        return;
      }
      if (!(qty > 0)) {
        this.setData({ formError: '第 ' + (i + 1) + ' 行数量必须大于 0' });
        return;
      }
      items.push({ productId: p.productId, quantity: qty });
    }

    let count = 0;
    for (let i = 0; i < items.length; i++) count += items[i].quantity;
    const ok = await ui.confirm(
      '确认发行？',
      station.stationName +
        ' · ' +
        items.length +
        ' 个商品 · 共 ' +
        count +
        ' 张水票，预计给该水站入账 ' +
        this.data.totalText +
        ' 积分（按商品档案的单件配送费 × 数量计算，服务端取价）。',
      '确认发行'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    // ⚠️ 幂等指纹只含「水站 + 月份 + 明细」：金额由服务端算，不进指纹（否则同一笔发行在
    //    档案调价前后会得到不同的键，重试就会变成两笔发行）
    const payload = { stationId: station.stationId, month: month, remark: this.data.remark, items: items };
    const key = idem.acquireKey({ scope: 'ISSUE_TICKET_ADMIN', ownerKey: ownerKey, payload: payload });
    try {
      const r = await ui.request.post('/admin/water-tickets/issue', Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      await ui.confirm('发行成功', r.message || '共 ' + r.totalTickets + ' 张水票', '知道了');
      wx.navigateBack();
    } catch (e) {
      // 失败不释放幂等键：原地重试复用同一个键
      this.setData({ formError: e.message || '发行失败' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});

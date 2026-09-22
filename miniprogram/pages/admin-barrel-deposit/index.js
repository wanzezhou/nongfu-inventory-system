// 登记押金 / 退回押金（回桶 · 管理员 · Phase 8b 第 16 域）
// ===========================================================================
// 资金动作：收取 = 公司账户 **+**，退回 = 公司账户 **−**。
// ⚠️ 提交前必须让用户看清「收还是退、对象是谁、几个桶、单价多少、总共多少钱、进/出哪个账户」——
//    押金是「公司欠客户多少桶」的凭据，方向搞反在台账上不会立刻显形。
// ⚠️ 退回数量不能超过该对象该桶型的在押桶数（服务端校验；页面用汇总数据提前提示）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    typeLabels: ['收取押金', '退回押金'],
    typeIndex: 0,
    partyLabels: ['水站', '零售客户'],
    partyIndex: 0,
    barrelTypes: [],
    barrelLabels: [],
    barrelIndex: 0,
    stations: [],
    stationLabels: [],
    stationIndex: 0,
    accounts: [],
    accLabels: [],
    accIndex: 0,
    /* 零售客户输入 */
    customerName: '',
    customerPhone: '',
    quantity: '1',
    unitPrice: '',
    remark: '',
    amountText: '0.00',
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
      const res = await ui.request.get('/admin/barrels/options', null, { silent: true });
      const bt = res.barrelTypes || [];
      const st = res.stations || [];
      const ac = res.activeAccounts || [];
      this.setData({
        barrelTypes: bt,
        barrelLabels: bt.map(function (b) {
          return b.barrelType + '（押金 ¥' + fmt.money(b.depositPrice) + '）';
        }),
        barrelIndex: 0,
        stations: st,
        stationLabels: st.map(function (s) {
          return s.stationName;
        }),
        stationIndex: 0,
        accounts: ac,
        accLabels: ac.map(function (a) {
          return a.accountName + '（余额 ¥' + fmt.money(a.currentBalance) + '）';
        }),
        accIndex: 0,
        // 单价默认取所选桶型的配置价（可改：历史押金价可能不同，强行用现价会记错金额）
        unitPrice: bt.length ? String(bt[0].depositPrice) : ''
      });
      this.recalc();
    } catch (e) {
      this.setData({ loadError: e.message || '选项加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  recalc() {
    const qty = Number(this.data.quantity) || 0;
    const price = Number(this.data.unitPrice) || 0;
    this.setData({ amountText: fmt.money(qty * price) });
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  onPartyChange(e) {
    this.setData({ partyIndex: Number(e.detail.value) });
  },

  onBarrelChange(e) {
    const i = Number(e.detail.value);
    const b = this.data.barrelTypes[i];
    this.setData({ barrelIndex: i, unitPrice: b ? String(b.depositPrice) : this.data.unitPrice });
    this.recalc();
  },

  onStationChange(e) {
    this.setData({ stationIndex: Number(e.detail.value) });
  },

  onAccChange(e) {
    this.setData({ accIndex: Number(e.detail.value) });
  },

  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value });
    this.recalc();
  },

  onPriceInput(e) {
    this.setData({ unitPrice: e.detail.value });
    this.recalc();
  },

  onNameInput(e) {
    this.setData({ customerName: e.detail.value });
  },

  onPhoneInput(e) {
    this.setData({ customerPhone: e.detail.value });
  },

  onRemarkInput(e) {
    this.setData({ remark: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const isReturn = this.data.typeIndex === 1;
    const isCustomer = this.data.partyIndex === 1;
    const barrel = this.data.barrelTypes[this.data.barrelIndex];
    const station = this.data.stations[this.data.stationIndex];
    const acc = this.data.accounts[this.data.accIndex];
    const qty = Number(this.data.quantity) || 0;
    const price = Number(this.data.unitPrice) || 0;

    if (!barrel) {
      this.setData({ formError: '请选择桶型（若列表为空，请先在「桶型配置」新增）' });
      return;
    }
    if (!isCustomer && !station) {
      this.setData({ formError: '请选择水站' });
      return;
    }
    if (isCustomer && !String(this.data.customerName).trim()) {
      this.setData({ formError: '零售客户姓名不能为空' });
      return;
    }
    if (!(qty > 0)) {
      this.setData({ formError: '数量必须大于 0' });
      return;
    }
    if (!(price > 0)) {
      this.setData({ formError: '押金单价必须大于 0' });
      return;
    }
    if (!acc) {
      this.setData({ formError: '请选择资金账户' });
      return;
    }

    const who = isCustomer ? String(this.data.customerName).trim() : station.stationName;
    const ok = await ui.confirm(
      isReturn ? '确认退回押金？' : '确认收取押金？',
      who +
        ' · ' +
        barrel.barrelType +
        ' × ' +
        qty +
        ' 桶，单价 ¥' +
        fmt.money(price) +
        '，合计 ¥' +
        this.data.amountText +
        '。账户「' +
        acc.accountName +
        (isReturn ? '」将**减少**该金额。' : '」将**增加**该金额。'),
      isReturn ? '确认退回' : '确认收取'
    );
    if (!ok) return;

    this.setData({ submitting: true, formError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const payload = {
      depositType: isReturn ? 'return' : 'collect',
      partyType: isCustomer ? 'customer' : 'station',
      stationId: isCustomer ? null : station.stationId,
      customerName: isCustomer ? String(this.data.customerName).trim() : null,
      customerPhone: isCustomer ? this.data.customerPhone || null : null,
      barrelType: barrel.barrelType,
      quantity: qty,
      unitPrice: price,
      accountId: acc.accountId,
      remark: this.data.remark
    };
    const key = idem.acquireKey({ scope: 'CREATE_BARREL_DEPOSIT', ownerKey: ownerKey, payload: payload });
    try {
      const r = await ui.request.post('/admin/barrels/deposits', Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      await ui.confirm('登记成功', r.message + '（单号 ' + r.depositNo + '）', '知道了');
      wx.navigateBack();
    } catch (e) {
      // 失败不释放幂等键：原地重试复用同一个键
      this.setData({ formError: e.message || '登记失败' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});

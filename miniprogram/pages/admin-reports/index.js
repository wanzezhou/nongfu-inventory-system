// 经营报表 · 营收 / 成本 / 利润（管理员 · Phase 8b 第 12~14 域）
// ===========================================================================
// 三个域**共用一个页面**（配置驱动切换）：
//   它们的形状完全相同（区间 + 概览卡 + 按订单类型明细），差别只有「取哪个接口、
//   主数值取哪个字段、副标题怎么拼」—— 这正是文档 §5.8 定式 ⑬「同构域走工厂」的适用场景。
//   分开写三份的代价不是啰嗦，而是「改一处要记得改三处」。
//
// ⚠️ 页面**不自己算任何金额**：所有数字来自服务端，页面只做格式化与拼接。
//    页面算一份、服务端算一份，两边口径必然分叉，而分叉时用户只会认为自己看错了。
// ⚠️ 接口路径必须**字面量**（定式 ⑭）：路径写在下面的 KINDS 配置里，
//    门禁能读到（check-api-paths 的 config 规则）。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');

const KINDS = [
  {
    key: 'revenue',
    label: '营收',
    // ⚠️ 路径写成 routes.list（而不是 endpoint）是**刻意**的：门禁既有的『配置驱动』
    //    识别规则读的就是 list/detail/... 这些键，且它已把「x.routes.y」形态从
    //    『抽不到的字面量』盲区清单里排除（主数据四域用的是 domain.routes.list）。
    //    用别的字段名会让整域的接口在门禁里变成『盲区』—— 看起来只是告警，
    //    实则让这条门禁对本来能静态校验的路径失去校验能力。
    routes: { list: '/admin/reports/revenue' },
    note: '营收 = 订单类(送水到府/水站/业务员/其他) + 机台类(量贩机/零售机，来自机台销量) + 其他收入(手工台账)。其他收入只进总额、不在下方明细里。'
  },
  {
    key: 'cost',
    label: '成本',
    routes: { list: '/admin/reports/cost' },
    note: '成本 = 订单商品成本（进货价 + 工人配送费）。工资与其他支出不在本页，见「成本汇总」口径说明。'
  },
  {
    key: 'profit',
    label: '利润',
    routes: { list: '/admin/reports/profit' },
    note: '利润 = 营收 − 成本。直营水站（水站订单）单独拆「利润1 / 利润2」两段，与 Web 利润页口径一致。'
  }
];

Page({
  data: {
    kinds: KINDS.map(function (k) {
      return { key: k.key, label: k.label };
    }),
    kind: 'revenue',
    range: 'month',
    rangeOptions: [],
    rangeLabels: [],
    rangeIndex: 0,
    summary: [],
    rows: [],
    note: '',
    start: '',
    end: '',
    loading: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch();
  },

  onTab(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.kind) return;
    // 切换报表时区间重置为本月：不同域支持的区间不同（营收没有「本季度」），
    // 沿用上一个域的选择会出现「明明选了本季却按本月算」的不一致。
    this.setData({ kind: key, range: 'month', rangeIndex: 0 });
    this.fetch();
  },

  currentKind() {
    for (let i = 0; i < KINDS.length; i++) if (KINDS[i].key === this.data.kind) return KINDS[i];
    return KINDS[0];
  },

  async fetch() {
    const cur = this.currentKind();
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get(cur.routes.list, { range: this.data.range }, { silent: true });
      const opts = res.rangeOptions || [];
      const labels = opts.map(function (o) {
        return o.label;
      });
      let idx = 0;
      for (let i = 0; i < opts.length; i++) if (opts[i].value === res.range) idx = i;
      this.setData({
        rangeOptions: opts,
        rangeLabels: labels,
        rangeIndex: idx,
        range: res.range,
        start: res.start || '',
        end: res.end || '',
        note: cur.note,
        summary: this.buildSummary(res),
        rows: this.buildRows(res)
      });
    } catch (e) {
      this.setData({ loadError: e.message || '报表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 概览卡：每个域只看 2~4 个数，页面把它拼成统一结构 */
  buildSummary(res) {
    if (res.kind === 'revenue') {
      return [
        { label: '总营收', value: '¥' + fmt.money(res.totalRevenue), strong: true },
        { label: '其中其他收入', value: '¥' + fmt.money(res.otherIncome), strong: false }
      ];
    }
    if (res.kind === 'cost') {
      return [{ label: '订单成本合计', value: '¥' + fmt.money(res.orderCostTotal), strong: true }];
    }
    const o = res.overall || {};
    return [
      { label: '总营收', value: '¥' + fmt.money(o.revenue), strong: false },
      { label: '总成本', value: '¥' + fmt.money(o.costTotal), strong: false },
      { label: '总利润', value: '¥' + fmt.money(o.profit), strong: true },
      { label: '毛利率', value: String(o.margin) + '%', strong: false }
    ];
  },

  /** 明细行：主数值按域取不同字段，副标题写清构成（口径可自查） */
  buildRows(res) {
    const list = res.list || [];
    return list.map(function (x) {
      if (res.kind === 'revenue') {
        return {
          key: x.orderType,
          title: x.typeName,
          main: '¥' + fmt.money(x.revenue),
          sub:
            '货款 ¥' +
            fmt.money(x.goodsAmount) +
            ' · 配送费 ¥' +
            fmt.money(x.deliveryFee) +
            ' · 水票 ¥' +
            fmt.money(x.ticketValue) +
            (x.source === 'machine' ? ' · 机台销量' : '')
        };
      }
      if (res.kind === 'cost') {
        return {
          key: x.orderType,
          title: x.typeName,
          main: '¥' + fmt.money(x.costTotal),
          sub: x.orderCount + ' 单 · ' + x.totalQty + ' 件'
        };
      }
      const direct =
        x.profit1 === null ? '' : '（直营：利润1 ¥' + fmt.money(x.profit1) + ' / 利润2 ¥' + fmt.money(x.profit2) + '）';
      return {
        key: x.orderType,
        title: x.typeName,
        main: '¥' + fmt.money(x.profit),
        sub: '营收 ¥' + fmt.money(x.revenue) + ' − 成本 ¥' + fmt.money(x.costTotal) + direct
      };
    });
  },

  onRangeChange(e) {
    const i = Number(e.detail.value);
    const opt = this.data.rangeOptions[i];
    if (!opt) return;
    this.setData({ rangeIndex: i, range: opt.value });
    this.fetch();
  }
});

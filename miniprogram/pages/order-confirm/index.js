// 确认订单（文档 §7 业务员订货 / §9 水站订单 / §10 配送 / §14 下单即支付 / §23.1 幂等）
// ===========================================================================
// ⚠️ 2026-09-20：**自提（PICKUP）已业务下线，前后端一并移除。**
//    本页原有一整块自提支持（配送/自提切换、自提地点配置拉取与展示、未配置时禁用提示，
//    以及「自提免填地址」的分支）已全部删除。现存口径：
//      · 履约方式恒为 DELIVERY（仍随请求下发，后端是白名单校验，省略会 400）；
//      · **配送地址一律必填**，不存在免地址场景；
//      · 页面不再出现任何「自提」字样或禁用的自提入口。
// ===========================================================================
// 本页是「金额与规则」的交汇点，因此有几条必须守住：
//
//   ① 前端**不计算**订单金额与积分（§22.1 / §22.6）。本页展示的合计只是
//      「单价 × 可计费数量」的**预览**，并明确标注「最终以服务端计价为准」。
//      真正的金额由 POST /mini/orders 在服务端事务内重算。
//
//   ② 业务员成交价：**前端可填**（Phase 3「成交价（前端可填）」），但服务端强制校验最低价
//      （§8.4 / §8.5）。本页做「提前提示」（低于最低价时按钮禁用 + 红字说明），只是体验优化，
//      **不是**安全边界 —— 真正的拦截在服务端。
//      ⚠️ §7.5 业务方已确认（2026-09-20）：自购与代客下单**同样受最低成交价约束**。
//         因此改价入口与最低价提示对两种场景**完全一致**，不得按场景放开。
//
//   ③ 幂等键在「用户点提交的那一刻」生成并持久化，重试复用同一个键（§23.1）。
//      因此提交按钮在请求中会被禁用，且 key 的生成放在 submit 内部而不是页面 onLoad。
//
//   ④ 积分不足 → 明确提示并给「去充值」入口（§14.3），不做「先下单再补款」。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const cart = require('../../utils/cart');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');
const { ROLES, ORDER_SCENE } = require('../../config/index');

/** 金额四舍五入到分（与后端 Math.round(n*100)/100 同口径） */
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** 输入框展示用的数字文本（去掉无意义的末尾 0：「20」而非「20.00」） */
function numText(n) {
  const v = round2(n);
  return Number.isFinite(v) ? String(v) : '0';
}

/**
 * 解析业务员手填的成交价文本（§8.4）
 *
 * 回退口径必须与后端 `orderPricingService.pickItemUnitPrice` **保持一致**：
 * 空 → 回退参考零售价；非法/负数 → 回退参考零售价并由调用方给出红字提示。
 * ⚠️ 这里的回退只影响**预览**；入库金额一律以服务端重算值为准（§22.6），
 *    所以即使两边回退口径将来分叉，也不会算错钱 —— 但会给出不一致的提示，
 *    故仍须同步修改。
 */
function parsePriceInput(raw, fallback) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (s === '') return { value: fallback, invalid: false };
  const n = Number(s);
  if (!isFinite(n) || n < 0) return { value: fallback, invalid: true };
  return { value: round2(n), invalid: false };
}

/**
 * 由当前明细重算「成交价 / 行小计 / 合计预览 / 价格错误 / 积分是否够」
 *
 * 抽成纯函数是为了让 **首次加载** 与 **用户改价** 走同一段计算 ——
 * 两处各写一份的话，「改了价但红字没更新」这类不一致会长期潜伏。
 *
 * @returns {{items: Array, preview: number, priceErrors: string[], balanceEnough: boolean}}
 */
function computePricing(items, balance) {
  let preview = 0;
  const priceErrors = [];

  const next = items.map(it => {
    const row = Object.assign({}, it);

    // 水站订单不可改价：服务端 stripClientUnitPrice 会强制回退分销价（§9.1）
    const isStation = !!row.isStation;
    const parsed = isStation
      ? { value: row.wholesalePrice, invalid: false }
      : parsePriceInput(row.priceInput, row.retailPrice);
    const unitPrice = round2(parsed.value);

    const billableQty = row.quantity - row.ticketQty;
    const lineAmount = round2(unitPrice * billableQty);

    // 提前提示（**非**安全边界，§8.4 / §8.5 / §7.5）
    let priceError = '';
    if (!isStation) {
      if (row.minPrice === null || row.minPrice === undefined) {
        // §8.5：未配置最低价 → 不可下单（不得把「未配置」当成 0 元最低价）
        priceError = '该商品未配置最低成交价，无法下单（请联系管理员配置）';
      } else if (parsed.invalid) {
        priceError = '成交价格式不正确（须为不小于 0 的数字）';
      } else if (unitPrice + 1e-9 < Number(row.minPrice)) {
        priceError = `成交价 ¥${fmt.money(unitPrice)} 低于最低成交价 ¥${fmt.money(row.minPrice)}，无法下单`;
      }
    }
    if (priceError) priceErrors.push(`${row.name}：${priceError}`);

    row.unitPrice = unitPrice;
    row.unitPriceText = fmt.money(unitPrice);
    row.billableQty = billableQty;
    row.lineAmountText = fmt.money(lineAmount);
    row.priceError = priceError;
    preview += lineAmount;
    return row;
  });

  const previewAmount = round2(preview);
  return {
    items: next,
    preview: previewAmount,
    previewAmountText: fmt.money(previewAmount),
    priceErrors,
    // 积分是否够只作提前提示；真正的判定在服务端事务内（§14.2）
    balanceEnough: Number(balance || 0) + 1e-9 >= previewAmount
  };
}

Page({
  data: {
    role: '',
    items: [], // [{ productId, name, spec, quantity, unitPrice, minPrice, ticketQty, ... }]
    wallet: null,

    // 履约方式：自提已于 2026-09-20 下线（前后端一并移除），本期恒为配送。
    // 仍显式放在 data 里并随请求下发，而不是省略该字段：
    // 后端是**白名单**校验（只认 DELIVERY），省略会被判为非法履约方式而 400。
    fulfillmentType: 'DELIVERY',

    // 收货信息
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    addressSource: 'ORDER_CUSTOM', // STATION_DEFAULT | ORDER_CUSTOM（仅水站可选默认）
    stationDefault: null, // { contactName, phoneMasked, phoneConfigured, address }

    // 业务员专用
    orderScene: ORDER_SCENE.CUSTOMER_ORDER,
    remark: '',

    // 预览与校验
    previewAmount: '0.00',
    balanceEnough: true,
    priceErrors: [],
    recentPrices: {},
    submitting: false,
    blocked: '',
    loadError: ''
  },

  onLoad() {
    const me = auth.me();
    if (me && me.account) {
      this.setData({
        role: me.account.role,
        // 业务员默认「代客下单」：自购是少数场景，且两者都受最低价约束（§7.5）
        orderScene: ORDER_SCENE.CUSTOMER_ORDER
      });
    }
  },

  onShow() {
    this.load();
  },

  async load() {
    const me = await ui.pageReady(this);
    if (!me || !me.account) return;
    const role = me.account.role;
    this.setData({ role, blocked: ui.blockedBanner() });

    if (!auth.permissions().canOrder) {
      this.setData({ loadError: '当前身份不能下单（管理员端本期为只读，请使用 Web 管理端）' });
      return;
    }

    const local = cart.items();
    if (!local.length) {
      this.setData({ loadError: '购物车为空，请先添加商品', items: [] });
      return;
    }

    try {
      // 钱包（积分是否够付由服务端最终判定，这里只做提前提示）
      const wallet = await ui.request.get('/wallet', null, { silent: true });

      // ⚠️ 2026-09-20 自提下线：原先这里会拉 /config 的 pickupConfigured 与 /me 的 pickup
      //    （自提地点是否已配置 + 地点文本），据此决定自提选项是否可用。该逻辑已整体删除，
      //    同时 requests 里也少了一次 /config 往返 —— 这也是删功能时应顺手拿回的收益。

      // 逐个取最新商品档案（不信任购物车里的任何历史价格）
      const detail = await Promise.all(
        local.map(async it => {
          const p = await ui.request.get(`/products/${it.productId}`, null, { silent: true });
          return { local: it, p };
        })
      );

      // 先构造「商品档案快照」，成交价与金额交由 computePricing 统一计算
      // （这样用户改价时能复用同一段逻辑，不会出现两套口径）
      const baseItems = detail.map(({ local: it, p }) => {
        const isStation = role === ROLES.STATION;
        const minPrice =
          p.salesmanMinPrice === null || p.salesmanMinPrice === undefined ? null : Number(p.salesmanMinPrice);
        const ticketQty = isStation && it.useTicket ? Math.min(Number(it.ticketQty) || 0, it.quantity) : 0;
        const retailPrice = Number(p.retailPrice) || 0;
        const wholesalePrice = Number(p.wholesalePrice) || 0;

        return {
          productId: it.productId,
          name: p.productName,
          spec: `${p.specification || '—'} · ${p.unit || '件'}`,
          unitText: p.unit || '件',
          imageFull: fmt.imageUrl(p.imageUrl),
          initial: fmt.productInitial(p.productName),
          quantity: it.quantity,
          ticketQty,

          isStation,
          retailPrice,
          retailPriceText: fmt.money(retailPrice),
          wholesalePrice,
          // 业务员成交价的可编辑初值 = 参考零售价。
          // §8.6：历史成交价「只作参考，不自动覆盖当前成交价」→ 不在这里套用历史价。
          // §9.1：水站单价不可改，初值仅用于展示。
          priceInput: numText(isStation ? wholesalePrice : retailPrice),

          minPrice,
          minPriceText: minPrice === null ? '' : fmt.money(minPrice)
        };
      });

      const pricing = computePricing(baseItems, wallet.balance);

      this.setData({
        wallet,
        items: pricing.items,
        previewAmount: pricing.previewAmountText,
        balanceEnough: pricing.balanceEnough,
        priceErrors: pricing.priceErrors,
        loadError: '',
        // 水站默认地址快照（有档案地址才默认选中，否则强制手填）
        stationDefault: (role === ROLES.STATION && p_stationDefault(detail)) || null
      });

      // 水站：预填联系人（地址由用户选择来源）
      if (role === ROLES.STATION && detail.length) {
        const sd = detail[0].p.stationDefault || null;
        if (sd) {
          this.setData({
            stationDefault: sd,
            customerName: this.data.customerName || sd.contactName || '',
            // 电话不回填明文（后端已脱敏）；留空由服务端从水站档案取（§54）
            addressSource: sd.address ? 'STATION_DEFAULT' : 'ORDER_CUSTOM',
            customerAddress: this.data.customerAddress || sd.address || ''
          });
        }
      }
    } catch (e) {
      this.setData({ loadError: e.message || '页面加载失败' });
    }
  },

  // ⚠️ 2026-09-20：「配送 / 自提」切换处理函数 `onFulfillmentChange` 已随自提下线删除。
  //    履约方式恒为 DELIVERY，页面上不再有切换控件，因此也不需要这个 handler
  //    （check-project.js 会校验 WXML 里的事件函数是否存在，留着反而是死代码）。

  onSceneChange(e) {
    this.setData({ orderScene: e.currentTarget.dataset.scene });
  },

  onAddressSourceChange(e) {
    const src = e.currentTarget.dataset.source;
    if (src === 'STATION_DEFAULT') {
      const sd = this.data.stationDefault || {};
      this.setData({ addressSource: src, customerAddress: sd.address || '' });
      return;
    }
    this.setData({ addressSource: src });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch[field] = e.detail.value;
    this.setData(patch);
  },

  /**
   * 业务员手填成交价（Phase 3「成交价（前端可填）」/ §8.4 / §8.5）
   *
   * ⚠️ 三条必须守住：
   *   ① 改价后**立即重算**行小计、合计预览与价格错误 —— 复用 computePricing，
   *      不另写一份计算，否则会出现「红字还在、金额已变」的不一致；
   *   ② 只改**当前行**的 priceInput，不碰其它行（避免整表重算时把未提交的输入抹掉）；
   *   ③ 这里**只做提示**。真正的下界由服务端 assertSalesmanMinPrice 在事务内强制，
   *      前端禁用按钮不是安全边界（§8.4 / §22.6）。
   *   ④ §7.5（业务方 2026-09-20 确认）：自购与代客**同样**受最低成交价约束，
   *      故本处理函数不区分 orderScene。
   */
  onPriceInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const raw = e.detail.value;
    if (!Number.isInteger(index) || index < 0 || index >= this.data.items.length) return;

    const items = this.data.items.map((it, i) => (i === index ? Object.assign({}, it, { priceInput: raw }) : it));
    const wallet = this.data.wallet || {};
    const pricing = computePricing(items, wallet.balance);

    this.setData({
      items: pricing.items,
      previewAmount: pricing.previewAmountText,
      balanceEnough: pricing.balanceEnough,
      priceErrors: pricing.priceErrors
    });
  },

  /**
   * 业务员历史成交价参考（文档 §8.6 / §21.3）
   *
   * ⚠️ 三条口径都必须守住：
   *   ① 只查**当前业务员自己**的历史订单（服务端按令牌里的 worker_id 过滤，
   *      前端传什么 customerPhone 都只能拿到自己的记录）；
   *   ② 历史价**只作参考，不自动覆盖当前成交价** —— 所以这里仅展示，
   *      绝不写回 items[].unitPrice；
   *   ③ 不得向业务员泄露其他业务员的客户价格历史（由服务端保证）。
   */
  async loadCustomerHistory() {
    if (this.data.role !== ROLES.SALESMAN) return;
    const phone = String(this.data.customerPhone || '').trim();
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) {
      this.setData({ recentPrices: {} });
      return;
    }
    const result = {};
    await Promise.all(
      this.data.items.map(async it => {
        try {
          const h = await ui.request.get(
            '/customer-history',
            {
              customerPhone: phone,
              productId: it.productId
            },
            { silent: true }
          );
          if (h && (h.latest !== null || (h.recent || []).length)) {
            result[it.productId] = {
              latestText: h.latest === null ? '' : fmt.money(h.latest),
              recent: (h.recent || []).map(r => fmt.money(r.unitPrice)),
              notice: h.notice
            };
          }
        } catch (e) {
          // 历史价是**辅助信息**，取不到不影响下单 —— 但不能伪造，所以直接不展示
          console.warn('[order-confirm] 历史成交价查询失败：', e.message);
        }
      })
    );
    this.setData({ recentPrices: result });
  },

  /** 提交订单（含幂等键） */
  async submit() {
    if (this.data.submitting) return;

    // 前置校验（体验优化；服务端仍会全部重校验）
    const role = this.data.role;
    // 自提下线后所有订单都是配送单 → 地址一律必填（原先「自提免地址」的分支已删）
    if (!this.data.customerAddress.trim()) {
      ui.showError({ message: '配送地址不能为空' });
      return;
    }
    if (!this.data.customerName.trim()) {
      ui.showError({ message: '客户姓名不能为空' });
      return;
    }
    // 水站选「水站默认地址」时电话可由服务端补；其余场景必须填
    const needPhone = !(role === ROLES.STATION && this.data.addressSource === 'STATION_DEFAULT');
    if (needPhone && !this.data.customerPhone.trim()) {
      ui.showError({ message: '客户电话不能为空' });
      return;
    }
    if (this.data.priceErrors.length) {
      ui.showError({ message: this.data.priceErrors[0] });
      return;
    }
    if (!this.data.balanceEnough) {
      const go = await ui.confirm('积分不足', '当前积分不足以支付本单，请先由管理员调增积分后再下单。', '知道了');
      if (go) wx.navigateTo({ url: '/pages/wallet-recharge/index' });
      return;
    }
    if (auth.isBlocked()) {
      ui.showError({ message: ui.blockedBanner() });
      return;
    }

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId}`;

    // 订单请求体（**全部驼峰**；后端全局 normalizeBody 做蛇形→驼峰，故这里必须是驼峰）
    const payload = {
      fulfillmentType: this.data.fulfillmentType,
      orderScene: role === ROLES.SALESMAN ? this.data.orderScene : undefined,
      customerName: this.data.customerName.trim(),
      customerPhone: this.data.customerPhone.trim() || undefined,
      customerAddress: this.data.customerAddress.trim(),
      addressSource: role === ROLES.STATION ? this.data.addressSource : undefined,
      remark: this.data.remark.trim() || undefined,
      items: this.data.items.map(it => ({
        productId: it.productId,
        quantity: it.quantity,
        // ⚠️ 水站订单**刻意不传** unitPrice：服务端 §9.1 会强制用分销价，
        //    传了也会被忽略（stripClientUnitPrice）；这里不传是为了让意图更明确。
        unitPrice: role === ROLES.STATION ? undefined : it.unitPrice,
        useTicket: role === ROLES.STATION ? it.ticketQty > 0 : undefined,
        ticketQty: role === ROLES.STATION ? it.ticketQty : undefined
      }))
    };

    // 幂等键：在「点提交的那一刻」生成；同内容重试复用同一个键（§23.1）
    const clientRequestId = idem.acquireKey({
      scope: 'CREATE_ORDER',
      ownerKey,
      payload
    });

    this.setData({ submitting: true });
    try {
      const res = await ui.request.post('/orders', Object.assign({ clientRequestId }, payload), {
        silent: true,
        loadingText: '提交中'
      });
      idem.rememberResult({ orderId: res.orderId, replayed: res.replayed });
      idem.releaseKey();
      // 下单成功后清掉已下单的商品（保留失败/未选中的）
      cart.clearMany(this.data.items.map(it => it.productId));
      wx.showToast({ title: res.replayed ? '订单已提交' : '下单成功', icon: 'success' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/order-detail/index?id=${res.orderId}` });
      }, 600);
    } catch (e) {
      // 失败时不释放幂等键：用户点「重试」时复用同一个键，避免重复下单
      if (e.code === 401) return;
      if (/积分不足/.test(e.message || '')) {
        const go = await ui.confirm('积分不足', e.message, '去充值');
        if (go) wx.navigateTo({ url: '/pages/wallet-recharge/index' });
      } else {
        ui.showError(e, '下单失败，请稍后重试');
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});

/** 从详情数组里取水站默认快照（有的商品接口才带，取第一个存在的即可） */
function p_stationDefault(detail) {
  for (const d of detail) {
    if (d.p && d.p.stationDefault) return d.p.stationDefault;
  }
  return null;
}

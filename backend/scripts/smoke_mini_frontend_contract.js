/**
 * 冒烟测试：小程序「前端契约」—— 页面会调用的每个读接口是否都能正常返回
 * ===========================================================================
 * 与 smoke_mini_program.js 的分工：
 *   那个脚本验证**业务规则与资金纪律**（最低价、钱包恒等式、幂等、禁用、水票抵扣…）；
 *   本脚本验证**页面能不能渲染出来** —— 即小程序 15 个页面实际调用的接口，
 *   是否都返回 200，且响应里**存在页面 WXML 绑定的那些字段**。
 *
 * 为什么需要单独一个：后端把字段改名（如 wallet.balanceText → wallet.balance）、
 * 或某个页面调用了不存在的路径时，接口本身不会报错、冒烟也不会红，
 * 但用户打开页面会看到一片空白。这类问题只有「按页面视角逐个拉一遍」才会暴露。
 *
 * 用法：node scripts/smoke_mini_frontend_contract.js（需后端已启动）
 * 测试数据自建并以 smoke_ 前缀标记，finally 统一清理。
 */
const BASE = 'http://localhost:3000/api';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...json };
}

let pass = 0;
let fail = 0;
const assert = (cond, name, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? '  ← ' + extra : ''}`);
  }
};

/** 断言对象含有指定字段（页面 WXML 直接绑定的字段，缺一个就是白屏/undefined） */
const hasFields = (obj, fields) => fields.every(f => obj && obj[f] !== undefined);

const TS = Date.now().toString(36).toUpperCase();
const S = {
  workerId: `SMKWD${TS}`,
  workerPhone: `137${String(Date.now()).slice(-8)}`,
  stationId: `SMKST${TS}`,
  stationPhone: `136${String(Date.now()).slice(-8)}`,
  productId: `SMKPR${TS}`,
  productCode: `SMK${TS}`
};

async function main() {
  const { pool } = require('../src/config/db');
  const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
  const walletService = require('../src/services/walletService');
  const { signMiniToken } = require('../src/services/miniAccountService');

  try {
    console.log('准备冒烟数据…');
    // 商品：开启业务员小程序可售 + 配最低价 + 有水票（水站维度）
    await pool.query(
      `INSERT INTO workers (worker_id, worker_name, phone, employee_type, commission_rate, status, created_at, updated_at)
       VALUES (?, '冒烟前台业务员', ?, 3, 0.00, 1, NOW(), NOW())`,
      [S.workerId, S.workerPhone]
    );
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, credit_limit, current_debt, payment_type, status, created_at, updated_at)
       VALUES (?, '冒烟前台水站', '冒烟联系人', ?, '南京市冒烟路1号', 0.00, 0.00, 1, 1, NOW(), NOW())`,
      [S.stationId, S.stationPhone]
    );
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
         distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
         worker_machine_delivery_fee, category, status, salesman_mini_enabled, salesman_min_price,
         created_at, updated_at)
       VALUES (?, ?, '冒烟前台商品', '19L', '桶', 10.00, 50.00, 20.00, 0.00, 2.00, 3.00, 1.00, 0.50, 0.00, '冒烟分类', 1, 1, 18.00, NOW(), NOW())`,
      [S.productId, S.productCode]
    );
    await pool.query('INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 500, NOW())', [S.productId]);
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟水票')`,
      [`SMKTK${TS}`, S.productId, S.stationId]
    );

    const [adminUser] = await pool.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    const adminTargetId = String(adminUser[0].id);

    for (const [openid, phone, role, target] of [
      [`smoke_fe_salesman_${TS}`, S.workerPhone, 'salesman', S.workerId],
      [`smoke_fe_station_${TS}`, S.stationPhone, 'station', S.stationId],
      [`smoke_fe_admin_${TS}`, '13500000009', 'admin', adminTargetId]
    ]) {
      await pool.query(
        `INSERT INTO mini_accounts (openid, phone, role, target_id, status, created_at)
         VALUES (?, ?, ?, ?, 1, NOW())`,
        [openid, phone, role, target]
      );
    }
    const [ids] = await pool.query(`SELECT id, role FROM mini_accounts WHERE openid LIKE 'smoke\\_fe\\_%' ORDER BY id`);
    const byRole = {};
    ids.forEach(r => {
      byRole[r.role] = r.id;
    });

    // 钱包注入（走正规事务路径）
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const [type, owner] of [
      ['SALESMAN', S.workerId],
      ['STATION', S.stationId]
    ]) {
      const w = await walletService.ensureWallet(conn, { ownerType: type, ownerId: owner, ownerName: '冒烟前台' });
      const row = await walletService.loadWalletForUpdate(conn, w.wallet_id);
      await walletService.creditWallet(conn, row, {
        txType: 'ADJUST_IN',
        amount: 500,
        relatedType: 'MANUAL_ADJUST',
        operatorId: 'smoke',
        remark: '冒烟注入积分'
      });
    }
    await conn.commit();
    conn.release();

    const tokenSalesman = signMiniToken({ id: byRole.salesman, role: 'salesman', target_id: S.workerId });
    const tokenStation = signMiniToken({ id: byRole.station, role: 'station', target_id: S.stationId });
    const tokenAdmin = signMiniToken({ id: byRole.admin, role: 'admin', target_id: adminTargetId });

    // ── 1. 登录页：GET /config（免鉴权） ────────────────────────────────────
    console.log('\n1. 登录页 pages/login —— GET /config');
    const cfg = await call('GET', '/mini/config');
    assert(cfg.code === 200, `GET /config 返回 200：${cfg.code}`);
    assert(
      hasFields(cfg.data, ['devLoginEnabled', 'wxLoginConfigured', 'tokenTtl', 'messages']),
      'config 含登录页绑定的字段',
      JSON.stringify(cfg.data).slice(0, 200)
    );
    assert(cfg.data.messages && cfg.data.messages.needBind !== undefined, 'config.messages 含前端提示文案');
    // ⚠️ 2026-09-20 自提下线：`pickupConfigured` 与 `messages.pickupNotConfigured` 已从响应中移除。
    //    这里反向断言它们**不再出现** —— 避免有人「顺手」把字段加回去而前端早已不再消费，
    //    形成两端认知不一致的僵尸字段。
    assert(cfg.data.pickupConfigured === undefined, 'config 不再下发已下线的 pickupConfigured');
    assert(cfg.data.messages.pickupNotConfigured === undefined, 'config.messages 不再含自提提示文案');

    // ── 2. 我的 / 身份 ──────────────────────────────────────────────────────
    console.log('\n2. 我的 pages/mine —— GET /me');
    for (const [label, token] of [
      ['业务员', tokenSalesman],
      ['水站', tokenStation],
      ['管理员', tokenAdmin]
    ]) {
      const me = await call('GET', '/mini/me', null, token);
      assert(me.code === 200, `${label} GET /me 返回 200：${me.code}`);
      assert(
        hasFields(me.data, ['account', 'subject', 'role', 'permissions']),
        `${label} /me 含 mine 页绑定字段`,
        JSON.stringify(me.data).slice(0, 200)
      );
      assert(me.data.pickup === undefined, `${label} /me 不再下发已下线的 pickup（自提地点配置）`);
      assert(me.data.permissions && me.data.permissions.canOrder !== undefined, `${label} permissions 含 canOrder`);
      // 业务员/水站有钱包；管理员没有
      if (label !== '管理员') {
        assert(
          !!me.data.wallet && hasFields(me.data.wallet, ['balance', 'identityOk', 'byType']),
          `${label} /me 含钱包（mine 页显示积分）`
        );
      }
    }

    // ── 3. 首页 ─────────────────────────────────────────────────────────────
    console.log('\n3. 首页（三角色）');
    const homeSalesman = await call('GET', '/mini/home', null, tokenSalesman);
    assert(homeSalesman.code === 200, `业务员 GET /home 200：${homeSalesman.code}`);
    assert(
      hasFields(homeSalesman.data, ['role', 'wallet', 'today', 'month', 'pipeline', 'recentOrders']),
      '业务员首页含 WXML 绑定字段',
      JSON.stringify(homeSalesman.data).slice(0, 220)
    );
    assert(hasFields(homeSalesman.data.today, ['orderCount']), 'today.orderCount 存在');
    assert(hasFields(homeSalesman.data.month, ['orderCount', 'orderAmount']), 'month 字段存在');

    const homeStation = await call('GET', '/mini/home', null, tokenStation);
    assert(homeStation.code === 200, `水站 GET /home 200：${homeStation.code}`);
    assert(hasFields(homeStation.data, ['wallet', 'month', 'pipeline', 'waterTickets']), '水站首页含绑定字段');
    assert(hasFields(homeStation.data.month, ['recharge', 'distributionPoints']), '水站 month 含充值/分销配送费积分');

    const homeAdmin = await call('GET', '/mini/home', null, tokenAdmin);
    assert(homeAdmin.code === 200, `管理员 GET /home 200：${homeAdmin.code}`);
    assert(homeAdmin.data.role === 'ADMIN', '管理员首页标识别为 ADMIN（前端据此渲染仪表盘）');

    // ── 4. 商城 / 商品详情 ──────────────────────────────────────────────────
    console.log('\n4. 商城 pages/mall + 商品详情 pages/product-detail');
    const cats = await call('GET', '/mini/products/categories', null, tokenSalesman);
    assert(cats.code === 200 && Array.isArray(cats.data.list), 'GET /products/categories 返回列表');
    assert(
      cats.data.list.some(c => c.category === '冒烟分类'),
      '分类包含冒烟分类（断言不空转）'
    );

    const prods = await call('GET', '/mini/products?page=1&pageSize=10', null, tokenSalesman);
    assert(prods.code === 200 && Array.isArray(prods.data.list), 'GET /products 分页返回列表');
    assert(hasFields(prods.data, ['list', 'total', 'page', 'pageSize']), '分页信封字段齐备');
    const mine = prods.data.list.find(p => p.productId === S.productId);
    assert(!!mine, '业务员可见冒烟商品（salesman_mini_enabled=1 且已配最低价）');
    assert(mine && mine.salesmanMinPrice === 18, '业务员维度返回 salesmanMinPrice');
    assert(mine && mine.wholesalePrice === undefined, '业务员维度**不**下发分销价（按角色裁剪价格）');

    const prodStation = await call('GET', '/mini/products?page=1&pageSize=10', null, tokenStation);
    const mineSt = prodStation.data.list.find(p => p.productId === S.productId);
    assert(!!mineSt && mineSt.wholesalePrice === 50, '水站维度返回分销价');

    const detail = await call('GET', `/mini/products/${S.productId}`, null, tokenSalesman);
    assert(detail.code === 200, `GET /products/:id 200：${detail.code}`);
    // ⚠️ 只断言**接口自己拥有的字段**。priceLabel / priceText / imageFull 是前端按角色
    //    拼出来的展示字段（见 miniprogram/pages/product-detail/index.js），不在接口契约里 ——
    //    把前端派生字段写进接口契约断言会变成假红（项目门禁的构造性误报会让人忽略告警）。
    assert(
      hasFields(detail.data, [
        'productId',
        'productName',
        'productCode',
        'specification',
        'unit',
        'category',
        'imageUrl',
        'retailPrice',
        'salesmanMinPrice'
      ]),
      '详情页依赖的接口字段齐备',
      JSON.stringify(detail.data).slice(0, 220)
    );

    // 确认订单页的「成交价输入框」依赖这两个值的**具体取值**，而非仅仅存在：
    //   retailPrice     → 输入框初值（也即用户不改价时提交的成交价）
    //   salesmanMinPrice→ 输入框下界提示 + 提交前置灰判据（§8.4 / §8.5 / §7.5）
    // 只断言「字段存在」的话，接口把最低价下发错（比如回退成 0）仍然全绿 —— 那正是
    // §8.5 要防的「0 元最低价」。故此处钉住数值。
    assert(
      Number(detail.data.retailPrice) === 20,
      `成交价输入框初值来源 retailPrice = 20：实得 ${detail.data.retailPrice}`
    );
    assert(
      Number(detail.data.salesmanMinPrice) === 18,
      `成交价下界 salesmanMinPrice = 18：实得 ${detail.data.salesmanMinPrice}`
    );

    const detailStation = await call('GET', `/mini/products/${S.productId}`, null, tokenStation);
    assert(
      detailStation.data.availableTicketQty === 1,
      `水站详情返回可用水票数（§30 水票页）：实得 ${detailStation.data.availableTicketQty}`
    );
    assert(!!detailStation.data.stationDefault, '水站详情返回 stationDefault（下单页「水站默认地址」来源）');
    assert(detailStation.data.stationDefault.phoneMasked !== undefined, 'stationDefault 手机号已脱敏（§54）');

    // ── 5. 下单 → 订单列表 / 详情 ──────────────────────────────────────────
    console.log('\n5. 确认订单 → 订单列表 / 详情');
    const created = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_fe_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'CUSTOMER_ORDER',
        customerName: '冒烟前台客户',
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: S.productId, quantity: 2, unitPrice: 20 }]
      },
      tokenSalesman
    );
    assert(created.code === 200, `下单成功：${created.code} ${created.message || ''}`);
    const orderId = created.data && created.data.orderId;

    const orderList = await call('GET', '/mini/orders?status=ALL&page=1&pageSize=10', null, tokenSalesman);
    assert(orderList.code === 200 && Array.isArray(orderList.data.list), 'GET /orders 返回列表');
    const row = orderList.data.list.find(o => o.orderId === orderId);
    assert(!!row, '新建订单出现在列表里');
    assert(
      hasFields(row, [
        'orderId',
        'fulfillmentStatusLabel',
        'refundStatus',
        'orderAmount',
        'customerName',
        'itemCount',
        'createdAt',
        'canCancel',
        'canRefund'
      ]),
      '列表行含 order-list 页绑定字段',
      JSON.stringify(row).slice(0, 220)
    );

    const detail2 = await call('GET', `/mini/orders/${orderId}`, null, tokenSalesman);
    assert(detail2.code === 200, `GET /orders/:id 200：${detail2.code}`);
    assert(
      hasFields(detail2.data, [
        'orderId',
        'sourceLabel',
        'buyerLabel',
        'paymentMethodLabel',
        'amount',
        'items',
        'delivery',
        'fulfillmentStatusLabel',
        'refundStatusLabel',
        'walletTransactions',
        'createdAt'
      ]),
      '§32 订单详情字段齐备',
      JSON.stringify(detail2.data).slice(0, 240)
    );
    assert(hasFields(detail2.data.amount, ['orderAmount', 'totalReceivable', 'pointsPaid']), '金额块含积分字段');
    assert(detail2.data.delivery.deliveryTypeLabel !== undefined, '配送方式展示文案存在');
    assert(
      detail2.data.walletTransactions.payment && detail2.data.walletTransactions.payment.transactionNo,
      '§32 要求显示的钱包流水号存在'
    );
    assert(detail2.data.items[0].minPriceCheck !== null, '业务员订单回传最低成交价校验结果（§32 末段）');

    // 历史成交价（§21.3 / §8.6）
    const hist = await call(
      'GET',
      `/mini/customer-history?customerPhone=13911112222&productId=${S.productId}`,
      null,
      tokenSalesman
    );
    assert(hist.code === 200, `GET /customer-history 200：${hist.code}`);
    assert(hist.data.latest === 20, `历史最新成交价 = 20：实得 ${hist.data.latest}`);
    assert(Array.isArray(hist.data.recent) && hist.data.recent.length >= 1, 'recent 数组非空（断言不空转）');
    assert(!!hist.data.notice, '回传「仅供参考不自动套用」提示（§8.6）');
    // 水站没有自由成交价概念 → 该接口应拒绝
    const histStation = await call(
      'GET',
      `/mini/customer-history?customerPhone=13911112222&productId=${S.productId}`,
      null,
      tokenStation
    );
    assert(histStation.code === 403, `水站访问历史成交价被拒（403）：实得 ${histStation.code}`);

    // ── 6. 钱包 / 流水 / 充值 ───────────────────────────────────────────────
    console.log('\n6. 积分钱包 pages/wallet + 流水 + 充值');
    const wallet = await call('GET', '/mini/wallet', null, tokenSalesman);
    assert(wallet.code === 200, `GET /wallet 200：${wallet.code}`);
    assert(
      hasFields(wallet.data, [
        'balance',
        'totalIn',
        'totalOut',
        'initialBalance',
        'identityOk',
        'byType',
        'equivalentRmb',
        'tips'
      ]),
      '钱包页绑定字段齐备',
      JSON.stringify(wallet.data).slice(0, 240)
    );
    assert(
      wallet.data.tips && wallet.data.tips.wechatPayNotOpen,
      '钱包页含「微信充值未开通」提示文案（前端绑定 wallet.tips.wechatPayNotOpen）'
    );

    const txs = await call('GET', '/mini/wallet/transactions?page=1&pageSize=15', null, tokenSalesman);
    assert(txs.code === 200 && Array.isArray(txs.data.list), 'GET /wallet/transactions 返回列表');
    const tx = txs.data.list[0];
    assert(
      hasFields(tx, [
        'transactionId',
        'transactionNo',
        'typeLabel',
        'signedAmount',
        'direction',
        'balanceAfter',
        'type',
        'createdAt',
        'relatedType'
      ]),
      '流水行含 wallet-transactions 页绑定字段',
      JSON.stringify(tx).slice(0, 220)
    );
    const filtered = await call(
      'GET',
      '/mini/wallet/transactions?type=ORDER_PAYMENT&page=1&pageSize=15',
      null,
      tokenSalesman
    );
    assert(
      filtered.code === 200 && filtered.data.list.every(t => t.type === 'ORDER_PAYMENT'),
      '按类型筛选生效（§33 流水筛选）'
    );

    const recharge = await call('POST', '/mini/wallet/recharge', { amount: 100 }, tokenSalesman);
    assert(recharge.code === 503, `充值接口按 §13.8 返回「未开通」（503）：实得 ${recharge.code}`);
    assert(/未开通|未就绪/.test(recharge.message || ''), `充值提示文案明确：${recharge.message}`);

    // ── 7. 水票（水站） ─────────────────────────────────────────────────────
    console.log('\n7. 水票 pages/station-tickets');
    const tickets = await call('GET', '/mini/water-tickets', null, tokenStation);
    assert(tickets.code === 200, `GET /water-tickets 200：${tickets.code}`);
    assert(
      Array.isArray(tickets.data.list) && tickets.data.totalAvailable === 1,
      `水票列表与合计正确（1 张）：${tickets.data.totalAvailable}`
    );
    const tk = tickets.data.list[0];
    assert(
      hasFields(tk, ['productId', 'productName', 'availableQty', 'usedQty', 'voidQty', 'months']),
      '水票行含 station-tickets 页绑定字段'
    );
    assert(tk.months.length > 0 && tk.months[0].month, '§30 要求显示水票月份');
    const tkSum = await call('GET', '/mini/water-tickets/summary', null, tokenStation);
    assert(tkSum.code === 200 && tkSum.data.totalAvailable === 1, 'GET /water-tickets/summary 正确');
    const tkBySalesman = await call('GET', '/mini/water-tickets', null, tokenSalesman);
    assert(tkBySalesman.code === 403, `业务员访问水票被拒（403）：实得 ${tkBySalesman.code}`);

    // ── 8. 管理员仪表盘 / 钱包后台 ──────────────────────────────────────────
    console.log('\n8. 管理员仪表盘 + 钱包后台 pages/admin-wallet');
    const dash = await call('GET', '/mini/admin/dashboard', null, tokenAdmin);
    assert(dash.code === 200, `GET /admin/dashboard 200：${dash.code}`);
    assert(
      hasFields(dash.data, [
        'today',
        'month',
        'pipeline',
        'inventory',
        'waterTickets',
        'stationPoints',
        'methodology',
        'writeNotice'
      ]),
      '仪表盘含首页 WXML 绑定字段',
      JSON.stringify(Object.keys(dash.data || {})).slice(0, 200)
    );
    assert(hasFields(dash.data.month, ['revenue', 'cost', 'profit']), '本月营收/成本/利润存在');
    assert(hasFields(dash.data.month.revenue, ['order', 'machine', 'otherIncome', 'total']), '营收构成字段齐备');
    assert(hasFields(dash.data.month.cost, ['order', 'salary', 'otherExpense', 'total']), '成本构成字段齐备');
    assert(hasFields(dash.data.pipeline, ['pendingStock', 'delivering', 'unpaidOrders', 'refunding']), '待办字段齐备');
    // ⚠️ 2026-09-20 自提下线：`readyForPickup` 已从 pipeline 移除，这里反向断言它不再出现
    //    （契约冒烟的价值就在于「后端字段一改，前端绑定立刻报警」—— 这一条正是它抓出来的）
    assert(dash.data.pipeline.readyForPickup === undefined, 'pipeline 不再含已下线的 readyForPickup');
    assert(hasFields(dash.data.inventory, ['outOfStock', 'lowStock', 'threshold', 'detail']), '库存预警字段齐备');

    const ov = await call('GET', '/mini/wallet/admin/overview', null, tokenAdmin);
    assert(ov.code === 200, `GET /wallet/admin/overview 200：${ov.code}`);
    assert(hasFields(ov.data, ['list', 'totalBalance', 'count', 'totals']), '钱包总览字段齐备');
    const target = ov.data.list.find(w => w.walletId);
    assert(!!target, '钱包列表非空（断言不空转）');

    const wd = await call(
      'GET',
      `/mini/wallet/admin/${target.walletId}/transactions?page=1&pageSize=50`,
      null,
      tokenAdmin
    );
    assert(wd.code === 200, `GET /wallet/admin/:walletId/transactions 200：${wd.code}`);
    assert(hasFields(wd.data, ['wallet', 'transactions', 'reconciliation']), '钱包详情含 admin-wallet 页绑定字段');
    assert(
      hasFields(wd.data.reconciliation, ['openingBalance', 'totalIn', 'totalOut', 'closingBalance', 'identityOk']),
      '对账块字段齐备'
    );
    assert(wd.data.wallet.identityOk === true, '对账恒等式成立');

    const adj = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: target.walletId,
        direction: 'IN',
        amount: 5,
        reason: '冒烟前台契约校验',
        clientRequestId: `smoke_fe_adj_${TS}`
      },
      tokenAdmin
    );
    assert(adj.code === 200, `管理员手工调增积分可用（§18）：${adj.code} ${adj.message || ''}`);
    assert(adj.data && adj.data.transactionNo, '调增返回流水号');

    // ── 9. 页面未登录时应被挡在登录页 ───────────────────────────────────────
    console.log('\n9. 未登录访问');
    const noAuth = await call('GET', '/mini/me');
    assert(noAuth.code === 401, `无令牌访问 /me 返回 401：${noAuth.code}`);
    const badToken = await call('GET', '/mini/me', null, 'not-a-real-token');
    assert(badToken.code === 401, `伪造令牌返回 401：${badToken.code}`);
  } finally {
    try {
      await cleanupSmokeResidue(pool, { log: console.log });
    } catch (e) {
      console.log(`  [清理] ⚠️ 清理失败：${e.message}`);
    }
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('冒烟异常:', e);
  process.exit(1);
});

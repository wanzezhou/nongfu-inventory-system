/**
 * 冒烟测试：微信订货小程序 · 身份隔离 / 钱包资金纪律 / 订单统一（2026-09-20）
 * ===========================================================================
 * 覆盖文档验收条款：
 *   §44.11 令牌隔离与禁用即时生效（① ② ③ ④ ⑤）
 *   §44.12 钱包资金纪律（① ② ③ ④ ⑤）
 *   §44.13 分销配送费入账口径 —— 本期只验「迁移已拆列 + 存量回填无偏差」（Phase 7 未接入）
 *   §44.14 配送 —— ⚠️ **自提已于 2026-09-20 下线，本条款的「自提」部分（① ② ④）随之作废**，
 *          第 7 节改为验证「自提已下线：构造 PICKUP 及其变体被拒 + 无免地址场景」；
 *          原 ③（水站地址快照不变）与自提无关，保留在第 7 节。
 *   §44.4  水站订单不增加欠款
 *   §44.2  业务员最低成交价
 *   §8.4   下界（低于最低价拒单）与**上界**（高于参考零售价放行）两侧都验 ——
 *          上界用例在第 14 节（放在所有绝对基线之后，见该节注释）
 *   §7.5   自购 / 代客**同样**受最低成交价约束（业务方 2026-09-20 确认；
 *          两种场景各一条断言 + 拒绝路径不留痕，见第 2 节）
 *   §45    幂等（同一 client_request_id 串行重复提交）、退款幂等、禁用后继续调用
 *
 * ⚠️ 运行前必须重启后端（否则测的是旧代码），且后端需已启动：
 *     cd backend && node src/app.js
 *     node scripts/smoke_mini_program.js
 *
 * ⚠️ 测试数据全部自建（冒烟业务员 / 冒烟水站 / SMK 前缀商品 / 冒烟客户名），
 *    finally 调 cleanupSmokeResidue 清理；**不使用任何真实业务数据当测试对象**。
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
const section = t => console.log(`\n${t}`);

// 唯一后缀，避免并行/重跑冲突
const TS = Date.now().toString(36).toUpperCase();
const SMOKE = {
  workerId: `SMKWD${TS}`,
  workerPhone: `137${String(Date.now()).slice(-8)}`,
  stationId: `SMKST${TS}`,
  stationPhone: `136${String(Date.now()).slice(-8)}`,
  productId: `SMKPR${TS}`,
  productCode: `SMK${TS}`,
  customerName: `冒烟客户${TS}`
};

const MIN_PRICE = 18; // 业务员最低成交价
const RETAIL = 20; // 零售价（成交价 >= 18，应放行）
const WHOLESALE = 50; // 水站分销价

async function main() {
  const { pool } = require('../src/config/db');
  const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
  const walletService = require('../src/services/walletService');
  const { signMiniToken } = require('../src/services/miniAccountService');

  let conn = null;
  // ⚠️ 2026-09-20 自提下线：原先这里要为 `mini_self_pickup_address` 做「快照 → 还原」，
  //    因为冒烟会临时给它赋值来测「配置后自提可下单」。自提移除后该键已被迁移删除、
  //    也无代码读取，故整块快照/还原逻辑随之删除（第 7 节改为验证「构造 PICKUP 被拒」）。
  try {
    // ══════════════════════ 0. 准备测试数据 ══════════════════════
    section('0. 准备冒烟数据（自建业务员 / 水站 / 商品 / 小程序账号 / 钱包）');

    conn = await pool.getConnection();

    await conn.query(
      `INSERT INTO workers (worker_id, worker_name, phone, employee_type, commission_rate, status, created_at, updated_at)
       VALUES (?, '冒烟业务员', ?, 3, 0.00, 1, NOW(), NOW())`,
      [SMOKE.workerId, SMOKE.workerPhone]
    );
    await conn.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, credit_limit, current_debt, payment_type, status, created_at, updated_at)
       VALUES (?, '冒烟水站', '冒烟联系人', ?, '南京市冒烟区冒烟路1号', 0.00, 0.00, 1, 1, NOW(), NOW())`,
      [SMOKE.stationId, SMOKE.stationPhone]
    );
    await conn.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
         distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
         worker_machine_delivery_fee, category, status,
         salesman_mini_enabled, salesman_min_price, created_at, updated_at)
       VALUES (?, ?, '冒烟商品19L', '19L', '桶', 10.00, ?, ?, 0.00, 2.00, 3.00, 1.00, 0.50, 0.00, '冒烟', 1, 1, ?, NOW(), NOW())`,
      [SMOKE.productId, SMOKE.productCode, WHOLESALE, RETAIL, MIN_PRICE]
    );
    await conn.query(`INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 1000, NOW())`, [
      SMOKE.productId
    ]);

    // 小程序账号：业务员 / 水站 / 管理员
    const [adminUser] = await conn.query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!adminUser.length) throw new Error('库中没有 admin 用户，无法测试管理员侧');
    const adminTargetId = String(adminUser[0].id);

    await conn.query(
      `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
       VALUES (?, ?, 'salesman', ?, '冒烟业务员', 1, NOW())`,
      [`smoke_salesman_${TS}`, SMOKE.workerPhone, SMOKE.workerId]
    );
    const [smRes] = await conn.query(`SELECT id FROM mini_accounts WHERE openid = ?`, [`smoke_salesman_${TS}`]);
    const salesmanAccountId = smRes[0].id;

    await conn.query(
      `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
       VALUES (?, ?, 'station', ?, '冒烟水站', 1, NOW())`,
      [`smoke_station_${TS}`, SMOKE.stationPhone, SMOKE.stationId]
    );
    const [stRes] = await conn.query(`SELECT id FROM mini_accounts WHERE openid = ?`, [`smoke_station_${TS}`]);
    const stationAccountId = stRes[0].id;

    await conn.query(
      `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
       VALUES (?, ?, 'admin', ?, '冒烟管理员', 1, NOW())`,
      [`smoke_admin_${TS}`, '13500000000', adminTargetId]
    );
    const [adRes] = await conn.query(`SELECT id FROM mini_accounts WHERE openid = ?`, [`smoke_admin_${TS}`]);
    const adminAccountId = adRes[0].id;

    // 钱包：开立并各注入 1000 积分（走 applyTransaction，即受审计的正规路径）
    await conn.beginTransaction();
    try {
      const wSalesman = await walletService.ensureWallet(conn, {
        ownerType: 'SALESMAN',
        ownerId: SMOKE.workerId,
        ownerName: '冒烟业务员'
      });
      const wStation = await walletService.ensureWallet(conn, {
        ownerType: 'STATION',
        ownerId: SMOKE.stationId,
        ownerName: '冒烟水站'
      });
      for (const w of [wSalesman, wStation]) {
        const row = await walletService.loadWalletForUpdate(conn, w.wallet_id);
        await walletService.creditWallet(conn, row, {
          txType: 'ADJUST_IN',
          amount: 1000,
          relatedType: 'MANUAL_ADJUST',
          operatorId: 'smoke',
          remark: '冒烟注入积分'
        });
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }

    conn.release();
    conn = null;

    const [ws] = await pool.query(
      "SELECT wallet_id FROM wallet_accounts WHERE owner_type = 'SALESMAN' AND owner_id = ?",
      [SMOKE.workerId]
    );
    const [wt] = await pool.query(
      "SELECT wallet_id FROM wallet_accounts WHERE owner_type = 'STATION' AND owner_id = ?",
      [SMOKE.stationId]
    );
    const salesmanWalletId = ws[0].wallet_id;
    const stationWalletId = wt[0].wallet_id;
    console.log(`  业务员钱包 ${salesmanWalletId} / 水站钱包 ${stationWalletId}（各 1000 积分）`);

    // 令牌：直接签发（冒烟测的是接口层，不走微信 code2session）
    const salesmanToken = signMiniToken({ id: salesmanAccountId, role: 'salesman', target_id: SMOKE.workerId });
    const stationToken = signMiniToken({ id: stationAccountId, role: 'station', target_id: SMOKE.stationId });
    const adminTokenMini = signMiniToken({ id: adminAccountId, role: 'admin', target_id: adminTargetId });

    // Web 令牌
    const webLogin = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    const webToken = webLogin.data && webLogin.data.token;
    assert(!!webToken, 'Web 管理员登录成功（用于令牌隔离对比）');

    // ══════════════════════ 1. 令牌隔离（§44.11 ①②③）══════════════════════
    section('1. 令牌隔离：小程序令牌与 Web 令牌必须双向拒绝（§22.4 / §44.11）');

    const webRoute = await call('GET', '/orders?page=1&pageSize=1', null, salesmanToken);
    assert(
      webRoute.code === 401,
      `① 小程序 SALESMAN 令牌访问 Web 接口被拒（401）：实得 ${webRoute.code}`,
      JSON.stringify(webRoute).slice(0, 160)
    );

    const webRouteAdmin = await call('GET', '/orders?page=1&pageSize=1', null, adminTokenMini);
    assert(webRouteAdmin.code === 401, `② 小程序 ADMIN 令牌访问 Web 管理接口被拒（401）：实得 ${webRouteAdmin.code}`);

    const miniRouteWithWebToken = await call('GET', '/mini/me', null, webToken);
    assert(
      miniRouteWithWebToken.code === 401,
      `③ Web 令牌访问小程序接口被拒（401）：实得 ${miniRouteWithWebToken.code}`
    );

    const meOk = await call('GET', '/mini/me', null, salesmanToken);
    assert(meOk.code === 200 && meOk.data.role === 'salesman', '小程序令牌访问小程序接口正常（对照组）');
    assert(meOk.data.account && meOk.data.account.phoneTail, '身份信息含手机号后四位（脱敏）');
    assert(!JSON.stringify(meOk.data).includes(SMOKE.workerPhone), '身份信息**不含**完整手机号（§54）');
    assert(!JSON.stringify(meOk.data).toLowerCase().includes('openid'), '身份信息**不含** openid（§54）');

    // ══════════════════════ 2. 业务员下单：最低成交价（§7.5 / §44.2）══════════════════════
    section('2. 业务员订单与最低成交价（§7.5 / §8 / §44.2）');

    // ⚠️ 这条断言原先用 `fulfillmentType: 'PICKUP'` 且**不带配送地址**构造请求，
    //    而服务端的校验顺序是「履约方式 → 幂等键」，于是它实际是被「未配置自提地点」拦下的，
    //    **根本没有测到幂等键必填** —— 一条长期假通过的断言（自提下线时顺手修正）。
    //    现在改成：一个**其余字段全合法**的配送请求，只缺 clientRequestId，
    //    并同时断言拒绝文案确实指向幂等键，避免再次因为别的校验而「碰巧 400」。
    const noIdem = await call(
      'POST',
      '/mini/orders',
      {
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路1号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(noIdem.code === 400, `缺少 clientRequestId 被拒（幂等键必填）：实得 ${noIdem.code}`);
    assert(
      /clientRequestId/.test(String(noIdem.message || '')),
      `拒绝原因确实是「缺幂等键」而非其它校验（防假通过）：${noIdem.message}`
    );
    assert(noIdem.code === 400, `缺少 clientRequestId 被拒（幂等键必填）：实得 ${noIdem.code}`);

    const lowPrice = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_low_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'CUSTOMER_ORDER',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: MIN_PRICE - 1 }]
      },
      salesmanToken
    );
    assert(lowPrice.code === 400, `成交价低于最低价被拒（400）：实得 ${lowPrice.code}`);
    assert(String(lowPrice.message || '').includes('最低价格'), `拒绝文案说明最低价：${lowPrice.message}`);

    // ── §7.5（业务方 2026-09-20 确认）：自购同样受最低成交价约束 ──────────────────
    // ⚠️ 为什么必须**两种场景各测一次**：
    //    只测「代客下单」的话，将来若有人给 `order_scene = SELF_PURCHASE` 加一条放行分支，
    //    上面那条断言依旧全绿 —— 而漏洞恰恰就在这里（选「自己订货」即可随意改低价格）。
    //    因此这两条断言是 §7.5 的**唯一**机器防线，不可合并、不可删。
    const lowPriceSelf = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_lowself_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: MIN_PRICE - 1 }]
      },
      salesmanToken
    );
    assert(
      lowPriceSelf.code === 400,
      `§7.5 自购成交价低于最低价**同样**被拒（400）：实得 ${lowPriceSelf.code} ${lowPriceSelf.message || ''}`
    );
    assert(
      String(lowPriceSelf.message || '') === String(lowPrice.message || ''),
      `自购与代客的拒绝文案逐字一致（证明校验只看订单类型、不看 order_scene）：\n      代客「${lowPrice.message}」\n      自购「${lowPriceSelf.message}」`
    );

    // 被拒 = 事务整体回滚：钱包、订单、流水都不留痕（§11.7 第 1 条 / §24.5）
    // ⚠️ 校验发生在「钱包加锁之后」，所以这里能顺带证明「拒绝路径没有走到扣款」——
    //    若哪天有人把校验挪到扣款之后，余额断言会立刻报警。
    const [balAfterReject] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    const [cntAfterReject] = await pool.query(
      "SELECT COUNT(*) AS n FROM orders WHERE buyer_type = 'SALESMAN' AND buyer_id = ?",
      [SMOKE.workerId]
    );
    assert(
      Math.abs(Number(balAfterReject[0].balance) - 1000) < 0.001,
      `两次拒单后钱包余额**未变**（仍为注入的 1000）：实得 ${balAfterReject[0].balance}`
    );
    assert(Number(cntAfterReject[0].n) === 0, `两次拒单**未创建任何订单**：orders 计数 = ${cntAfterReject[0].n}`);
    const [rejectTx] = await pool.query(
      `SELECT COUNT(*) AS n FROM wallet_transactions
        WHERE wallet_id = ? AND transaction_type = 'ORDER_PAYMENT'`,
      [salesmanWalletId]
    );
    assert(Number(rejectTx[0].n) === 0, `拒单**未留下 ORDER_PAYMENT 流水**（未产生半截扣款）：计数 = ${rejectTx[0].n}`);

    const equalPrice = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_eq_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: MIN_PRICE }]
      },
      salesmanToken
    );
    assert(
      equalPrice.code === 200,
      `成交价 == 最低价放行（边界，§44.2）：实得 ${equalPrice.code} ${equalPrice.message || ''}`
    );

    const salesmanOrderId = equalPrice.data && equalPrice.data.orderId;

    // ══════════════════════ 3. 订单统一落库（§6 / §16 / §34）══════════════════════
    section('3. 订单统一模型：与 Web 共用 orders 表且新字段齐备（§6）');

    const [o1] = await pool.query(
      `SELECT order_id, order_type, order_source, buyer_type, buyer_id, payment_method, wallet_id,
              fulfillment_type, fulfillment_status, order_scene, refund_status,
              payment_status, paid_amount, total_receivable, delivery_type,
              created_from_mini_account_id, canceled_at
         FROM orders WHERE order_id = ?`,
      [salesmanOrderId]
    );
    const ord = o1[0];
    assert(!!ord, '订单已落库');
    assert(ord.order_type === 3, `order_type = 3（线下零售，不新造 type 7）：${ord.order_type}`);
    assert(ord.order_source === 'MINI_PROGRAM', `order_source = MINI_PROGRAM：${ord.order_source}`);
    assert(
      ord.buyer_type === 'SALESMAN' && ord.buyer_id === SMOKE.workerId,
      `buyer_type/buyer_id 正确：${ord.buyer_type}/${ord.buyer_id}`
    );
    assert(
      ord.payment_method === 'WALLET' && ord.wallet_id === salesmanWalletId,
      `payment_method/wallet_id 正确：${ord.payment_method}/${ord.wallet_id}`
    );
    assert(ord.fulfillment_status === 'PAID', `初始履约状态 = PAID：${ord.fulfillment_status}`);
    assert(ord.refund_status === 'NONE', `初始退款状态 = NONE：${ord.refund_status}`);
    assert(
      ord.payment_status === 1 && Number(ord.paid_amount) === Number(ord.total_receivable),
      `小程序订单同事务置为「已支付」并回填 paid_amount（§6.5.1 ②）：payment_status=${ord.payment_status} paid=${ord.paid_amount} total=${ord.total_receivable}`
    );
    assert(ord.delivery_type === 1, `配送订单 delivery_type = 1（自有员工配送）：${ord.delivery_type}`);
    assert(Number(ord.created_from_mini_account_id) === salesmanAccountId, 'created_from_mini_account_id 正确');

    const [items1] = await pool.query(
      'SELECT product_id, quantity, unit_price, subtotal, retail_price FROM order_items WHERE order_id = ?',
      [salesmanOrderId]
    );
    assert(
      items1.length === 1 && Number(items1[0].unit_price) === MIN_PRICE,
      `明细成交价 = 手填价 ${MIN_PRICE}：${items1[0] && items1[0].unit_price}`
    );
    assert(Number(items1[0].retail_price) === MIN_PRICE, '价格快照保存成交价而非档案零售价（§34）');

    // ══════════════════════ 4. 钱包三联事务（§11.7 / §44.12）══════════════════════
    section('4. 钱包三联事务与流水字段齐备（§11.7 第 1、3 条）');

    const [w1] = await pool.query('SELECT balance, initial_balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    const expectedAfterPay = 1000 - MIN_PRICE;
    assert(
      Math.abs(Number(w1[0].balance) - expectedAfterPay) < 0.001,
      `钱包余额 = 1000 − ${MIN_PRICE} = ${expectedAfterPay}：实得 ${w1[0].balance}`
    );

    const [payTx] = await pool.query(
      `SELECT transaction_type, direction, amount, balance_before, balance_after,
              related_type, related_id, operator_id, remark, created_at
         FROM wallet_transactions WHERE wallet_id = ? AND transaction_type = 'ORDER_PAYMENT'`,
      [salesmanWalletId]
    );
    assert(payTx.length === 1, '生成 1 条 ORDER_PAYMENT 流水');
    if (payTx.length) {
      const t = payTx[0];
      assert(t.direction === 2, `ORDER_PAYMENT 方向 = 2（出账）：${t.direction}`);
      assert(Number(t.amount) > 0, 'amount 恒为正数（方向只看 direction）');
      assert(t.balance_before !== null && t.balance_after !== null, 'balance_before / balance_after 均已落库');
      assert(Number(t.balance_after) === Number(t.balance_before) - Number(t.amount), '流水前后余额差 = 金额');
      assert(t.related_type === 'ORDER' && t.related_id === salesmanOrderId, 'related_type/related_id 已关联订单');
      assert(!!t.operator_id && !!t.created_at, 'operator_id / created_at 非空（字段齐备）');
    }

    // ══════════════════════ 5. 幂等（§23.1 / §45）══════════════════════
    section('5. 幂等：同 clientRequestId 重复提交只生效一次（§23.1）');

    const idemKey = `smoke_idem_${TS}`;
    const idemBody = {
      clientRequestId: idemKey,
      fulfillmentType: 'DELIVERY',
      orderScene: 'CUSTOMER_ORDER',
      customerName: SMOKE.customerName,
      customerPhone: '13911112222',
      customerAddress: '南京市冒烟路3号',
      items: [{ productId: SMOKE.productId, quantity: 2, unitPrice: RETAIL }]
    };
    const first = await call('POST', '/mini/orders', idemBody, salesmanToken);
    const [wAfterFirst] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    const second = await call('POST', '/mini/orders', idemBody, salesmanToken);
    const [wAfterSecond] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    const [orderCount2] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE order_source = ? AND buyer_id = ?', [
      'MINI_PROGRAM',
      SMOKE.workerId
    ]);

    assert(first.code === 200, `首次提交成功：${first.code} ${first.message || ''}`);
    assert(second.code === 200, `重复提交返回 200（不报错）：${second.code}`);
    assert(
      second.data && second.data.orderId === first.data.orderId,
      `重复提交返回**同一订单号**：${first.data && first.data.orderId} vs ${second.data && second.data.orderId}`
    );
    assert(second.data && second.data.replayed === true, '重复提交标记 replayed = true');
    assert(
      Number(wAfterFirst[0].balance) === Number(wAfterSecond[0].balance),
      `重复提交**不再扣款**：${wAfterFirst[0].balance} → ${wAfterSecond[0].balance}`
    );
    assert(Number(orderCount2[0].n) === 2, `订单数 = 2（未新建第三单）：实得 ${orderCount2[0].n}`);

    const conflict = await call(
      'POST',
      '/mini/orders',
      {
        ...idemBody,
        items: [{ productId: SMOKE.productId, quantity: 9, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(conflict.code === 400, `同键不同参数被拒（400，§23.1 冲突规则）：实得 ${conflict.code}`);

    // ══════════════════════ 6. 直营水站订单（§9 / §44.3 / §44.4）══════════════════════
    section('6. 直营水站订单：强制分销价、水票抵扣、不产生欠款（§9 / §44.3 / §44.4）');

    // 造 3 张未用水票
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟水票')`,
      [`SMKTK${TS}A`, SMOKE.productId, SMOKE.stationId]
    );
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟水票')`,
      [`SMKTK${TS}B`, SMOKE.productId, SMOKE.stationId]
    );
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟水票')`,
      [`SMKTK${TS}C`, SMOKE.productId, SMOKE.stationId]
    );

    const [debtBefore] = await pool.query('SELECT current_debt FROM sub_stations WHERE station_id = ?', [
      SMOKE.stationId
    ]);
    const [wStationBefore] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      stationWalletId
    ]);

    // ⚠️ 前端伪造 unitPrice = 1（远低于分销价 50）→ 必须被服务端忽略
    const stationOrder = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_st_${TS}`,
        fulfillmentType: 'DELIVERY',
        addressSource: 'STATION_DEFAULT',
        customerName: '冒烟水站客户',
        customerPhone: '13911113333',
        items: [{ productId: SMOKE.productId, quantity: 5, unitPrice: 1, useTicket: true, ticketQty: 3 }]
      },
      stationToken
    );
    assert(stationOrder.code === 200, `水站下单成功：${stationOrder.code} ${stationOrder.message || ''}`);
    const stationOrderId = stationOrder.data && stationOrder.data.orderId;

    const [so] = await pool.query(
      `SELECT order_type, order_source, buyer_type, buyer_id, order_amount, total_receivable,
              fulfillment_type, delivery_type, payment_status, refund_status, customer_address
         FROM orders WHERE order_id = ?`,
      [stationOrderId]
    );
    const st = so[0];
    // 5 件 × 50 分销价 − 3 件水票抵扣 = 2 件 × 50 = 100
    assert(
      Number(st.order_amount) === 100,
      `行级水票抵扣计价正确：5 件中 3 件抵扣 → 应付 100，实得 ${st.order_amount}`
    );
    assert(st.order_type === 2, `order_type = 2（复用既有编号）：${st.order_type}`);
    assert(st.buyer_type === 'STATION', 'buyer_type = STATION');

    const [sItems] = await pool.query(
      'SELECT unit_price, ticket_qty, pricing_type, subtotal FROM order_items WHERE order_id = ?',
      [stationOrderId]
    );
    assert(
      Number(sItems[0].unit_price) === WHOLESALE,
      `前端伪造 unitPrice=1 被忽略，入库为服务端分销价 ${WHOLESALE}（§9.1 / §22.6）：实得 ${sItems[0].unit_price}`
    );
    assert(
      Number(sItems[0].ticket_qty) === 3 && Number(sItems[0].pricing_type) === 2,
      '水票抵扣张数与计价方式落库正确'
    );

    const [debtAfter] = await pool.query('SELECT current_debt FROM sub_stations WHERE station_id = ?', [
      SMOKE.stationId
    ]);
    assert(
      Number(debtAfter[0].current_debt) === Number(debtBefore[0].current_debt),
      `水站 current_debt **不变**（§6.5.1 / §44.4）：${debtBefore[0].current_debt} → ${debtAfter[0].current_debt}`
    );

    const [wStationAfter] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      stationWalletId
    ]);
    assert(
      Math.abs(Number(wStationBefore[0].balance) - Number(wStationAfter[0].balance) - 100) < 0.001,
      `水站钱包扣减 = 应付积分 100：${wStationBefore[0].balance} → ${wStationAfter[0].balance}`
    );

    const [usedTickets] = await pool.query(
      'SELECT COUNT(*) AS n FROM water_tickets WHERE station_id = ? AND status = 2 AND order_id = ?',
      [SMOKE.stationId, stationOrderId]
    );
    assert(Number(usedTickets[0].n) === 3, `3 张水票被核销且关联订单（§9.2）：实得 ${usedTickets[0].n}`);

    // ══════════════════════ 7. 自提已下线 + 配送地址快照 ══════════════════════
    section('7. 自提已下线（构造 PICKUP 被拒）+ 配送地址快照（§10.3）');

    // ⚠️ 为什么必须**绕过前端**构造这个请求：
    //    自提下线是「前后端一并移除」，前端已无任何自提入口与字样。若只检查前端，
    //    得到的是「界面干净」而不是「接口不再接受自提」—— 而**抓包/脚本仍能直接调接口**。
    //    「界面删了、接口还收」正是典型半状态，所以本节是自提下线的**唯一**机器防线。
    const pickupRetired = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_pickretired_${TS}`,
        fulfillmentType: 'PICKUP',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(
      pickupRetired.code === 400,
      `自提已下线：构造 PICKUP 请求被拒（400）：实得 ${pickupRetired.code} ${pickupRetired.message || ''}`
    );
    assert(
      String(pickupRetired.message || '').includes('配送'),
      `拒绝文案指向「本期仅支持配送」：${pickupRetired.message}`
    );

    // 白名单而非黑名单：只拦 'PICKUP' 一个字面量是不够的 —— 变体拼写会漏过去落库成第三种值
    const pickupVariant = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_pickvariant_${TS}`,
        fulfillmentType: 'SELF_PICKUP',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(pickupVariant.code === 400, `自提变体拼写（SELF_PICKUP）同样被拒：实得 ${pickupVariant.code}`);

    // 缺失履约方式也不得默认放行（与改动前行为一致：原先缺失同样不在合法集合内）
    const noFulfillment = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_noful_${TS}`,
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(noFulfillment.code === 400, `缺少 fulfillmentType 被拒（不默认成配送）：实得 ${noFulfillment.code}`);

    // 自提下线后**不存在免地址场景** → 配送单缺地址必须被拒（原自提分支可免地址）
    const noAddress = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_noaddr_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(noAddress.code === 400, `配送单缺地址被拒（无免地址场景）：实得 ${noAddress.code}`);
    assert(String(noAddress.message || '').includes('地址'), `拒绝文案指向地址必填：${noAddress.message}`);

    // ⚠️ 地址快照：改水站地址后历史订单地址不变（§10.3）
    await pool.query('UPDATE sub_stations SET address = ? WHERE station_id = ?', [
      '南京市冒烟区新地址999号',
      SMOKE.stationId
    ]);
    const [addrSnapshot] = await pool.query('SELECT customer_address FROM orders WHERE order_id = ?', [stationOrderId]);
    assert(
      !String(addrSnapshot[0].customer_address || '').includes('新地址'),
      `水站地址变更后历史订单快照不变（§10.3）：${addrSnapshot[0].customer_address}`
    );

    // ══════════════════════ 8. 取消与退款（§15 / §16）══════════════════════
    section('8. 取消 / 退款：回补钱包 + 幂等 + 越权拦截（§15 / §15.4）');

    const [invBeforeCancel] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [
      SMOKE.productId
    ]);
    const [wBeforeCancel] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    const cancelRes = await call(
      'POST',
      `/mini/orders/${salesmanOrderId}/cancel`,
      { reason: '冒烟取消' },
      salesmanToken
    );
    assert(cancelRes.code === 200, `取消订单成功：${cancelRes.code} ${cancelRes.message || ''}`);

    const [oC] = await pool.query(
      'SELECT canceled_at, fulfillment_status, refund_status FROM orders WHERE order_id = ?',
      [salesmanOrderId]
    );
    assert(!!oC[0].canceled_at, 'canceled_at 已置（既有语义，≠ 软删除）');
    assert(oC[0].fulfillment_status === 'CANCELED', `取消后履约状态 = CANCELED：${oC[0].fulfillment_status}`);
    assert(
      oC[0].refund_status === 'REFUNDED',
      `取消同时退款（小程序订单下单即支付，二者必然同时发生）：refund_status=${oC[0].refund_status}`
    );

    const [wCancel] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [salesmanWalletId]);
    assert(
      Math.abs(Number(wCancel[0].balance) - Number(wBeforeCancel[0].balance) - MIN_PRICE) < 0.001,
      `取消后钱包回补 ${MIN_PRICE} 积分（§15.3）：${wBeforeCancel[0].balance} → ${wCancel[0].balance}`
    );

    const [invAfterCancel] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [SMOKE.productId]);
    assert(
      Number(invAfterCancel[0].quantity) === Number(invBeforeCancel[0].quantity) + 1,
      `取消恢复库存 +1：${invBeforeCancel[0].quantity} → ${invAfterCancel[0].quantity}`
    );

    const [refundTx] = await pool.query(
      `SELECT direction, amount, reversal_of FROM wallet_transactions
        WHERE related_type = 'ORDER' AND related_id = ? AND transaction_type = 'REFUND'`,
      [salesmanOrderId]
    );
    assert(refundTx.length === 1, '生成 1 条 REFUND 流水（§15.3）');
    if (refundTx.length) {
      assert(refundTx[0].direction === 1, `REFUND 方向 = 1（入账）：${refundTx[0].direction}`);
      assert(!!refundTx[0].reversal_of, 'REFUND 记录被冲回的原流水（reversal_of 非空，便于追溯）');
    }

    // 退款幂等：再次取消 → 不得再次加积分
    const balanceBeforeReCancel = Number(wCancel[0].balance);
    const cancelAgain = await call(
      'POST',
      `/mini/orders/${salesmanOrderId}/cancel`,
      { reason: '冒烟重复取消' },
      salesmanToken
    );
    const [wReCancel] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [salesmanWalletId]);
    assert(cancelAgain.code === 400, `重复取消被拒（订单已取消）：实得 ${cancelAgain.code}`);
    assert(
      Number(wReCancel[0].balance) === balanceBeforeReCancel,
      `重复取消**不再加积分**（§15.4）：${balanceBeforeReCancel} → ${wReCancel[0].balance}`
    );

    const refundAgain = await call('POST', `/mini/orders/${salesmanOrderId}/refund`, {}, salesmanToken);
    assert(refundAgain.code === 400, `已退款订单再次申请退款被拒：实得 ${refundAgain.code}`);
    const [wRefundAgain] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [
      salesmanWalletId
    ]);
    assert(Number(wRefundAgain[0].balance) === balanceBeforeReCancel, '重复退款申请**不再加积分**（§44.8）');

    // 越权：水站令牌操作业务员的订单
    const crossAccess = await call('POST', `/mini/orders/${stationOrderId}/cancel`, {}, salesmanToken);
    assert(
      crossAccess.code === 400 && String(crossAccess.message || '').includes('无权'),
      `跨主体操作订单被拒（§44.1）：${crossAccess.code} ${crossAccess.message}`
    );

    // ══════════════════════ 9. 退款时的库存恢复条件（§15.3「符合条件时」）══════════════════════
    section('9. 退款：保留履约事实；库存恢复以「是否已完成交付」为条件（§15.3 / §16.1 第 3 条）');

    // 9a) DELIVERING（已发货、未完成交付）→ 按实现口径**应恢复库存**
    //     ⚠️ 这里的期望值来自 miniOrderService.assertCancelable/assertRefundable 上方注释里
    //        定死的口径：「当且仅当 fulfillment_status ≠ COMPLETED 时恢复库存与水票」。
    //        断言必须与实现口径一致，否则测试本身就成了假红源。
    await pool.query("UPDATE orders SET fulfillment_status = 'DELIVERING' WHERE order_id = ?", [stationOrderId]);
    const [invBeforeRefund] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [
      SMOKE.productId
    ]);
    const [stItems] = await pool.query('SELECT SUM(quantity) AS q FROM order_items WHERE order_id = ?', [
      stationOrderId
    ]);
    const stationQty = Number(stItems[0].q) || 0;
    const refundRes = await call(
      'POST',
      `/mini/orders/${stationOrderId}/refund`,
      { reason: '冒烟已发货退款' },
      stationToken
    );
    assert(refundRes.code === 200, `已发货订单退款成功：${refundRes.code} ${refundRes.message || ''}`);
    const [oR] = await pool.query('SELECT fulfillment_status, refund_status FROM orders WHERE order_id = ?', [
      stationOrderId
    ]);
    assert(oR[0].refund_status === 'REFUNDED', `refund_status = REFUNDED：${oR[0].refund_status}`);
    assert(
      oR[0].fulfillment_status === 'DELIVERING',
      `退款后履约状态**保留退款前最后事实**（不写成已取消，§16.1 第 3 条）：${oR[0].fulfillment_status}`
    );
    const [invAfterRefund] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [SMOKE.productId]);
    assert(
      Number(invAfterRefund[0].quantity) === Number(invBeforeRefund[0].quantity) + stationQty,
      `未完成交付（DELIVERING）→ 恢复库存 +${stationQty}：${invBeforeRefund[0].quantity} → ${invAfterRefund[0].quantity}`
    );

    // 9b) COMPLETED（已完成交付）→ **不**恢复库存（货已实际交付，需实物退回后人工盘库）
    const completedOrder = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_cmp_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路7号',
        items: [{ productId: SMOKE.productId, quantity: 3, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(completedOrder.code === 200, `构造已交付订单成功：${completedOrder.code} ${completedOrder.message || ''}`);
    const completedOrderId = completedOrder.data && completedOrder.data.orderId;
    await pool.query("UPDATE orders SET fulfillment_status = 'COMPLETED' WHERE order_id = ?", [completedOrderId]);
    const [invBeforeCompleted] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [
      SMOKE.productId
    ]);
    const refundCompleted = await call(
      'POST',
      `/mini/orders/${completedOrderId}/refund`,
      { reason: '冒烟已交付退款' },
      salesmanToken
    );
    const [invAfterCompleted] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [
      SMOKE.productId
    ]);
    assert(
      refundCompleted.code === 200,
      `已交付订单退款成功：${refundCompleted.code} ${refundCompleted.message || ''}`
    );
    assert(
      Number(invAfterCompleted[0].quantity) === Number(invBeforeCompleted[0].quantity),
      `已完成交付（COMPLETED）→ **不**自动恢复库存（§15.3「符合条件时」）：${invBeforeCompleted[0].quantity} → ${invAfterCompleted[0].quantity}`
    );
    const [oCmp] = await pool.query('SELECT fulfillment_status FROM orders WHERE order_id = ?', [completedOrderId]);
    assert(
      oCmp[0].fulfillment_status === 'COMPLETED',
      `已交付订单退款后履约状态仍为 COMPLETED（保留事实）：${oCmp[0].fulfillment_status}`
    );

    // ══════════════════════ 10. 管理员钱包后台（§18 / Phase 5）══════════════════════
    section('10. 管理员钱包调整：强制原因 + 幂等 + 余额校验（§18 / §45）');

    const adjustNoReason = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: salesmanWalletId,
        direction: 'IN',
        amount: 10,
        clientRequestId: `smoke_adj0_${TS}`
      },
      adminTokenMini
    );
    assert(adjustNoReason.code === 400, `缺少操作原因被拒（§18 强制填写）：实得 ${adjustNoReason.code}`);

    const adjustNoIdem = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: salesmanWalletId,
        direction: 'IN',
        amount: 10,
        reason: '冒烟调增'
      },
      adminTokenMini
    );
    assert(adjustNoIdem.code === 400, `缺少 clientRequestId 被拒：实得 ${adjustNoIdem.code}`);

    const adjustKey = `smoke_adj_${TS}`;
    const [wB] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [salesmanWalletId]);
    const adj1 = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: salesmanWalletId,
        direction: 'IN',
        amount: 66,
        reason: '冒烟调增',
        clientRequestId: adjustKey
      },
      adminTokenMini
    );
    const adj2 = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: salesmanWalletId,
        direction: 'IN',
        amount: 66,
        reason: '冒烟调增',
        clientRequestId: adjustKey
      },
      adminTokenMini
    );
    const [wA] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [salesmanWalletId]);
    assert(adj1.code === 200, `管理员调增成功：${adj1.code} ${adj1.message || ''}`);
    assert(adj2.code === 200 && adj2.data && adj2.data.replayed === true, '重复点击「增加积分」被幂等合并（§45）');
    assert(
      Math.abs(Number(wA[0].balance) - (Number(wB[0].balance) + 66)) < 0.001,
      `只加一次 66：${wB[0].balance} → ${wA[0].balance}`
    );

    const adjOutTooMuch = await call(
      'POST',
      '/mini/wallet/admin/adjust',
      {
        walletId: salesmanWalletId,
        direction: 'OUT',
        amount: 999999,
        reason: '冒烟超额扣减',
        clientRequestId: `smoke_adjx_${TS}`
      },
      adminTokenMini
    );
    assert(
      adjOutTooMuch.code === 400 && String(adjOutTooMuch.message || '').includes('积分不足'),
      `扣减超额被拒且提示积分不足（§11.7 第 2 条）：${adjOutTooMuch.code} ${adjOutTooMuch.message}`
    );

    const adminBySalesman = await call('GET', '/mini/wallet/admin/overview', null, salesmanToken);
    assert(
      adminBySalesman.code === 403,
      `业务员访问管理员接口被拒（403，requireMiniAdmin）：实得 ${adminBySalesman.code}`
    );

    const dash = await call('GET', '/mini/admin/dashboard', null, adminTokenMini);
    assert(dash.code === 200, `管理员只读仪表盘可用（Phase 8a）：${dash.code}`);
    if (dash.code === 200) {
      const d = dash.data;
      assert(
        d.today && d.month && d.pipeline && d.inventory && d.waterTickets && d.stationPoints,
        '仪表盘字段齐备（§28：今日/本月/待办/库存/水票/积分总额）'
      );
      assert(
        typeof d.month.revenue.total === 'number' &&
          typeof d.month.cost.total === 'number' &&
          typeof d.month.profit === 'number',
        '总营收/总成本/总利润已聚合'
      );
      const recomputed = Math.round((d.month.revenue.total - d.month.cost.total) * 100) / 100;
      assert(
        Math.abs(recomputed - d.month.profit) < 0.01,
        `总利润 = 总营收 − 总成本 勾稽成立：${recomputed} vs ${d.month.profit}`
      );
      assert(!!d.methodology && !!d.methodology.rangeConvention, '仪表盘回传口径自述（§53：显式声明区间约定）');
    }

    // ══════════════════════ 11. 禁用即时生效（§44.11 ④⑤）══════════════════════
    section('11. 禁用即时生效：持未过期令牌也必须被拦（§4.5.1 / §44.11 ④⑤）');

    await pool.query('UPDATE mini_accounts SET status = 0 WHERE id = ?', [salesmanAccountId]);

    const readWhileDisabled = await call('GET', '/mini/me', null, salesmanToken);
    assert(
      readWhileDisabled.code === 200,
      `禁用后**读**仍可用（§22.5：禁用只拦写，不拦读自己的历史）：${readWhileDisabled.code}`
    );
    assert(readWhileDisabled.data && readWhileDisabled.data.blocked, '禁用状态已透出给前端（blocked 非空）');

    // ⚠️ 下面的请求必须构造为**完全合法的配送单**（含地址、DELIVERY）：
    //    它们要验证的是「禁用 → 401」，而「履约方式/地址」校验排在这些状态校验之前。
    //    若继续沿用已下线的 PICKUP，会先被履约校验拦成 400，断言失败且看起来像回归。
    const writeWhileDisabled = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_dis_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(
      writeWhileDisabled.code === 401,
      `④ 禁用后**下单**被拒（HTTP 401，非 403）：实得 ${writeWhileDisabled.code}`
    );

    const rechargeWhileDisabled = await call('POST', '/mini/wallet/recharge', { amount: 100 }, salesmanToken);
    assert(rechargeWhileDisabled.code === 401, `④ 禁用后**充值**被拒（401）：实得 ${rechargeWhileDisabled.code}`);

    await pool.query('UPDATE mini_accounts SET status = 1 WHERE id = ?', [salesmanAccountId]);
    // ⑤ 主体停用
    await pool.query('UPDATE workers SET status = 0 WHERE worker_id = ?', [SMOKE.workerId]);
    const subjectDisabled = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_subj_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路2号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL }]
      },
      salesmanToken
    );
    assert(subjectDisabled.code === 401, `⑤ 绑定主体（workers）停用后下单被拒（401）：实得 ${subjectDisabled.code}`);
    await pool.query('UPDATE workers SET status = 1 WHERE worker_id = ?', [SMOKE.workerId]);

    // ══════════════════════ 12. 钱包恒等式（§44.12 ①②③）══════════════════════
    section('12. 钱包恒等式：余额 = 期初 + Σ正向 − Σ负向（§11.5 / §44.12）');

    const audit = await walletService.auditAllWallets(pool);
    const broken = audit.filter(a => !a.ok);
    assert(
      broken.length === 0,
      `全部 ${audit.length} 个钱包恒等式成立（含停用钱包）：${broken.length ? JSON.stringify(broken).slice(0, 300) : ''}`
    );
    assert(audit.length > 0, '至少存在 1 个钱包（断言非空转）');

    const smokeAudit = audit.filter(a => [salesmanWalletId, stationWalletId].includes(a.walletId));
    assert(
      smokeAudit.length === 2 && smokeAudit.every(a => a.txCount > 0),
      `冒烟钱包均有流水（txCount > 0，断言不空转）：${smokeAudit.map(a => a.txCount).join('/')}`
    );
    for (const a of smokeAudit) {
      console.log(
        `     ${a.ownerType}/${a.ownerId} 期初=${a.initialBalance} +入=${a.totalIn} −出=${a.totalOut} = ${a.expected} (账面 ${a.balance}) 流水${a.txCount}条`
      );
    }

    // ② 停用钱包恒等式仍成立
    await pool.query('UPDATE wallet_accounts SET status = 0 WHERE wallet_id = ?', [stationWalletId]);
    const disabledAudit = await walletService.assertWalletIdentity(pool, stationWalletId);
    assert(disabledAudit.ok, `② 钱包停用（status=0）后恒等式仍成立：diff=${disabledAudit.diff}`);
    await pool.query('UPDATE wallet_accounts SET status = 1 WHERE wallet_id = ?', [stationWalletId]);

    // ③ 收入类流水被撤销时方向不得写反：撤销后余额回到撤销前基线
    //
    // ⚠️ 这里**必须先造一笔金额小于当前余额的收入**再撤销：
    //    直接冲回最初注入的 1000 积分会因「余额已被消费到 900 < 1000」而报「积分不足」——
    //    那其实是**正确行为**（不能把已经花掉的钱凭空退回），不是 bug。
    //    用一笔小额入账来测方向，才能把「方向写反」和「余额不足」两件事分开。
    const revConn0 = await pool.getConnection();
    await revConn0.beginTransaction();
    await walletService.applyTransaction(
      revConn0,
      await walletService.loadWalletForUpdateIncludingDisabled(revConn0, stationWalletId),
      {
        txType: 'ADJUST_IN',
        amount: 50,
        direction: 1,
        relatedType: 'MANUAL_ADJUST',
        operatorId: 'smoke',
        remark: '冒烟冲回用的小额入账'
      }
    );
    // 钱包变动必须与流水同事务（§11.7 第 1 条）；autocommit 下 FOR UPDATE 的锁会立刻释放
    await revConn0.commit();
    revConn0.release();
    const [beforeRev] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [stationWalletId]);
    const [distTx] = await pool.query(
      `SELECT transaction_id, direction, amount FROM wallet_transactions
        WHERE wallet_id = ? AND direction = 1 AND remark = '冒烟冲回用的小额入账' LIMIT 1`,
      [stationWalletId]
    );
    assert(distTx.length === 1 && Number(distTx[0].amount) === 50, '已构造 50 积分的正向入账用于冲回测试');
    await walletService.reverseTransaction(pool, distTx[0].transaction_id, {
      txType: 'DISTRIBUTION_FEE_REVERSAL',
      remark: '冒烟冲回（收入方向）'
    });
    const [afterRev] = await pool.query('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [stationWalletId]);
    const expectRev = Math.round((Number(beforeRev[0].balance) - Number(distTx[0].amount)) * 100) / 100;
    assert(
      Math.abs(Number(afterRev[0].balance) - expectRev) < 0.001,
      `③ 收入类流水撤销方向正确（−amount 而非 +）：${beforeRev[0].balance} − ${distTx[0].amount} = ${expectRev}，实得 ${afterRev[0].balance}`
    );
    const [revTx] = await pool.query(
      `SELECT direction, amount, reversal_of FROM wallet_transactions
        WHERE reversal_of = ?`,
      [distTx[0].transaction_id]
    );
    assert(revTx.length === 1 && revTx[0].direction === 2, `冲回流水方向 = 2（反向），reversal_of 指向原流水`);
    const auditAfterRev = await walletService.assertWalletIdentity(pool, stationWalletId);
    assert(auditAfterRev.ok, `冲回后恒等式仍成立：diff=${auditAfterRev.diff}`);

    // ══════════════════════ 13. 迁移落地检查（§44.13 ④）══════════════════════
    section('13. 数据库迁移落地检查（§4.1.1 / §4.6.1 / §20）');

    const [maCols] = await pool.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mini_accounts'`
    );
    const maSet = new Set(maCols.map(r => r.c));
    assert(!maSet.has('username') && !maSet.has('password_hash'), '§4.1.1 mini_accounts 口令列已移除');
    assert(maSet.has('active_key'), '§4.6.1 active_key 生成列存在');

    const [seedCount] = await pool.query("SELECT COUNT(*) AS n FROM mini_accounts WHERE openid LIKE 'seed\\_%'");
    assert(Number(seedCount[0].n) === 0, '§4.1.1 占位账号 seed_* 已清除');

    const [smsTable] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_codes'`
    );
    assert(Number(smsTable[0].n) === 0, '§4.1.1 孤儿表 sms_codes 已处置');

    // §4.6.1「一个水站一个微信账号」：同一 role+target 的第二条启用记录必须被唯一索引拒绝
    let dupRejected = false;
    try {
      await pool.query(
        `INSERT INTO mini_accounts (openid, phone, role, target_id, status, created_at)
         VALUES (?, '13500000001', 'station', ?, 1, NOW())`,
        [`smoke_dup_${TS}`, SMOKE.stationId]
      );
    } catch (e) {
      dupRejected = e.code === 'ER_DUP_ENTRY';
    }
    assert(dupRejected, '§4.6.1 同一水站第二条启用绑定被唯一索引拒绝（一个水站一个微信账号）');

    // 停用后该键释放 → 新账号可立即绑定（§44.11 ⑥）
    await pool.query('UPDATE mini_accounts SET status = 0 WHERE id = ?', [stationAccountId]);
    let rebindOk = false;
    try {
      await pool.query(
        `INSERT INTO mini_accounts (openid, phone, role, target_id, status, created_at)
         VALUES (?, '13500000002', 'station', ?, 1, NOW())`,
        [`smoke_rebind_${TS}`, SMOKE.stationId]
      );
      rebindOk = true;
    } catch (e) {
      rebindOk = false;
    }
    assert(rebindOk, '§4.6.1 停用后唯一键释放，新微信账号可立即绑定（§44.11 ⑥）');

    // ⚠️ 反向断言：此时若把**旧账号**恢复为启用，唯一索引必须拒绝 ——
    //    因为新账号已占用 (station, stationId) 这个启用态键。
    //    这一步同时是「回滚旧绑定」的正确做法参照：必须先停用/删除新绑定，
    //    否则同一水站会同时有两条启用绑定，违反「一个水站一个微信账号」。
    let restoreRejected = false;
    try {
      await pool.query('UPDATE mini_accounts SET status = 1 WHERE id = ?', [stationAccountId]);
    } catch (e) {
      restoreRejected = e.code === 'ER_DUP_ENTRY';
    }
    assert(restoreRejected, '§4.6.1 新账号占用期间，旧账号无法同时恢复为启用（同一水站不出现两条启用绑定）');

    // 清理这条临时绑定，再恢复原账号（顺序不能反，见上）
    await pool.query('DELETE FROM mini_accounts WHERE openid = ?', [`smoke_rebind_${TS}`]);
    await pool.query('UPDATE mini_accounts SET status = 1 WHERE id = ?', [stationAccountId]);
    const [restored] = await pool.query('SELECT status FROM mini_accounts WHERE id = ?', [stationAccountId]);
    assert(Number(restored[0].status) === 1, '临时绑定清理后，原账号已恢复启用');

    // §12.2.1 单件值列 + 存量回填无偏差
    const [feeCols] = await pool.query(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_ticket_issuance'
          AND COLUMN_NAME IN ('distribution_delivery_fee_unit','distribution_delivery_fee_total','wallet_transaction_id')`
    );
    assert(feeCols.length === 3, `§20.4 water_ticket_issuance 三列齐备：${feeCols.map(r => r.c).join(',')}`);

    const [inexact] = await pool.query(
      `SELECT COUNT(*) AS n FROM water_ticket_issuance
        WHERE quantity > 0 AND distribution_delivery_fee_unit IS NOT NULL
          AND ROUND(distribution_delivery_fee_unit * quantity, 2) <> distribution_delivery_fee_total`
    );
    assert(
      Number(inexact[0].n) === 0,
      `§44.13 ④ 存量回填后「单件值 × 数量 = 总额」无偏差（无静默四舍五入）：偏差 ${inexact[0].n} 条`
    );

    // ══════════════════════ 14. 成交价上界：高于参考零售价放行（§8.4 后半句）══════════════════════
    // ⚠️ 为什么这一段放在**最后**：第 3 / 4 节含**绝对**基线（`1000 − 成交价`、`ORDER_PAYMENT` 计数 = 1），
    //    在第 2 节附近插入成功订单会误伤它们。这里位于所有绝对断言之后，只影响收尾清理
    //    （订单客户名带「冒烟」前缀，会被 cleanupSmokeResidue 清掉）。
    //
    // §8.4 是**两条**规则：① 成交价 >= 最低价；② 允许高于最低价，**也允许高于参考零售价**。
    // ② 必须测，是因为本期给确认订单页加了成交价输入框（Phase 3「前端可填」）——
    //    价格从此是自由值。若有人在服务端顺手加一条「不得高于零售价」这种看似合理的限制，
    //    业务员的溢价销售会被无理由拒掉，而现有断言全绿（只测下界不测上界）。
    section('14. 成交价上界：高于参考零售价放行（§8.4 后半句）');

    const aboveRetail = await call(
      'POST',
      '/mini/orders',
      {
        clientRequestId: `smoke_above_${TS}`,
        fulfillmentType: 'DELIVERY',
        orderScene: 'SELF_PURCHASE',
        customerName: SMOKE.customerName,
        customerPhone: '13911112222',
        customerAddress: '南京市冒烟路8号',
        items: [{ productId: SMOKE.productId, quantity: 1, unitPrice: RETAIL + 10 }]
      },
      salesmanToken
    );
    assert(
      aboveRetail.code === 200,
      `溢价成交价（¥${RETAIL + 10} > 参考零售价 ¥${RETAIL}）放行：实得 ${aboveRetail.code} ${aboveRetail.message || ''}`
    );

    const aboveOrderId = aboveRetail.data && aboveRetail.data.orderId;
    if (aboveOrderId) {
      const [aboveItems] = await pool.query('SELECT unit_price FROM order_items WHERE order_id = ?', [aboveOrderId]);
      assert(
        aboveItems.length === 1 && Number(aboveItems[0].unit_price) === RETAIL + 10,
        `溢价成交价被**采用**（未静默回退成参考零售价）：实得 ${aboveItems[0] && aboveItems[0].unit_price}`
      );

      const [aboveOrd] = await pool.query('SELECT total_receivable FROM orders WHERE order_id = ?', [aboveOrderId]);
      assert(
        Number(aboveOrd[0].total_receivable) === RETAIL + 10,
        `订单应收 = 溢价成交价 × 数量 = ¥${RETAIL + 10}：实得 ${aboveOrd[0].total_receivable}`
      );
    }
  } finally {
    if (conn) {
      try {
        conn.release();
      } catch (e) {
        /* ignore */
      }
    }
    // ⚠️ 收尾清理必须放 finally：否则一旦中途断言抛错，测试数据会永久留在库里
    try {
      // 注：原先这里要「还原自提地点配置」，自提下线后该键已被迁移删除，无需还原。
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

/**
 * 冒烟测试：积分双账户（充值积分 / 配送费积分）—— 2026-09-23
 * ===========================================================================
 * 背景：原积分钱包只有单一余额。业务要求区分两类积分，可**混合**抵扣但需**分别可见、
 *       分别记账、分别回冲**：
 *         · 充值积分     —— 管理员后台设置（ADJUST_IN/OUT，默认类型 RECHARGE）
 *         · 配送费积分   —— 返货配送费 1 元 = 1 积分（水票发行入账，DELIVERY_FEE）
 *
 * 覆盖的不变量（每条都对应一个"改坏了会静默错账"的点）：
 *   §1 配送费积分入账 → points_type=DELIVERY_FEE + points_month=发行月份 + 只加分账户 B
 *   §2 充值积分入账   → 管理员调整默认落 RECHARGE；显式指定类型同样生效
 *   §3 用户自选混合抵扣 → 两类各扣其数、拆成两条流水、总额一致、订单落库
 *   §4 负例：分配和不等于应付 / 单类不足 / 负数 → 400 且**零副作用**（不留半截扣款）
 *   §5 回冲按原类型 → 作废水票只回「配送费积分」，不污染充值积分
 *   §6 两条恒等式对**全部钱包**成立：balance = 期初+净额、balance = 充值+配送费；
 *      配送费积分可按发行月份汇总（月度发放明细）
 *
 * ⚠️ 与既有脚本的关系：smoke_water_ticket.js 钉住"发行/作废的金额与方向"，
 *    本脚本钉住"**分账户**的金额与分类"；smoke_mini_program.js 钉住下单链路，
 *    本脚本在其上补"分配参数"的契约与账务。三者互补，不可互相替代。
 *
 * 运行：node scripts/smoke_wallet_points.js（需后端已启动：cd backend && node src/app.js）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// 后端地址可覆盖：便于在另一个端口上验证「改造后的代码」而不影响常驻实例
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000/api';
const { pool } = require('../src/config/db');
const walletService = require('../src/services/walletService');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
const { signMiniToken } = require('../src/services/miniAccountService');
const { TX_DIRECTION, WALLET_TX_TYPE } = require('../src/constants/mini');

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
  return { ...json, httpStatus: res.status };
}

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
/** 金额两位小数（与后端同一口径） */
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const q = async (sql, args = []) => (await pool.query(sql, args))[0];

const TS = Date.now();
// 标识必须落在 smokeCleanup 的 MARKERS 内（products SMK% / sub_stations SMKST% / month 2099%）
const productId = `SMKPP${TS}`;
const stationId = `SMKST${TS}`;
const workerId = `SMKPW${TS}`;
const MONTH = '2099-03';
const UNIT_FEE = 2; // 商品档案单件分销配送费 → 配送费积分（服务端唯一来源）
const RETAIL = 15;
const WHOLESALE = 12;

const walletSnap = async () => {
  const rows = await q(
    `SELECT wallet_id, initial_balance, balance, recharge_balance, delivery_fee_balance
       FROM wallet_accounts WHERE owner_type = 'STATION' AND owner_id = ?`,
    [stationId]
  );
  if (!rows.length) return null;
  const w = rows[0];
  return {
    walletId: w.wallet_id,
    initial: Number(w.initial_balance),
    total: Number(w.balance),
    recharge: Number(w.recharge_balance),
    delivery: Number(w.delivery_fee_balance)
  };
};

/** 按业务关联读流水（核对类型与分账户金额） */
const txsOf = async relatedId =>
  q(
    `SELECT transaction_id, transaction_type, direction, amount, points_type, points_month
       FROM wallet_transactions
      WHERE wallet_id = ? AND related_id = ? ORDER BY created_at, transaction_id`,
    [(await walletSnap()).walletId, relatedId]
  );

/** 全库两条恒等式（不只本冒烟的钱包）—— 分账户拆分若漏维护某处，这里立刻报警 */
const globalInvariants = async () => {
  const badNet = await q(
    `SELECT w.wallet_id, w.balance, w.initial_balance,
            ROUND(COALESCE(SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE -t.amount END), 0), 2) AS net
       FROM wallet_accounts w
       LEFT JOIN wallet_transactions t ON t.wallet_id = w.wallet_id
      GROUP BY w.wallet_id, w.balance, w.initial_balance
     HAVING ROUND(w.balance, 2) <> ROUND(w.initial_balance + net, 2)`
  );
  const badSplit = await q(
    `SELECT wallet_id, balance, recharge_balance, delivery_fee_balance FROM wallet_accounts
      WHERE ROUND(balance, 2) <> ROUND(recharge_balance + delivery_fee_balance, 2)`
  );
  return { badNet, badSplit };
};

(async () => {
  // ── 0. 准备 ───────────────────────────────────────────────────────────────
  section('0. 准备（登录 + 自建商品/水站/业务员/钱包，不依赖真实数据）');

  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(Boolean(login.data && login.data.token), `Web 管理员登录（${login.code}）`);
  const webToken = login.data.token;

  await pool.query(
    `INSERT INTO products (product_id, product_code, product_name, specification, unit,
       purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
       distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
       worker_machine_delivery_fee, category, status,
       salesman_mini_enabled, salesman_min_price, created_at, updated_at)
     VALUES (?, ?, '冒烟-双积分商品', '19L', '桶', 10.00, ?, ?, 0.00, 2.00, ?, 1.00, 0.50, 0.00, '冒烟', 1, 1, ?, NOW(), NOW())`,
    [productId, productId, WHOLESALE, RETAIL, UNIT_FEE, RETAIL]
  );
  await pool.query(`INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 1000, NOW())`, [productId]);
  await pool.query(
    `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, credit_limit, current_debt, payment_type, status, created_at, updated_at)
     VALUES (?, '冒烟-双积分水站', '冒烟', '13800000001', '南京市冒烟区冒烟路9号', 0.00, 0.00, 1, 1, NOW(), NOW())`,
    [stationId]
  );
  await pool.query(
    `INSERT INTO workers (worker_id, worker_name, phone, employee_type, commission_rate, status, created_at, updated_at)
     VALUES (?, '冒烟双积分业务员', '13800000002', 3, 0.00, 1, NOW(), NOW())`,
    [workerId]
  );

  const [adminUser] = await q(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
  const adminTargetId = String(adminUser.id);

  // ⚠️ mini_accounts 上有唯一索引 uk_role_active（role + target_id，仅活动行）：
  //    同一角色+目标只能有一个活动账号。管理员账号在库里通常**已存在**（运维必需），
  //    直接 INSERT 会撞唯一键 —— 因此这里「存在则复用、不存在才新建」。
  //    复用只用于鉴权，本脚本的所有操作对象都是自建冒烟数据，不碰真实业务数据。
  const ensureMiniAccount = async (openid, phone, role, targetId, nickname) => {
    const exist = await q('SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? AND status = 1 LIMIT 1', [
      role,
      targetId
    ]);
    if (exist.length) {
      console.log(`  （复用已存在的 ${role} 小程序账号 id=${exist[0].id}）`);
      return exist[0].id;
    }
    await pool.query(
      `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      [openid, phone, role, targetId, nickname]
    );
    return (await q('SELECT id FROM mini_accounts WHERE openid = ?', [openid]))[0].id;
  };
  const stationAccId = await ensureMiniAccount(`smoke_pts_st_${TS}`, '13800000001', 'station', stationId, '冒烟水站');
  const adminAccId = await ensureMiniAccount(`smoke_pts_ad_${TS}`, '13800000003', 'admin', adminTargetId, '冒烟管理员');

  // 水站钱包：**从 0 开始**（余额全部来自真实业务路径，便于断言分类）
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await walletService.ensureWallet(conn, { ownerType: 'STATION', ownerId: stationId, ownerName: '冒烟-双积分水站' });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const stationToken = signMiniToken({ id: stationAccId, role: 'station', target_id: stationId });
  const adminMiniToken = signMiniToken({ id: adminAccId, role: 'admin', target_id: adminTargetId });

  const s0 = await walletSnap();
  assert(
    s0 && near(s0.total, 0) && near(s0.recharge, 0) && near(s0.delivery, 0),
    '水站钱包开立且初始为 0（三类余额一致）'
  );

  // ── 1. 配送费积分入账（水票发行）────────────────────────────────────────────
  section('1. 配送费积分入账：水票发行 → 只加「配送费积分」分账户（§12.10 / 双积分）');

  const ISSUE_QTY = 10;
  const issue = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-双积分发行',
      items: [{ productId, quantity: ISSUE_QTY, distributionDeliveryFee: 0 }]
    },
    webToken
  );
  assert(issue.code === 200, `发行成功（${issue.code} ${issue.message || ''}）`);
  const issuanceId = issue.data && issue.data.issuanceIds && issue.data.issuanceIds[0];
  const expectFee = ISSUE_QTY * UNIT_FEE;

  const s1 = await walletSnap();
  assert(near(s1.delivery, expectFee), `配送费积分 = ${expectFee}（实得 ${s1.delivery}）`);
  assert(near(s1.recharge, 0), `充值积分**未受影响**（实得 ${s1.recharge}）`);
  assert(near(s1.total, expectFee), `总余额 = ${expectFee}（实得 ${s1.total}）`);

  const issueTx = (await txsOf(issuanceId)).find(t => t.transaction_type === WALLET_TX_TYPE.DISTRIBUTION_FEE);
  assert(Boolean(issueTx), '发行产生 DISTRIBUTION_FEE 流水');
  assert(
    issueTx && issueTx.points_type === 'DELIVERY_FEE',
    `流水 points_type = DELIVERY_FEE（实得 ${issueTx && issueTx.points_type}）`
  );
  assert(
    issueTx && issueTx.points_month === MONTH,
    `流水 points_month = 发行月份 ${MONTH}（实得 ${issueTx && issueTx.points_month}）`
  );

  // ── 2. 充值积分入账（管理员调整）──────────────────────────────────────────
  section('2. 充值积分入账：管理员调整默认落「充值积分」，也可显式指定类型');

  const s1WalletId = s1.walletId;
  const adj1 = await call(
    'POST',
    '/mini/wallet/admin/adjust',
    {
      walletId: s1WalletId,
      direction: 'IN',
      amount: 100,
      reason: '冒烟充值积分',
      clientRequestId: `smoke_pts_adj1_${TS}`
    },
    adminMiniToken
  );
  assert(adj1.code === 200, `管理员增加 100（默认类型）（${adj1.code} ${adj1.message || ''}）`);

  const s2 = await walletSnap();
  assert(near(s2.recharge, 100), `充值积分 = 100（实得 ${s2.recharge}）`);
  assert(near(s2.delivery, expectFee), `配送费积分**不变** = ${expectFee}（实得 ${s2.delivery}）`);

  const adjTx1 = await q(
    `SELECT points_type FROM wallet_transactions
      WHERE wallet_id = ? AND transaction_type = ? ORDER BY created_at DESC LIMIT 1`,
    [s1WalletId, WALLET_TX_TYPE.ADJUST_IN]
  );
  assert(
    adjTx1.length && adjTx1[0].points_type === 'RECHARGE',
    `管理员调整默认 points_type = RECHARGE（实得 ${adjTx1.length ? adjTx1[0].points_type : '无流水'}）`
  );

  const adj2 = await call(
    'POST',
    '/mini/wallet/admin/adjust',
    {
      walletId: s1WalletId,
      direction: 'IN',
      amount: 5,
      pointsType: 'DELIVERY_FEE',
      reason: '冒烟-补发配送费积分',
      clientRequestId: `smoke_pts_adj2_${TS}`
    },
    adminMiniToken
  );
  assert(adj2.code === 200, `管理员显式指定 DELIVERY_FEE 增加 5（${adj2.code} ${adj2.message || ''}）`);
  const s2b = await walletSnap();
  assert(near(s2b.delivery, expectFee + 5), `配送费积分 = ${expectFee + 5}（实得 ${s2b.delivery}）`);
  assert(near(s2b.recharge, 100), `充值积分仍为 100（实得 ${s2b.recharge}）`);

  // ── 3. 用户自选混合抵扣（水站下单）────────────────────────────────────────
  section('3. 用户自选混合抵扣：两类各扣其数 + 拆两条流水 + 总额一致');

  const orderBody = extra => ({
    clientRequestId: `smoke_pts_${TS}_${Math.random().toString(36).slice(2, 8)}`,
    fulfillmentType: 'DELIVERY',
    customerName: '冒烟双积分收货人',
    customerPhone: '13911113333',
    customerAddress: '南京市冒烟路9号',
    items: [{ productId, quantity: 1, unitPrice: RETAIL }],
    ...extra
  });

  // 3.1 探测：不传分配参数 → 服务端应能自动分配（向后兼容既有调用方）
  const probe = await call('POST', '/mini/orders', orderBody({}), stationToken);
  assert(probe.code === 200, `3.1 不传分配参数仍可下单（向后兼容）：${probe.code} ${probe.message || ''}`);
  const probeOrderId = probe.data && probe.data.orderId;
  const probeOrder = probeOrderId
    ? (await q('SELECT order_amount, total_receivable FROM orders WHERE order_id = ?', [probeOrderId]))[0]
    : null;
  const PAYABLE = probeOrder ? Number(probeOrder.total_receivable || probeOrder.order_amount) : null;
  assert(PAYABLE !== null && PAYABLE > 0, `3.1 探测到应付积分 = ${PAYABLE}`);

  const sAfterProbe = await walletSnap();
  assert(
    near(sAfterProbe.total, s2b.total - PAYABLE),
    `3.1 探测下单扣减总额 ${PAYABLE}（${s2b.total} → ${sAfterProbe.total}）`
  );

  // 3.2 混合：充值 5 + 配送费（应付−5）
  const useRecharge = 5;
  const useDelivery = Number((PAYABLE - useRecharge).toFixed(2));
  const before3 = await walletSnap();
  const mixed = await call(
    'POST',
    '/mini/orders',
    orderBody({ pointsRecharge: useRecharge, pointsDeliveryFee: useDelivery }),
    stationToken
  );
  assert(mixed.code === 200, `3.2 混合抵扣下单成功（${mixed.code} ${mixed.message || ''}）`);
  const mixedOrderId = mixed.data && mixed.data.orderId;

  const after3 = await walletSnap();
  assert(
    near(after3.recharge, before3.recharge - useRecharge),
    `3.2 充值积分 ${before3.recharge} → ${after3.recharge}（−${useRecharge}）`
  );
  assert(
    near(after3.delivery, before3.delivery - useDelivery),
    `3.2 配送费积分 ${before3.delivery} → ${after3.delivery}（−${useDelivery}）`
  );
  assert(
    near(after3.total, before3.total - PAYABLE),
    `3.2 总余额扣减 = 应付 ${PAYABLE}（${before3.total} → ${after3.total}）`
  );

  const payTxs = mixedOrderId
    ? (await txsOf(mixedOrderId)).filter(t => t.transaction_type === WALLET_TX_TYPE.ORDER_PAYMENT)
    : [];
  assert(payTxs.length === 2, `3.2 混合扣款拆成 **2 条**流水（实得 ${payTxs.length} 条）`);
  const txR = payTxs.find(t => t.points_type === 'RECHARGE');
  const txD = payTxs.find(t => t.points_type === 'DELIVERY_FEE');
  assert(txR && near(txR.amount, useRecharge), `3.2 充值积分流水金额 ${useRecharge}（实得 ${txR && txR.amount}）`);
  assert(txD && near(txD.amount, useDelivery), `3.2 配送费积分流水金额 ${useDelivery}（实得 ${txD && txD.amount}）`);
  assert(
    payTxs.every(t => t.direction === TX_DIRECTION.OUT),
    '3.2 两条流水方向均为出账（OUT）'
  );

  // 3.3 单一类型也能用（全配送费）—— 先补一批发行，确保配送费积分够本次应付
  //     （前面 3.1 的自动分配已经先花掉了一部分配送费积分，不补会因余额不足而 400）
  const TOPUP_QTY = 5;
  const topUp = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-补充配送费积分',
      items: [{ productId, quantity: TOPUP_QTY, distributionDeliveryFee: 0 }]
    },
    webToken
  );
  assert(topUp.code === 200, `3.3 补发行 ${TOPUP_QTY} 件以补足配送费积分（${topUp.code} ${topUp.message || ''}）`);
  const before3c = await walletSnap();
  const onlyDelivery = await call(
    'POST',
    '/mini/orders',
    orderBody({ pointsRecharge: 0, pointsDeliveryFee: PAYABLE }),
    stationToken
  );
  assert(onlyDelivery.code === 200, `3.3 全额用配送费积分下单（${onlyDelivery.code} ${onlyDelivery.message || ''}）`);
  const after3c = await walletSnap();
  assert(near(after3c.recharge, before3c.recharge), `3.3 充值积分未被扣（${before3c.recharge} → ${after3c.recharge}）`);
  assert(
    near(after3c.delivery, before3c.delivery - PAYABLE),
    `3.3 配送费积分扣 ${PAYABLE}（${before3c.delivery} → ${after3c.delivery}）`
  );

  // ── 4. 负例：拒绝路径必须零副作用 ─────────────────────────────────────────
  section('4. 负例：非法分配一律 400，且不留半截扣款/订单');

  const before4 = await walletSnap();
  const [ordersBefore4] = await q('SELECT COUNT(*) n FROM orders WHERE buyer_type = ? AND buyer_id = ?', [
    'STATION',
    stationId
  ]);
  const [txBefore4] = await q(
    `SELECT COUNT(*) n FROM wallet_transactions WHERE wallet_id = ? AND transaction_type = ?`,
    [before4.walletId, WALLET_TX_TYPE.ORDER_PAYMENT]
  );

  const badSum = await call(
    'POST',
    '/mini/orders',
    orderBody({ pointsRecharge: 1, pointsDeliveryFee: 1 }), // 和 ≠ 应付
    stationToken
  );
  assert(badSum.code === 400, `4.1 分配之和 ≠ 应付被拒（400）：实得 ${badSum.code} ${badSum.message || ''}`);

  const badOver = await call(
    'POST',
    '/mini/orders',
    orderBody({ pointsRecharge: 99999, pointsDeliveryFee: 0 }),
    stationToken
  );
  assert(badOver.code === 400, `4.2 单类超出可用余额被拒（400）：实得 ${badOver.code} ${badOver.message || ''}`);

  const badNegative = await call(
    'POST',
    '/mini/orders',
    orderBody({ pointsRecharge: -1, pointsDeliveryFee: PAYABLE + 1 }),
    stationToken
  );
  assert(badNegative.code === 400, `4.3 负数分配被拒（400）：实得 ${badNegative.code} ${badNegative.message || ''}`);

  const after4 = await walletSnap();
  const [ordersAfter4] = await q('SELECT COUNT(*) n FROM orders WHERE buyer_type = ? AND buyer_id = ?', [
    'STATION',
    stationId
  ]);
  const [txAfter4] = await q(
    `SELECT COUNT(*) n FROM wallet_transactions WHERE wallet_id = ? AND transaction_type = ?`,
    [before4.walletId, WALLET_TX_TYPE.ORDER_PAYMENT]
  );
  assert(
    near(after4.total, before4.total) &&
      near(after4.recharge, before4.recharge) &&
      near(after4.delivery, before4.delivery),
    `4.4 三次拒单后三类余额均未变（总 ${after4.total} / 充值 ${after4.recharge} / 配送费 ${after4.delivery}）`
  );
  assert(
    Number(ordersAfter4.n) === Number(ordersBefore4.n),
    `4.4 拒单未创建订单（${ordersBefore4.n} → ${ordersAfter4.n}）`
  );
  assert(
    Number(txAfter4.n) === Number(txBefore4.n),
    `4.4 拒单未留下 ORDER_PAYMENT 流水（${txBefore4.n} → ${txAfter4.n}）`
  );

  // ── 5. 回冲按原类型 ──────────────────────────────────────────────────────
  section('5. 回冲按原类型：作废水票只回「配送费积分」，不污染充值积分');

  const ticket = (
    await q('SELECT ticket_id FROM water_tickets WHERE issuance_id = ? AND status = 1 LIMIT 1', [issuanceId])
  )[0];
  assert(Boolean(ticket), '取到一张未使用水票用于作废');

  const before5 = await walletSnap();
  const cancel = await call('POST', `/water-tickets/${ticket.ticket_id}/cancel`, { reason: '冒烟-作废' }, webToken);
  assert(cancel.code === 200, `作废单张水票（${cancel.code} ${cancel.message || ''}）`);
  const after5 = await walletSnap();
  // ⚠️ 方向别写反：作废是**把发行时给出的积分收回** → 配送费积分应当**减少**。
  //    （照抄「回冲 = 加回来」会守着错误行为 —— 这类方向错误在本仓库已有先例。）
  assert(
    near(after5.delivery, before5.delivery - UNIT_FEE),
    `配送费积分被收回 ${UNIT_FEE}（${before5.delivery} → ${after5.delivery}）`
  );
  assert(near(after5.recharge, before5.recharge), `充值积分未受影响（${before5.recharge} → ${after5.recharge}）`);

  const revertTx = await q(
    `SELECT points_type, direction, amount FROM wallet_transactions
      WHERE wallet_id = ? AND transaction_type = ? ORDER BY created_at DESC LIMIT 1`,
    [before5.walletId, WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL]
  );
  assert(
    revertTx.length && revertTx[0].points_type === 'DELIVERY_FEE',
    `回冲流水 points_type = DELIVERY_FEE（实得 ${revertTx.length ? revertTx[0].points_type : '无'})`
  );

  // ── 6. 不变量与月度明细 ──────────────────────────────────────────────────
  section('6. 不变量：两条恒等式（全库）+ 配送费积分按月可见');

  const inv = await globalInvariants();
  assert(inv.badNet.length === 0, `恒等式①「余额 = 期初 + 流水净额」全库成立（违反 ${inv.badNet.length} 处）`);
  assert(
    inv.badSplit.length === 0,
    `恒等式②「余额 = 充值积分 + 配送费积分」全库成立（违反 ${inv.badSplit.length} 处）`
  );

  const expectMonthTotal = round2(expectFee + TOPUP_QTY * UNIT_FEE); // 段 1 发行 + 段 3.3 补发行
  const [monthAgg] = await q(
    `SELECT COALESCE(SUM(amount), 0) s, COUNT(*) n FROM wallet_transactions
      WHERE wallet_id = ? AND transaction_type = ? AND points_month = ?`,
    [(await walletSnap()).walletId, WALLET_TX_TYPE.DISTRIBUTION_FEE, MONTH]
  );
  assert(
    near(monthAgg.s, expectMonthTotal),
    `按发行月份 ${MONTH} 汇总配送费积分入账 = ${expectMonthTotal}（实得 ${monthAgg.s}，${monthAgg.n} 笔）`
  );

  const [otherMonth] = await q(
    `SELECT COALESCE(SUM(amount), 0) s FROM wallet_transactions
      WHERE wallet_id = ? AND transaction_type = ? AND points_month <> ?`,
    [(await walletSnap()).walletId, WALLET_TX_TYPE.DISTRIBUTION_FEE, MONTH]
  );
  assert(near(otherMonth.s, 0), `其他月份无配送费入账（实得 ${otherMonth.s}）—— 证明月度归属不是常量`);

  // ── 结果 ─────────────────────────────────────────────────────────────────
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
})()
  .catch(e => {
    console.error('\n冒烟异常：' + (e && e.message));
    console.error(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
    fail++;
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const r = await cleanupSmokeResidue(pool, { log: () => {} });
      console.log('清理：' + JSON.stringify(r));
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    await pool.end();
  });

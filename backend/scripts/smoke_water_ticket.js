/**
 * 冒烟测试：水票（水站返货管理）Web 端
 * —— 发行 / 编辑 / 账户调整 / 单张作废 / 批次删除 / 配送费端点已停用 / **积分入账与回冲**
 * ===========================================================================
 * 覆盖的端点（全部 Web 侧 /api/water-tickets）：
 *   POST   /issue                                发行（返货清单录入）
 *   POST   /:id/cancel                           单张作废（**回冲积分**）
 *   POST   /adjust-balance                       账户调整（调可用张数；**不涉及积分**）
 *   PUT    /issuances/:id                        编辑发行记录（只改数量/月份/备注）
 *   DELETE /issuances/batch/:batchId             删除批次（**按净入账回冲积分**）
 *   POST   /adjust-delivery-fee                  已停用 → 410
 *   POST   /adjust-station-delivery-fee          已停用 → 410
 *   GET    /inventory | /list | /issuances       三个读接口
 *
 * ⚠️ 本脚本在 Phase 7 落地时**翻转了三条历史断言方向**（照抄旧写法会守着错误行为）：
 *   ① §1.x 配送费**不再采信客户端传入值**（§12.10）：单件值一律来自商品档案；
 *   ② §5.x 发行记录的配送费**不再可编辑**（改单只改数量，金额随数量重算）；
 *   ③ §7.x 两个配送费调整端点**已停用**（返回 410，§12.9）—— 原先断言的是「能调整到目标值」。
 *
 * ⚠️ 积分是**水站的可用余额**（1 积分 = 1 元，下单时由 miniOrderService.debitWallet 抵扣），
 *    因此本节把钱包恒等式一并钉住：**余额 = 期初 + Σ正向 − Σ负向**，方向按域固定
 *    （发行/加量 IN、作废/减量/删批次 OUT）。
 *
 * 运行：node scripts/smoke_water_ticket.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';
const { pool } = require('../src/config/db');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
const { TX_DIRECTION, WALLET_TX_TYPE, WALLET_OWNER_TYPE, WALLET_RELATED_TYPE } = require('../src/constants/mini');

/** 返回信封 + HTTP 状态码（401/410 这类断言只能看状态码） */
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

const TS = Date.now();
// 标识口径必须落在 smokeCleanup 的 MARKERS 内（products SMK% / sub_stations SMKST% / month 2099%）
const productId = `SMKWT${TS}`;
const productId2 = `SMKWD${TS}`;
const stationId = `SMKST${TS}`;
const ghostStationId = `SMKSTG${TS}`;
const MONTH = '2099-01';
const UNIT_FEE = 2.5; // 商品档案单件分销配送费（服务端唯一来源）
const UNIT_FEE2 = 1; // 第二个商品的单件值

const q = async (sql, args = []) => (await pool.query(sql, args))[0];

const countTickets = async (status, product = productId) =>
  Number(
    (
      await q('SELECT COUNT(*) c FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = ?', [
        stationId,
        product,
        status
      ])
    )[0].c
  );

const issuanceOf = async id =>
  (
    await q(
      `SELECT issuance_id, batch_id, station_id, product_id, quantity, distribution_delivery_fee,
              month, remark, distribution_delivery_fee_unit, distribution_delivery_fee_total,
              wallet_transaction_id
         FROM water_ticket_issuance WHERE issuance_id = ?`,
      [id]
    )
  )[0] || null;

const sumFee = async (product = productId) =>
  Number(
    (
      await q(
        `SELECT ROUND(COALESCE(SUM(distribution_delivery_fee), 0), 2) s FROM water_ticket_issuance
          WHERE station_id = ? AND product_id = ?`,
        [stationId, product]
      )
    )[0].s
  );

const walletRow = async () =>
  (
    await q(
      'SELECT wallet_id, owner_type, owner_id, initial_balance, balance, status FROM wallet_accounts WHERE owner_type = ? AND owner_id = ?',
      [WALLET_OWNER_TYPE.STATION, stationId]
    )
  )[0] || null;

const walletBalance = async () => {
  const w = await walletRow();
  return w ? Number(w.balance) : null;
};

/** 钱包恒等式：余额 = 期初 + Σ正向 − Σ负向（对本冒烟自建的水站钱包） */
const walletReconcile = async () => {
  const w = await walletRow();
  if (!w) return null;
  const [net] = await q(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE -amount END), 0), 2) net,
            COUNT(*) n
       FROM wallet_transactions WHERE wallet_id = ?`,
    [TX_DIRECTION.IN, w.wallet_id]
  );
  return {
    initial: Number(w.initial_balance),
    balance: Number(w.balance),
    net: Number(net.net),
    count: Number(net.n),
    ok: near(Number(w.balance), Number(w.initial_balance) + Number(net.net))
  };
};

/** 直接读积分流水（按发行记录），用于核对回冲方向与类型 */
const txByIssuance = async issuanceId =>
  q(
    `SELECT transaction_id, direction, amount, transaction_type, related_type, related_id
       FROM wallet_transactions
      WHERE related_type = ? AND related_id = ? ORDER BY created_at, transaction_id`,
    [WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE, issuanceId]
  );

const setTicketStatus = async (ticketId, status) => {
  await pool.query('UPDATE water_tickets SET status = ? WHERE ticket_id = ?', [status, ticketId]);
};

const firstUnusedTicket = async () =>
  (
    await q('SELECT ticket_id FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = 1 LIMIT 1', [
      stationId,
      productId
    ])
  )[0];

const firstUnusedBatchTicket = async issuanceId =>
  (await q('SELECT ticket_id FROM water_tickets WHERE issuance_id = ? AND status = 1 LIMIT 1', [issuanceId]))[0];

/** 账户调整补发的票（不属于任何批次） */
const orphanTickets = async () =>
  Number(
    (
      await q('SELECT COUNT(*) c FROM water_tickets WHERE station_id = ? AND product_id = ? AND issuance_id IS NULL', [
        stationId,
        productId
      ])
    )[0].c
  );

const ticketsInBatch = async batchId =>
  Number(
    (
      await q(
        `SELECT COUNT(*) c FROM water_tickets t JOIN water_ticket_issuance i ON t.issuance_id = i.issuance_id
          WHERE i.batch_id = ?`,
        [batchId]
      )
    )[0].c
  );

(async () => {
  // ── 0. 登录与自建载体 ────────────────────────────────────────────────────
  section('0. 准备（登录 + 自建商品/水站，不依赖真实数据）');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(Boolean(login.data && login.data.token), '管理员登录');
  const token = login.data.token;

  const insertProduct = (pid, unit, name) =>
    pool.query(
      `INSERT INTO products (product_id, product_name, product_code, category, purchase_price, wholesale_price,
         retail_price, machine_price, distribution_delivery_fee, status, created_at, updated_at)
       VALUES (?, ?, ?, '冒烟', 10, 12, 15, 10, ?, 1, NOW(), NOW())`,
      [pid, name, pid, unit]
    );
  await insertProduct(productId, UNIT_FEE, '冒烟-水票发行测试商品');
  await insertProduct(productId2, UNIT_FEE2, '冒烟-水票第二商品');
  await pool.query(
    `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, created_at, updated_at)
     VALUES (?, '冒烟-水票发行测试水站', '冒烟', '13800000000', 1, NOW(), NOW())`,
    [stationId]
  );
  assert(
    true,
    `载体就绪：商品 ${productId}（单件 ${UNIT_FEE}）/ ${productId2}（单件 ${UNIT_FEE2}），水站 ${stationId}`
  );

  // ── 1. 发行：单件值服务端重取 + 三列恒等 + 客户端值不生效 ────────────────
  section('1. 发行（POST /issue）：单件值服务端重取 + 三列恒等 + 客户端值不生效');
  const issue1 = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-发行',
      // ⚠️ 故意传一个**错误**的配送费：它必须被忽略（Phase 7 §12.10）
      items: [{ productId, quantity: 3, distributionDeliveryFee: 1 }]
    },
    token
  );
  assert(issue1.code === 200, `1.1 发行成功（实得 ${issue1.code} ${issue1.message || ''}）`);
  const batch1 = issue1.data && issue1.data.batchId;
  const issuance1 = issue1.data && issue1.data.issuanceIds && issue1.data.issuanceIds[0];
  assert(Boolean(batch1) && String(batch1).startsWith('WTB'), '1.2 返回批次号（WTB 前缀）');
  assert(issue1.data.totalTickets === 3, `1.3 返回门票数 3（实得 ${issue1.data.totalTickets}）`);
  assert(
    issue1.data.issuanceIds.length === 1,
    `1.4 一条商品对应一条发行记录（实得 ${issue1.data.issuanceIds.length}）`
  );
  assert((await countTickets(1)) === 3, '1.5 ★ 门票落库 3 张且全部为未用');

  const iss1 = await issuanceOf(issuance1);
  assert(iss1 && Number(iss1.quantity) === 3, `1.6 发行记录 quantity=3（实得 ${iss1 && iss1.quantity}）`);
  assert(
    iss1 && near(iss1.distribution_delivery_fee_unit, UNIT_FEE),
    `1.7 ★ 单件值服务端重取：入库 ${UNIT_FEE}（实得 ${iss1 && iss1.distribution_delivery_fee_unit}）`
  );
  assert(
    iss1 &&
      near(iss1.distribution_delivery_fee_total, UNIT_FEE * 3) &&
      near(iss1.distribution_delivery_fee, UNIT_FEE * 3),
    `1.8 ★★ 三列恒等：unit×quantity === _total === 遗留列 = ${UNIT_FEE * 3}（实得 ${iss1 && iss1.distribution_delivery_fee_total}/${iss1 && iss1.distribution_delivery_fee}）`
  );
  assert(
    iss1 && near(iss1.distribution_delivery_fee, UNIT_FEE * 3),
    '1.9 ★★ 客户端传入的配送费（1）**不生效**，入库仍是档案值×数量 = 7.5'
  );
  assert(
    issue1.data.totalFee !== undefined && near(issue1.data.totalFee, UNIT_FEE * 3),
    `1.10 响应回传本次发行金额合计（实得 ${issue1.data && issue1.data.totalFee}）`
  );
  assert(
    (await countTickets(1)) ===
      Number((await q('SELECT COUNT(*) c FROM water_tickets WHERE issuance_id = ?', [issuance1]))[0].c),
    '1.11 门票全部挂在本次发行记录下（issuance_id 回填）'
  );

  // 多商品：逐条取各自档案单件值
  const issueMulti = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-多商品',
      items: [
        { productId, quantity: 1, distributionDeliveryFee: 0 },
        { productId: productId2, quantity: 2, distributionDeliveryFee: 0 }
      ]
    },
    token
  );
  const issB = await issuanceOf(issueMulti.data.issuanceIds[0]);
  const issC = await issuanceOf(issueMulti.data.issuanceIds[1]);
  assert(
    issueMulti.code === 200 &&
      near(issB.distribution_delivery_fee, UNIT_FEE) &&
      near(issC.distribution_delivery_fee, UNIT_FEE2 * 2),
    `1.12 ★ 多商品逐条取各自档案单件值（实得 ${issB && issB.distribution_delivery_fee}/${issC && issC.distribution_delivery_fee}）`
  );
  assert(
    issueMulti.data.totalFee !== undefined && near(issueMulti.data.totalFee, UNIT_FEE + UNIT_FEE2 * 2),
    '1.13 多商品发行金额合计正确'
  );
  await call('DELETE', `/water-tickets/issuances/batch/${issueMulti.data.batchId}`, null, token);

  const issueDefaultMonth = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId: productId2, quantity: 1 }] },
    token
  );
  const defIss = await issuanceOf(issueDefaultMonth.data.issuanceIds[0]);
  const expectMonth = new Date().toISOString().slice(0, 7);
  assert(
    defIss && defIss.month === expectMonth,
    `1.14 不传 month 时默认当月（期望 ${expectMonth}，实得 ${defIss && defIss.month}）`
  );
  // ⚠️ 必须走**接口**删除而不是原生 SQL：Phase 7 起删批次会回冲该批次的积分，
  //    SQL 直删会绕过回冲 → 钱包留下没有凭据的余额，后续恒等式断言会「莫名」多出钱。
  //    （仓库铁律里「原生 SQL 直删订单会绕过营收回冲」那条，在积分侧是同一个坑。）
  const delMonth = await call(
    'DELETE',
    `/water-tickets/issuances/batch/${issueDefaultMonth.data.batchId}`,
    null,
    token
  );
  assert(delMonth.code === 200, `1.15 默认月份批次已连同积分一起回冲删除（实得 ${delMonth.code}）`);

  const badNoItems = await call('POST', '/water-tickets/issue', { stationId, items: [] }, token);
  assert(badNoItems.code === 400, `1.15 空 items → 400（实得 ${badNoItems.code}）`);
  const badNoStation = await call('POST', '/water-tickets/issue', { items: [{ productId, quantity: 1 }] }, token);
  assert(badNoStation.code === 400, `1.16 缺水站 → 400（实得 ${badNoStation.code}）`);
  const badQty = await call('POST', '/water-tickets/issue', { stationId, items: [{ productId, quantity: 0 }] }, token);
  assert(badQty.code === 400, `1.17 数量为 0 → 400（实得 ${badQty.code}）`);
  const badStation = await call(
    'POST',
    '/water-tickets/issue',
    { stationId: ghostStationId, items: [{ productId, quantity: 1 }] },
    token
  );
  assert(badStation.code === 404, `1.18 水站不存在 → 404（实得 ${badStation.code}）`);
  const badProduct = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId: `NOSUCH${TS}`, quantity: 1 }] },
    token
  );
  assert(badProduct.code === 400, `1.19 商品不存在 → 400（实得 ${badProduct.code}）`);
  const noAuth = await call('POST', '/water-tickets/issue', { stationId, items: [] }, null);
  assert(
    noAuth.httpStatus === 401 && noAuth.code === 401,
    `1.20 无令牌 → HTTP 401 + 信封 401（实得 ${noAuth.httpStatus}/${noAuth.code}）`
  );

  // ── 2. 积分入账 + 读接口 ─────────────────────────────────────────────────
  section('2. 积分入账（水站钱包）+ 读接口');
  const w0 = await walletRow();
  assert(
    Boolean(w0) && w0.owner_type === WALLET_OWNER_TYPE.STATION,
    '2.1 ★ 发行即为该水站开立了积分钱包（owner_type=STATION）'
  );
  assert(w0 && Number(w0.status) === 1, `2.2 钱包为启用状态（实得 status=${w0 && w0.status}）`);
  assert(
    near(await walletBalance(), UNIT_FEE * 3),
    `2.3 ★ 发行入账：余额 = 单件×数量 = ${UNIT_FEE * 3}（实得 ${await walletBalance()}）`
  );
  const tx1 = await txByIssuance(issuance1);
  assert(
    tx1.length === 1 &&
      tx1[0].transaction_type === WALLET_TX_TYPE.DISTRIBUTION_FEE &&
      Number(tx1[0].direction) === TX_DIRECTION.IN,
    `2.4 ★ 流水类型/方向正确（${tx1[0] && tx1[0].transaction_type} / direction=${tx1[0] && tx1[0].direction}）`
  );
  assert(
    iss1 && iss1.wallet_transaction_id === tx1[0].transaction_id,
    '2.5 发行记录回填了入账流水号（wallet_transaction_id）'
  );
  const rec1 = await walletReconcile();
  assert(
    rec1 && rec1.ok,
    `2.6 ★ 钱包恒等式成立（期初 ${rec1 && rec1.initial} + 净额 ${rec1 && rec1.net} = 余额 ${rec1 && rec1.balance}）`
  );

  const inv = await call('GET', `/water-tickets/inventory?stationId=${stationId}&productId=${productId}`, null, token);
  const invRow = inv.data.list.find(x => x.productId === productId);
  assert(Boolean(invRow) && invRow.available === 3, `2.7 库存：未用 3 张（实得 ${invRow && invRow.available}）`);
  assert(
    Boolean(invRow) && near(invRow.deliveryFeeTotal, UNIT_FEE * 3),
    `2.8 库存行带该「水站×商品」的配送费合计（实得 ${invRow && invRow.deliveryFeeTotal}）`
  );

  const list = await call(
    'GET',
    `/water-tickets/list?stationId=${stationId}&productId=${productId}&page=1&pageSize=50`,
    null,
    token
  );
  assert(
    list.code === 200 && Number(list.data.total) === 3,
    `2.9 明细 total=3（实得 ${list.code}/${list.data && list.data.total}）`
  );
  assert(
    (list.data.list || []).every(x => x.status === 1 && x.statusName),
    '2.10 明细每行带数字状态与中文名（1 未用）'
  );

  const issuances = await call('GET', `/water-tickets/issuances?stationId=${stationId}&month=${MONTH}`, null, token);
  const batchRow = (issuances.data.list || []).find(b => b.batchId === batch1);
  assert(Boolean(batchRow), '2.11 发行记录按批次返回且能查到本批次');
  assert(
    Boolean(batchRow) && batchRow.totalQuantity === 3 && near(batchRow.totalFee, UNIT_FEE * 3),
    `2.12 批次合计：数量 3 / 配送费 7.5（实得 ${batchRow && batchRow.totalQuantity}/${batchRow && batchRow.totalFee}）`
  );
  assert(
    Boolean(batchRow) && batchRow.items.length === 1 && near(batchRow.items[0].unitFee, UNIT_FEE),
    `2.13 批次内明细带单件值（unitFee=${UNIT_FEE}，实得 ${batchRow && batchRow.items[0] && batchRow.items[0].unitFee}）`
  );

  // ── 3. 单张作废（回冲积分）───────────────────────────────────────────────
  section('3. 单张作废（POST /:id/cancel）：按单件值回冲积分');
  const t1 = await firstUnusedTicket();
  const balanceBeforeCancel = await walletBalance();
  const cancel1 = await call('POST', `/water-tickets/${t1.ticket_id}/cancel`, null, token);
  assert(cancel1.code === 200, `3.1 作废一张未用票（实得 ${cancel1.code} ${cancel1.message || ''}）`);
  assert((await countTickets(3)) === 1 && (await countTickets(1)) === 2, '3.2 状态流转：未用 3→2、作废 0→1');
  assert(
    near(await walletBalance(), balanceBeforeCancel - UNIT_FEE),
    `3.3 ★★ 回冲方向为 OUT：余额 ${balanceBeforeCancel} → ${balanceBeforeCancel - UNIT_FEE}（实得 ${await walletBalance()}）`
  );
  const tx2 = await txByIssuance(issuance1);
  assert(
    tx2.length === 2 &&
      tx2[1].transaction_type === WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL &&
      Number(tx2[1].direction) === TX_DIRECTION.OUT,
    `3.4 ★ 回冲流水类型/方向正确（${tx2[1] && tx2[1].transaction_type} / direction=${tx2[1] && tx2[1].direction}）`
  );
  assert(
    near((await walletReconcile()).net, UNIT_FEE * 2),
    `3.5 恒等式仍成立且净额 = 7.5 − 2.5 = 5（实得 ${(await walletReconcile()).net}）`
  );

  const balanceAfterCancel = await walletBalance();
  const cancelAgain = await call('POST', `/water-tickets/${t1.ticket_id}/cancel`, null, token);
  assert(
    cancelAgain.code === 400,
    `3.6 重复作废被拒（状态守卫在 SQL 的 AND status=未用 上，实得 ${cancelAgain.code}）`
  );
  assert(
    near(await walletBalance(), balanceAfterCancel),
    `3.7 ★★ 重复作废**不重复回冲**：余额未变（实得 ${await walletBalance()}）`
  );
  const cancelMissing = await call('POST', `/water-tickets/NOSUCH${TS}/cancel`, null, token);
  assert(cancelMissing.code === 400, `3.8 不存在的票 → 400（实得 ${cancelMissing.code}）`);

  // ── 4. 账户调整（不涉及积分）─────────────────────────────────────────────
  section('4. 账户调整（POST /adjust-balance）：只动票、**不动积分**');
  const balanceBeforeAdjust = await walletBalance();
  const adj1 = await call('POST', '/water-tickets/adjust-balance', { stationId, productId, targetQuantity: 5 }, token);
  assert(
    adj1.code === 200 && adj1.data.current === 2 && adj1.data.generated === 3 && adj1.data.cancelled === 0,
    `4.1 2→5：补发 3（实得 ${adj1.code} current=${adj1.data && adj1.data.current} gen=${adj1.data && adj1.data.generated}）`
  );
  assert((await countTickets(1)) === 5, '4.2 未用票变为 5');
  assert(
    near(await walletBalance(), balanceBeforeAdjust),
    `4.3 ★★ 账户调整补发的票**不产生积分**（它们没有发行记录；余额未变，实得 ${await walletBalance()}）`
  );
  const orphan = await q(
    "SELECT COUNT(*) c FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = 1 AND issuance_id IS NULL AND remark = '账户调整'",
    [stationId, productId]
  );
  assert(Number(orphan[0].c) === 3, `4.4 补发票无发行记录（issuance_id IS NULL，实得 ${orphan[0].c} 张）`);

  const adj2 = await call('POST', '/water-tickets/adjust-balance', { stationId, productId, targetQuantity: 2 }, token);
  assert(
    adj2.code === 200 && adj2.data.cancelled === 3 && adj2.data.generated === 0,
    `4.5 5→2：作废 3（实得 cancelled=${adj2.data && adj2.data.cancelled}）`
  );
  assert(
    near(await walletBalance(), balanceBeforeAdjust),
    '4.6 ★ 作废「账户调整票」同样不回冲积分（它们从未入账 —— 凭空扣会把恒等式弄坏）'
  );
  assert((await countTickets(1)) === 2 && (await countTickets(3)) === 4, '4.7 未用 2 / 作废 4（1 张手动 + 3 张调整）');

  const adjSame = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId, targetQuantity: 2 },
    token
  );
  assert(
    adjSame.code === 200 && adjSame.data.generated === 0 && adjSame.data.cancelled === 0,
    '4.8 目标数不变时不动任何票（不产生多余票）'
  );
  const adjBad = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId, targetQuantity: -1 },
    token
  );
  assert(adjBad.code === 400, `4.9 目标数为负 → 400（实得 ${adjBad.code}）`);
  const adjBadStation = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId: ghostStationId, productId, targetQuantity: 1 },
    token
  );
  assert(adjBadStation.code === 404, `4.10 水站不存在 → 404（实得 ${adjBadStation.code}）`);
  const adjBadProduct = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId: `NOSUCH${TS}`, targetQuantity: 1 },
    token
  );
  assert(adjBadProduct.code === 404, `4.11 商品不存在 → 404（实得 ${adjBadProduct.code}）`);

  // ── 5. 编辑发行记录（只改数量；金额派生；差额联动积分）───────────────────
  section('5. 编辑发行记录（PUT /issuances/:id）：只改数量、金额派生、差额联动积分');
  const balBeforeUp = await walletBalance(); // 5.0
  const up1 = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 5 }, token);
  assert(up1.code === 200, `5.1 数量 3→5（实得 ${up1.code} ${up1.message || ''}）`);
  assert((await countTickets(1)) === 4, '5.2 改大补发 2 张未用票（2→4）');
  const issUp1 = await issuanceOf(issuance1);
  assert(
    issUp1 &&
      near(issUp1.distribution_delivery_fee_total, UNIT_FEE * 5) &&
      near(issUp1.distribution_delivery_fee_unit, UNIT_FEE),
    `5.3 ★ 金额随数量重算且单件值不变（total=${UNIT_FEE * 5}，实得 ${issUp1 && issUp1.distribution_delivery_fee_total}）`
  );
  assert(
    near(await walletBalance(), balBeforeUp + UNIT_FEE * 2),
    `5.4 ★★ 加量 2 件 → 补入账 ${UNIT_FEE * 2}（余额 ${balBeforeUp} → ${balBeforeUp + UNIT_FEE * 2}，实得 ${await walletBalance()}）`
  );

  const up2 = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 4 }, token);
  assert(up2.code === 200, '5.5 数量 5→4');
  assert((await countTickets(1)) === 3 && (await countTickets(3)) === 5, '5.6 改小作废 1 张未用票（未用 4→3）');
  assert(
    near(await walletBalance(), balBeforeUp + UNIT_FEE),
    `5.7 ★★ 减量 1 件 → 回冲 ${UNIT_FEE}（实得余额 ${await walletBalance()}）`
  );

  const balBeforeFeeTry = await walletBalance();
  const up3 = await call(
    'PUT',
    `/water-tickets/issuances/${issuance1}`,
    { quantity: 4, distributionDeliveryFee: 999 },
    token
  );
  const issAfterFee = await issuanceOf(issuance1);
  assert(up3.code === 200, `5.8 改单请求仍成功（配送费字段被忽略而非报错，实得 ${up3.code}）`);
  assert(
    issAfterFee && near(issAfterFee.distribution_delivery_fee_total, UNIT_FEE * 4),
    `5.9 ★★ 配送费**不可编辑**：传 999 不生效，仍为单件值×数量 = ${UNIT_FEE * 4}（实得 ${issAfterFee && issAfterFee.distribution_delivery_fee_total}）`
  );
  assert(
    near(await walletBalance(), balBeforeFeeTry),
    `5.10 ★ 改配送费的请求不产生任何积分流水（余额未变，实得 ${await walletBalance()}）`
  );

  const upBadQty = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 0 }, token);
  assert(upBadQty.code === 400, `5.11 数量为 0 → 400（实得 ${upBadQty.code}）`);
  const upMissing = await call('PUT', '/water-tickets/issuances/NOSUCH', { quantity: 1 }, token);
  assert(upMissing.code === 404, `5.12 发行记录不存在 → 404（实得 ${upMissing.code}）`);

  const usedTicket = await firstUnusedBatchTicket(issuance1);
  await setTicketStatus(usedTicket.ticket_id, 2);
  const balBeforeBlocked = await walletBalance();
  const upBlocked = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 1 }, token);
  assert(upBlocked.code === 400, `5.13 需作废 3 张而本发行记录可用未用仅 1 张 → 400（实得 ${upBlocked.code}）`);
  const issAfterBlocked = await issuanceOf(issuance1);
  assert(
    Number(issAfterBlocked.quantity) === 4 &&
      (await countTickets(1)) === 2 &&
      near(await walletBalance(), balBeforeBlocked),
    '5.14 ★★ 被拒后数量、票数、**积分余额**均未变（拒绝发生在写库前，无半截改动）'
  );

  // ── 6. 批次删除（按净入账回冲）───────────────────────────────────────────
  section('6. 批次删除（DELETE /issuances/batch/:batchId）：按净入账回冲');
  const delBlocked = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(delBlocked.code === 400, `6.1 批次内有 1 张已核销票 → 拒绝删除（实得 ${delBlocked.code}）`);
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE batch_id = ?', [batch1]))[0].c === 1 &&
      near(await walletBalance(), balBeforeBlocked),
    '6.2 拒绝后批次与积分余额均未变（未发生半截删除/半截回冲）'
  );

  await setTicketStatus(usedTicket.ticket_id, 1); // 复原（真实核销路径见 smoke_ticket_restore.js）
  const orphanBefore = await orphanTickets();
  // ⚠️ 口径：**该批次**的净入账（不是整个钱包的净额）—— 回冲只针对本批次
  const batchNetRows = await q(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN wt.direction = ? THEN wt.amount ELSE -wt.amount END), 0), 2) net
       FROM wallet_transactions wt
       JOIN water_ticket_issuance i ON wt.related_type = ? AND wt.related_id = i.issuance_id
      WHERE i.batch_id = ?`,
    [TX_DIRECTION.IN, WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE, batch1]
  );
  const batchNet = Number(batchNetRows[0].net);
  const balanceBeforeDelete = await walletBalance();
  assert(batchNet > 0, `6.3 删除前该批次仍有净入账 ${batchNet}（回冲依据是净额，不是单据快照）`);
  const delOk = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(
    delOk.code === 200 && delOk.data.removed === 1,
    `6.4 无已核销票后删除成功（removed=${delOk.data && delOk.data.removed}）`
  );
  assert(
    near(delOk.data.revertedFee, batchNet),
    `6.5 ★ 响应回传回冲金额 = 该批次净入账 ${batchNet}（实得 ${delOk.data && delOk.data.revertedFee}）`
  );
  assert(
    near(await walletBalance(), balanceBeforeDelete - batchNet) && near(await walletBalance(), 0),
    `6.6 ★★ 余额按净额回冲并归零：${balanceBeforeDelete} − ${batchNet} = 0（实得 ${await walletBalance()}）`
  );
  const rec6 = await walletReconcile();
  assert(
    rec6 && rec6.ok && near(rec6.balance, 0),
    `6.7 ★★ 恒等式成立且余额为 0（期初 ${rec6.initial} + 净额 ${rec6.net}）`
  );
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE batch_id = ?', [batch1]))[0].c === 0 &&
      (await q('SELECT COUNT(*) c FROM water_tickets WHERE issuance_id = ?', [issuance1]))[0].c === 0,
    '6.8 该批次发行记录与门票均已清空'
  );
  const delAgain = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(delAgain.code === 404, `6.9 重复删除 → 404 批次不存在（实得 ${delAgain.code}）`);
  assert((await ticketsInBatch(batch1)) === 0, '6.10 该批次名下再无任何水票（JOIN 复核）');
  assert(
    (await orphanTickets()) === orphanBefore && orphanBefore > 0,
    `6.11 ★ 账户调整补发的票（issuance_id IS NULL）不被批次回收：前后均 ${orphanBefore} 张`
  );

  // ── 7. 两个配送费调整端点已停用（§12.9）──────────────────────────────────
  section('7. 配送费调整端点已停用（POST /adjust-delivery-fee、/adjust-station-delivery-fee → 410）');
  const adjFee1 = await call(
    'POST',
    '/water-tickets/adjust-delivery-fee',
    { stationId, productId, targetFee: 8 },
    token
  );
  assert(
    adjFee1.httpStatus === 410 && adjFee1.code === 410,
    `7.1 ★ 按商品调整 → 410（已停用，实得 ${adjFee1.httpStatus}/${adjFee1.code}）`
  );
  const adjFee2 = await call('POST', '/water-tickets/adjust-station-delivery-fee', { stationId, targetFee: 10 }, token);
  assert(
    adjFee2.httpStatus === 410 && adjFee2.code === 410,
    `7.2 ★ 按水站调整 → 410（已停用，实得 ${adjFee2.httpStatus}/${adjFee2.code}）`
  );
  assert(
    (await sumFee()) === 0 && near(await walletBalance(), 0),
    '7.3 停用端点不产生任何副作用（金额与积分余额均未变）'
  );

  // ── 8. 余额不足时回冲被拒（设计决定：不制造负余额）──────────────────────
  section('8. 积分已被花掉时回冲被拒（不制造负余额）');
  const issueRetry = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, month: MONTH, remark: '冒烟-余额不足', items: [{ productId, quantity: 2 }] },
    token
  );
  const issuance4 = issueRetry.data.issuanceIds[0];
  const walletE = await walletRow();
  await pool.query(
    `INSERT INTO wallet_transactions
       (transaction_id, transaction_no, wallet_id, transaction_type, direction, amount,
        balance_before, balance_after, related_type, related_id, operator_id, operator_role, remark, created_at)
     VALUES (?, ?, ?, 'ORDER_PAYMENT', 2, ?, ?, 0.00, 'MANUAL_ADJUST', ?, 'smoke', 'admin', '冒烟-模拟水站花掉积分', NOW())`,
    [`WTSMK${TS}`, `WTSMKN${TS}`, walletE.wallet_id, UNIT_FEE * 2, await walletBalance(), issuance4]
  );
  await pool.query('UPDATE wallet_accounts SET balance = 0.00 WHERE wallet_id = ?', [walletE.wallet_id]);
  assert((await walletBalance()) === 0, '8.1 已把该水站积分花光（余额 0，模拟已被消费）');

  const tSpend = await firstUnusedBatchTicket(issuance4);
  const cancelBroke = await call('POST', `/water-tickets/${tSpend.ticket_id}/cancel`, null, token);
  assert(
    cancelBroke.code === 400,
    `8.2 ★★ 余额不足时作废被拒（实得 ${cancelBroke.code} ${cancelBroke.message || ''}）`
  );
  const tState = await q('SELECT status FROM water_tickets WHERE ticket_id = ?', [tSpend.ticket_id]);
  assert(
    Number(tState[0].status) === 1 && (await walletBalance()) === 0,
    '8.3 ★★ 被拒后票仍为未用、余额仍为 0（整个事务回滚，没有半截改动）'
  );
  const delBroke = await call('DELETE', `/water-tickets/issuances/batch/${issueRetry.data.batchId}`, null, token);
  assert(delBroke.code === 400, `8.4 ★ 同理：批次删除也因余额不足被拒（实得 ${delBroke.code}）`);
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE batch_id = ?', [issueRetry.data.batchId]))[0].c === 1,
    '8.5 被拒后批次仍在（未发生半截删除）'
  );

  console.log(`\n阶段结果：${pass} 通过 / ${fail} 失败`);
})()
  .catch(e => {
    console.error('冒烟异常:', e);
    fail++;
  })
  .finally(async () => {
    // 兜底清理：异常路径也执行（残留会污染后续冒烟与门禁计数）
    const residue = await cleanupSmokeResidue(pool);
    const left = await q(
      `SELECT
         (SELECT COUNT(*) FROM water_tickets WHERE station_id LIKE 'SMKST%') AS tickets,
         (SELECT COUNT(*) FROM water_ticket_issuance WHERE station_id LIKE 'SMKST%') AS issuances,
         (SELECT COUNT(*) FROM sub_stations WHERE station_id LIKE 'SMKST%') AS stations,
         (SELECT COUNT(*) FROM products WHERE product_code LIKE 'SMK%') AS products,
         (SELECT COUNT(*) FROM wallet_accounts WHERE owner_id LIKE 'SMKST%') AS wallets,
         (SELECT COUNT(*) FROM wallet_transactions WHERE related_id LIKE 'WTSMK%' OR operator_id = 'smoke') AS wtx`
    );
    const rows = left[0];
    const total =
      Number(rows.tickets) +
      Number(rows.issuances) +
      Number(rows.stations) +
      Number(rows.products) +
      Number(rows.wallets) +
      Number(rows.wtx);
    console.log(
      `清理：残留 门票 ${rows.tickets} / 发行记录 ${rows.issuances} / 水站 ${rows.stations} / 商品 ${rows.products}` +
        ` / 钱包 ${rows.wallets} / 钱包流水 ${rows.wtx}${total === 0 ? ' ✓' : ' ✗ ' + JSON.stringify(rows)}`
    );
    if (total !== 0) fail++;
    void residue;
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

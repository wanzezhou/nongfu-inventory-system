/**
 * 冒烟测试：水票（水站返货管理）Web 端 —— 发行 / 编辑 / 账户调整 / 配送费调整 / 批次删除 / 单张作废
 * ===========================================================================
 * 为什么需要本脚本（2026-09-22 新增）：
 *   水票是 Phase 7（水票积分）要改造的对象，而**它的写侧此前零冒烟覆盖** ——
 *   `smoke_ticket_restore.js` 覆盖的是「订单侧核销/还原」，6 个发行类写端点从未被跑过。
 *   按仓库纪律「改既有端点前先有防线」，Phase 7 动它们之前必须先有这份定型测试。
 *
 * 覆盖的 9 个端点（全部 Web 侧 /api/water-tickets）：
 *   POST   /issue                                发行（返货清单录入）
 *   POST   /:id/cancel                           单张作废
 *   POST   /adjust-balance                       账户调整（把可用张数调到目标值）
 *   POST   /adjust-delivery-fee                  按「水站+商品」调整配送费累计到目标值
 *   POST   /adjust-station-delivery-fee          按「水站」调整配送费累计到目标值
 *   PUT    /issuances/:id                        编辑发行记录（数量 / 配送费 / 月份）
 *   DELETE /issuances/batch/:batchId             删除批次
 *   GET    /inventory | /list | /issuances       三个读接口
 *
 * ⚠️ 本脚本记录的是**当前行为**，其中 §1.5 是一条「已知缺口锚点」：
 *   发行时配送费**原样采信客户端传入值** —— `products.distribution_delivery_fee` 从不被读取。
 *   在「配送费只是个记录数字」的当下无害；但 Phase 7 要让它变成钱包积分，
 *   那时这个等号就是「前端传多少、公司就欠水站多少积分」（违反文档自立的 §22.1）。
 *   docs §12.10 已判定必须改为「服务端从商品档案重取」——
 *   改完后 §1.5 这条断言**必须翻转方向**（照抄会变成守着错误行为）。
 *
 * 运行：node scripts/smoke_water_ticket.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';
const { pool } = require('../src/config/db');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');

/** 返回信封 + HTTP 状态码（401 这类断言只能看状态码） */
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

const TS = Date.now();
// 标识口径必须落在 smokeCleanup 的 MARKERS 内，否则测试数据会永久堆在库里：
//   products → product_code LIKE 'SMK%' / product_name LIKE '冒烟%'
//   sub_stations → station_id LIKE 'SMKST%' / station_name LIKE '冒烟%'
//   water_ticket_issuance → month LIKE '2099%' OR remark LIKE '%冒烟%'
const productId = `SMKWT${TS}`;
const productId2 = `SMKWD${TS}`;
const stationId = `SMKST${TS}`;
const ghostStationId = `SMKSTG${TS}`;
const MONTH = '2099-01';
const UNIT_FEE = 2.5; // 商品档案单件分销配送费

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
              month, remark, distribution_delivery_fee_unit, distribution_delivery_fee_total
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

/**
 * 批次内的第一张未用票 —— §5.11 / §6 必须用它，而不是上面那个通用查询：
 * 账户调整补发的票不在任何批次里（issuance_id IS NULL），若随手取到那种票，
 * 「批次内有已核销票」的前提就不成立，删批次会**成功**，断言变成随机通过/失败。
 */
const firstUnusedBatchTicket = async issuanceId =>
  (await q('SELECT ticket_id FROM water_tickets WHERE issuance_id = ? AND status = 1 LIMIT 1', [issuanceId]))[0];

/**
 * 「无发行记录」的水票张数 = 账户调整补发的那些票。
 * ⚠️ 它们不属于任何批次（issuance_id IS NULL），因此**批次删除不会回收它们** ——
 *    这条不变量用「删除前后对比」来断言，不去猜具体张数（张数会随作废顺序变化）。
 */
const orphanTickets = async () =>
  Number(
    (
      await q('SELECT COUNT(*) c FROM water_tickets WHERE station_id = ? AND product_id = ? AND issuance_id IS NULL', [
        stationId,
        productId
      ])
    )[0].c
  );

/** 挂在某批次下的水票张数（批次删除后应归零） */
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

  await pool.query(
    `INSERT INTO products (product_id, product_name, product_code, category, purchase_price, wholesale_price,
       retail_price, machine_price, distribution_delivery_fee, status, created_at, updated_at)
     VALUES (?, '冒烟-水票发行测试商品', ?, '冒烟', 10, 12, 15, 10, ?, 1, NOW(), NOW())`,
    [productId, productId, UNIT_FEE]
  );
  await pool.query(
    `INSERT INTO products (product_id, product_name, product_code, category, purchase_price, wholesale_price,
       retail_price, machine_price, distribution_delivery_fee, status, created_at, updated_at)
     VALUES (?, '冒烟-水票默认月份测试商品', ?, '冒烟', 10, 12, 15, 10, 1, 1, NOW(), NOW())`,
    [productId2, productId2]
  );
  await pool.query(
    `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, created_at, updated_at)
     VALUES (?, '冒烟-水票发行测试水站', '冒烟', '13800000000', 1, NOW(), NOW())`,
    [stationId]
  );
  assert(true, `载体就绪：商品 ${productId} / ${productId2}，水站 ${stationId}`);

  // ── 1. 发行 ─────────────────────────────────────────────────────────────
  section('1. 发行（POST /issue）');
  const issue1 = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-发行',
      items: [{ productId, quantity: 3, distributionDeliveryFee: 7.5 }]
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
    iss1 && Number(iss1.distribution_delivery_fee) === 7.5,
    `1.7 配送费按客户端传入值入库 7.5（实得 ${iss1 && iss1.distribution_delivery_fee}）`
  );
  assert(
    (await countTickets(1)) ===
      Number((await q('SELECT COUNT(*) c FROM water_tickets WHERE issuance_id = ?', [issuance1]))[0].c),
    '1.8 门票全部挂在本次发行记录下（issuance_id 回填）'
  );

  // ⚠️ 已知缺口锚点（Phase 7 §12.10 修它时**本断言必须翻转**）
  const issueGap = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-缺口锚点',
      items: [{ productId, quantity: 3, distributionDeliveryFee: 1 }]
    },
    token
  );
  const gapIss = await issuanceOf(issueGap.data.issuanceIds[0]);
  assert(
    gapIss && Number(gapIss.distribution_delivery_fee) === 1,
    `1.9 ⚠️ 已知缺口锚点：配送费原样采信客户端值（传 1，商品档案单件 ${UNIT_FEE}×3=7.5，实得 ${gapIss && gapIss.distribution_delivery_fee}）` +
      ' —— Phase 7 §12.10 落地后本断言方向必须翻转'
  );
  await call('DELETE', `/water-tickets/issuances/batch/${issueGap.data.batchId}`, null, token);
  assert((await sumFee()) === 7.5, `1.10 清掉缺口锚点批次后配送费合计回到 7.5（实得 ${await sumFee()}）`);

  // 默认月份
  const issueDefaultMonth = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId: productId2, quantity: 1, distributionDeliveryFee: 1 }] },
    token
  );
  const defIss = await issuanceOf(issueDefaultMonth.data.issuanceIds[0]);
  const expectMonth = new Date().toISOString().slice(0, 7);
  assert(
    defIss && defIss.month === expectMonth,
    `1.11 不传 month 时默认当月（期望 ${expectMonth}，实得 ${defIss && defIss.month}）`
  );
  await pool.query('DELETE FROM water_tickets WHERE issuance_id = ?', [issueDefaultMonth.data.issuanceIds[0]]);
  await pool.query('DELETE FROM water_ticket_issuance WHERE issuance_id = ?', [issueDefaultMonth.data.issuanceIds[0]]);

  // 参数校验
  const badNoItems = await call('POST', '/water-tickets/issue', { stationId, items: [] }, token);
  assert(badNoItems.code === 400, `1.12 空 items → 400（实得 ${badNoItems.code}）`);
  const badNoStation = await call(
    'POST',
    '/water-tickets/issue',
    { items: [{ productId, quantity: 1, distributionDeliveryFee: 0 }] },
    token
  );
  assert(badNoStation.code === 400, `1.13 缺水站 → 400（实得 ${badNoStation.code}）`);
  const badQty = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId, quantity: 0, distributionDeliveryFee: 1 }] },
    token
  );
  assert(badQty.code === 400, `1.14 数量为 0 → 400（实得 ${badQty.code}）`);
  const badFee = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId, quantity: 1, distributionDeliveryFee: -1 }] },
    token
  );
  assert(badFee.code === 400, `1.15 配送费为负 → 400（实得 ${badFee.code}）`);
  const badStation = await call(
    'POST',
    '/water-tickets/issue',
    { stationId: ghostStationId, items: [{ productId, quantity: 1, distributionDeliveryFee: 1 }] },
    token
  );
  assert(badStation.code === 404, `1.16 水站不存在 → 404（实得 ${badStation.code}）`);
  const badProduct = await call(
    'POST',
    '/water-tickets/issue',
    { stationId, items: [{ productId: `NOSUCH${TS}`, quantity: 1, distributionDeliveryFee: 1 }] },
    token
  );
  assert(badProduct.code === 400, `1.17 商品不存在 → 400（实得 ${badProduct.code}）`);
  const noAuth = await call('POST', '/water-tickets/issue', { stationId, items: [] }, null);
  assert(
    noAuth.httpStatus === 401 && noAuth.code === 401,
    `1.18 无令牌 → HTTP 401 + 信封 401（实得 ${noAuth.httpStatus}/${noAuth.code}）`
  );

  // ── 2. 三个读接口 ────────────────────────────────────────────────────────
  section('2. 读接口（inventory / list / issuances）');
  const inv = await call('GET', `/water-tickets/inventory?stationId=${stationId}&productId=${productId}`, null, token);
  const invRow = inv.data.list.find(x => x.productId === productId);
  assert(Boolean(invRow) && invRow.available === 3, `2.1 库存：未用 3 张（实得 ${invRow && invRow.available}）`);
  assert(
    Boolean(invRow) && Number(invRow.deliveryFeeTotal) === 7.5,
    `2.2 库存行带该「水站×商品」的配送费合计 7.5（实得 ${invRow && invRow.deliveryFeeTotal}）`
  );
  assert(
    Boolean(invRow) && Number(invRow.stationDeliveryFee) === 7.5,
    '2.3 水站级配送费合计（合并单元格用）与商品级一致（本水站只有这一个商品）'
  );

  const list = await call(
    'GET',
    `/water-tickets/list?stationId=${stationId}&productId=${productId}&page=1&pageSize=50`,
    null,
    token
  );
  assert(
    list.code === 200 && Number(list.data.total) === 3,
    `2.4 明细 total=3（实得 ${list.code}/${list.data && list.data.total}）`
  );
  assert(
    (list.data.list || []).every(x => x.status === 1 && x.statusName),
    '2.5 明细每行带数字状态与中文名（1 未用）'
  );
  const listVoid = await call(
    'GET',
    `/water-tickets/list?stationId=${stationId}&productId=${productId}&status=3`,
    null,
    token
  );
  assert(Number(listVoid.data.total) === 0, `2.6 明细按 status 过滤生效（已作废 0 张，实得 ${listVoid.data.total}）`);

  const issuances = await call('GET', `/water-tickets/issuances?stationId=${stationId}&month=${MONTH}`, null, token);
  const batchRow = (issuances.data.list || []).find(b => b.batchId === batch1);
  assert(Boolean(batchRow), '2.7 发行记录按批次返回且能查到本批次');
  assert(
    Boolean(batchRow) && batchRow.totalQuantity === 3 && Number(batchRow.totalFee) === 7.5,
    `2.8 批次合计：数量 3 / 配送费 7.5（实得 ${batchRow && batchRow.totalQuantity}/${batchRow && batchRow.totalFee}）`
  );
  assert(
    Boolean(batchRow) && batchRow.items.length === 1 && batchRow.items[0].issuanceId === issuance1,
    '2.9 批次内明细为嵌套 items（与批次同一层级返回）'
  );

  // ── 3. 单张作废 ──────────────────────────────────────────────────────────
  section('3. 单张作废（POST /:id/cancel）');
  const t1 = await firstUnusedTicket();
  const cancel1 = await call('POST', `/water-tickets/${t1.ticket_id}/cancel`, null, token);
  assert(cancel1.code === 200, `3.1 作废一张未用票（实得 ${cancel1.code} ${cancel1.message || ''}）`);
  assert((await countTickets(3)) === 1 && (await countTickets(1)) === 2, '3.2 状态流转：未用 3→2、作废 0→1');
  const cancelAgain = await call('POST', `/water-tickets/${t1.ticket_id}/cancel`, null, token);
  assert(
    cancelAgain.code === 400,
    `3.3 重复作废被拒（状态守卫在 SQL 的 AND status=未用 上，实得 ${cancelAgain.code}）`
  );
  assert((await countTickets(3)) === 1, '3.4 重复作废未改变任何状态（第二次 affectedRows=0）');
  const cancelMissing = await call('POST', `/water-tickets/NOSUCH${TS}/cancel`, null, token);
  assert(cancelMissing.code === 400, `3.5 不存在的票 → 400（实得 ${cancelMissing.code}）`);

  // ── 4. 账户调整 ──────────────────────────────────────────────────────────
  section('4. 账户调整（POST /adjust-balance，目标张数）');
  const adj1 = await call('POST', '/water-tickets/adjust-balance', { stationId, productId, targetQuantity: 5 }, token);
  assert(
    adj1.code === 200 && adj1.data.current === 2 && adj1.data.generated === 3 && adj1.data.cancelled === 0,
    `4.1 2→5：补发 3（实得 ${adj1.code} current=${adj1.data && adj1.data.current} gen=${adj1.data && adj1.data.generated}）`
  );
  assert((await countTickets(1)) === 5, '4.2 未用票变为 5');
  const orphan = await q(
    "SELECT COUNT(*) c FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = 1 AND issuance_id IS NULL AND remark = '账户调整'",
    [stationId, productId]
  );
  assert(
    Number(orphan[0].c) === 3,
    `4.3 ★ 补发票不生成发行记录（issuance_id IS NULL，remark=账户调整，实得 ${orphan[0].c} 张）`
  );

  const adj2 = await call('POST', '/water-tickets/adjust-balance', { stationId, productId, targetQuantity: 2 }, token);
  assert(
    adj2.code === 200 && adj2.data.cancelled === 3 && adj2.data.generated === 0,
    `4.4 5→2：作废 3（实得 cancelled=${adj2.data && adj2.data.cancelled}）`
  );
  assert((await countTickets(1)) === 2 && (await countTickets(3)) === 4, '4.5 未用 2 / 作废 4（1 张手动 + 3 张调整）');

  const adjSame = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId, targetQuantity: 2 },
    token
  );
  assert(
    adjSame.code === 200 && adjSame.data.generated === 0 && adjSame.data.cancelled === 0,
    '4.6 目标数不变时不动任何票（幂等：不产生多余票）'
  );
  assert((await countTickets(1)) === 2, '4.7 不变调整后未用仍为 2');

  const adjBad = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId, targetQuantity: -1 },
    token
  );
  assert(adjBad.code === 400, `4.8 目标数为负 → 400（实得 ${adjBad.code}）`);
  const adjBadStation = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId: ghostStationId, productId, targetQuantity: 1 },
    token
  );
  assert(adjBadStation.code === 404, `4.9 水站不存在 → 404（实得 ${adjBadStation.code}）`);
  const adjBadProduct = await call(
    'POST',
    '/water-tickets/adjust-balance',
    { stationId, productId: `NOSUCH${TS}`, targetQuantity: 1 },
    token
  );
  assert(adjBadProduct.code === 404, `4.10 商品不存在 → 404（实得 ${adjBadProduct.code}）`);

  // ── 5. 编辑发行记录 ──────────────────────────────────────────────────────
  section('5. 编辑发行记录（PUT /issuances/:id）');
  const up1 = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 5 }, token);
  assert(up1.code === 200, `5.1 数量 3→5（实得 ${up1.code} ${up1.message || ''}）`);
  assert((await countTickets(1)) === 4, '5.2 改大补发 2 张未用票（2→4）');
  const up2 = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 4 }, token);
  assert(up2.code === 200, '5.3 数量 5→4');
  assert(
    (await countTickets(1)) === 3 && (await countTickets(3)) === 5,
    '5.4 改小作废 1 张未用票（未用 4→3、作废 →5）'
  );
  const up3 = await call('PUT', `/water-tickets/issuances/${issuance1}`, { distributionDeliveryFee: 9.99 }, token);
  const issAfterFee = await issuanceOf(issuance1);
  assert(
    up3.code === 200 && Number(issAfterFee.distribution_delivery_fee) === 9.99,
    `5.5 单独改配送费生效（实得 ${issAfterFee && issAfterFee.distribution_delivery_fee}）`
  );
  assert((await sumFee()) === 9.99, '5.6 配送费合计随之变化');
  assert((await countTickets(1)) === 3, '5.7 只改金额不动票数');

  const upBadQty = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 0 }, token);
  assert(upBadQty.code === 400, `5.8 数量为 0 → 400（实得 ${upBadQty.code}）`);
  const upBadFee = await call('PUT', `/water-tickets/issuances/${issuance1}`, { distributionDeliveryFee: -1 }, token);
  assert(upBadFee.code === 400, `5.9 配送费为负 → 400（实得 ${upBadFee.code}）`);
  const upMissing = await call('PUT', '/water-tickets/issuances/NOSUCH', { quantity: 1 }, token);
  assert(upMissing.code === 404, `5.10 发行记录不存在 → 404（实得 ${upMissing.code}）`);

  // 已核销票挡路：该发行记录下只剩 1 张未用（另 1 张置为已核销）→ 数量 4 减到 1 需作废 3 张 → 必须整单拒绝
  const usedTicket = await firstUnusedBatchTicket(issuance1);
  await setTicketStatus(usedTicket.ticket_id, 2);
  const upBlocked = await call('PUT', `/water-tickets/issuances/${issuance1}`, { quantity: 1 }, token);
  assert(upBlocked.code === 400, `5.11 需作废 3 张而本发行记录可用未用仅 1 张 → 400（实得 ${upBlocked.code}）`);
  const issAfterBlocked = await issuanceOf(issuance1);
  assert(
    Number(issAfterBlocked.quantity) === 4 && (await countTickets(1)) === 2,
    '5.12 ★ 被拒后数量与票数均未变（拒绝发生在写库前，无半截改动）'
  );

  // ── 6. 批次删除 ──────────────────────────────────────────────────────────
  section('6. 批次删除（DELETE /issuances/batch/:batchId）');
  const delBlocked = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(delBlocked.code === 400, `6.1 批次内有 1 张已核销票 → 拒绝删除（实得 ${delBlocked.code}）`);
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE batch_id = ?', [batch1]))[0].c === 1,
    '6.2 拒绝后批次仍在（未发生半截删除）'
  );

  const orphanBefore = await orphanTickets();
  await setTicketStatus(usedTicket.ticket_id, 1); // 复原（真实核销路径见 smoke_ticket_restore.js）
  const delOk = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(
    delOk.code === 200 && delOk.data.removed === 1,
    `6.3 无已核销票后删除成功（removed=${delOk.data && delOk.data.removed}）`
  );
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE batch_id = ?', [batch1]))[0].c === 0 &&
      (await q('SELECT COUNT(*) c FROM water_tickets WHERE issuance_id = ?', [issuance1]))[0].c === 0,
    '6.4 该批次发行记录与门票均已清空'
  );
  const delAgain = await call('DELETE', `/water-tickets/issuances/batch/${batch1}`, null, token);
  assert(delAgain.code === 404, `6.5 重复删除 → 404 批次不存在（实得 ${delAgain.code}）`);
  assert((await ticketsInBatch(batch1)) === 0, '6.6 该批次名下再无任何水票（JOIN 复核，非只按 issuance_id 估算）');
  assert(
    (await orphanTickets()) === orphanBefore && orphanBefore > 0,
    `6.7 ★ 账户调整补发的票（issuance_id IS NULL）**不被批次回收**：删除前后均为 ${orphanBefore} 张 —— ` +
      "它们既无发行记录、也无人负责回收，只能按 remark='账户调整' 单独处理"
  );

  // ── 7. 两个配送费调整 ────────────────────────────────────────────────────
  section('7. 配送费调整（adjust-delivery-fee / adjust-station-delivery-fee）');
  const feeNoIss = await call(
    'POST',
    '/water-tickets/adjust-delivery-fee',
    { stationId, productId, targetFee: 8 },
    token
  );
  assert(feeNoIss.code === 400, `7.1 该水站商品无发行记录 → 400（实得 ${feeNoIss.code}，前一步批次已删）`);

  const issue3 = await call(
    'POST',
    '/water-tickets/issue',
    {
      stationId,
      month: MONTH,
      remark: '冒烟-配送费调整',
      items: [{ productId, quantity: 2, distributionDeliveryFee: 5 }]
    },
    token
  );
  const issuance3 = issue3.data.issuanceIds[0];
  assert(issue3.code === 200 && (await sumFee()) === 5, `7.2 重新发行后配送费合计 5（实得 ${await sumFee()}）`);

  const unusedBeforeFeeAdj = await countTickets(1);
  const feeAdj = await call(
    'POST',
    '/water-tickets/adjust-delivery-fee',
    { stationId, productId, targetFee: 8 },
    token
  );
  assert(
    feeAdj.code === 200 && (await sumFee()) === 8,
    `7.3 ★ 按商品调整到目标值 8：SUM 精确变为 8（实得 ${feeAdj.code}/${await sumFee()}）`
  );
  assert(
    (
      await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE station_id = ? AND product_id = ?', [
        stationId,
        productId
      ])
    )[0].c === 1,
    '7.4 调整是「把差额加到最新一条发行记录」，不新增记录'
  );
  assert((await countTickets(1)) === unusedBeforeFeeAdj, `7.5 只动金额不动票数（未用 ${unusedBeforeFeeAdj} 张不变）`);
  const feeAdjBad = await call(
    'POST',
    '/water-tickets/adjust-delivery-fee',
    { stationId, productId, targetFee: -1 },
    token
  );
  assert(feeAdjBad.code === 400, `7.6 目标金额为负 → 400（实得 ${feeAdjBad.code}）`);

  const stFeeAdj = await call(
    'POST',
    '/water-tickets/adjust-station-delivery-fee',
    { stationId, targetFee: 10 },
    token
  );
  assert(
    stFeeAdj.code === 200 && (await sumFee()) === 10,
    `7.7 ★ 按水站调整到目标值 10：SUM 精确变为 10（实得 ${stFeeAdj.code}/${await sumFee()}）`
  );
  const stFeeBad = await call(
    'POST',
    '/water-tickets/adjust-station-delivery-fee',
    { stationId, targetFee: -1 },
    token
  );
  assert(stFeeBad.code === 400, `7.8 负数目标 → 400（实得 ${stFeeBad.code}）`);
  const stFeeGhost = await call(
    'POST',
    '/water-tickets/adjust-station-delivery-fee',
    { stationId: ghostStationId, targetFee: 1 },
    token
  );
  assert(stFeeGhost.code === 400, `7.9 无发行记录的水站 → 400（实得 ${stFeeGhost.code}）`);

  // 收尾前把第 7 段造的数据删掉，便于残留核对
  await call('DELETE', `/water-tickets/issuances/batch/${issue3.data.batchId}`, null, token);
  assert(
    (await q('SELECT COUNT(*) c FROM water_ticket_issuance WHERE station_id = ?', [stationId]))[0].c === 0,
    '7.10 第 7 段批次已清理（发行记录归零）'
  );
  void issuance3;

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
         (SELECT COUNT(*) FROM products WHERE product_code LIKE 'SMK%') AS products`
    );
    const rows = left[0];
    const total = Number(rows.tickets) + Number(rows.issuances) + Number(rows.stations) + Number(rows.products);
    console.log(
      `清理：残留 门票 ${rows.tickets} / 发行记录 ${rows.issuances} / 水站 ${rows.stations} / 商品 ${rows.products}` +
        `${total === 0 ? ' ✓' : ' ✗ ' + JSON.stringify(rows)}`
    );
    if (total !== 0) fail++;
    void residue;
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

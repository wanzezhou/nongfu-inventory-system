const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { TICKET_STATUS, TICKET_STATUS_NAMES } = require('../constants/waterTicket');
// 分销配送费积分台账（Phase 7 §12.6/§12.7/§12.10）：单件值取数、入账/回冲原语、
// 与「某发行记录/批次当前净入账」的聚合查询。Web 与管理端共用同一套。
const waterTicketLedger = require('../services/waterTicketLedger');

// ---------------------------------------------------------------------------
// 水站返货管理（水票系统）
// 一张水票 = 一件对应商品（价值=进货价）；发行 = 每月返货清单录入
// water_tickets.status 语义见 constants/waterTicket.js（1-未用 / 2-已核销 / 3-作废）
// ---------------------------------------------------------------------------

// 返货清单录入/发行：生成发行记录 + 等量水票（每商品一条发行记录，含返货配送费）
/** 业务校验失败（`e.business = true`）—— 项目既有约定（同 salaryLedger.bizFail） */
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

// ---------------------------------------------------------------------------
// 发行核心（Web 与管理端共用**同一段金额逻辑**）
// ⚠️ 为什么必须抽出来：发行不只是「生成票」，它同时给水站入账积分（单件值 × 数量）。
//    两端各写一份的结果必然是「一边改了单件值来源、另一边没改」—— 而两边账面都像正常。
// ⚠️ **必须在调用方事务内执行**（发行记录 + 水票 + 钱包入账同一事务）。
// @returns {Promise<{issuanceIds:string[], batchId:string, totalTickets:number, totalFee:number}>}
async function createIssuance(conn, { stationId, month, remark, items, operator }) {
  const actualMonth = month || new Date().toISOString().slice(0, 7);
  if (!stationId) throw bizFail('请选择水站');
  if (!Array.isArray(items) || items.length === 0) throw bizFail('请至少填写一条返货商品');

  // ⚠️ 请求体里的 `distributionDeliveryFee` 一律**不参与入库**（§12.10）：
  //    单件配送费由服务端从商品档案重取 —— 它现在会变成水站的积分（钱），
  //    采信客户端值等于把「公司欠水站多少积分」的定价权交给调用方。
  //    为兼容旧前端仍**接受**该字段（不报错），但只字不用。
  // 字段名经 normalizeBody 中间件归一为驼峰。
  const cleanItems = items.map(it => ({ productId: it.productId, quantity: Number(it.quantity) }));
  if (cleanItems.some(it => !it.productId || isNaN(it.quantity) || it.quantity <= 0)) {
    throw bizFail('每条需填写商品与数量（>0）');
  }

  const [stationRows] = await conn.execute('SELECT station_id, station_name FROM sub_stations WHERE station_id = ?', [
    stationId
  ]);
  if (stationRows.length === 0) throw bizFail('水站不存在', 404);
  const stationName = stationRows[0].station_name;

  // 单件配送费：逐商品从档案取（同一商品多次提报会各生成一条发行记录，各自入账）
  const unitFeeMap = {};
  for (const it of cleanItems) {
    unitFeeMap[it.productId] = await waterTicketLedger.resolveUnitFee(conn, it.productId);
  }

  const now = new Date();
  // 同一次录入 = 一个批次（批次号用于列表按批次合并展示）
  const batchId = `WTB${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
  let totalTickets = 0;
  let totalFee = 0;
  const issuanceIds = [];

  for (const it of cleanItems) {
    const issuanceId = `WTI${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
    const fee = waterTicketLedger.computeFeeCols(unitFeeMap[it.productId], it.quantity);

    // ① 先入账（积分 = 水站可用余额，发行即产生）：金额 = 单件值 × 数量
    //    ★ 双积分：必须带上发行月份（此刻发行记录还没写，服务端无法回查 —— 见
    //      waterTicketLedger.creditDistributionFee 的说明）
    const tx = await waterTicketLedger.creditDistributionFee(conn, {
      issuanceId,
      stationId,
      stationName,
      amount: fee.total,
      month: actualMonth,
      operator,
      remark: `返货发行入账（${it.quantity} 件 × ${fee.unit}）`
    });

    // ② 发行记录落「三列恒等」：unit × quantity === _total === 遗留列（§12.6，遗留列保持兼容）
    await conn.execute(
      `INSERT INTO water_ticket_issuance
         (issuance_id, batch_id, station_id, product_id, quantity, distribution_delivery_fee,
          month, remark, created_by, distribution_delivery_fee_unit, distribution_delivery_fee_total,
          wallet_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        issuanceId,
        batchId,
        stationId,
        it.productId,
        it.quantity,
        fee.total,
        actualMonth,
        remark || null,
        operator,
        fee.unit,
        fee.total,
        tx ? tx.transaction_id : null
      ]
    );
    issuanceIds.push(issuanceId);

    // ③ 批量生成等量水票
    const ticketValues = [];
    for (let i = 0; i < it.quantity; i++) {
      ticketValues.push([
        `WT${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`,
        it.productId,
        stationId,
        TICKET_STATUS.UNUSED,
        actualMonth,
        issuanceId,
        now,
        operator,
        null,
        null,
        null
      ]);
    }
    if (ticketValues.length) {
      await conn.query(
        `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issuance_id, issued_at, issued_by, used_at, order_id, remark) VALUES ?`,
        [ticketValues]
      );
    }
    totalTickets += it.quantity;
    totalFee = waterTicketLedger.round2(totalFee + fee.total);
  }

  return { issuanceIds, batchId, totalTickets, totalFee };
}

/** HTTP 出口（薄封装：事务边界在这里，便于并进幂等/审计） */
async function issueTickets(req, res) {
  let connection;
  try {
    const { stationId, month, remark, items } = req.body || {};
    const operator = (req.user && (req.user.username || req.user.id)) || null;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const data = await createIssuance(connection, { stationId, month, remark, items, operator });
    await connection.commit();
    return success(res, data, `发行成功（${data.totalTickets} 张水票）`);
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    // ⚠️ 钱包原语与业务校验抛的都是**业务错误**（如「积分钱包已停用」「积分不足」「水站不存在」）——
    //    必须按其自带状态码回（400/404），不能一律 500，否则用户与排障者都读不懂。
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('issueTickets error:', e);
    return error(res, '发行失败', 500);
  } finally {
    if (connection) connection.release();
  }
}

// 水票库存（按水站+商品统计未用票数）
/**
 * 水票库存取数（Web 水票页与小程序管理端共用 —— 单源，不重写 SQL）
 * @param {object} query { stationId|station_id, month, productId }
 */
async function loadTicketInventory(query = {}) {
  {
    const { stationId, station_id, month, productId } = query;
    const where = [];
    const params = [];
    if (stationId || station_id) {
      where.push('t.station_id = ?');
      params.push(stationId || station_id);
    }
    if (month) {
      where.push('t.month = ?');
      params.push(month);
    }
    if (productId) {
      where.push('t.product_id = ?');
      params.push(productId);
    }
    where.push('t.status = ?');
    params.push(TICKET_STATUS.UNUSED);
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.execute(
      `SELECT t.station_id, s.station_name, t.product_id, p.product_name, p.specification, COUNT(*) AS available,
              (SELECT ROUND(SUM(i2.distribution_delivery_fee), 2)
               FROM water_ticket_issuance i2
               WHERE i2.station_id = t.station_id AND i2.product_id = t.product_id) AS delivery_fee_total
       FROM water_tickets t
       LEFT JOIN sub_stations s ON t.station_id = s.station_id
       LEFT JOIN products p ON t.product_id = p.product_id
       ${whereSql}
       GROUP BY t.station_id, t.product_id, s.station_name, p.product_name, p.specification
       ORDER BY s.station_name, p.product_name`,
      params
    );
    const list = rows.map(r => ({
      stationId: r.station_id,
      stationName: r.station_name || r.station_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      available: Number(r.available) || 0,
      deliveryFeeTotal: Number(r.delivery_fee_total) || 0
    }));
    // 水站级分销配送费总计（合并单元格求和用）
    const stationFeeMap = {};
    list.forEach(x => {
      stationFeeMap[x.stationId] = Math.round(((stationFeeMap[x.stationId] || 0) + x.deliveryFeeTotal) * 100) / 100;
    });
    list.forEach(x => {
      x.stationDeliveryFee = stationFeeMap[x.stationId] || 0;
    });
    return { list };
  }
}

/** HTTP 出口（薄封装） */
async function getTicketInventory(req, res) {
  try {
    return success(res, await loadTicketInventory(req.query));
  } catch (e) {
    console.error('getTicketInventory error:', e);
    return error(res, '水票库存查询失败', 500);
  }
}

// 水票明细（分页）
/**
 * 水票明细取数（单源）
 * @param {object} query { stationId|station_id, productId, status, month, page, pageSize }
 */
async function loadTicketList(query = {}) {
  {
    const { stationId, station_id, productId, status, month, page = 1, pageSize = 10 } = query;
    const { page: p, size, offset } = parsePage({ page, pageSize }, { maxSize: 100 });
    const where = [];
    const params = [];
    if (stationId || station_id) {
      where.push('t.station_id = ?');
      params.push(stationId || station_id);
    }
    if (productId) {
      where.push('t.product_id = ?');
      params.push(productId);
    }
    if (status !== undefined && status !== '') {
      where.push('t.status = ?');
      params.push(Number(status));
    }
    if (month) {
      where.push('t.month = ?');
      params.push(month);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM water_tickets t ${whereSql}`, params);
    const [rows] = await pool.execute(
      `SELECT t.ticket_id, t.product_id, p.product_name, p.specification, t.station_id, s.station_name,
              t.status, t.month, t.issued_at, t.issued_by, t.used_at, t.order_id
       FROM water_tickets t
       LEFT JOIN products p ON t.product_id = p.product_id
       LEFT JOIN sub_stations s ON t.station_id = s.station_id
       ${whereSql}
       ORDER BY t.issued_at DESC, t.ticket_id
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );
    const list = rows.map(r => ({
      ticketId: r.ticket_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      stationId: r.station_id,
      stationName: r.station_name || r.station_id,
      status: Number(r.status),
      statusName: TICKET_STATUS_NAMES[Number(r.status)] || '未知',
      month: r.month,
      issuedAt: r.issued_at,
      issuedBy: r.issued_by || '',
      usedAt: r.used_at,
      orderId: r.order_id || ''
    }));
    return { list, total: countRows[0].total, page: p, pageSize: size };
  }
}

/** HTTP 出口（薄封装） */
async function getTicketList(req, res) {
  try {
    return success(res, await loadTicketList(req.query));
  } catch (e) {
    console.error('getTicketList error:', e);
    return error(res, '水票明细查询失败', 500);
  }
}

// 作废水票（仅未用可作废）
/**
 * 作废单张水票 —— **须在调用方事务内执行**（Web 与小程序管理端共用同一段）
 * ⚠️ 状态守卫在 SQL 里（`AND status = UNUSED`）：并发下两次作废只有一次生效，
 *    第二次 affectedRows=0 → 抛 bizFail，不会把「已使用的票」改成作废。
 * ⚠️ **Phase 7 起会回冲积分**（§12.7）：作废 1 张 → 按该票所属发行记录的**单件值**回冲
 *    （方向 OUT）。积分在发行时已入账，作废相当于把这件返货退回去。
 *    · 账户调整补发的票（`issuance_id IS NULL`）**从未入账** → 不回冲（也不能凭空扣）；
 *    · 水站已把积分花掉时，回冲会因**余额不足**被拒 → 整个事务回滚，票保持未用。
 *      这是有意的：宁可拒绝，也不把余额压成负数（那会破坏仓库的余额恒等式）。
 */
async function cancelTicketById(conn, id, operator = null) {
  // 先取票与所属发行记录：回冲需要「单件值」与「水站」
  const [tRows] = await conn.execute(
    `SELECT t.ticket_id, t.station_id, t.issuance_id, i.distribution_delivery_fee_unit
       FROM water_tickets t
       LEFT JOIN water_ticket_issuance i ON t.issuance_id = i.issuance_id
      WHERE t.ticket_id = ?`,
    [id]
  );
  if (!tRows.length) throw bizFail('水票不存在或已不可作废');
  const ticket = tRows[0];

  const [result] = await conn.execute('UPDATE water_tickets SET status = ? WHERE ticket_id = ? AND status = ?', [
    TICKET_STATUS.VOID,
    id,
    TICKET_STATUS.UNUSED
  ]);
  if (result.affectedRows === 0) throw bizFail('水票不存在或已不可作废');

  if (ticket.issuance_id && ticket.distribution_delivery_fee_unit !== null) {
    await waterTicketLedger.revertDistributionFee(conn, {
      issuanceId: ticket.issuance_id,
      stationId: ticket.station_id,
      amount: ticket.distribution_delivery_fee_unit,
      operator,
      remark: `作废水票回冲（票号 ${id}）`
    });
  }
  return { ticketId: id };
}

/** HTTP 出口（薄封装：事务边界在控制器，便于并进幂等/审计） */
async function cancelTicket(req, res) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await cancelTicketById(conn, req.params.id, (req.user && (req.user.username || req.user.id)) || null);
    await conn.commit();
    return success(res, data, '已作废');
  } catch (e) {
    await conn.rollback();
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('cancelTicket error:', e);
    return error(res, '作废失败', 500);
  } finally {
    conn.release();
  }
}

// 发行记录列表（按批次分组：同一次录入的多条记录合并展示，按录入时间倒序）
/**
 * 发行记录取数（单源）
 * @param {object} query { stationId|station_id, month, page, pageSize }
 */
async function loadIssuanceList(query = {}) {
  {
    const { stationId, station_id, month, page = 1, pageSize = 10 } = query;
    const { page: p, size, offset } = parsePage({ page, pageSize }, { maxSize: 100 });
    const where = [];
    const params = [];
    if (stationId || station_id) {
      where.push('i.station_id = ?');
      params.push(stationId || station_id);
    }
    if (month) {
      where.push('i.month = ?');
      params.push(month);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // 批次级总数与分页
    const [countRows] = await pool.execute(
      `SELECT COUNT(DISTINCT i.batch_id) AS total FROM water_ticket_issuance i ${whereSql}`,
      params
    );
    const [batchRows] = await pool.execute(
      `SELECT i.batch_id, i.station_id, s.station_name, i.month, i.created_by, MIN(i.created_at) AS created_at,
              SUM(i.quantity) AS total_quantity, ROUND(SUM(i.distribution_delivery_fee), 2) AS total_fee,
              COUNT(*) AS item_count, MAX(i.remark) AS remark
       FROM water_ticket_issuance i
       LEFT JOIN sub_stations s ON i.station_id = s.station_id
       ${whereSql}
       GROUP BY i.batch_id, i.station_id, s.station_name, i.month, i.created_by
       ORDER BY created_at DESC, i.batch_id DESC
       LIMIT ${parseInt(size, 10)} OFFSET ${parseInt(offset, 10)}`,
      params
    );

    // 批次内明细
    const batchIds = batchRows.map(b => b.batch_id);
    let itemsRows = [];
    if (batchIds.length) {
      [itemsRows] = await pool.execute(
        `SELECT i.batch_id, i.issuance_id, i.product_id, p.product_name, p.specification,
                i.quantity, i.distribution_delivery_fee, i.distribution_delivery_fee_unit, i.remark
         FROM water_ticket_issuance i
         LEFT JOIN products p ON i.product_id = p.product_id
         WHERE i.batch_id IN (${batchIds.map(() => '?').join(',')})
         ORDER BY i.issuance_id`,
        batchIds
      );
    }

    const list = batchRows.map(b => ({
      batchId: b.batch_id,
      stationId: b.station_id,
      stationName: b.station_name || b.station_id,
      month: b.month,
      remark: b.remark || '',
      createdBy: b.created_by || '',
      createdAt: b.created_at,
      totalQuantity: Number(b.total_quantity) || 0,
      totalFee: Number(b.total_fee) || 0,
      itemCount: Number(b.item_count) || 0,
      items: itemsRows
        .filter(x => x.batch_id === b.batch_id)
        .map(x => ({
          issuanceId: x.issuance_id,
          productId: x.product_id,
          productName: x.product_name || x.product_id,
          specification: x.specification || '',
          quantity: Number(x.quantity) || 0,
          // 单件值（Phase 7 §12.6 落库）：页面据此展示「单件 × 数量」，不再反推
          unitFee: Number(x.distribution_delivery_fee_unit) || 0,
          distributionDeliveryFee: Number(x.distribution_delivery_fee) || 0,
          remark: x.remark || ''
        }))
    }));
    return { list, total: countRows[0].total, page: p, pageSize: size };
  }
}

/** HTTP 出口（薄封装） */
async function getIssuanceList(req, res) {
  try {
    return success(res, await loadIssuanceList(req.query));
  } catch (e) {
    console.error('getIssuanceList error:', e);
    return error(res, '发行记录查询失败', 500);
  }
}

// ---------------------------------------------------------------------------
// 编辑发行记录核心（Web 与管理端共用）
// ⚠️ 分销配送费**不可编辑**（§12.9/§12.10）：单件值来自商品档案，
//    总额 = 单件值 × 数量（随数量自动重算）。请求体里若带 `distributionDeliveryFee` 一律忽略 ——
//    改金额等于直接改历史入账金额，而它现在是水站的**积分**（钱），只能走反向流水。
// ⚠️ 数量变化联动水票与积分：增加→补发未用票 + 按差额入账；减少→作废未核销票 + 按差额回冲。
// ⚠️ **必须在调用方事务内执行**。
// @returns {Promise<{issuanceId:string, quantity:number, distributionDeliveryFee:number}>}
async function updateIssuanceCore(conn, { id, quantity, month, remark, operator }) {
  const [exist] = await conn.execute(
    `SELECT issuance_id, station_id, product_id, quantity, distribution_delivery_fee,
            month, remark, distribution_delivery_fee_unit
       FROM water_ticket_issuance WHERE issuance_id = ? FOR UPDATE`,
    [id]
  );
  if (exist.length === 0) throw bizFail('发行记录不存在', 404);
  const old = exist[0];

  const newQuantity = quantity !== undefined && quantity !== '' ? Number(quantity) : Number(old.quantity);
  if (isNaN(newQuantity) || newQuantity <= 0) throw bizFail('数量必须大于0');
  const newMonth = month || old.month;

  // 单件值：优先用已落库的值；历史行（Phase 7 之前）为空则回源商品档案并补上
  const oldUnit =
    old.distribution_delivery_fee_unit !== null && old.distribution_delivery_fee_unit !== undefined
      ? waterTicketLedger.round2(old.distribution_delivery_fee_unit)
      : await waterTicketLedger.resolveUnitFee(conn, old.product_id);
  const fee = waterTicketLedger.computeFeeCols(oldUnit, newQuantity);
  const oldTotal = waterTicketLedger.round2(old.distribution_delivery_fee);
  const feeDiff = waterTicketLedger.round2(fee.total - oldTotal);

  // 数量调整：计算差额
  const diff = newQuantity - Number(old.quantity);
  if (diff > 0) {
    // 补发水票
    const now = new Date();
    const values = [];
    for (let i = 0; i < diff; i++) {
      values.push([
        `WT${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`,
        old.product_id,
        old.station_id,
        TICKET_STATUS.UNUSED,
        newMonth,
        id,
        now,
        operator,
        null,
        null,
        null
      ]);
    }
    await conn.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issuance_id, issued_at, issued_by, used_at, order_id, remark) VALUES ?`,
      [values]
    );
  } else if (diff < 0) {
    // 作废多余的未核销水票（按票最早优先）
    const need = -diff;
    const [tickets] = await conn.execute(
      `SELECT ticket_id FROM water_tickets WHERE issuance_id = ? AND status = ? ORDER BY ticket_id LIMIT ${parseInt(need, 10)}`,
      [id, TICKET_STATUS.UNUSED]
    );
    if (tickets.length < need) {
      throw bizFail(`可作废的未用水票不足：需减 ${need} 张，仅剩 ${tickets.length} 张（部分已核销）`);
    }
    const ids = tickets.map(t => t.ticket_id);
    await conn.execute(`UPDATE water_tickets SET status = ? WHERE ticket_id IN (${ids.map(() => '?').join(',')})`, [
      TICKET_STATUS.VOID,
      ...ids
    ]);
  }

  // 积分联动：差额正向补入账 / 负向回冲（金额来自「单件值 × 数量」的差额，不是客户端值）
  if (feeDiff > 0) {
    await waterTicketLedger.creditDistributionFee(conn, {
      issuanceId: id,
      stationId: old.station_id,
      amount: feeDiff,
      month: old.month,
      operator,
      remark: `改单加量入账（数量 ${old.quantity} → ${newQuantity}）`
    });
  } else if (feeDiff < 0) {
    await waterTicketLedger.revertDistributionFee(conn, {
      issuanceId: id,
      stationId: old.station_id,
      amount: -feeDiff,
      operator,
      remark: `改单减量回冲（数量 ${old.quantity} → ${newQuantity}）`
    });
  }

  // ⚠️ `wallet_transaction_id` 只在**首次发行**时写入（= 该记录的入账流水），
  //    编辑产生的补/冲流水由 wallet_transactions 按 related_id 聚合体现 —— 不在这里改写，
  //    否则这个字段的语义会随编辑在「入账」与「回冲」之间漂移。
  await conn.execute(
    `UPDATE water_ticket_issuance
        SET quantity = ?, distribution_delivery_fee = ?, distribution_delivery_fee_unit = ?,
            distribution_delivery_fee_total = ?, month = ?, remark = ?
      WHERE issuance_id = ?`,
    [newQuantity, fee.total, fee.unit, fee.total, newMonth, remark !== undefined ? remark : old.remark, id]
  );

  return { issuanceId: id, quantity: newQuantity, distributionDeliveryFee: fee.total };
}

/** HTTP 出口（薄封装，Web 端） */
async function updateIssuance(req, res) {
  let connection;
  try {
    const { id } = req.params;
    const { quantity, month, remark } = req.body || {};
    const operator = (req.user && (req.user.username || req.user.id)) || null;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const data = await updateIssuanceCore(connection, { id, quantity, month, remark, operator });
    await connection.commit();
    return success(res, data, '修改成功');
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('updateIssuance error:', e);
    return error(res, '修改失败', 500);
  } finally {
    if (connection) connection.release();
  }
}

// 水站账户调整：将某水站某商品的可用水票数调整为目标数量（差额补发/作废）
async function adjustBalance(req, res) {
  let connection;
  try {
    const { stationId, productId, targetQuantity } = req.body || {};
    const actualStationId = stationId;
    const actualProductId = productId;
    const target = Number(targetQuantity);
    const operator = (req.user && (req.user.username || req.user.id)) || null;

    if (!actualStationId) return error(res, '请选择水站', 400);
    if (!actualProductId) return error(res, '请选择商品', 400);
    if (isNaN(target) || target < 0) return error(res, '目标数量必须大于等于0', 400);

    // 校验水站与商品
    const [sRows] = await pool.execute('SELECT station_id FROM sub_stations WHERE station_id = ?', [actualStationId]);
    if (sRows.length === 0) return error(res, '水站不存在', 404);
    const [pRows] = await pool.execute('SELECT product_id FROM products WHERE product_id = ?', [actualProductId]);
    if (pRows.length === 0) return error(res, '商品不存在', 404);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [curRows] = await connection.execute(
      `SELECT COUNT(*) AS c FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = ?`,
      [actualStationId, actualProductId, TICKET_STATUS.UNUSED]
    );
    const current = Number(curRows[0].c) || 0;
    const diff = target - current;
    const now = new Date();

    if (diff > 0) {
      // 补发（不生成发行记录，issuance_id 为空，备注"账户调整"）
      const values = [];
      for (let i = 0; i < diff; i++) {
        const ticketId = `WT${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;
        values.push([
          ticketId,
          actualProductId,
          actualStationId,
          TICKET_STATUS.UNUSED,
          now.toISOString().slice(0, 7),
          null,
          now,
          operator,
          null,
          null,
          '账户调整'
        ]);
      }
      await connection.query(
        `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issuance_id, issued_at, issued_by, used_at, order_id, remark) VALUES ?`,
        [values]
      );
    } else if (diff < 0) {
      const need = -diff;
      const [tickets] = await connection.execute(
        `SELECT ticket_id FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = ? ORDER BY ticket_id LIMIT ${parseInt(need, 10)}`,
        [actualStationId, actualProductId, TICKET_STATUS.UNUSED]
      );
      if (tickets.length < need) {
        await connection.rollback();
        return error(res, `可作废的未用水票不足：需减 ${need} 张，仅剩 ${tickets.length} 张（部分已核销）`, 400);
      }
      const ids = tickets.map(t => t.ticket_id);
      await connection.execute(
        `UPDATE water_tickets SET status = ? WHERE ticket_id IN (${ids.map(() => '?').join(',')})`,
        [TICKET_STATUS.VOID, ...ids]
      );
    }

    await connection.commit();
    return success(
      res,
      {
        stationId: actualStationId,
        productId: actualProductId,
        current,
        target,
        generated: Math.max(diff, 0),
        cancelled: Math.max(-diff, 0)
      },
      '调整成功'
    );
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('adjustBalance error:', e);
    return error(res, '调整失败', 500);
  } finally {
    if (connection) connection.release();
  }
}

// ── 以下两个端点已于 2026-09-22 **停用**（Phase 7 §12.9）─────────────────────
// 它们的能力是「把差额直接写进**历史**发行记录」，也就是改历史金额。
// 在配送费变成水站积分（钱）之后，这条路径会绕过钱包流水去改已入账金额 ——
// 钱包（账面）与发行记录（单据）会静默错位，而账面上没有任何一笔流水能解释差额从哪来。
// 正确做法：确需修正时**新增一张对冲发行记录**，不改历史。
//
// 保留路由并返回 410（而不是删掉路由）：旧调用方能拿到明确原因，也保留恢复的可能
// （回滚路径见 docs/小程序开发说明.md §7.2）。
const DISABLED_ADJUST_MSG = '该功能已停用（配送费由商品档案决定、不可改历史金额）；如需修正请新增一张对冲发行记录';

function adjustDeliveryFee(req, res) {
  return error(res, DISABLED_ADJUST_MSG, 410);
}

function adjustStationDeliveryFee(req, res) {
  return error(res, DISABLED_ADJUST_MSG, 410);
}

// 删除发行批次（管理员）：整批删除
// 约束：该批次存在已核销水票（status=已核销，已被订单抵扣）时拒绝删除；
// 未用(1)/作废(3)水票随批次一并删除
async function deleteIssuanceBatch(req, res) {
  let connection;
  try {
    const { batchId } = req.params;
    if (!batchId) return error(res, '缺少批次号', 400);
    const operator = (req.user && (req.user.username || req.user.id)) || null;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [issRows] = await connection.execute('SELECT issuance_id FROM water_ticket_issuance WHERE batch_id = ?', [
      batchId
    ]);
    if (issRows.length === 0) {
      await connection.rollback();
      return error(res, '批次不存在', 404);
    }
    const ids = issRows.map(r => r.issuance_id);
    const placeholders = ids.map(() => '?').join(',');

    // 检查已核销水票
    // ⚠️⚠️ 参数顺序必须与 SQL 里的占位符顺序一致：`IN (?)` 在前、`status = ?` 在后。
    //    2026-09-22 修正前此处传的是 `[TICKET_STATUS.USED, ...ids]` → 实际执行成
    //    `issuance_id IN (2) AND status = 'WTI...'`，条件**永远不成立**（恒为 0 行），
    //    于是这个守卫**完全失效**：含已核销票的批次照样能整批删除，
    //    把订单已抵扣的水票一并删掉 —— 订单还在、抵扣记录却没了，且账面看不出异常。
    //    该缺陷存活很久未被发现，原因是水票写侧此前**零冒烟覆盖**；
    //    现由 scripts/smoke_water_ticket.js §6.1 钉死。
    const [usedRows] = await connection.execute(
      `SELECT COUNT(*) AS c FROM water_tickets WHERE issuance_id IN (${placeholders}) AND status = ?`,
      [...ids, TICKET_STATUS.USED]
    );
    const usedCount = Number(usedRows[0].c) || 0;
    if (usedCount > 0) {
      await connection.rollback();
      return error(res, `该批次已有 ${usedCount} 张水票被订单核销，无法删除（请先处理关联订单）`, 400);
    }

    // 删除水票（未用/作废）与发行记录
    // ① 先按**当前净入账**逐条回冲积分（§12.7）：发行时入过账，删批次等于取消这次发行。
    //    ⚠️ 不能用 SUM(distribution_delivery_fee_total) 快照回冲 —— 之前的票级作废与减量
    //       已经把一部分冲回去了，按快照会**多冲**（且多冲的部分没有业务单据支撑）。
    //    ⚠️ 水站已把积分花掉时会因余额不足被拒 → 整体回滚、批次不被删除（有意为之）。
    const credited = await waterTicketLedger.issuancesWithCredit(connection, batchId);
    for (const row of credited) {
      await waterTicketLedger.revertDistributionFee(connection, {
        issuanceId: row.issuance_id,
        stationId: row.station_id,
        amount: row.net,
        operator,
        remark: `删除发行批次回冲（批次 ${batchId}）`
      });
    }

    await connection.execute(`DELETE FROM water_tickets WHERE issuance_id IN (${placeholders})`, ids);
    await connection.execute('DELETE FROM water_ticket_issuance WHERE batch_id = ?', [batchId]);

    await connection.commit();
    return success(
      res,
      { batchId, removed: issRows.length, revertedFee: credited.reduce((s, r) => s + r.net, 0) },
      '批次已删除'
    );
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('deleteIssuanceBatch error:', e);
    return error(res, '删除失败', 500);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  issueTickets,
  // 核心（Web 与管理端共用；小程序管理端直接调这两个，避免金额逻辑写两遍）
  createIssuance,
  updateIssuanceCore,
  getTicketInventory,
  getTicketList,
  cancelTicket,
  // 取数 / 原语（小程序管理端复用）
  loadTicketInventory,
  loadTicketList,
  loadIssuanceList,
  cancelTicketById,
  getIssuanceList,
  updateIssuance,
  adjustBalance,
  adjustDeliveryFee,
  adjustStationDeliveryFee,
  deleteIssuanceBatch
};

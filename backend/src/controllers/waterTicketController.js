const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// ---------------------------------------------------------------------------
// 水站返货管理（水票系统）
// 一张水票 = 一件对应商品（价值=进货价）；发行 = 每月返货清单录入
// water_tickets.status: 1-未用 2-已核销 3-作废
// ---------------------------------------------------------------------------

// 返货清单录入/发行：生成发行记录 + 等量水票（每商品一条发行记录，含返货配送费）
async function issueTickets(req, res) {
  let connection;
  try {
    const { stationId, station_id, month, remark, items } = req.body || {};
    const actualStationId = stationId || station_id;
    const actualMonth = month || new Date().toISOString().slice(0, 7);
    const operator = (req.user && (req.user.username || req.user.id)) || null;

    if (!actualStationId) return error(res, '请选择水站', 400);
    if (!Array.isArray(items) || items.length === 0) return error(res, '请至少填写一条返货商品', 400);
    const cleanItems = items.map((it) => ({
      productId: it.productId || it.product_id,
      quantity: Number(it.quantity),
      returnDeliveryFee: Number(it.returnDeliveryFee !== undefined ? it.returnDeliveryFee : (it.return_delivery_fee || 0))
    }));
    const invalid = cleanItems.some((it) => !it.productId || isNaN(it.quantity) || it.quantity <= 0 || isNaN(it.returnDeliveryFee) || it.returnDeliveryFee < 0);
    if (invalid) return error(res, '每条需填写商品、数量（>0）与返货配送费（≥0）', 400);

    // 校验水站与商品存在
    const [stationRows] = await pool.execute('SELECT station_id FROM sub_stations WHERE station_id = ?', [actualStationId]);
    if (stationRows.length === 0) return error(res, '水站不存在', 404);
    const productIds = cleanItems.map((it) => it.productId);
    const [productRows] = await pool.execute(
      `SELECT product_id FROM products WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    );
    const existSet = new Set(productRows.map((p) => p.product_id));
    for (const it of cleanItems) {
      if (!existSet.has(it.productId)) return error(res, `商品不存在: ${it.productId}`, 400);
    }

    const now = new Date();
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let totalTickets = 0;
    const issuanceIds = [];
    for (const it of cleanItems) {
      const issuanceId = `WTI${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      await connection.execute(
        `INSERT INTO water_ticket_issuance (issuance_id, station_id, product_id, quantity, return_delivery_fee, month, remark, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [issuanceId, actualStationId, it.productId, it.quantity, it.returnDeliveryFee, actualMonth, remark || null, operator]
      );
      issuanceIds.push(issuanceId);

      // 批量生成水票
      const ticketValues = [];
      for (let i = 0; i < it.quantity; i++) {
        const ticketId = `WT${Date.now()}${Math.floor(Math.random() * 900000 + 100000)}`;
        ticketValues.push([ticketId, it.productId, actualStationId, 1, actualMonth, issuanceId, now, operator, null, null, null]);
      }
      if (ticketValues.length) {
        await connection.query(
          `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issuance_id, issued_at, issued_by, used_at, order_id, remark) VALUES ?`,
          [ticketValues]
        );
      }
      totalTickets += it.quantity;
    }

    await connection.commit();
    return success(res, { issuanceIds, totalTickets }, `发行成功（${totalTickets} 张水票）`);
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('issueTickets error:', e);
    return error(res, '发行失败', 500);
  } finally {
    if (connection) connection.release();
  }
}

// 水票库存（按水站+商品统计未用票数）
async function getTicketInventory(req, res) {
  try {
    const { stationId, station_id, month, productId } = req.query;
    const where = [];
    const params = [];
    if (stationId || station_id) { where.push('t.station_id = ?'); params.push(stationId || station_id); }
    if (month) { where.push('t.month = ?'); params.push(month); }
    if (productId) { where.push('t.product_id = ?'); params.push(productId); }
    where.push('t.status = 1');
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.execute(
      `SELECT t.station_id, s.station_name, t.product_id, p.product_name, p.specification, COUNT(*) AS available
       FROM water_tickets t
       LEFT JOIN sub_stations s ON t.station_id = s.station_id
       LEFT JOIN products p ON t.product_id = p.product_id
       ${whereSql}
       GROUP BY t.station_id, t.product_id, s.station_name, p.product_name, p.specification
       ORDER BY s.station_name, p.product_name`,
      params
    );
    const list = rows.map((r) => ({
      stationId: r.station_id,
      stationName: r.station_name || r.station_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      available: Number(r.available) || 0
    }));
    return success(res, { list });
  } catch (e) {
    console.error('getTicketInventory error:', e);
    return error(res, '水票库存查询失败', 500);
  }
}

// 水票明细（分页）
async function getTicketList(req, res) {
  try {
    const { stationId, station_id, productId, status, month, page = 1, pageSize = 10 } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;
    const where = [];
    const params = [];
    if (stationId || station_id) { where.push('t.station_id = ?'); params.push(stationId || station_id); }
    if (productId) { where.push('t.product_id = ?'); params.push(productId); }
    if (status !== undefined && status !== '') { where.push('t.status = ?'); params.push(Number(status)); }
    if (month) { where.push('t.month = ?'); params.push(month); }
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
    const list = rows.map((r) => ({
      ticketId: r.ticket_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      stationId: r.station_id,
      stationName: r.station_name || r.station_id,
      status: Number(r.status),
      statusName: { 1: '未用', 2: '已核销', 3: '作废' }[Number(r.status)] || '未知',
      month: r.month,
      issuedAt: r.issued_at,
      issuedBy: r.issued_by || '',
      usedAt: r.used_at,
      orderId: r.order_id || ''
    }));
    return success(res, { list, total: countRows[0].total, page: p, pageSize: size });
  } catch (e) {
    console.error('getTicketList error:', e);
    return error(res, '水票明细查询失败', 500);
  }
}

// 作废水票（仅未用可作废）
async function cancelTicket(req, res) {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      `UPDATE water_tickets SET status = 3 WHERE ticket_id = ? AND status = 1`,
      [id]
    );
    if (result.affectedRows === 0) return error(res, '水票不存在或已不可作废', 400);
    return success(res, null, '已作废');
  } catch (e) {
    console.error('cancelTicket error:', e);
    return error(res, '作废失败', 500);
  }
}

// 发行记录列表（返货清单，含返货配送费；分页）
async function getIssuanceList(req, res) {
  try {
    const { stationId, station_id, month, page = 1, pageSize = 10 } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;
    const where = [];
    const params = [];
    if (stationId || station_id) { where.push('i.station_id = ?'); params.push(stationId || station_id); }
    if (month) { where.push('i.month = ?'); params.push(month); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM water_ticket_issuance i ${whereSql}`, params);
    const [rows] = await pool.execute(
      `SELECT i.issuance_id, i.station_id, s.station_name, i.product_id, p.product_name, p.specification,
              i.quantity, i.return_delivery_fee, i.month, i.remark, i.created_by, i.created_at
       FROM water_ticket_issuance i
       LEFT JOIN sub_stations s ON i.station_id = s.station_id
       LEFT JOIN products p ON i.product_id = p.product_id
       ${whereSql}
       ORDER BY i.created_at DESC
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );
    const list = rows.map((r) => ({
      issuanceId: r.issuance_id,
      stationId: r.station_id,
      stationName: r.station_name || r.station_id,
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      quantity: Number(r.quantity) || 0,
      returnDeliveryFee: Number(r.return_delivery_fee) || 0,
      month: r.month,
      remark: r.remark || '',
      createdBy: r.created_by || '',
      createdAt: r.created_at
    }));
    return success(res, { list, total: countRows[0].total, page: p, pageSize: size });
  } catch (e) {
    console.error('getIssuanceList error:', e);
    return error(res, '发行记录查询失败', 500);
  }
}

module.exports = {
  issueTickets,
  getTicketInventory,
  getTicketList,
  cancelTicket,
  getIssuanceList
};

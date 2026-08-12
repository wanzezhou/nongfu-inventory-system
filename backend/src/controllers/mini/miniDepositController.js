const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');

// 判断是否为表不存在的错误
function isTableMissingError(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

// 押金列表（数据隔离，表不存在时返回空列表）
async function list(req, res) {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;

    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    const whereParts = [];
    const params = [];
    if (role === 'admin') {
      // 全部
    } else if (role === 'worker' || role === 'salesman') {
      whereParts.push('d.handler_id = ?');
      params.push(targetId);
    } else if (role === 'station') {
      whereParts.push('d.station_id = ?');
      params.push(targetId);
    } else {
      whereParts.push('1 = 0');
    }
    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    let countRows, listRows;
    try {
      const countSql = `SELECT COUNT(*) AS total FROM barrel_deposits d ${whereClause}`;
      [countRows] = await pool.execute(countSql, params);
      const listSql = `SELECT
          d.id, d.station_id AS stationId, s.station_name AS stationName,
          d.barrel_type AS barrelType, d.quantity, d.unit_price AS unitPrice,
          d.deposit_type AS depositType, d.handler_id AS handlerId,
          w.worker_name AS handlerName, d.remark, d.created_at AS createdAt
        FROM barrel_deposits d
        LEFT JOIN sub_stations s ON d.station_id = s.station_id
        LEFT JOIN workers w ON d.handler_id = w.worker_id
        ${whereClause}
        ORDER BY d.created_at DESC
        LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
      [listRows] = await pool.execute(listSql, params);
    } catch (err) {
      if (isTableMissingError(err)) {
        return pagination(res, [], 0, currentPage, size);
      }
      throw err;
    }

    const total = countRows[0].total;
    const list = listRows.map(r => ({
      id: r.id,
      stationId: r.stationId,
      stationName: r.stationName || null,
      barrelType: r.barrelType,
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unitPrice) || 0,
      depositType: r.depositType,
      handlerId: r.handlerId,
      handlerName: r.handlerName || null,
      remark: r.remark || null,
      createdAt: r.createdAt
    }));

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取押金列表失败:', err);
    return res.json({ code: 500, message: '获取押金列表失败: ' + err.message, data: null });
  }
}

// 创建押金记录
async function create(req, res) {
  try {
    // 先探测表是否存在
    try {
      await pool.execute('SELECT 1 FROM barrel_deposits LIMIT 1');
    } catch (err) {
      if (isTableMissingError(err)) {
        return res.json({ code: 403, message: '押金功能暂未启用', data: null });
      }
      throw err;
    }

    const { stationId, barrelType, quantity, unitPrice, depositType, remark } = req.body || {};
    if (!stationId || !barrelType || quantity === undefined || unitPrice === undefined || !depositType) {
      return res.json({ code: 400, message: '水站、桶类型、数量、单价、押金类型不能为空', data: null });
    }
    const handlerId = req.miniUser.targetId;

    const [result] = await pool.execute(
      `INSERT INTO barrel_deposits
        (station_id, barrel_type, quantity, unit_price, deposit_type, handler_id, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [stationId, barrelType, Number(quantity), Number(unitPrice), depositType, handlerId, remark || null]
    );

    return res.json({ code: 200, message: '押金记录创建成功', data: { id: result.insertId } });
  } catch (err) {
    console.error('创建押金记录失败:', err);
    return res.json({ code: 500, message: '创建押金记录失败: ' + err.message, data: null });
  }
}

module.exports = {
  list,
  create
};

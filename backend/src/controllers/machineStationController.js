const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

// machine_type: 1-量贩机, 2-零售机
function generateMachineId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `M${timestamp}${random}`;
}

// 获取机台列表（支持按类型筛选）
async function getMachineStationList(req, res) {
  try {
    const { keyword, type, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (type !== undefined && type !== '') {
      whereClause += ' AND machine_type = ?';
      params.push(Number(type));
    }

    if (keyword) {
      whereClause += ' AND (station_name LIKE ? OR manager LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const countSql = `SELECT COUNT(*) as total FROM machine_stations ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM machine_stations ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取机台列表失败:', err);
    return error(res, '获取机台列表失败: ' + err.message);
  }
}

// 获取机台详情
async function getMachineStationById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM machine_stations WHERE machine_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '机台不存在', 404);
    }

    return success(res, rows[0]);
  } catch (err) {
    console.error('获取机台详情失败:', err);
    return error(res, '获取机台详情失败: ' + err.message);
  }
}

// 新增机台
async function createMachineStation(req, res) {
  try {
    const {
      machine_type = 1,
      station_name,
      address,
      manager,
      manager_phone,
      status = 1
    } = req.body;

    if (!station_name) {
      return error(res, '站点名称不能为空', 400);
    }

    const machine_id = generateMachineId();
    const now = new Date();

    const sql = `INSERT INTO machine_stations (
      machine_id, machine_type, station_name, address, manager, manager_phone, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      machine_id,
      Number(machine_type) || 1,
      station_name,
      address || null,
      manager || null,
      manager_phone || null,
      status,
      now,
      now
    ];

    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM machine_stations WHERE machine_id = ?', [machine_id]);
    return success(res, rows[0], '机台创建成功');
  } catch (err) {
    console.error('创建机台失败:', err);
    return error(res, '创建机台失败: ' + err.message);
  }
}

// 更新机台
async function updateMachineStation(req, res) {
  try {
    const { id } = req.params;
    const {
      machine_type,
      station_name,
      address,
      manager,
      manager_phone,
      status
    } = req.body;

    const [existing] = await pool.execute('SELECT machine_id FROM machine_stations WHERE machine_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '机台不存在', 404);
    }

    const updateFields = [];
    const values = [];

    if (machine_type !== undefined) {
      updateFields.push('machine_type = ?');
      values.push(Number(machine_type));
    }
    if (station_name !== undefined) {
      updateFields.push('station_name = ?');
      values.push(station_name);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      values.push(address);
    }
    if (manager !== undefined) {
      updateFields.push('manager = ?');
      values.push(manager);
    }
    if (manager_phone !== undefined) {
      updateFields.push('manager_phone = ?');
      values.push(manager_phone);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(status);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date());
    values.push(id);

    const sql = `UPDATE machine_stations SET ${updateFields.join(', ')} WHERE machine_id = ?`;
    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM machine_stations WHERE machine_id = ?', [id]);
    return success(res, rows[0], '机台更新成功');
  } catch (err) {
    console.error('更新机台失败:', err);
    return error(res, '更新机台失败: ' + err.message);
  }
}

// 删除机台（软删除，status设为0）
async function deleteMachineStation(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT machine_id, status FROM machine_stations WHERE machine_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '机台不存在', 404);
    }

    const sql = 'UPDATE machine_stations SET status = 0, updated_at = ? WHERE machine_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '机台删除成功');
  } catch (err) {
    console.error('删除机台失败:', err);
    return error(res, '删除机台失败: ' + err.message);
  }
}

module.exports = {
  getMachineStationList,
  getMachineStationById,
  createMachineStation,
  updateMachineStation,
  deleteMachineStation
};

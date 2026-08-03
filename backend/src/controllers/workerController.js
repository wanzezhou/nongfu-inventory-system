const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

function generateWorkerId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `W${timestamp}${random}`;
}

function formatWorker(worker) {
  if (!worker) return null;
  return {
    id: worker.worker_id,
    workerId: worker.worker_id,
    name: worker.worker_name,
    workerName: worker.worker_name,
    phone: worker.phone,
    vehicleType: worker.vehicle_type,
    bankName: worker.bank_name,
    bankAccount: worker.bank_account,
    status: worker.status,
    createdAt: worker.created_at,
    updatedAt: worker.updated_at
  };
}

async function getWorkerList(req, res) {
  try {
    const { keyword, status, vehicleType, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (worker_name LIKE ? OR phone LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (status !== undefined && status !== '' && status !== null) {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    if (vehicleType !== undefined && vehicleType !== '' && vehicleType !== null) {
      whereClause += ' AND vehicle_type = ?';
      params.push(Number(vehicleType));
    }

    const countSql = `SELECT COUNT(*) as total FROM workers ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM workers ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const formattedList = list.map(item => formatWorker(item));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取员工列表失败:', err);
    return error(res, '获取员工列表失败: ' + err.message);
  }
}

async function getAllWorkers(req, res) {
  try {
    const sql = 'SELECT worker_id, worker_name, phone, vehicle_type FROM workers WHERE status = 1 ORDER BY worker_name ASC';
    const [rows] = await pool.execute(sql);

    const formattedList = rows.map(item => formatWorker(item));

    return success(res, formattedList);
  } catch (err) {
    console.error('获取员工列表失败:', err);
    return error(res, '获取员工列表失败: ' + err.message);
  }
}

async function getWorkerById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM workers WHERE worker_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '员工不存在', 404);
    }

    return success(res, formatWorker(rows[0]));
  } catch (err) {
    console.error('获取员工详情失败:', err);
    return error(res, '获取员工详情失败: ' + err.message);
  }
}

async function createWorker(req, res) {
  try {
    const {
      workerName,
      worker_name,
      phone,
      vehicleType,
      vehicle_type,
      bankName,
      bank_name,
      bankAccount,
      bank_account,
      status
    } = req.body;

    const name = workerName || worker_name;
    const vType = vehicleType !== undefined ? vehicleType : (vehicle_type !== undefined ? vehicle_type : 1);
    const bName = bankName !== undefined ? bankName : bank_name;
    const bAccount = bankAccount !== undefined ? bankAccount : bank_account;

    if (!name) {
      return error(res, '员工姓名不能为空', 400);
    }

    const worker_id = generateWorkerId();
    const now = new Date();

    const sql = `INSERT INTO workers (
      worker_id, worker_name, phone, vehicle_type,
      bank_name, bank_account, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      worker_id,
      name,
      phone || null,
      Number(vType) || 1,
      bName || null,
      bAccount || null,
      status !== undefined ? Number(status) : 1,
      now,
      now
    ];

    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM workers WHERE worker_id = ?', [worker_id]);

    return success(res, formatWorker(rows[0]), '员工创建成功');
  } catch (err) {
    console.error('创建员工失败:', err);
    return error(res, '创建员工失败: ' + err.message);
  }
}

async function updateWorker(req, res) {
  try {
    const { id } = req.params;
    const {
      workerName,
      worker_name,
      phone,
      vehicleType,
      vehicle_type,
      bankName,
      bank_name,
      bankAccount,
      bank_account,
      status
    } = req.body;

    const [existing] = await pool.execute('SELECT worker_id FROM workers WHERE worker_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '员工不存在', 404);
    }

    const updateFields = [];
    const values = [];

    const name = workerName !== undefined ? workerName : worker_name;
    if (name !== undefined) {
      updateFields.push('worker_name = ?');
      values.push(name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      values.push(phone);
    }
    const vType = vehicleType !== undefined ? vehicleType : vehicle_type;
    if (vType !== undefined) {
      updateFields.push('vehicle_type = ?');
      values.push(Number(vType));
    }
    const bName = bankName !== undefined ? bankName : bank_name;
    if (bName !== undefined) {
      updateFields.push('bank_name = ?');
      values.push(bName);
    }
    const bAccount = bankAccount !== undefined ? bankAccount : bank_account;
    if (bAccount !== undefined) {
      updateFields.push('bank_account = ?');
      values.push(bAccount);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(Number(status));
    }

    if (updateFields.length === 0) {
      return error(res, '没有需要更新的字段', 400);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date());

    values.push(id);

    const sql = `UPDATE workers SET ${updateFields.join(', ')} WHERE worker_id = ?`;
    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM workers WHERE worker_id = ?', [id]);

    return success(res, formatWorker(rows[0]), '员工更新成功');
  } catch (err) {
    console.error('更新员工失败:', err);
    return error(res, '更新员工失败: ' + err.message);
  }
}

async function deleteWorker(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT worker_id, status FROM workers WHERE worker_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '员工不存在', 404);
    }

    const sql = 'UPDATE workers SET status = 0, updated_at = ? WHERE worker_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '员工删除成功');
  } catch (err) {
    console.error('删除员工失败:', err);
    return error(res, '删除员工失败: ' + err.message);
  }
}

module.exports = {
  getWorkerList,
  getAllWorkers,
  getWorkerById,
  createWorker,
  updateWorker,
  deleteWorker
};

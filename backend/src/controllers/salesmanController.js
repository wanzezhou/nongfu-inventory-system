const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

function generateSalesmanId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SM${timestamp}${random}`;
}

function formatSalesman(s) {
  if (!s) return null;
  return {
    id: s.salesman_id,
    salesmanId: s.salesman_id,
    name: s.salesman_name,
    salesmanName: s.salesman_name,
    phone: s.phone,
    commissionRate: Number(s.commission_rate) || 0,
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at
  };
}

async function getSalesmanList(req, res) {
  try {
    const { keyword, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (salesman_name LIKE ? OR phone LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (status !== undefined && status !== '' && status !== null) {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const countSql = `SELECT COUNT(*) as total FROM salesmen ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM salesmen ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const formattedList = list.map(item => formatSalesman(item));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取业务员列表失败:', err);
    return error(res, '获取业务员列表失败: ' + err.message);
  }
}

async function getAllSalesmen(req, res) {
  try {
    const sql = 'SELECT salesman_id, salesman_name, phone, commission_rate FROM salesmen WHERE status = 1 ORDER BY salesman_name ASC';
    const [rows] = await pool.execute(sql);

    const formattedList = rows.map(item => formatSalesman(item));

    return success(res, formattedList);
  } catch (err) {
    console.error('获取业务员列表失败:', err);
    return error(res, '获取业务员列表失败: ' + err.message);
  }
}

async function getSalesmanById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM salesmen WHERE salesman_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '业务员不存在', 404);
    }

    return success(res, formatSalesman(rows[0]));
  } catch (err) {
    console.error('获取业务员详情失败:', err);
    return error(res, '获取业务员详情失败: ' + err.message);
  }
}

async function createSalesman(req, res) {
  try {
    const { name, phone, commissionRate, status } = req.body;

    if (!name) {
      return error(res, '业务员姓名不能为空', 400);
    }

    const salesman_id = generateSalesmanId();
    const now = new Date();

    const sql = `INSERT INTO salesmen (
      salesman_id, salesman_name, phone, commission_rate, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      salesman_id,
      name,
      phone || null,
      commissionRate !== undefined ? Number(commissionRate) : 0,
      status !== undefined ? Number(status) : 1,
      now,
      now
    ];

    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM salesmen WHERE salesman_id = ?', [salesman_id]);

    return success(res, formatSalesman(rows[0]), '业务员创建成功');
  } catch (err) {
    console.error('创建业务员失败:', err);
    return error(res, '创建业务员失败: ' + err.message);
  }
}

async function updateSalesman(req, res) {
  try {
    const { id } = req.params;
    const { name, phone, commissionRate, status } = req.body;

    const [existing] = await pool.execute('SELECT salesman_id FROM salesmen WHERE salesman_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '业务员不存在', 404);
    }

    const updateFields = [];
    const values = [];

    if (name !== undefined) {
      updateFields.push('salesman_name = ?');
      values.push(name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      values.push(phone);
    }
    if (commissionRate !== undefined) {
      updateFields.push('commission_rate = ?');
      values.push(Number(commissionRate));
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

    const sql = `UPDATE salesmen SET ${updateFields.join(', ')} WHERE salesman_id = ?`;
    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM salesmen WHERE salesman_id = ?', [id]);

    return success(res, formatSalesman(rows[0]), '业务员更新成功');
  } catch (err) {
    console.error('更新业务员失败:', err);
    return error(res, '更新业务员失败: ' + err.message);
  }
}

async function deleteSalesman(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT salesman_id, status FROM salesmen WHERE salesman_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '业务员不存在', 404);
    }

    const sql = 'UPDATE salesmen SET status = 0, updated_at = ? WHERE salesman_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '业务员删除成功');
  } catch (err) {
    console.error('删除业务员失败:', err);
    return error(res, '删除业务员失败: ' + err.message);
  }
}

module.exports = {
  getSalesmanList,
  getAllSalesmen,
  getSalesmanById,
  createSalesman,
  updateSalesman,
  deleteSalesman
};

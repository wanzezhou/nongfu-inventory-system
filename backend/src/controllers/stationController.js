const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

// 生成水站ID：S + 时间戳 + 4位随机数
function generateStationId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `S${timestamp}${random}`;
}

// 获取水站列表
async function getStationList(req, res) {
  try {
    const { keyword, area, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    // 关键词模糊搜索（水站名称或联系人）
    if (keyword) {
      whereClause += ' AND (station_name LIKE ? OR contact_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 区域筛选
    if (area) {
      whereClause += ' AND area = ?';
      params.push(area);
    }

    // 状态筛选
    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM sub_stations ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM sub_stations ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取水站列表失败:', err);
    return error(res, '获取水站列表失败: ' + err.message);
  }
}

// 获取水站详情
async function getStationById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM sub_stations WHERE station_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '水站不存在', 404);
    }

    return success(res, rows[0]);
  } catch (err) {
    console.error('获取水站详情失败:', err);
    return error(res, '获取水站详情失败: ' + err.message);
  }
}

// 新增水站
async function createStation(req, res) {
  try {
    const {
      station_name,
      contact_name,
      phone,
      address,
      area,
      credit_limit,
      payment_type,
      bank_name,
      bank_account,
      account_name,
      invoice_title,
      tax_number,
      invoice_address,
      invoice_phone,
      status = 1
    } = req.body;

    // 校验必填字段
    if (!station_name) {
      return error(res, '水站名称不能为空', 400);
    }

    // 生成水站ID
    const station_id = generateStationId();

    // 当前时间
    const now = new Date();

    const sql = `INSERT INTO sub_stations (
      station_id, station_name, contact_name, phone, address, area,
      credit_limit, current_debt, payment_type, bank_name, bank_account,
      account_name, invoice_title, tax_number, invoice_address, invoice_phone,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      station_id,
      station_name,
      contact_name || null,
      phone || null,
      address || null,
      area || null,
      credit_limit || 0,
      0,
      payment_type || null,
      bank_name || null,
      bank_account || null,
      account_name || null,
      invoice_title || null,
      tax_number || null,
      invoice_address || null,
      invoice_phone || null,
      status,
      now,
      now
    ];

    await pool.execute(sql, values);

    // 查询新增的水站
    const [rows] = await pool.execute('SELECT * FROM sub_stations WHERE station_id = ?', [station_id]);

    return success(res, rows[0], '水站创建成功');
  } catch (err) {
    console.error('创建水站失败:', err);
    return error(res, '创建水站失败: ' + err.message);
  }
}

// 更新水站
async function updateStation(req, res) {
  try {
    const { id } = req.params;
    const {
      station_name,
      contact_name,
      phone,
      address,
      area,
      credit_limit,
      current_debt,
      payment_type,
      bank_name,
      bank_account,
      account_name,
      invoice_title,
      tax_number,
      invoice_address,
      invoice_phone,
      status
    } = req.body;

    // 检查水站是否存在
    const [existing] = await pool.execute('SELECT station_id FROM sub_stations WHERE station_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '水站不存在', 404);
    }

    // 构建更新语句
    const updateFields = [];
    const values = [];

    if (station_name !== undefined) {
      updateFields.push('station_name = ?');
      values.push(station_name);
    }
    if (contact_name !== undefined) {
      updateFields.push('contact_name = ?');
      values.push(contact_name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      values.push(phone);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      values.push(address);
    }
    if (area !== undefined) {
      updateFields.push('area = ?');
      values.push(area);
    }
    if (credit_limit !== undefined) {
      updateFields.push('credit_limit = ?');
      values.push(credit_limit);
    }
    if (current_debt !== undefined) {
      updateFields.push('current_debt = ?');
      values.push(current_debt);
    }
    if (payment_type !== undefined) {
      updateFields.push('payment_type = ?');
      values.push(payment_type);
    }
    if (bank_name !== undefined) {
      updateFields.push('bank_name = ?');
      values.push(bank_name);
    }
    if (bank_account !== undefined) {
      updateFields.push('bank_account = ?');
      values.push(bank_account);
    }
    if (account_name !== undefined) {
      updateFields.push('account_name = ?');
      values.push(account_name);
    }
    if (invoice_title !== undefined) {
      updateFields.push('invoice_title = ?');
      values.push(invoice_title);
    }
    if (tax_number !== undefined) {
      updateFields.push('tax_number = ?');
      values.push(tax_number);
    }
    if (invoice_address !== undefined) {
      updateFields.push('invoice_address = ?');
      values.push(invoice_address);
    }
    if (invoice_phone !== undefined) {
      updateFields.push('invoice_phone = ?');
      values.push(invoice_phone);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(status);
    }

    // 添加更新时间
    updateFields.push('updated_at = ?');
    values.push(new Date());

    // 添加ID条件
    values.push(id);

    const sql = `UPDATE sub_stations SET ${updateFields.join(', ')} WHERE station_id = ?`;
    await pool.execute(sql, values);

    // 查询更新后的水站
    const [rows] = await pool.execute('SELECT * FROM sub_stations WHERE station_id = ?', [id]);

    return success(res, rows[0], '水站更新成功');
  } catch (err) {
    console.error('更新水站失败:', err);
    return error(res, '更新水站失败: ' + err.message);
  }
}

// 删除水站（软删除，status设为0）
async function deleteStation(req, res) {
  try {
    const { id } = req.params;

    // 检查水站是否存在
    const [existing] = await pool.execute('SELECT station_id, status FROM sub_stations WHERE station_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '水站不存在', 404);
    }

    // 软删除：将status设为0
    const sql = 'UPDATE sub_stations SET status = 0, updated_at = ? WHERE station_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '水站删除成功');
  } catch (err) {
    console.error('删除水站失败:', err);
    return error(res, '删除水站失败: ' + err.message);
  }
}

module.exports = {
  getStationList,
  getStationById,
  createStation,
  updateStation,
  deleteStation
};

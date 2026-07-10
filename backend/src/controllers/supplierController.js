const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

function generateSupplierId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SUP${timestamp}${random}`;
}

async function getSupplierList(req, res) {
  try {
    const { keyword, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (supplier_name LIKE ? OR contact_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const countSql = `SELECT COUNT(*) as total FROM suppliers ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM suppliers ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取供应商列表失败:', err);
    return error(res, '获取供应商列表失败: ' + err.message);
  }
}

async function getAllSuppliers(req, res) {
  try {
    const sql = 'SELECT supplier_id, supplier_name, contact_name, phone FROM suppliers WHERE status = 1 ORDER BY supplier_name ASC';
    const [rows] = await pool.execute(sql);

    return success(res, rows);
  } catch (err) {
    console.error('获取供应商列表失败:', err);
    return error(res, '获取供应商列表失败: ' + err.message);
  }
}

async function getSupplierById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM suppliers WHERE supplier_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '供应商不存在', 404);
    }

    return success(res, rows[0]);
  } catch (err) {
    console.error('获取供应商详情失败:', err);
    return error(res, '获取供应商详情失败: ' + err.message);
  }
}

async function createSupplier(req, res) {
  try {
    const {
      supplier_name,
      contact_name,
      phone,
      address,
      bank_name,
      bank_account,
      account_name,
      tax_number,
      invoice_title,
      remark,
      status = 1
    } = req.body;

    if (!supplier_name) {
      return error(res, '供应商名称不能为空', 400);
    }

    const supplier_id = generateSupplierId();
    const now = new Date();

    const sql = `INSERT INTO suppliers (
      supplier_id, supplier_name, contact_name, phone, address,
      bank_name, bank_account, account_name, tax_number, invoice_title,
      status, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      supplier_id,
      supplier_name,
      contact_name || null,
      phone || null,
      address || null,
      bank_name || null,
      bank_account || null,
      account_name || null,
      tax_number || null,
      invoice_title || null,
      status,
      remark || null,
      now,
      now
    ];

    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM suppliers WHERE supplier_id = ?', [supplier_id]);

    return success(res, rows[0], '供应商创建成功');
  } catch (err) {
    console.error('创建供应商失败:', err);
    return error(res, '创建供应商失败: ' + err.message);
  }
}

async function updateSupplier(req, res) {
  try {
    const { id } = req.params;
    const {
      supplier_name,
      contact_name,
      phone,
      address,
      bank_name,
      bank_account,
      account_name,
      tax_number,
      invoice_title,
      status,
      remark
    } = req.body;

    const [existing] = await pool.execute('SELECT supplier_id FROM suppliers WHERE supplier_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '供应商不存在', 404);
    }

    const updateFields = [];
    const values = [];

    if (supplier_name !== undefined) {
      updateFields.push('supplier_name = ?');
      values.push(supplier_name);
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
    if (tax_number !== undefined) {
      updateFields.push('tax_number = ?');
      values.push(tax_number);
    }
    if (invoice_title !== undefined) {
      updateFields.push('invoice_title = ?');
      values.push(invoice_title);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(status);
    }
    if (remark !== undefined) {
      updateFields.push('remark = ?');
      values.push(remark);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date());

    values.push(id);

    const sql = `UPDATE suppliers SET ${updateFields.join(', ')} WHERE supplier_id = ?`;
    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT * FROM suppliers WHERE supplier_id = ?', [id]);

    return success(res, rows[0], '供应商更新成功');
  } catch (err) {
    console.error('更新供应商失败:', err);
    return error(res, '更新供应商失败: ' + err.message);
  }
}

async function deleteSupplier(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT supplier_id, status FROM suppliers WHERE supplier_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '供应商不存在', 404);
    }

    const sql = 'UPDATE suppliers SET status = 0, updated_at = ? WHERE supplier_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '供应商删除成功');
  } catch (err) {
    console.error('删除供应商失败:', err);
    return error(res, '删除供应商失败: ' + err.message);
  }
}

module.exports = {
  getSupplierList,
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier
};

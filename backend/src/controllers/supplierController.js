const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');
const { countRef, describeReferences } = require('../utils/deleteRefs');

const generateSupplierId = () => generateId('SUP');

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

    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

    const listSql = `SELECT * FROM suppliers ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取供应商列表失败:', err);
    return error(res, '获取供应商列表失败');
  }
}

async function getAllSuppliers(req, res) {
  try {
    const sql = 'SELECT supplier_id, supplier_name, contact_name, phone FROM suppliers WHERE status = 1 ORDER BY supplier_name ASC';
    const [rows] = await pool.execute(sql);

    return success(res, rows);
  } catch (err) {
    console.error('获取供应商列表失败:', err);
    return error(res, '获取供应商列表失败');
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
    return error(res, '获取供应商详情失败');
  }
}

async function createSupplier(req, res) {
  try {
    // ⚠️ normalizeBody(D7) 全局把 snake_case 键转成 camelCase 并删除原键 → 只能读驼峰键；
    //    用「解构重命名」映射回原变量名，下游代码不变
    const {
      supplierName: supplier_name,
      contactName: contact_name,
      phone,
      address,
      bankName: bank_name,
      bankAccount: bank_account,
      accountName: account_name,
      taxNumber: tax_number,
      invoiceTitle: invoice_title,
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
    return error(res, '创建供应商失败');
  }
}

async function updateSupplier(req, res) {
  try {
    const { id } = req.params;
    // 同上：读驼峰键
    const {
      supplierName: supplier_name,
      contactName: contact_name,
      phone,
      address,
      bankName: bank_name,
      bankAccount: bank_account,
      accountName: account_name,
      taxNumber: tax_number,
      invoiceTitle: invoice_title,
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
    return error(res, '更新供应商失败');
  }
}

// 供应商的引用检查
//   ⚠️ purchase_records.supplier_id 是 ON DELETE SET NULL —— 物理删供应商不会报错，
//      但会让历史采购记录**静默失去供应商归属**，故有采购记录即不物理删
async function findSupplierReferences(conn, supplierId) {
  const [purchases] = await conn.execute(
    'SELECT COUNT(*) AS n FROM purchase_records WHERE supplier_id = ?', [supplierId]
  );
  return [countRef('采购入库记录', purchases[0].n)].filter(Boolean);
}

/**
 * 删除供应商：**无引用 → 物理删除；有引用 → 转为「停用」保留**
 * 响应：{ mode: 'hard'|'soft', supplierId, supplierName, references }
 */
async function deleteSupplier(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    const [existing] = await connection.execute(
      'SELECT supplier_id, supplier_name, status FROM suppliers WHERE supplier_id = ?', [id]
    );
    if (existing.length === 0) {
      return error(res, '供应商不存在', 404);
    }
    const { supplier_id: supplierId, supplier_name: supplierName } = existing[0];

    const references = await findSupplierReferences(connection, supplierId);

    if (references.length === 0) {
      await connection.beginTransaction();
      try {
        await connection.execute('DELETE FROM suppliers WHERE supplier_id = ?', [supplierId]);
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        throw e;
      }
      return success(res, { mode: 'hard', supplierId, supplierName, references },
        `供应商「${supplierName}」已删除`);
    }

    await connection.execute(
      'UPDATE suppliers SET status = 0, updated_at = ? WHERE supplier_id = ?',
      [new Date(), supplierId]
    );
    const detail = describeReferences(references);
    return success(res, { mode: 'soft', supplierId, supplierName, references },
      `供应商「${supplierName}」存在关联数据（${detail}），已转为「停用」保留而非删除`);
  } catch (err) {
    console.error('删除供应商失败:', err);
    return error(res, '删除供应商失败');
  } finally {
    connection.release();
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

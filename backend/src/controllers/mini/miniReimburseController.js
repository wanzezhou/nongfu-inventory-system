const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');

// 判断是否为表不存在的错误
function isTableMissingError(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

// 报销列表（数据隔离，表不存在时返回空列表）
async function list(req, res) {
  try {
    const { page = 1, pageSize = 20, status } = req.query;
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;

    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    const whereParts = [];
    const params = [];
    if (role !== 'admin') {
      whereParts.push('r.applicant_id = ?');
      params.push(targetId);
    }
    if (status !== undefined && status !== '' && status !== null) {
      whereParts.push('r.status = ?');
      params.push(Number(status));
    }
    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    let countRows, listRows;
    try {
      const countSql = `SELECT COUNT(*) AS total FROM reimbursements r ${whereClause}`;
      [countRows] = await pool.execute(countSql, params);
      const listSql = `SELECT
          r.id, r.applicant_id AS applicantId, r.type, r.amount, r.description,
          r.remark, r.status, r.approved_amount AS approvedAmount,
          r.approved_at AS approvedAt, r.created_at AS createdAt, r.updated_at AS updatedAt
        FROM reimbursements r
        ${whereClause}
        ORDER BY r.created_at DESC
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
      applicantId: r.applicantId,
      type: r.type,
      amount: Number(r.amount) || 0,
      description: r.description,
      remark: r.remark,
      status: r.status,
      approvedAmount: r.approvedAmount !== null ? Number(r.approvedAmount) : null,
      approvedAt: r.approvedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取报销列表失败:', err);
    return res.json({ code: 500, message: '获取报销列表失败: ' + err.message, data: null });
  }
}

// 创建报销
async function create(req, res) {
  try {
    try {
      await pool.execute('SELECT 1 FROM reimbursements LIMIT 1');
    } catch (err) {
      if (isTableMissingError(err)) {
        return res.json({ code: 403, message: '报销功能暂未启用', data: null });
      }
      throw err;
    }

    const { type, amount, description, remark } = req.body || {};
    if (!type || amount === undefined || !description) {
      return res.json({ code: 400, message: '类型、金额、说明不能为空', data: null });
    }
    const applicantId = req.miniUser.targetId;

    const [result] = await pool.execute(
      `INSERT INTO reimbursements
        (applicant_id, type, amount, description, remark, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [applicantId, type, Number(amount), description, remark || null]
    );

    return res.json({ code: 200, message: '报销申请创建成功', data: { id: result.insertId } });
  } catch (err) {
    console.error('创建报销失败:', err);
    return res.json({ code: 500, message: '创建报销失败: ' + err.message, data: null });
  }
}

// 审批报销（仅管理员）
async function approve(req, res) {
  try {
    const { id } = req.params;
    const { status, approvedAmount, remark } = req.body || {};
    if (!id) {
      return res.json({ code: 400, message: '缺少报销ID', data: null });
    }
    if (Number(status) !== 2 && Number(status) !== 3) {
      return res.json({ code: 400, message: '审批状态无效（2=通过, 3=拒绝）', data: null });
    }

    try {
      await pool.execute('SELECT 1 FROM reimbursements LIMIT 1');
    } catch (err) {
      if (isTableMissingError(err)) {
        return res.json({ code: 403, message: '报销功能暂未启用', data: null });
      }
      throw err;
    }

    const [existRows] = await pool.execute(
      'SELECT id, status FROM reimbursements WHERE id = ?',
      [id]
    );
    if (existRows.length === 0) {
      return res.json({ code: 404, message: '报销记录不存在', data: null });
    }
    if (existRows[0].status !== 0) {
      return res.json({ code: 409, message: '该报销已审批，不可重复审批', data: null });
    }

    const [result] = await pool.execute(
      `UPDATE reimbursements
       SET status = ?, approved_amount = ?, remark = ?, approved_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [Number(status), approvedAmount !== undefined ? Number(approvedAmount) : null, remark || null, id]
    );
    if (result.affectedRows === 0) {
      return res.json({ code: 409, message: '审批失败', data: null });
    }
    return res.json({ code: 200, message: '审批成功', data: null });
  } catch (err) {
    console.error('审批报销失败:', err);
    return res.json({ code: 500, message: '审批报销失败: ' + err.message, data: null });
  }
}

module.exports = {
  list,
  create,
  approve
};

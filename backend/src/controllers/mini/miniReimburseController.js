const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 报销附件上传目录
const uploadDir = path.join(__dirname, '../../../uploads/reimburse');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `reimb_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 判断是否为表不存在的错误
function isTableMissingError(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.errno === 1146);
}

// 格式化报销记录（含附件列表）
function formatReimburse(r, attachMap) {
  const id = r.id || r.reimburse_id;
  const attachments = (attachMap && attachMap[id]) || [];
  return {
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
    updatedAt: r.updatedAt,
    attachments
  };
}

// 批量查询附件并按 reimburse_id 分组
async function fetchAttachments(reimburseIds) {
  if (!reimburseIds || reimburseIds.length === 0) return {};
  const placeholders = reimburseIds.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT id, reimburse_id AS reimburseId, file_url AS fileUrl,
            file_name AS fileName, file_size AS fileSize, created_at AS createdAt
     FROM reimburse_attachments
     WHERE reimburse_id IN (${placeholders})
     ORDER BY id ASC`,
    reimburseIds
  );
  const map = {};
  for (const a of rows) {
    const key = a.reimburseId;
    if (!map[key]) map[key] = [];
    map[key].push({
      id: a.id,
      fileUrl: a.fileUrl,
      fileName: a.fileName,
      fileSize: a.fileSize,
      createdAt: a.createdAt
    });
  }
  return map;
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

    // 批量查询附件
    const ids = listRows.map(r => r.id);
    const attachMap = await fetchAttachments(ids).catch(() => ({}));

    const total = countRows[0].total;
    const list = listRows.map(r => formatReimburse(r, attachMap));

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取报销列表失败:', err);
    return res.json({ code: 500, message: '获取报销列表失败: ' + err.message, data: null });
  }
}

// 报销详情
async function detail(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.json({ code: 400, message: '缺少报销ID', data: null });
    }
    let rows;
    try {
      [rows] = await pool.execute(
        `SELECT id, applicant_id AS applicantId, type, amount, description,
                remark, status, approved_amount AS approvedAmount,
                approved_at AS approvedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM reimbursements WHERE id = ?`,
        [id]
      );
    } catch (err) {
      if (isTableMissingError(err)) {
        return res.json({ code: 404, message: '报销记录不存在', data: null });
      }
      throw err;
    }
    if (rows.length === 0) {
      return res.json({ code: 404, message: '报销记录不存在', data: null });
    }
    const r = rows[0];

    // 数据隔离：非管理员只能查看自己的
    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;
    if (role !== 'admin' && String(r.applicantId) !== String(targetId)) {
      return res.json({ code: 403, message: '无权查看该报销', data: null });
    }

    const attachMap = await fetchAttachments([r.id]).catch(() => ({}));
    return success(res, formatReimburse(r, attachMap));
  } catch (err) {
    console.error('获取报销详情失败:', err);
    return res.json({ code: 500, message: '获取报销详情失败: ' + err.message, data: null });
  }
}

// 创建报销
async function create(req, res) {
  const conn = await pool.getConnection();
  try {
    try {
      await conn.execute('SELECT 1 FROM reimbursements LIMIT 1');
    } catch (err) {
      if (isTableMissingError(err)) {
        return res.json({ code: 403, message: '报销功能暂未启用', data: null });
      }
      throw err;
    }

    const { type, amount, description, remark, attachmentUrls } = req.body || {};
    if (!type || amount === undefined || !description) {
      return res.json({ code: 400, message: '类型、金额、说明不能为空', data: null });
    }
    const applicantId = req.miniUser.targetId;

    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT INTO reimbursements
        (applicant_id, type, amount, description, remark, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())`,
      [applicantId, type, Number(amount), description, remark || null]
    );
    const reimburseId = result.insertId;

    // 写入附件
    if (Array.isArray(attachmentUrls) && attachmentUrls.length > 0) {
      const validUrls = attachmentUrls
        .map(u => (typeof u === 'string' ? u.trim() : ''))
        .filter(Boolean);
      if (validUrls.length > 0) {
        const insertSql = `INSERT INTO reimburse_attachments
          (reimburse_id, file_url, file_name, file_size, created_at)
          VALUES ?`;
        const values = validUrls.map(url => [
          reimburseId,
          url,
          path.basename(url) || null,
          null,
          new Date()
        ]);
        await conn.query(insertSql, [values]);
      }
    }

    await conn.commit();
    return res.json({ code: 200, message: '报销申请创建成功', data: { id: reimburseId } });
  } catch (err) {
    await conn.rollback();
    console.error('创建报销失败:', err);
    return res.json({ code: 500, message: '创建报销失败: ' + err.message, data: null });
  } finally {
    conn.release();
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

// 上传报销附件
async function uploadAttachment(req, res) {
  try {
    if (!req.file) {
      return res.json({ code: 400, message: '未接收到文件', data: null });
    }
    const url = `/uploads/reimburse/${req.file.filename}`;
    return res.json({
      code: 200,
      message: '上传成功',
      data: {
        url,
        fileName: req.file.originalname,
        fileSize: req.file.size
      }
    });
  } catch (err) {
    console.error('上传报销附件失败:', err);
    return res.json({ code: 500, message: '上传失败: ' + err.message, data: null });
  }
}

module.exports = {
  list,
  detail,
  create,
  approve,
  uploadAttachment,
  upload
};

const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const bcrypt = require('bcryptjs');

function formatMiniAccount(ma) {
  if (!ma) return null;
  return {
    id: ma.id,
    openid: ma.openid,
    unionId: ma.union_id,
    phone: ma.phone,
    role: ma.role,
    targetId: ma.target_id,
    entityName: ma.entity_name || null,
    nickname: ma.nickname,
    avatarUrl: ma.avatar_url,
    status: ma.status,
    username: ma.username,
    lastLoginAt: ma.last_login_at,
    createdAt: ma.created_at,
    updatedAt: ma.updated_at
  };
}

// 固定的关联查询片段：根据 role 关联对应的实体表，取实体名称
// 注意：workers/sub_stations 表 collation 为 utf8mb4_unicode_ci，与 mini_accounts(utf8mb4_0900_ai_ci) 不同，
// 关联时需 CONVERT + COLLATE 统一，否则报 Illegal mix of collations
const JOIN_CLAUSE = `
FROM mini_accounts ma
LEFT JOIN users u ON ma.role = 'admin' AND ma.target_id = CAST(u.id AS CHAR) COLLATE utf8mb4_0900_ai_ci
LEFT JOIN workers w ON ma.role = 'worker' AND ma.target_id = CONVERT(w.worker_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci
LEFT JOIN sub_stations s ON ma.role = 'station' AND ma.target_id = CONVERT(s.station_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci
LEFT JOIN salesmen sm ON ma.role = 'salesman' AND ma.target_id = CONVERT(sm.salesman_id USING utf8mb4) COLLATE utf8mb4_0900_ai_ci
`;

async function getMiniAccountList(req, res) {
  try {
    const { keyword, role, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (ma.openid LIKE ? OR ma.phone LIKE ? OR ma.nickname LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (role !== undefined && role !== '' && role !== null) {
      whereClause += ' AND ma.role = ?';
      params.push(role);
    }

    if (status !== undefined && status !== '' && status !== null) {
      whereClause += ' AND ma.status = ?';
      params.push(Number(status));
    }

    const countSql = `SELECT COUNT(*) as total ${JOIN_CLAUSE} ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT ma.id, ma.openid, ma.union_id, ma.phone, ma.role, ma.target_id, ma.nickname, ma.avatar_url, ma.status, ma.username, ma.last_login_at, ma.created_at, ma.updated_at, COALESCE(u.display_name, w.worker_name, s.station_name, sm.salesman_name) AS entity_name ${JOIN_CLAUSE} ${whereClause} ORDER BY ma.created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const formattedList = list.map(item => formatMiniAccount(item));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取小程序账号列表失败:', err);
    return error(res, '获取小程序账号列表失败: ' + err.message);
  }
}

async function createMiniAccount(req, res) {
  try {
    const { role, targetId, phone, nickname, status, remark, username, password } = req.body;

    if (!role) {
      return error(res, '角色不能为空', 400);
    }
    if (!targetId) {
      return error(res, '绑定目标不能为空', 400);
    }

    const passwordHash = (password && password !== '') ? await bcrypt.hash(password, 10) : null;

    const openid = `pc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date();

    const sql = `INSERT INTO mini_accounts (
      openid, phone, role, target_id, nickname, status, username, password_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      openid,
      phone || null,
      role,
      targetId,
      nickname || null,
      status !== undefined ? Number(status) : 1,
      username || null,
      passwordHash,
      now,
      now
    ];

    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, username, last_login_at, created_at, updated_at FROM mini_accounts WHERE openid = ?', [openid]);

    return success(res, formatMiniAccount(rows[0]), '小程序账号创建成功');
  } catch (err) {
    console.error('创建小程序账号失败:', err);
    return error(res, '创建小程序账号失败: ' + err.message);
  }
}

async function updateMiniAccount(req, res) {
  try {
    const { id } = req.params;
    const { role, targetId, phone, nickname, status, username, password } = req.body;

    const [existing] = await pool.execute('SELECT id FROM mini_accounts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '小程序账号不存在', 404);
    }

    const updateFields = [];
    const values = [];

    if (username !== undefined) {
      updateFields.push('username = ?');
      values.push(username);
    }
    if (role !== undefined) {
      updateFields.push('role = ?');
      values.push(role);
    }
    if (targetId !== undefined) {
      updateFields.push('target_id = ?');
      values.push(targetId);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      values.push(phone);
    }
    if (nickname !== undefined) {
      updateFields.push('nickname = ?');
      values.push(nickname);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(Number(status));
    }
    if (password !== undefined && password !== '') {
      const passwordHash = await bcrypt.hash(password, 10);
      updateFields.push('password_hash = ?');
      values.push(passwordHash);
    }

    if (updateFields.length === 0) {
      return error(res, '没有需要更新的字段', 400);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date());

    values.push(id);

    const sql = `UPDATE mini_accounts SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.execute(sql, values);

    const [rows] = await pool.execute('SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, username, last_login_at, created_at, updated_at FROM mini_accounts WHERE id = ?', [id]);

    return success(res, formatMiniAccount(rows[0]), '小程序账号更新成功');
  } catch (err) {
    console.error('更新小程序账号失败:', err);
    return error(res, '更新小程序账号失败: ' + err.message);
  }
}

async function deleteMiniAccount(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id FROM mini_accounts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '小程序账号不存在', 404);
    }

    const sql = 'DELETE FROM mini_accounts WHERE id = ?';
    await pool.execute(sql, [id]);

    return success(res, null, '小程序账号解绑成功');
  } catch (err) {
    console.error('解绑小程序账号失败:', err);
    return error(res, '解绑小程序账号失败: ' + err.message);
  }
}

async function toggleMiniAccount(req, res) {
  try {
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT id, status FROM mini_accounts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '小程序账号不存在', 404);
    }

    const currentStatus = existing[0].status;
    const newStatus = currentStatus === 1 ? 0 : 1;

    const sql = 'UPDATE mini_accounts SET status = ?, updated_at = ? WHERE id = ?';
    await pool.execute(sql, [newStatus, new Date(), id]);

    const [rows] = await pool.execute('SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, username, last_login_at, created_at, updated_at FROM mini_accounts WHERE id = ?', [id]);

    return success(res, formatMiniAccount(rows[0]), newStatus === 1 ? '账号已启用' : '账号已禁用');
  } catch (err) {
    console.error('切换小程序账号状态失败:', err);
    return error(res, '切换小程序账号状态失败: ' + err.message);
  }
}

async function getEntityOptions(req, res) {
  try {
    const { role } = req.query;

    if (!role) {
      return error(res, '角色参数不能为空', 400);
    }

    let sql;
    switch (role) {
      case 'admin':
        sql = 'SELECT id, display_name AS name, phone FROM users';
        break;
      case 'worker':
        sql = 'SELECT worker_id AS id, worker_name AS name, phone FROM workers WHERE status = 1';
        break;
      case 'station':
        sql = 'SELECT station_id AS id, station_name AS name, phone FROM sub_stations WHERE status = 1';
        break;
      case 'salesman':
        sql = 'SELECT salesman_id AS id, salesman_name AS name, phone FROM salesmen WHERE status = 1';
        break;
      default:
        return error(res, '不支持的角色类型: ' + role, 400);
    }

    const [rows] = await pool.execute(sql);

    const result = rows.map(item => ({
      id: item.id,
      name: item.name,
      phone: item.phone
    }));

    return success(res, result);
  } catch (err) {
    console.error('获取绑定实体选项失败:', err);
    return error(res, '获取绑定实体选项失败: ' + err.message);
  }
}

module.exports = {
  getMiniAccountList,
  createMiniAccount,
  updateMiniAccount,
  deleteMiniAccount,
  toggleMiniAccount,
  getEntityOptions
};

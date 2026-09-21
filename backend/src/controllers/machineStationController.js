const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');
const { countRef, describeReferences } = require('../utils/deleteRefs');

// machine_type: 1-量贩机, 2-零售机
const generateMachineId = () => generateId('M');

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

    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

    const listSql = `SELECT * FROM machine_stations ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取机台列表失败:', err);
    return error(res, '获取机台列表失败');
  }
}

/**
 * 机台下拉选项（2026-09-18 代码审查 #1 新增）
 * 不分页全量返回，字段与列表接口一致（保持蛇形）。须注册在 /:id 之前。
 */
const MACHINE_OPTIONS_MAX = Number(process.env.OPTIONS_MAX_ROWS || 5000);

async function getAllMachineStations(req, res) {
  try {
    const { type, status } = req.query;
    let whereClause = 'WHERE 1=1';
    const params = [];
    if (type !== undefined && type !== '') {
      whereClause += ' AND machine_type = ?';
      params.push(Number(type));
    }
    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const [countResult] = await pool.execute(`SELECT COUNT(*) AS total FROM machine_stations ${whereClause}`, params);
    const total = Number(countResult[0].total) || 0;
    if (total > MACHINE_OPTIONS_MAX) {
      return error(res, `机台数量 ${total} 超过下拉上限 ${MACHINE_OPTIONS_MAX}`, 400);
    }

    // 显式列名（不使用 SELECT *）
    const [list] = await pool.execute(
      `SELECT machine_id, machine_type, station_name, address, manager, manager_phone,
              status, created_at, updated_at
       FROM machine_stations ${whereClause}
       ORDER BY station_name ASC`,
      params
    );

    return success(res, { list, total });
  } catch (err) {
    console.error('获取机台选项失败:', err);
    return error(res, '获取机台选项失败');
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
    return error(res, '获取机台详情失败');
  }
}

// 新增机台
async function createMachineStation(req, res) {
  try {
    // ⚠️ normalizeBody(D7) 已把请求体的 snake_case 键统一转成 camelCase 并**删除原键**
    //    （app.use(normalizeBody) 全局生效）→ 此处只能读驼峰键。
    //    用「解构重命名」把驼峰键映射回原变量名，下游代码无需改动。
    const {
      machineType: machine_type = 1,
      stationName: station_name,
      address,
      manager,
      managerPhone: manager_phone,
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
    return error(res, '创建机台失败');
  }
}

// 更新机台
async function updateMachineStation(req, res) {
  try {
    const { id } = req.params;
    // 同上：读驼峰键（normalizeBody 已删除蛇形键）
    const {
      machineType: machine_type,
      stationName: station_name,
      address,
      manager,
      managerPhone: manager_phone,
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
    return error(res, '更新机台失败');
  }
}

// 删除机台（软删除，status设为0）
// 机台的引用检查：该机台是否已被业务数据引用
//   ⚠️ machine_sales 的外键是 ON DELETE CASCADE —— 物理删机台会**连带删掉销量记录**，
//      所以「有销量」必须算作引用（否则删一台机器就静默毁掉它的历史销量）
async function findMachineReferences(conn, machineId) {
  const [orders] = await conn.execute('SELECT COUNT(*) AS n FROM orders WHERE machine_station_id = ?', [machineId]);
  const [sales] = await conn.execute('SELECT COUNT(*) AS n FROM machine_sales WHERE machine_id = ?', [machineId]);
  return [countRef('供货订单', orders[0].n), countRef('销量记录', sales[0].n)].filter(Boolean);
}

/**
 * 删除机台：**无引用 → 物理删除；有引用 → 转为「停用」保留**
 * 响应：{ mode: 'hard'|'soft', machineId, machineName, references }
 *   mode=hard 列表里该行消失；mode=soft 行保留但 status=0（列表按状态筛选可见）
 */
async function deleteMachineStation(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    const [existing] = await connection.execute(
      'SELECT machine_id, station_name, status FROM machine_stations WHERE machine_id = ?',
      [id]
    );
    if (existing.length === 0) {
      return error(res, '机台不存在', 404);
    }
    const { machine_id: machineId, station_name: machineName } = existing[0];

    const references = await findMachineReferences(connection, machineId);

    if (references.length === 0) {
      await connection.beginTransaction();
      try {
        await connection.execute('DELETE FROM machine_stations WHERE machine_id = ?', [machineId]);
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        throw e;
      }
      return success(res, { mode: 'hard', machineId, machineName, references }, `机台「${machineName}」已删除`);
    }

    await connection.execute('UPDATE machine_stations SET status = 0, updated_at = ? WHERE machine_id = ?', [
      new Date(),
      machineId
    ]);
    const detail = describeReferences(references);
    return success(
      res,
      { mode: 'soft', machineId, machineName, references },
      `机台「${machineName}」存在关联数据（${detail}），已转为「停用」保留而非删除`
    );
  } catch (err) {
    console.error('删除机台失败:', err);
    return error(res, '删除机台失败');
  } finally {
    connection.release();
  }
}

module.exports = {
  getMachineStationList,
  // 引用检查是「无引用→物理删除；有引用→转停用」这条统一语义的**判据**，
  // 小程序管理端（Phase 8b）复用同一个函数 —— 两处各写一份必然在「查哪几张表」上分叉
  findMachineReferences,
  getAllMachineStations,
  getMachineStationById,
  createMachineStation,
  updateMachineStation,
  deleteMachineStation
};

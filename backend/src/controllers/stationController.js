const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');
const { countRef, amountRef, describeReferences } = require('../utils/deleteRefs');

// 生成水站ID：S + 时间戳 + 4位随机数
const generateStationId = () => generateId('S');

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
    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

    const listSql = `SELECT * FROM sub_stations ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取水站列表失败:', err);
    return error(res, '获取水站列表失败');
  }
}

/**
 * 水站下拉选项（2026-09-18 代码审查 #1 新增）
 * 不分页全量返回，字段与列表接口一致（保持蛇形，前端既有映射零改动）。
 * 与 /suppliers/all、/workers/all 同一惯例。
 */
const STATION_OPTIONS_MAX = Number(process.env.OPTIONS_MAX_ROWS || 5000);

async function getAllStations(req, res) {
  try {
    const { status } = req.query;
    let whereClause = 'WHERE 1=1';
    const params = [];
    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const [countResult] = await pool.execute(`SELECT COUNT(*) AS total FROM sub_stations ${whereClause}`, params);
    const total = Number(countResult[0].total) || 0;
    if (total > STATION_OPTIONS_MAX) {
      return error(res, `水站数量 ${total} 超过下拉上限 ${STATION_OPTIONS_MAX}`, 400);
    }

    // 显式列名（不使用 SELECT *）
    const [list] = await pool.execute(
      `SELECT station_id, station_name, contact_name, phone, address, area,
              credit_limit, current_debt, payment_type,
              bank_name, bank_account, account_name,
              invoice_title, tax_number, invoice_address, invoice_phone,
              status, created_at, updated_at
       FROM sub_stations ${whereClause}
       ORDER BY station_name ASC`,
      params
    );

    return success(res, { list, total });
  } catch (err) {
    console.error('获取水站选项失败:', err);
    return error(res, '获取水站选项失败');
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
    return error(res, '获取水站详情失败');
  }
}

// 新增水站
async function createStation(req, res) {
  try {
    // ⚠️ normalizeBody(D7) 全局把 snake_case 键转成 camelCase 并删除原键 → 只能读驼峰键；
    //    用「解构重命名」映射回原变量名，下游代码不变
    const {
      stationName: station_name,
      contactName: contact_name,
      phone,
      address,
      area,
      creditLimit: credit_limit,
      paymentType: payment_type,
      bankName: bank_name,
      bankAccount: bank_account,
      accountName: account_name,
      invoiceTitle: invoice_title,
      taxNumber: tax_number,
      invoiceAddress: invoice_address,
      invoicePhone: invoice_phone,
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
    return error(res, '创建水站失败');
  }
}

// 更新水站
async function updateStation(req, res) {
  try {
    const { id } = req.params;
    // 同上：读驼峰键
    const {
      stationName: station_name,
      contactName: contact_name,
      phone,
      address,
      area,
      creditLimit: credit_limit,
      currentDebt: current_debt,
      paymentType: payment_type,
      bankName: bank_name,
      bankAccount: bank_account,
      accountName: account_name,
      invoiceTitle: invoice_title,
      taxNumber: tax_number,
      invoiceAddress: invoice_address,
      invoicePhone: invoice_phone,
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
    return error(res, '更新水站失败');
  }
}

// 删除水站（软删除，status设为0）
// 水站的引用检查（水站被 6 张表以裸列引用，无外键保护 → 必须逐个查）
//   另把「未结欠款」也算作不可物理删的情形：有欠款的水站删掉就再也追不回来了
async function findStationReferences(conn, stationId) {
  const [orders] = await conn.execute('SELECT COUNT(*) AS n FROM orders WHERE station_id = ?', [stationId]);
  const [tickets] = await conn.execute('SELECT COUNT(*) AS n FROM water_tickets WHERE station_id = ?', [stationId]);
  const [issuance] = await conn.execute('SELECT COUNT(*) AS n FROM water_ticket_issuance WHERE station_id = ?', [
    stationId
  ]);
  const [settlements] = await conn.execute('SELECT COUNT(*) AS n FROM financial_settlement WHERE station_id = ?', [
    stationId
  ]);
  const [deposits] = await conn.execute('SELECT COUNT(*) AS n FROM barrel_deposits WHERE station_id = ?', [stationId]);
  const [returns] = await conn.execute('SELECT COUNT(*) AS n FROM station_returns WHERE station_id = ?', [stationId]);
  const [debtRows] = await conn.execute('SELECT current_debt FROM sub_stations WHERE station_id = ?', [stationId]);

  return [
    countRef('订单', orders[0].n),
    countRef('水票', tickets[0].n),
    countRef('水票发行记录', issuance[0].n),
    countRef('财务对账记录', settlements[0].n),
    countRef('押金记录', deposits[0].n),
    countRef('退站记录', returns[0].n),
    amountRef('未结欠款', debtRows[0] && debtRows[0].current_debt)
  ].filter(Boolean);
}

/**
 * 删除水站：**无引用 → 物理删除；有引用 → 转为「停用」保留**
 * 响应：{ mode: 'hard'|'soft', stationId, stationName, references }
 * 说明：停用后水站不再出现在下单选站列表（该列表只取 status=1），但历史数据完整保留
 */
async function deleteStation(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    // 检查水站是否存在
    const [existing] = await connection.execute(
      'SELECT station_id, station_name, status, current_debt FROM sub_stations WHERE station_id = ?',
      [id]
    );
    if (existing.length === 0) {
      return error(res, '水站不存在', 404);
    }
    const { station_id: stationId, station_name: stationName } = existing[0];

    const references = await findStationReferences(connection, stationId);

    if (references.length === 0) {
      await connection.beginTransaction();
      try {
        await connection.execute('DELETE FROM sub_stations WHERE station_id = ?', [stationId]);
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        throw e;
      }
      return success(res, { mode: 'hard', stationId, stationName, references }, `水站「${stationName}」已删除`);
    }

    // 软删除：将 status 设为 0（保留历史可追溯）
    await connection.execute('UPDATE sub_stations SET status = 0, updated_at = ? WHERE station_id = ?', [
      new Date(),
      stationId
    ]);
    const detail = describeReferences(references);
    return success(
      res,
      { mode: 'soft', stationId, stationName, references },
      `水站「${stationName}」存在关联数据（${detail}），已转为「停用」保留而非删除`
    );
  } catch (err) {
    console.error('删除水站失败:', err);
    return error(res, '删除水站失败');
  } finally {
    connection.release();
  }
}

module.exports = {
  getStationList,
  // 引用检查是「无引用→物理删除；有引用→转停用」这条统一语义的**判据**，
  // 小程序管理端（Phase 8b）复用同一个函数 —— 两处各写一份必然在「查哪几张表」上分叉
  findStationReferences,
  getAllStations,
  getStationById,
  createStation,
  updateStation,
  deleteStation
};

const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');

const generateWorkerId = () => generateId('W');

// 员工类型：1=店长 2=配送员工 3=业务员 4=管理员（2026-09-16 新增管理员）
// 固定月薪适用类型：店长(1)/业务员(3)/管理员(4)；配送员工(2)工资按订单配送费结算
const MONTHLY_SALARY_TYPES = [1, 3, 4];
const hasMonthlySalary = (t) => MONTHLY_SALARY_TYPES.includes(Number(t));

function formatWorker(worker) {
  if (!worker) return null;
  return {
    id: worker.worker_id,
    workerId: worker.worker_id,
    name: worker.worker_name,
    workerName: worker.worker_name,
    phone: worker.phone,
    employeeType: worker.employee_type,
    commissionRate: worker.commission_rate != null ? Number(worker.commission_rate) : null,
    monthlySalary: worker.monthly_salary != null ? Number(worker.monthly_salary) : null,
    bankName: worker.bank_name,
    bankAccount: worker.bank_account,
    status: worker.status,
    createdAt: worker.created_at,
    updatedAt: worker.updated_at
  };
}

async function getWorkerList(req, res) {
  try {
    const { keyword, status, employeeType, page = 1, pageSize = 10 } = req.query;

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

    if (employeeType !== undefined && employeeType !== '' && employeeType !== null) {
      whereClause += ' AND employee_type = ?';
      params.push(Number(employeeType));
    }

    const countSql = `SELECT COUNT(*) as total FROM workers ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

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
    const sql = 'SELECT worker_id, worker_name, phone, employee_type, monthly_salary FROM workers WHERE status = 1 ORDER BY employee_type ASC, worker_name ASC';
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
      employeeType,
      employee_type,
      bankName,
      bank_name,
      bankAccount,
      bank_account,
      commissionRate,
      monthlySalary,
      status
    } = req.body;

    const name = workerName || worker_name;
    const eType = employeeType !== undefined ? employeeType : (employee_type !== undefined ? employee_type : 2);
    const bName = bankName !== undefined ? bankName : bank_name;
    const bAccount = bankAccount !== undefined ? bankAccount : bank_account;

    if (!name) {
      return error(res, '员工姓名不能为空', 400);
    }

    const worker_id = generateWorkerId();
    const now = new Date();

    const sql = `INSERT INTO workers (
      worker_id, worker_name, phone, employee_type, commission_rate, monthly_salary,
      bank_name, bank_account, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      worker_id,
      name,
      phone || null,
      Number(eType) || 2,
      // 提成比例仅业务员（类型3）使用，其他类型存 NULL
      Number(eType) === 3 ? (commissionRate !== undefined && commissionRate !== null ? Number(commissionRate) : 0) : null,
      // 固定月薪仅店长(1)/业务员(3)/管理员(4)使用，配送员工(2)存 NULL
      hasMonthlySalary(eType)
        ? (monthlySalary !== undefined && monthlySalary !== null && monthlySalary !== '' ? Number(monthlySalary) : null)
        : null,
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
      employeeType,
      employee_type,
      bankName,
      bank_name,
      bankAccount,
      bank_account,
      commissionRate,
      monthlySalary,
      status
    } = req.body;

    const [existing] = await pool.execute('SELECT worker_id, employee_type FROM workers WHERE worker_id = ?', [id]);
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
    const eType = employeeType !== undefined ? employeeType : employee_type;
    if (eType !== undefined) {
      updateFields.push('employee_type = ?');
      values.push(Number(eType));
    }
    // 提成比例仅业务员（类型3）使用；显式传值才更新
    if (commissionRate !== undefined) {
      updateFields.push('commission_rate = ?');
      values.push(commissionRate !== null && commissionRate !== '' ? Number(commissionRate) : null);
    }
    // 固定月薪仅店长(1)/业务员(3)/管理员(4)使用；显式传值才更新
    if (monthlySalary !== undefined) {
      const t = Number(eType !== undefined ? eType : existing[0].employee_type);
      updateFields.push('monthly_salary = ?');
      values.push(hasMonthlySalary(t)
        ? (monthlySalary !== null && monthlySalary !== '' ? Number(monthlySalary) : null)
        : null);
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

// 员工删除（2026-09-16 重做）：**能真删就真删，否则设为离职**
// ---------------------------------------------------------------------------
// 背景：orders.created_by / orders.worker_id / financial_settlement.worker_id 都是
//       指向 workers 的外键（RESTRICT），有历史单据的员工物理删不掉，硬删会破坏
//       历史可追溯性。而「误建的员工」没有任何引用，应当能真正删掉。
// 规则：① 下列引用表全部为 0 → **物理 DELETE**（并清理 system_settings 中指向它的配置）
//       ② 任一引用表 > 0      → **软删（status=0 离职）**，并返回引用清单供前端提示
// 响应：{ mode: 'hard'|'soft', workerId, workerName, references: [{label, count}] }
// ---------------------------------------------------------------------------
const WORKER_REF_TABLES = [
  { table: 'orders', column: 'created_by', label: '订单（创建人）' },
  { table: 'orders', column: 'worker_id', label: '订单（配送员工）' },
  { table: 'financial_settlement', column: 'worker_id', label: '财务结算' },
  { table: 'salary_payments', column: 'worker_id', label: '工资发放' },
  { table: 'salary_advances', column: 'worker_id', label: '工资预支' },
  { table: 'staff_salaries', column: 'worker_id', label: '员工工资表' }
];

async function findWorkerReferences(conn, workerId) {
  const refs = [];
  for (const r of WORKER_REF_TABLES) {
    try {
      const [rows] = await conn.execute(
        `SELECT COUNT(*) AS n FROM \`${r.table}\` WHERE \`${r.column}\` = ?`,
        [workerId]
      );
      const n = Number(rows[0].n) || 0;
      if (n > 0) refs.push({ label: r.label, count: n });
    } catch (e) {
      // 表不存在（历史库差异）时跳过，不阻断删除判定
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }
  }
  return refs;
}

async function deleteWorker(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    const [existing] = await connection.execute(
      'SELECT worker_id, worker_name, status FROM workers WHERE worker_id = ?',
      [id]
    );
    if (existing.length === 0) {
      return error(res, '员工不存在', 404);
    }
    const { worker_id: workerId, worker_name: workerName } = existing[0];

    const references = await findWorkerReferences(connection, workerId);

    if (references.length === 0) {
      // —— 无任何引用：物理删除 ——
      await connection.beginTransaction();
      try {
        // 清理配置表中指向该员工的悬挂引用（首个使用方：销售单打印店长）
        // 清理后 resolvePrintManager() 会自动回退为「第一位启用的店长」
        await connection.execute(
          `UPDATE system_settings SET setting_value = NULL WHERE setting_key = 'print_manager_worker_id' AND setting_value = ?`,
          [workerId]
        );
        await connection.execute('DELETE FROM workers WHERE worker_id = ?', [workerId]);
        await connection.commit();
      } catch (e) {
        await connection.rollback();
        throw e;
      }
      return success(res, { mode: 'hard', workerId, workerName, references }, `员工「${workerName}」已删除`);
    }

    // —— 有历史单据：只能软删（离职），保留可追溯性 ——
    await connection.execute(
      'UPDATE workers SET status = 0, updated_at = ? WHERE worker_id = ?',
      [new Date(), workerId]
    );
    const detail = references.map((r) => `${r.label} ${r.count} 条`).join('、');
    return success(
      res,
      { mode: 'soft', workerId, workerName, references },
      `员工「${workerName}」存在历史单据（${detail}），已转为「离职」保留而非删除`
    );
  } catch (err) {
    console.error('删除员工失败:', err);
    return error(res, '删除员工失败: ' + err.message);
  } finally {
    connection.release();
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

// 其他收入管理：CRUD + 账户记账（增加余额/写收入流水，事务保证一致）
// ---------------------------------------------------------------------------
// 与 otherController（其他支出）刻意保持结构一致，便于两侧对照维护：
//   支出 = 扣减余额 + tx_type 2（支出）  |  收入 = 增加余额 + tx_type 1（收入）
// 撤销方向相反：支出回补 +amount，收入回退 −amount。
// ⚠️ 铁律：业务记录、finance_accounts.current_balance、finance_transactions
//    必须在**同一事务**内完成，任一步失败整体 rollback。
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');

// 预置收入类别
// ⚠️ 刻意避开与「订单营收」相关的类目（送水到府/水公社/直营水站/线下零售/量贩机/零售机）：
//    那些由订单与机台销量自动汇总，手工登记同名类目会造成口径重复。
const PRESET_CATEGORIES = ['废品回收', '利息收入', '返利', '补贴', '赔偿', '其他'];

function genId() {
  return (
    'INC' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1000)
      .toString(36)
      .toUpperCase()
  );
}
function genTxNo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return (
    'TX' +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  );
}
function genTxId() {
  return (
    'TX' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 10000)
      .toString(36)
      .toUpperCase()
  );
}

// 记账：增加账户余额并写入收入流水（须在事务内调用，conn 为事务连接）
async function applyIncomeLedger(conn, income, user) {
  if (!income.account_id) return;
  const [acc] = await conn.query(
    'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE',
    [income.account_id]
  );
  if (!acc.length) throw new Error('收入账户不存在或已停用');
  const a = acc[0];
  const before = Number(a.current_balance);
  const amount = Number(income.amount);
  // 收入方向不做余额校验（与项目铁律一致：只有扣款方向才校验余额）
  await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
    before + amount,
    income.account_id
  ]);
  await conn.query(
    `INSERT INTO finance_transactions
       (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
        related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      genTxId(),
      genTxNo(),
      a.account_id,
      a.account_name,
      1,
      '其他收入',
      amount,
      before,
      before + amount,
      'other_income',
      income.income_id,
      income.income_date,
      user || null,
      income.income_name || null,
      income.remark || null
    ]
  );
}

// 撤销记账：回退余额并删除关联流水（须在事务内调用）
// ⚠️ 方向与收入相反：收入当时是 +amount，撤销必须 −amount，否则余额会被越撤越多。
async function revertIncomeLedger(conn, incomeId) {
  const [txs] = await conn.query(
    'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
    ['other_income', incomeId]
  );
  for (const tx of txs) {
    await conn.query(
      'UPDATE finance_accounts SET current_balance = current_balance - ?, updated_at = NOW() WHERE account_id = ?',
      [tx.amount, tx.account_id]
    );
    await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
  }
}

function validateBody(body) {
  const { incomeName, amount, incomeDate, category } = body;
  if (!incomeName || !String(incomeName).trim()) return '收入名称不能为空';
  const amt = Number(amount);
  if (amount === undefined || amount === null || amount === '' || isNaN(amt) || amt <= 0)
    return '金额必须为大于 0 的数字';
  if (!incomeDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(incomeDate))) return '收入日期格式应为 YYYY-MM-DD';
  if (!category || !String(category).trim()) return '收入类别不能为空';
  return null;
}

/**
 * 收入列表的筛选条件 —— Web 与**小程序管理端（Phase 8b）共用同一段**，避免两处分叉
 *
 * ⚠️ 区间语义必须单源：这里走 `buildRangeWhere`（start **含** / end **不含**）。
 *    本仓库存在**两套**区间约定（另一套 `financialController.resolveDateRange` 是 end **含**），
 *    两者混用会静默漏掉当天数据。与 `buildExpenseListWhere` 同构 —— 两域一起改，
 *    别只改一处（否则「支出对的、收入错的」这种一半正确最难发现）。
 *
 * @returns {{clause:string, params:Array}|{error:string}} 区间非法时返回 { error }（用户文案）
 */
function buildIncomeListWhere(query = {}) {
  const { month, range, startDate, endDate, category, keyword } = query;
  const parts = [];
  const params = [];
  // 时间条件：range / month 走统一区间解析（month 为旧参数，等价整月）
  //           直接传 startDate/endDate（无 range/month）时沿用原闭区间语义
  if (range || month) {
    const r = resolveRange({ range, month, startDate, endDate });
    if (!r) return { error: RANGE_INVALID_MSG };
    const rw = buildRangeWhere('income_date', r);
    if (rw.clause) {
      parts.push(rw.clause);
      params.push(...rw.params);
    }
  } else {
    if (startDate) {
      parts.push('income_date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      parts.push('income_date <= ?');
      params.push(endDate);
    }
  }
  if (category) {
    parts.push('category = ?');
    params.push(category);
  }
  if (keyword) {
    parts.push('(income_name LIKE ? OR remark LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  return { clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

// 列表（筛选：预设区间 / 月份 / 日期范围 / 类别 / 关键词，分页）
async function getIncomes(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const { page: p, size, offset } = parsePage({ page, pageSize });
    const filters = buildIncomeListWhere(req.query);
    if (filters.error) {
      return error(res, filters.error, 400);
    }
    const where = filters.clause;
    const params = filters.params;
    const [rows] = await pool.execute(
      `SELECT income_id, income_name, category, amount, DATE_FORMAT(income_date, '%Y-%m-%d') AS income_date,
              account_id, account_name, remark, created_by, created_at
       FROM other_incomes ${where}
       ORDER BY income_date DESC, created_at DESC
       LIMIT ${size} OFFSET ${offset}`, // size/offset 已 parseInt，防注入；预处理不支持 LIMIT 绑定
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM other_incomes ${where}`, params);
    const [sumRow] = await pool.execute(`SELECT ROUND(SUM(amount), 2) AS total FROM other_incomes ${where}`, params);
    return success(res, {
      list: rows.map(r => ({
        ...r,
        amount: Number(r.amount) || 0
      })),
      total: cnt[0].n,
      sumAmount: Number(sumRow[0].total) || 0,
      page: p,
      pageSize: size
    });
  } catch (e) {
    console.error('getIncomes error:', e);
    return error(res, '其他收入查询失败', 500);
  }
}

// 类别选项：预置 + 历史自定义
async function getCategories(req, res) {
  try {
    const [rows] = await pool.query('SELECT DISTINCT category FROM other_incomes ORDER BY category');
    const custom = rows.map(r => r.category).filter(c => !PRESET_CATEGORIES.includes(c));
    return success(res, { preset: PRESET_CATEGORIES, custom });
  } catch (e) {
    console.error('getIncomeCategories error:', e);
    return error(res, '类别查询失败', 500);
  }
}

// 新建（记账）
async function createIncome(req, res) {
  const errMsg = validateBody(req.body);
  if (errMsg) return error(res, errMsg, 400);
  const { incomeName, amount, incomeDate, category, accountId, remark } = req.body;
  const user = (req.user && (req.user.username || req.user.id)) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const incomeId = genId();
    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query(
        'SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1',
        [accountId]
      );
      if (!acc.length) {
        await conn.rollback();
        return error(res, '收入账户不存在或已停用', 400);
      }
      accountName = acc[0].account_name;
    }
    await conn.query(
      `INSERT INTO other_incomes (income_id, income_name, category, amount, income_date, account_id, account_name, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        incomeId,
        String(incomeName).trim(),
        String(category).trim(),
        Number(amount),
        incomeDate,
        accountId || null,
        accountName,
        remark || null,
        user
      ]
    );
    await applyIncomeLedger(
      conn,
      {
        income_id: incomeId,
        account_id: accountId || null,
        amount: Number(amount),
        income_date: incomeDate,
        income_name: String(incomeName).trim(),
        remark: remark || null
      },
      user
    );
    await conn.commit();
    return success(res, { incomeId }, '新增成功');
  } catch (e) {
    await conn.rollback();
    console.error('createIncome error:', e);
    return error(res, e.message.includes('账户') ? e.message : '新增其他收入失败', 500); // hazard-allow: bizFail 白名单文案（账户停用）（设计输出，非内部细节）
  } finally {
    conn.release();
  }
}

// 编辑：撤销旧流水 -> 更新记录 -> 按新值记账
async function updateIncome(req, res) {
  const { id } = req.params;
  const errMsg = validateBody(req.body);
  if (errMsg) return error(res, errMsg, 400);
  const { incomeName, amount, incomeDate, category, accountId, remark } = req.body;
  const user = (req.user && (req.user.username || req.user.id)) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT income_id FROM other_incomes WHERE income_id = ?', [id]);
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }
    await revertIncomeLedger(conn, id);
    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query(
        'SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1',
        [accountId]
      );
      if (!acc.length) {
        await conn.rollback();
        return error(res, '收入账户不存在或已停用', 400);
      }
      accountName = acc[0].account_name;
    }
    await conn.query(
      `UPDATE other_incomes SET income_name = ?, category = ?, amount = ?, income_date = ?, account_id = ?, account_name = ?, remark = ?, updated_at = NOW() WHERE income_id = ?`,
      [
        String(incomeName).trim(),
        String(category).trim(),
        Number(amount),
        incomeDate,
        accountId || null,
        accountName,
        remark || null,
        id
      ]
    );
    await applyIncomeLedger(
      conn,
      {
        income_id: id,
        account_id: accountId || null,
        amount: Number(amount),
        income_date: incomeDate,
        income_name: String(incomeName).trim(),
        remark: remark || null
      },
      user
    );
    await conn.commit();
    return success(res, { incomeId: id }, '修改成功');
  } catch (e) {
    await conn.rollback();
    console.error('updateIncome error:', e);
    return error(res, e.message.includes('账户') ? e.message : '修改其他收入失败', 500); // hazard-allow: bizFail 白名单文案（账户停用）（设计输出，非内部细节）
  } finally {
    conn.release();
  }
}

// 删除：撤销流水回退余额 -> 删除记录
async function deleteIncome(req, res) {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT income_id FROM other_incomes WHERE income_id = ?', [id]);
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }
    await revertIncomeLedger(conn, id);
    await conn.query('DELETE FROM other_incomes WHERE income_id = ?', [id]);
    await conn.commit();
    return success(res, null, '删除成功');
  } catch (e) {
    await conn.rollback();
    console.error('deleteIncome error:', e);
    return error(res, '删除其他收入失败', 500);
  } finally {
    conn.release();
  }
}

module.exports = {
  getIncomes,
  getCategories,
  createIncome,
  updateIncome,
  deleteIncome,
  applyIncomeLedger,
  revertIncomeLedger,
  buildIncomeListWhere,
  PRESET_CATEGORIES,
  validateBody,
  genId
};

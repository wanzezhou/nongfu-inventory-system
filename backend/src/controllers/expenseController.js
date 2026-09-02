// 其他支出管理：CRUD + 账户记账（扣减余额/写流水，事务保证一致）
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// 预置支出类别
const PRESET_CATEGORIES = ['运输', '仓储', '房租水电', '办公', '维修', '招待', '营销', '其他'];

function genId() {
  return 'EXP' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
}
function genTxNo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return 'TX' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + String(Math.floor(Math.random() * 100000)).padStart(5, '0');
}
function genTxId() {
  return 'TX' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 10000).toString(36).toUpperCase();
}

// 记账：扣减账户余额并写入流水（须在事务内调用，conn 为事务连接）
async function applyExpenseLedger(conn, expense, user) {
  if (!expense.account_id) return;
  const [acc] = await conn.query(
    'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE',
    [expense.account_id]
  );
  if (!acc.length) throw new Error('支出账户不存在或已停用');
  const a = acc[0];
  const before = Number(a.current_balance);
  const amount = Number(expense.amount);
  await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [before - amount, expense.account_id]);
  await conn.query(
    `INSERT INTO finance_transactions
       (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
        related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      genTxId(), genTxNo(), a.account_id, a.account_name, 2, '其他支出', amount,
      before, before - amount, 'other_expense', expense.expense_id, expense.expense_date,
      user || null, expense.expense_name || null, expense.remark || null
    ]
  );
}

// 撤销记账：回补余额并删除关联流水（须在事务内调用）
async function revertExpenseLedger(conn, expenseId) {
  const [txs] = await conn.query(
    'SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module = ? AND related_id = ?',
    ['other_expense', expenseId]
  );
  for (const tx of txs) {
    await conn.query('UPDATE finance_accounts SET current_balance = current_balance + ?, updated_at = NOW() WHERE account_id = ?', [tx.amount, tx.account_id]);
    await conn.query('DELETE FROM finance_transactions WHERE tx_id = ?', [tx.tx_id]);
  }
}

function validateBody(body) {
  const { expenseName, amount, expenseDate, category } = body;
  if (!expenseName || !String(expenseName).trim()) return '支出名称不能为空';
  const amt = Number(amount);
  if (amount === undefined || amount === null || amount === '' || isNaN(amt) || amt <= 0) return '金额必须为大于 0 的数字';
  if (!expenseDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(expenseDate))) return '支出日期格式应为 YYYY-MM-DD';
  if (!category || !String(category).trim()) return '支出类别不能为空';
  return null;
}

// 列表（筛选：月份/日期范围/类别/关键词，分页）
async function getExpenses(req, res) {
  try {
    const { month, startDate, endDate, category, keyword, page = 1, pageSize = 10 } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(200, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;
    const parts = [];
    const params = [];
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      parts.push('DATE_FORMAT(expense_date, ?) = ?');
      params.push('%Y-%m', month);
    }
    if (startDate) { parts.push('expense_date >= ?'); params.push(startDate); }
    if (endDate) { parts.push('expense_date <= ?'); params.push(endDate); }
    if (category) { parts.push('category = ?'); params.push(category); }
    if (keyword) {
      parts.push('(expense_name LIKE ? OR remark LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    const [rows] = await pool.execute(
      `SELECT expense_id, expense_name, category, amount, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
              account_id, account_name, remark, created_by, created_at
       FROM other_expenses ${where}
       ORDER BY expense_date DESC, created_at DESC
       LIMIT ${size} OFFSET ${offset}`, // size/offset 已 parseInt，防注入；预处理不支持 LIMIT 绑定
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM other_expenses ${where}`, params);
    const [sumRow] = await pool.execute(`SELECT ROUND(SUM(amount), 2) AS total FROM other_expenses ${where}`, params);
    return success(res, {
      list: rows.map((r) => ({
        ...r, amount: Number(r.amount) || 0, total: undefined
      })),
      total: cnt[0].n,
      sumAmount: Number(sumRow[0].total) || 0,
      page: p, pageSize: size
    });
  } catch (e) {
    console.error('getExpenses error:', e);
    return error(res, '其他支出查询失败', 500);
  }
}

// 类别选项：预置 + 历史自定义
async function getCategories(req, res) {
  try {
    const [rows] = await pool.query('SELECT DISTINCT category FROM other_expenses ORDER BY category');
    const custom = rows.map((r) => r.category).filter((c) => !PRESET_CATEGORIES.includes(c));
    return success(res, { preset: PRESET_CATEGORIES, custom });
  } catch (e) {
    console.error('getCategories error:', e);
    return error(res, '类别查询失败', 500);
  }
}

// 新建（记账）
async function createExpense(req, res) {
  const errMsg = validateBody(req.body);
  if (errMsg) return error(res, errMsg, 400);
  const { expenseName, amount, expenseDate, category, accountId, remark } = req.body;
  const user = (req.user && (req.user.username || req.user.id)) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const expenseId = genId();
    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query('SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1', [accountId]);
      if (!acc.length) { await conn.rollback(); return error(res, '支出账户不存在或已停用', 400); }
      accountName = acc[0].account_name;
    }
    await conn.query(
      `INSERT INTO other_expenses (expense_id, expense_name, category, amount, expense_date, account_id, account_name, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [expenseId, String(expenseName).trim(), String(category).trim(), Number(amount), expenseDate, accountId || null, accountName, remark || null, user]
    );
    await applyExpenseLedger(conn, { expense_id: expenseId, account_id: accountId || null, amount: Number(amount), expense_date: expenseDate, expense_name: String(expenseName).trim(), remark: remark || null }, user);
    await conn.commit();
    return success(res, { expenseId }, '新增成功');
  } catch (e) {
    await conn.rollback();
    console.error('createExpense error:', e);
    return error(res, e.message.includes('账户') ? e.message : '新增其他支出失败', 500);
  } finally {
    conn.release();
  }
}

// 编辑：撤销旧流水 -> 更新记录 -> 按新值记账
async function updateExpense(req, res) {
  const { id } = req.params;
  const errMsg = validateBody(req.body);
  if (errMsg) return error(res, errMsg, 400);
  const { expenseName, amount, expenseDate, category, accountId, remark } = req.body;
  const user = (req.user && (req.user.username || req.user.id)) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT expense_id FROM other_expenses WHERE expense_id = ?', [id]);
    if (!exist.length) { await conn.rollback(); return error(res, '记录不存在', 404); }
    await revertExpenseLedger(conn, id);
    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query('SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1', [accountId]);
      if (!acc.length) { await conn.rollback(); return error(res, '支出账户不存在或已停用', 400); }
      accountName = acc[0].account_name;
    }
    await conn.query(
      `UPDATE other_expenses SET expense_name = ?, category = ?, amount = ?, expense_date = ?, account_id = ?, account_name = ?, remark = ?, updated_at = NOW() WHERE expense_id = ?`,
      [String(expenseName).trim(), String(category).trim(), Number(amount), expenseDate, accountId || null, accountName, remark || null, id]
    );
    await applyExpenseLedger(conn, { expense_id: id, account_id: accountId || null, amount: Number(amount), expense_date: expenseDate, expense_name: String(expenseName).trim(), remark: remark || null }, user);
    await conn.commit();
    return success(res, { expenseId: id }, '修改成功');
  } catch (e) {
    await conn.rollback();
    console.error('updateExpense error:', e);
    return error(res, e.message.includes('账户') ? e.message : '修改其他支出失败', 500);
  } finally {
    conn.release();
  }
}

// 删除：撤销流水回补余额 -> 删除记录
async function deleteExpense(req, res) {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT expense_id FROM other_expenses WHERE expense_id = ?', [id]);
    if (!exist.length) { await conn.rollback(); return error(res, '记录不存在', 404); }
    await revertExpenseLedger(conn, id);
    await conn.query('DELETE FROM other_expenses WHERE expense_id = ?', [id]);
    await conn.commit();
    return success(res, null, '删除成功');
  } catch (e) {
    await conn.rollback();
    console.error('deleteExpense error:', e);
    return error(res, '删除其他支出失败', 500);
  } finally {
    conn.release();
  }
}

module.exports = {
  getExpenses, getCategories, createExpense, updateExpense, deleteExpense,
  applyExpenseLedger, revertExpenseLedger, PRESET_CATEGORIES, validateBody, genId
};

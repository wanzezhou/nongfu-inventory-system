// 公司账户管理（独立模块）：7 类账户（4 资金账户 + 3 普通余额账户）查看/维护/人工收支/相互转账/流水
// 语义：账户间相互独立；转账任一转出方/转入方；所有变更事务化并记流水
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePage } = require('../utils/pagination');

// 公司账户管理（独立模块）：账户类型字典（2026-09-15 财务管理 V2 扩展）
//   1-4  原有资金账户：晟之溪公户 / 水公社公户 / 微信 / 其他
//   5-7  已停用：可上单信用余额 / 可上单折扣余额 / 自有费用余额（已合并至 8）
//   8-10 新增：农夫上单账户 / 量贩机账户 / 零售机账户
const ACCOUNT_TYPES = {
  1: '晟之溪公户',
  2: '水公社公户',
  3: '微信',
  4: '其他',
  5: '可上单信用余额',
  6: '可上单折扣余额',
  7: '自有费用余额',
  8: '农夫上单账户',
  9: '量贩机账户',
  10: '零售机账户'
};

function genAccountId() {
  return (
    'ACC' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 10000)
      .toString(36)
      .toUpperCase()
  );
}

/** finance_accounts 的显式列清单：避免星号通配（拖网络/内存 + 列变更隐式耦合） */
const ACCOUNT_COLS =
  'account_id, account_name, account_type, bank_name, bank_account, initial_balance, current_balance, remark, status, created_at, updated_at';

/** 业务错误（e.business=true）：文案面向用户，由调用方统一转响应（项目既有约定） */
function businessError(msg) {
  const e = new Error(msg);
  e.business = true;
  return e;
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

function row2vo(r) {
  return {
    accountId: r.account_id,
    accountName: r.account_name,
    accountType: Number(r.account_type),
    accountTypeName: ACCOUNT_TYPES[r.account_type] || '其他',
    bankName: r.bank_name || '',
    bankAccount: r.bank_account || '',
    currentBalance: Number(r.current_balance) || 0,
    initialBalance: Number(r.initial_balance) || 0,
    remark: r.remark || '',
    status: Number(r.status) !== 0
  };
}

// 账户列表（全量，按类型排序）
async function getAccounts(req, res) {
  try {
    // hazard-allow: ACCOUNT_COLS 是模块内硬编码的列名常量（不来自任何入参），非拼接式 SQL
    const [rows] = await pool.query(`SELECT ${ACCOUNT_COLS} FROM finance_accounts ORDER BY account_type, created_at`);
    return success(res, { list: rows.map(row2vo) });
  } catch (e) {
    console.error('getAccounts error:', e);
    return error(res, '账户查询失败', 500);
  }
}

// 新增账户（类型下拉 1-7；同名拦截）
async function createAccount(req, res) {
  try {
    const { accountName, accountType, bankName, bankAccount, initialBalance, remark } = req.body;
    if (!accountName || !String(accountName).trim()) return error(res, '账户名称不能为空', 400);
    const type = Number(accountType);
    if (!ACCOUNT_TYPES[type]) return error(res, '无效的账户类型', 400);
    const initial = Number(initialBalance) || 0;
    if (initial < 0) return error(res, '期初余额不能为负', 400);
    const [exist] = await pool.query('SELECT account_id FROM finance_accounts WHERE account_name = ?', [
      String(accountName).trim()
    ]);
    if (exist.length) return error(res, '账户名称已存在', 400);
    const accountId = genAccountId();
    await pool.query(
      `INSERT INTO finance_accounts (account_id, account_name, account_type, bank_name, bank_account, initial_balance, current_balance, remark, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        accountId,
        String(accountName).trim(),
        type,
        bankName || null,
        bankAccount || null,
        initial,
        initial,
        remark || null
      ]
    );
    return success(res, { accountId }, '新增成功');
  } catch (e) {
    console.error('createAccount error:', e);
    return error(res, '新增账户失败', 500);
  }
}

// 编辑账户（名称/类型不可改，改备注/开户信息/期初不动余额）
async function updateAccount(req, res) {
  try {
    const { id } = req.params;
    const { bankName, bankAccount, remark, status } = req.body;
    const [exist] = await pool.query('SELECT account_id FROM finance_accounts WHERE account_id = ?', [id]);
    if (!exist.length) return error(res, '账户不存在', 404);
    await pool.query(
      'UPDATE finance_accounts SET bank_name = ?, bank_account = ?, remark = ?, status = ?, updated_at = NOW() WHERE account_id = ?',
      [bankName || null, bankAccount || null, remark || null, status ? 1 : 0, id]
    );
    return success(res, null, '保存成功');
  } catch (e) {
    console.error('updateAccount error:', e);
    return error(res, '保存失败', 500);
  }
}

// 删除账户：仅余额为 0 且无任何流水时允许
async function deleteAccount(req, res) {
  try {
    const { id } = req.params;
    const [acc] = await pool.query('SELECT account_id, current_balance FROM finance_accounts WHERE account_id = ?', [
      id
    ]);
    if (!acc.length) return error(res, '账户不存在', 404);
    if (Math.abs(Number(acc[0].current_balance)) > 0.009) return error(res, '账户余额不为 0，不能删除（可停用）', 400);
    const [tx] = await pool.query('SELECT COUNT(*) n FROM finance_transactions WHERE account_id = ?', [id]);
    if (tx[0].n > 0) return error(res, '账户存在流水记录，不能删除（可停用）', 400);
    await pool.query('DELETE FROM finance_accounts WHERE account_id = ?', [id]);
    return success(res, null, '删除成功');
  } catch (e) {
    console.error('deleteAccount error:', e);
    return error(res, '删除失败', 500);
  }
}

// 内部：写入一条流水（conn 事务内）
async function insertTx(conn, { account, txType, amount, before, txNo, batchId, counterparty, remark, user }) {
  const after = before + (txType === 1 ? amount : -amount);
  await conn.query(
    `INSERT INTO finance_transactions
       (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
        related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
    [
      genTxId(),
      txNo,
      account.account_id,
      account.account_name,
      txType,
      txType === 1 ? '收入' : '支出',
      amount,
      before,
      after,
      'account_transfer',
      batchId,
      user || null,
      counterparty || null,
      remark || null
    ]
  );
  return after;
}

// 人工调账（收入 income / 支出 expense）
async function adjustBalance(req, res) {
  try {
    const { id } = req.params;
    const { type, amount, remark } = req.body;
    if (!['income', 'expense'].includes(type)) return error(res, '调账类型无效', 400);
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) return error(res, '金额必须为大于 0 的数字', 400);
    const user = (req.user && (req.user.username || req.user.id)) || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // hazard-allow: ACCOUNT_COLS 是模块内硬编码的列名常量（不来自任何入参），非拼接式 SQL
      const [acc] = await conn.query(`SELECT ${ACCOUNT_COLS} FROM finance_accounts WHERE account_id = ? FOR UPDATE`, [
        id
      ]);
      if (!acc.length) {
        await conn.rollback();
        return error(res, '账户不存在', 404);
      }
      if (Number(acc[0].status) !== 1) {
        await conn.rollback();
        return error(res, '账户已停用，不能调账', 400);
      }
      const balance = Number(acc[0].current_balance);
      if (type === 'expense' && balance < amt) {
        await conn.rollback();
        return error(res, '可用余额不足', 400);
      }
      const txType = type === 'income' ? 1 : 2;
      const newBalance = txType === 1 ? balance + amt : balance - amt;
      await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
        newBalance,
        id
      ]);
      await insertTx(conn, {
        account: acc[0],
        txType,
        amount: amt,
        before: balance,
        txNo: genTxNo(),
        batchId: 'MANUAL',
        counterparty: type === 'income' ? '人工收入' : '人工支出',
        remark: remark || null,
        user
      });
      await conn.commit();
      return success(res, { accountId: id, balance: newBalance }, type === 'income' ? '收入入账成功' : '支出登记成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('adjustBalance error:', e);
    return error(res, e.message.includes('不足') || e.message.includes('停用') ? e.message : '调账失败', 400); // hazard-allow: bizFail 白名单文案（余额不足/账户停用）（设计输出，非内部细节）
  }
}

/**
 * 账户间转账 —— **可复用原语**（Web 端与小程序管理端共用；调用方负责事务边界）
 * ---------------------------------------------------------------------------
 * 为什么抽出来：这段逻辑原先是 Web 端点里的内联事务，小程序管理端也要转账 ——
 * 而转账是**双边余额 + 双流水**的资金动作，两处各写一份必然在「先扣后加 / 批次号是否一致 /
 * 余额不足检查在哪一步」上分叉，且这类分叉在账面**看起来完全正常**（总额守恒仍然成立）。
 * 校验顺序固定为：存在 → 启用 → 非同一账户 → 余额足够。
 * 抛 businessError（e.business=true，带 status）交由调用方统一转响应。
 *
 * @returns {{txNo: string, fromBalance: number, toBalance: number}}
 */
async function applyTransfer(conn, { fromId, toId, amount, remark, user }) {
  if (!fromId || !toId) throw businessError('请选择转出与转入账户');
  if (fromId === toId) throw businessError('转出与转入账户不能相同');
  const amt = Number(amount);
  if (!amount || isNaN(amt) || amt <= 0) throw businessError('金额必须为大于 0 的数字');

  // hazard-allow: ACCOUNT_COLS 是模块内硬编码的列名常量（不来自任何入参），非拼接式 SQL
  const [fromRows] = await conn.query(`SELECT ${ACCOUNT_COLS} FROM finance_accounts WHERE account_id = ? FOR UPDATE`, [
    fromId
  ]);
  // hazard-allow: ACCOUNT_COLS 是模块内硬编码的列名常量（不来自任何入参），非拼接式 SQL
  const [toRows] = await conn.query(`SELECT ${ACCOUNT_COLS} FROM finance_accounts WHERE account_id = ? FOR UPDATE`, [
    toId
  ]);
  if (!fromRows.length || !toRows.length) {
    throw Object.assign(businessError('账户不存在'), { status: 404 });
  }
  if (Number(fromRows[0].status) !== 1) throw businessError('转出账户已停用');
  if (Number(toRows[0].status) !== 1) throw businessError('转入账户已停用');
  const fromBalance = Number(fromRows[0].current_balance);
  if (fromBalance < amt) throw businessError('转出账户可用余额不足');
  const toBalance = Number(toRows[0].current_balance);

  const txNo = genTxNo();
  const batchId = 'XFER' + txNo; // 同一批次号把两条流水绑在一起，对账时可回溯
  const fromAfter = await insertTx(conn, {
    account: fromRows[0],
    txType: 2,
    amount: amt,
    before: fromBalance,
    txNo,
    batchId,
    counterparty: toRows[0].account_name,
    remark: remark || null,
    user
  });
  const toAfter = await insertTx(conn, {
    account: toRows[0],
    txType: 1,
    amount: amt,
    before: toBalance,
    txNo,
    batchId,
    counterparty: fromRows[0].account_name,
    remark: remark || null,
    user
  });
  await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
    fromAfter,
    fromId
  ]);
  await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
    toAfter,
    toId
  ]);

  return { txNo, fromBalance: fromAfter, toBalance: toAfter };
}

// 账户间转账（Web 端点：薄封装 + 事务边界）
async function transferBetween(req, res) {
  try {
    const { fromId, toId, amount, remark } = req.body;
    const user = (req.user && (req.user.username || req.user.id)) || null;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await applyTransfer(conn, { fromId, toId, amount, remark, user });
      await conn.commit();
      return success(res, r, '转账成功');
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('transferBetween error:', e);
    // hazard-allow: 仅透传 businessError 自建的业务文案（余额不足/账户停用/不能相同等，面向用户），其余走下面的固定文案
    if (e.business) return error(res, e.message, e.status || 400);
    return error(res, '转账失败', 400);
  }
}

// 账户流水（分页，可按日期范围/类型筛选）
async function getTransactions(req, res) {
  try {
    const { id } = req.params;
    const { startDate, endDate, type, page = 1, pageSize = 10 } = req.query;
    const { page: p, size, offset } = parsePage({ page, pageSize });
    const parts = ['account_id = ?'];
    const params = [id];
    if (startDate) {
      parts.push('tx_date >= ?');
      params.push(startDate);
    }
    if (endDate) {
      parts.push('tx_date <= ?');
      params.push(endDate);
    }
    if (type && ['1', '2', '3', '4'].includes(String(type))) {
      parts.push('tx_type = ?');
      params.push(Number(type));
    }
    const where = 'WHERE ' + parts.join(' AND ');
    const [rows] = await pool.execute(
      `SELECT tx_no, tx_type, tx_category, amount, balance_before, balance_after, counterparty, handler, remark, DATE_FORMAT(tx_date, '%Y-%m-%d') AS tx_date, created_at
       FROM finance_transactions ${where}
       ORDER BY created_at DESC, tx_id DESC
       LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) n FROM finance_transactions ${where}`, params);
    return success(res, {
      list: rows.map(r => ({
        txNo: r.tx_no,
        txType: Number(r.tx_type),
        txTypeName: { 1: '收入', 2: '支出', 3: '冻结', 4: '解冻' }[r.tx_type] || '-',
        txCategory: r.tx_category || '',
        amount: Number(r.amount) || 0,
        balanceBefore: Number(r.balance_before) || 0,
        balanceAfter: Number(r.balance_after) || 0,
        counterparty: r.counterparty || '',
        handler: r.handler || '',
        remark: r.remark || '',
        txDate: r.tx_date,
        createdAt: r.created_at
      })),
      total: cnt[0].n,
      page: p,
      pageSize: size
    });
  } catch (e) {
    console.error('getTransactions error:', e);
    return error(res, '流水查询失败', 500);
  }
}

module.exports = {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  adjustBalance,
  transferBetween,
  getTransactions,
  applyTransfer,
  ACCOUNT_TYPES,
  genTxId,
  genTxNo
};

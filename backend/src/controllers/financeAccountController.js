// 公司账户（本期提供列表供其他支出选账户；完整维护/流水在账户管理模块交付）
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

const ACCOUNT_TYPES = { 1: '晟之溪公户', 2: '水公社公户', 3: '微信', 4: '其他' };

async function getAccounts(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT account_id, account_name, account_type, bank_name, bank_account,
              current_balance, initial_balance, remark, status
       FROM finance_accounts
       ORDER BY account_type, created_at`
    );
    const list = rows.map((r) => ({
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
    }));
    return success(res, { list });
  } catch (e) {
    console.error('getAccounts error:', e);
    return error(res, '账户查询失败', 500);
  }
}

module.exports = { getAccounts, ACCOUNT_TYPES };

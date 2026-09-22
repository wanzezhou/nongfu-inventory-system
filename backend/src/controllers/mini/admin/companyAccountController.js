// 小程序管理端 · 公司账户域（Phase 8b 第 10 域，文档 §5.3）
// ===========================================================================
// 为什么这个域重要：支出 / 收入 / 库存入库 / 工资发放**全都依赖账户下拉** ——
//   账户是整个资金体系的地基，而在此之前管理员在手机上无法维护它（只能回 Web）。
//
// ⚠️ 三条硬纪律（沿用 Web 端既有语义，不放松）：
//   ① **余额不可直接编辑** —— current_balance 只能由业务单据或转账变动；
//      本域刻意**不开放** Web 的「人工调账」（adjustBalance）：它绕过业务单据直接改余额，
//      在手机上误操作的成本远高于 Web（小屏、无二次确认的习惯、易误触）。
//      需要调账时走 Web —— 这是**有意的范围决定**，不是遗漏（见交付文档）。
//   ② 名称/类型创建后不可改（Web updateAccount 同样不改这两项）：名称是唯一键、
//      类型参与统计口径，改动会让历史报表对不上。
//   ③ 删除遵循「余额为 0 且无流水」才允许物理删（Web 既有规则）；否则返回可停用提示。
//      停用走编辑接口（status=0）—— 两个动作分开，用户明确知道自己选了哪个。
//
// 转账是唯一开放的资金动作：**双边余额 + 双流水同批次号**，完整复用 Web 端
// financeAccountController.applyTransfer（单源，不重写）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { parseMiniPage, requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const financeAccountController = require('../../financeAccountController');
const { hashRequest } = require('../../../utils/requestHash');

const { ACCOUNT_TYPES, applyTransfer } = financeAccountController;

/** 账户类型下拉（含已停用的 5~7：历史账户可能仍是这些类型，编辑时不能丢） */
function accountTypes() {
  return Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value: Number(value), label }));
}

function shapeAccount(r) {
  return {
    accountId: r.account_id,
    accountName: r.account_name,
    accountType: Number(r.account_type),
    accountTypeName: ACCOUNT_TYPES[r.account_type] || '其他',
    bankName: r.bank_name || '',
    bankAccount: r.bank_account || '',
    initialBalance: Number(r.initial_balance) || 0,
    currentBalance: Number(r.current_balance) || 0,
    remark: r.remark || '',
    status: Number(r.status) === 1,
    updatedAt: r.updated_at
  };
}

// ── GET /mini/admin/accounts —— 列表 ────────────────────────────────────────
async function listAccounts(req, res) {
  const conn = await pool.getConnection();
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const parts = [];
    const params = [];
    if (req.query.status === '1' || req.query.status === '0') {
      parts.push('status = ?');
      params.push(Number(req.query.status));
    }
    if (req.query.type) {
      parts.push('account_type = ?');
      params.push(Number(req.query.type));
    }
    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      parts.push('(account_name LIKE ? OR account_id LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [cnt] = await conn.execute(`SELECT COUNT(*) AS n FROM finance_accounts ${where}`, params);
    const [rows] = await conn.execute(
      `SELECT account_id, account_name, account_type, bank_name, bank_account, initial_balance, current_balance, remark, status, created_at, updated_at FROM finance_accounts ${where} ORDER BY status DESC, account_type, created_at LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    // 启用账户余额合计 —— 手机上最常看的一个数（停用账户不计入，避免与对账口径混淆）
    const [sumRow] = await conn.execute(
      `SELECT COALESCE(SUM(current_balance), 0) AS total FROM finance_accounts
        ${where ? where + ' AND' : 'WHERE'} status = 1`,
      params
    );

    const total = Number(cnt[0].n) || 0;
    return success(res, {
      list: rows.map(shapeAccount),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      totalBalance: Math.round(Number(sumRow[0].total) * 100) / 100
    });
  } catch (e) {
    console.error('[mini/admin] 账户列表失败:', e);
    return error(res, '账户列表查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/accounts/options —— 表单选项 ────────────────────────────
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [active] = await conn.query(
      'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE status = 1 ORDER BY account_type, created_at'
    );
    return success(res, {
      types: accountTypes(),
      // 转账用：只列启用账户（停用账户转账必然被拒，列出来是自造失败）
      activeAccounts: active.map(a => ({
        accountId: a.account_id,
        accountName: a.account_name,
        currentBalance: Number(a.current_balance) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 账户选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/accounts/:id —— 详情 + 近期流水 ─────────────────────────
async function getAccountById(req, res) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      'SELECT account_id, account_name, account_type, bank_name, bank_account, initial_balance, current_balance, remark, status, created_at, updated_at FROM finance_accounts WHERE account_id = ?',
      [req.params.id]
    );
    if (!rows.length) return error(res, '账户不存在', 404);
    const [txs] = await conn.execute(
      `SELECT tx_no, tx_type, tx_category, amount, balance_before, balance_after, counterparty, handler, remark,
              DATE_FORMAT(tx_date, '%Y-%m-%d') AS tx_date, created_at
         FROM finance_transactions WHERE account_id = ?
        ORDER BY created_at DESC, tx_id DESC LIMIT 20`,
      [req.params.id]
    );
    return success(res, {
      account: shapeAccount(rows[0]),
      transactions: txs.map(t => ({
        txNo: t.tx_no,
        txType: Number(t.tx_type),
        txTypeName: { 1: '收入', 2: '支出', 3: '冻结', 4: '解冻' }[t.tx_type] || '-',
        txCategory: t.tx_category || '',
        amount: Number(t.amount) || 0,
        balanceBefore: Number(t.balance_before) || 0,
        balanceAfter: Number(t.balance_after) || 0,
        counterparty: t.counterparty || '',
        handler: t.handler || '',
        remark: t.remark || '',
        txDate: t.tx_date,
        createdAt: t.created_at
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 账户详情失败:', e);
    return error(res, '账户详情查询失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/accounts —— 新增（幂等 + 审计）─────────────────────────
async function createAccount(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const accountName = String(body.accountName || '').trim();
  const type = Number(body.accountType);
  const initial = Number(body.initialBalance) || 0;
  // 校验与 Web 端同一套规则（名称非空/类型合法/期初非负）
  if (!accountName) return error(res, '账户名称不能为空', 400);
  if (!ACCOUNT_TYPES[type]) return error(res, '无效的账户类型', 400);
  if (initial < 0) return error(res, '期初余额不能为负', 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_ACCOUNT,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ accountName, type, initial }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: claim.resultRef, replayed: true }, '该账户已创建（重复请求已合并）');
    }

    const [dup] = await conn.execute('SELECT account_id FROM finance_accounts WHERE account_name = ?', [accountName]);
    if (dup.length) {
      await conn.rollback();
      return error(res, '账户名称已存在', 400);
    }
    // ⚠️ genAccountId 未被 Web 控制器导出（导出的是 genTxId/genTxNo）—— 本地生成同构 ID：
    //    前缀 ACC + 时间戳 base36 + 随机后缀，与 Web 端前缀一致（账户 ID 格式在同一系统内要统一）
    const accountId =
      'ACC' +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 10000)
        .toString(36)
        .toUpperCase();
    await conn.execute(
      `INSERT INTO finance_accounts (account_id, account_name, account_type, bank_name, bank_account,
          initial_balance, current_balance, remark, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        accountId,
        accountName,
        type,
        body.bankName || null,
        body.bankAccount || null,
        initial,
        initial, // 期初 = 当前（余额只能由业务单据/转账变动）
        body.remark || null
      ]
    );
    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_ACCOUNT,
      key: String(body.clientRequestId),
      resultRef: accountId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_ACCOUNT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'FINANCE_ACCOUNT',
      targetId: accountId,
      detail: { accountName, accountType: type, initialBalance: initial }
    });
    await conn.commit();
    return success(res, { accountId }, '账户已创建');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 新增账户失败:', e);
    return error(res, '新增账户失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/accounts/:id —— 编辑（幂等 + 审计）──────────────────────
// ⚠️ 只改开户信息 / 备注 / 状态：**名称、类型、余额都不接受入参**
//    （名称是唯一键、类型参与统计口径；余额只能由业务单据或转账变动）
async function updateAccount(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_ACCOUNT,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        id: req.params.id,
        bankName: body.bankName || null,
        bankAccount: body.bankAccount || null,
        remark: body.remark || null,
        status: body.status
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: req.params.id, replayed: true }, '该操作已执行（重复请求已合并）');
    }

    const [exist] = await conn.execute(
      'SELECT account_id, account_name, status FROM finance_accounts WHERE account_id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!exist.length) {
      await conn.rollback();
      return error(res, '账户不存在', 404);
    }
    const status = body.status === undefined ? Number(exist[0].status) : body.status ? 1 : 0;
    await conn.execute(
      'UPDATE finance_accounts SET bank_name = ?, bank_account = ?, remark = ?, status = ?, updated_at = NOW() WHERE account_id = ?',
      [body.bankName || null, body.bankAccount || null, body.remark || null, status, req.params.id]
    );
    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_ACCOUNT,
      key: String(body.clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_ACCOUNT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'FINANCE_ACCOUNT',
      targetId: req.params.id,
      detail: {
        accountName: exist[0].account_name,
        statusBefore: Number(exist[0].status),
        statusAfter: status
      }
    });
    await conn.commit();
    return success(res, { accountId: req.params.id, status }, '已保存');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 编辑账户失败:', e);
    return error(res, '保存失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/accounts/:id —— 删除（幂等 + 审计）───────────────────
// 沿用 Web 规则：余额必须为 0 且无任何流水才能物理删；否则提示改用停用。
async function removeAccount(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_ACCOUNT,
      key: String(clientRequestId),
      requestHash: hashRequest({ id: req.params.id }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: claim.resultRef, replayed: true }, '该操作已执行（重复请求已合并）');
    }

    const [acc] = await conn.execute(
      'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!acc.length) {
      await conn.rollback();
      return error(res, '账户不存在', 404);
    }
    if (Math.abs(Number(acc[0].current_balance)) > 0.009) {
      await conn.rollback();
      return error(res, '账户余额不为 0，不能删除（可改为停用）', 400);
    }
    const [tx] = await conn.execute('SELECT COUNT(*) n FROM finance_transactions WHERE account_id = ?', [
      req.params.id
    ]);
    if (Number(tx[0].n) > 0) {
      await conn.rollback();
      return error(res, '账户存在流水记录，不能删除（可改为停用）', 400);
    }
    await conn.execute('DELETE FROM finance_accounts WHERE account_id = ?', [req.params.id]);
    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_ACCOUNT,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DELETE_ACCOUNT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'FINANCE_ACCOUNT',
      targetId: req.params.id,
      detail: { accountName: acc[0].account_name }
    });
    await conn.commit();
    return success(res, { accountId: req.params.id }, '账户已删除');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 删除账户失败:', e);
    return error(res, '删除失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/accounts/transfer —— 转账（幂等 + 审计）────────────────
async function transfer(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.TRANSFER_ACCOUNT,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ fromId: body.fromId, toId: body.toId, amount: body.amount }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { replayed: true }, '该转账已执行（重复请求已合并）');
    }

    let r;
    try {
      // 单源原语：双边余额 + 双流水同批次（与 Web 端共用，不重写）
      r = await applyTransfer(conn, {
        fromId: body.fromId,
        toId: body.toId,
        amount: body.amount,
        remark: body.remark,
        user: operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '转账失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.TRANSFER_ACCOUNT,
      key: String(body.clientRequestId),
      resultRef: r.txNo
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.TRANSFER_ACCOUNT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'FINANCE_ACCOUNT',
      targetId: r.txNo,
      detail: {
        fromId: body.fromId,
        toId: body.toId,
        amount: Number(body.amount),
        fromBalanceAfter: r.fromBalance,
        toBalanceAfter: r.toBalance
      }
    });
    await conn.commit();
    return success(res, r, '转账成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 转账失败:', e);
    return error(res, '转账失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  listAccounts,
  getFormOptions,
  getAccountById,
  createAccount,
  updateAccount,
  removeAccount,
  transfer
};

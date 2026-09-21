// 小程序管理端 · 支出/费用域（文档 §5.3「支出/费用」/ §43 Phase 8b）
// ===========================================================================
// Phase 8b 的**定式**（后续 15 个域照此办理，别各写一套 —— 逐域验收不等于逐域换风格）：
//
//   ① 路由挂 `requireMiniAdmin`，**不复用 Web 的 `requireAdmin`**。
//      文档 §22.4 把这条列为风险点：小程序令牌若与 Web 共用校验，管理员身份
//      就等于拿到整本 Web 后台。写接口再加 `requireMiniActive`（§22.5：禁用只拦写）。
//
//   ② 写接口**必须带幂等键**（§23.1）。移动端弱网重试极常见，没有幂等键时
//      一次重试就记两笔支出，而账面上看不出任何异常 —— 这正是本仓库最怕的错法。
//
//   ③ 资金动作一律调**既有账务原语**（`applyExpenseLedger` / `revertExpenseLedger`），
//      本文件只做编排，绝不自己写余额与流水（§41 头号禁止项 / §42.3）。
//      这样做还有一个副作用是好的：Web 端与小程序端的记账方向**物理上不可能分叉**。
//
//   ④ 每次写操作落审计（§40），actor 记 `mini:<accountId>`，与 Web 端操作可区分。
//
//   ⑤ 列表筛选复用 `buildExpenseListWhere`，**不另写区间语义**：
//      本仓库有「start 含 / end 不含」与「end 含」两套约定，另写一遍极可能挑错。
//
//   ⑥ 分页参数 parseInt 后内联（mysql2 不支持 `LIMIT ?`，仓库陷阱）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { MINI_PAGE, AUDIT_ACTION, IDEM_SCOPE, IDEM_KEY_MAX_LEN } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const expenseController = require('../../expenseController');
const { hashRequest } = require('../../../utils/requestHash');

// 复用 Web 端的账务原语与校验（单一来源：记账方向、回补方向、字段校验收口在此）
const { validateBody, applyExpenseLedger, revertExpenseLedger, genId, buildExpenseListWhere } = expenseController;

/** 分页（与 catalogController 同口径；mysql2 不支持 LIMIT ? → parseInt 后内联） */
function parseMiniPage(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MINI_PAGE.MAX_SIZE, Math.max(1, parseInt(query.pageSize, 10) || MINI_PAGE.DEFAULT_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 账户下拉：只列**启用**账户 —— applyExpenseLedger 会以 status=1 加锁校验，
 *  列表若含停用账户，用户选完必然报错，属自造失败。
 *  ⚠️ 刻意不复用 financeAccountController.getAccounts：那个接口返回**全部**账户
 *  （含停用）且用 `SELECT *` 取全字段，与这里的用途不同；语义上真正的约束仍在账务原语里。 */
async function listActiveAccounts(conn) {
  const [rows] = await conn.query(
    `SELECT account_id, account_name, current_balance
       FROM finance_accounts WHERE status = 1 ORDER BY account_type, created_at`
  );
  return rows.map(r => ({
    accountId: r.account_id,
    accountName: r.account_name,
    currentBalance: Number(r.current_balance) || 0
  }));
}

/** 支出类别：预置 + 历史自定义（与 Web 端同一条取数，避免两处各列一份） */
async function listCategories(conn) {
  const [rows] = await conn.query('SELECT DISTINCT category FROM other_expenses ORDER BY category');
  const custom = rows.map(r => r.category).filter(c => !expenseController.PRESET_CATEGORIES.includes(c));
  return { preset: expenseController.PRESET_CATEGORIES, custom };
}

/** 幂等键校验：缺失或超长一律 400（与订单/钱包调增同口径） */
function requireIdemKey(clientRequestId) {
  if (!clientRequestId || String(clientRequestId).length > IDEM_KEY_MAX_LEN) {
    return `缺少或非法 clientRequestId（幂等键，长度不超过 ${IDEM_KEY_MAX_LEN}）`;
  }
  return null;
}

/**
 * 业务错误出口
 * ⚠️ 账务原语抛的是 `new Error('支出账户不存在或已停用')` 这类**面向用户**的文案，
 *    白名单透传；其余一律给固定文案，**绝不把 err.message 出参**（红线：泄露表名/SQL）。
 */
function businessMessage(e, fallback) {
  const msg = String((e && e.message) || '');
  return /账户/.test(msg) ? msg : fallback;
}

// ── GET /mini/admin/expenses —— 台账列表 ─────────────────────────────────────
async function listExpenses(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const filters = buildExpenseListWhere(req.query);
    if (filters.error) return error(res, filters.error, 400);
    const where = filters.clause;
    const params = filters.params;

    const [rows] = await pool.execute(
      `SELECT expense_id, expense_name, category, amount, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
              account_id, account_name, remark, created_by, created_at
         FROM other_expenses ${where}
        ORDER BY expense_date DESC, created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM other_expenses ${where}`, params);
    const [sumRow] = await pool.execute(`SELECT ROUND(SUM(amount), 2) AS total FROM other_expenses ${where}`, params);

    return success(res, {
      list: rows.map(r => ({
        expenseId: r.expense_id,
        expenseName: r.expense_name,
        category: r.category,
        amount: Number(r.amount) || 0,
        expenseDate: r.expense_date,
        accountId: r.account_id,
        accountName: r.account_name,
        remark: r.remark,
        createdBy: r.created_by
      })),
      total: Number(cnt[0].n) || 0,
      sumAmount: Number(sumRow[0].total) || 0,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 支出列表查询失败:', e);
    return error(res, '支出列表查询失败');
  }
}

// ── GET /mini/admin/expenses/options —— 表单选项（账户 + 类别）────────────────
// ⚠️ 必须注册在 `/expenses/:id` 之类的动态段**之前**（仓库陷阱：通配会吞掉具体路径）
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [accounts, categories] = await Promise.all([listActiveAccounts(conn), listCategories(conn)]);
    return success(res, {
      accounts,
      presetCategories: categories.preset,
      customCategories: categories.custom
    });
  } catch (e) {
    console.error('[mini/admin] 支出表单选项查询失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/expenses/:id —— 单条明细（编辑页回填）────────────────────
// ⚠️ 必须注册在 `/expenses/options` **之后**（静态段前置，仓库陷阱）
async function getExpenseById(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT expense_id, expense_name, category, amount, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
              account_id, account_name, remark, created_by, created_at
         FROM other_expenses WHERE expense_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return error(res, '记录不存在', 404);
    const r = rows[0];
    return success(res, {
      expenseId: r.expense_id,
      expenseName: r.expense_name,
      category: r.category,
      amount: Number(r.amount) || 0,
      expenseDate: r.expense_date,
      accountId: r.account_id,
      accountName: r.account_name,
      remark: r.remark,
      createdBy: r.created_by
    });
  } catch (e) {
    console.error('[mini/admin] 支出明细查询失败:', e);
    return error(res, '支出明细查询失败');
  }
}

// ── POST /mini/admin/expenses —— 新增（幂等 + 审计）──────────────────────────
async function createExpense(req, res) {
  const body = req.body || {};
  const errMsg = validateBody(body);
  if (errMsg) return error(res, errMsg, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { expenseName, amount, expenseDate, category, accountId, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.CREATE_EXPENSE;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ expenseName, amount, expenseDate, category, accountId: accountId || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { expenseId: claim.resultRef, replayed: true }, '该记录已创建（重复请求已合并）');
    }

    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query(
        'SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1',
        [accountId]
      );
      if (!acc.length) {
        await conn.rollback();
        return error(res, '支出账户不存在或已停用', 400);
      }
      accountName = acc[0].account_name;
    }

    const expenseId = genId();
    await conn.query(
      `INSERT INTO other_expenses (expense_id, expense_name, category, amount, expense_date, account_id, account_name, remark, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        expenseId,
        String(expenseName).trim(),
        String(category).trim(),
        Number(amount),
        expenseDate,
        accountId || null,
        accountName,
        remark || null,
        operator
      ]
    );
    // 记账：扣账户余额 + 写流水（同一事务，失败整体回滚）
    await applyExpenseLedger(
      conn,
      {
        expense_id: expenseId,
        account_id: accountId || null,
        amount: Number(amount),
        expense_date: expenseDate,
        expense_name: String(expenseName).trim(),
        remark: remark || null
      },
      operator
    );

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: expenseId });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_EXPENSE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_EXPENSE',
      targetId: expenseId,
      detail: {
        expenseName,
        amount: Number(amount),
        expenseDate,
        category,
        accountId: accountId || null,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(res, { expenseId }, '新增成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 新增支出失败:', e);
    return error(res, businessMessage(e, '新增其他支出失败'), 500);
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/expenses/:id —— 编辑（撤销旧流水 → 改记录 → 按新值记账）──
async function updateExpense(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const errMsg = validateBody(body);
  if (errMsg) return error(res, errMsg, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { expenseName, amount, expenseDate, category, accountId, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.UPDATE_EXPENSE;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ id, expenseName, amount, expenseDate, category, accountId: accountId || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { expenseId: claim.resultRef, replayed: true }, '该修改已生效（重复请求已合并）');
    }

    const [exist] = await conn.query('SELECT expense_id FROM other_expenses WHERE expense_id = ?', [id]);
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }

    // ⚠️ 顺序不能反：先撤销旧流水回补余额，再按新值记账。
    //    若先记账再撤销，编辑后的账户余额会多出（旧值 + 新值）的差额而不报错。
    await revertExpenseLedger(conn, id);

    let accountName = null;
    if (accountId) {
      const [acc] = await conn.query(
        'SELECT account_id, account_name FROM finance_accounts WHERE account_id = ? AND status = 1',
        [accountId]
      );
      if (!acc.length) {
        await conn.rollback();
        return error(res, '支出账户不存在或已停用', 400);
      }
      accountName = acc[0].account_name;
    }

    await conn.query(
      `UPDATE other_expenses SET expense_name = ?, category = ?, amount = ?, expense_date = ?, account_id = ?, account_name = ?, remark = ?, updated_at = NOW() WHERE expense_id = ?`,
      [
        String(expenseName).trim(),
        String(category).trim(),
        Number(amount),
        expenseDate,
        accountId || null,
        accountName,
        remark || null,
        id
      ]
    );
    await applyExpenseLedger(
      conn,
      {
        expense_id: id,
        account_id: accountId || null,
        amount: Number(amount),
        expense_date: expenseDate,
        expense_name: String(expenseName).trim(),
        remark: remark || null
      },
      operator
    );

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_EXPENSE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_EXPENSE',
      targetId: id,
      detail: {
        expenseName,
        amount: Number(amount),
        expenseDate,
        category,
        accountId: accountId || null,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(res, { expenseId: id }, '修改成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 修改支出失败:', e);
    return error(res, businessMessage(e, '修改其他支出失败'), 500);
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/expenses/:id —— 删除（撤销流水回补余额 → 删记录）──────
async function deleteExpense(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  // ⚠️ DELETE 的请求体在不同客户端/网关上的支持并不一致（有的直接丢弃），
  //    故幂等键同时接受 `?clientRequestId=` —— 否则会退化成「某些环境删不了」这种难查的问题。
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.DELETE_EXPENSE;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(clientRequestId),
      requestHash: hashRequest({ id }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { expenseId: claim.resultRef, replayed: true }, '该记录已删除（重复请求已合并）');
    }

    const [exist] = await conn.query(
      'SELECT expense_id, expense_name, amount, account_id FROM other_expenses WHERE expense_id = ?',
      [id]
    );
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }

    // 撤销流水会**回补账户余额**（删支出 = 钱没花出去），与「删除收入」方向相反 —— 别抄反
    await revertExpenseLedger(conn, id);
    await conn.query('DELETE FROM other_expenses WHERE expense_id = ?', [id]);

    await walletService.completeIdempotency(conn, { scope, key: String(clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DELETE_EXPENSE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_EXPENSE',
      targetId: id,
      detail: {
        expenseName: exist[0].expense_name,
        amount: Number(exist[0].amount) || 0,
        accountId: exist[0].account_id || null
      }
    });

    await conn.commit();
    return success(res, { expenseId: id }, '删除成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 删除支出失败:', e);
    return error(res, '删除其他支出失败');
  } finally {
    conn.release();
  }
}

module.exports = { listExpenses, getFormOptions, getExpenseById, createExpense, updateExpense, deleteExpense };

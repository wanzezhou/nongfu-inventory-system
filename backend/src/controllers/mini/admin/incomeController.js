// 小程序管理端 · 收入域（文档 §5.3「收入」/ §43 Phase 8b）
// ===========================================================================
// 与 `admin/expenseController.js` 同构，定式见 `_shared.js` 与本文件头部。
//
// ⚠️⚠️ 唯一但致命的差异 —— **方向相反**，抄支出版时最容易错的就是这里：
//
//     动作            支出域                收入域
//     ─────────────  ───────────────────  ───────────────────
//     新增（记账）     账户余额 **减少**      账户余额 **增加**
//     删除（撤销记账） 账户余额 **回补 +**    账户余额 **扣回 −**
//
//   两个方向都由 Web 端原语（`applyIncomeLedger` / `revertIncomeLedger`）实现，
//   本文件**一行余额都不碰** —— 所以只要坚持「调原语、不自己写 UPDATE 余额」，
//   方向就不可能在两处之间分叉。这正是定式第 ③ 条（§41 头号禁止项）的意义。
//
// 另一处不对称（同样别抄错）：
//   · 支出**扣款**前会校验余额是否够（账务原语内 `FOR UPDATE` + 比较）；
//   · 收入**入账**不校验余额（项目铁律：只有扣款方向才校验）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { AUDIT_ACTION, IDEM_SCOPE } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const incomeController = require('../../incomeController');
const { hashRequest } = require('../../../utils/requestHash');
const { parseMiniPage, listActiveAccounts, listCategories, requireIdemKey, businessMessage } = require('./_shared');

// 复用 Web 端的账务原语与校验（单一来源：记账方向、回补方向、字段校验收口在此）
const { validateBody, applyIncomeLedger, revertIncomeLedger, genId, buildIncomeListWhere } = incomeController;

// ── GET /mini/admin/incomes —— 台账列表 ──────────────────────────────────────
async function listIncomes(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const filters = buildIncomeListWhere(req.query);
    if (filters.error) return error(res, filters.error, 400);
    const where = filters.clause;
    const params = filters.params;

    const [rows] = await pool.execute(
      `SELECT income_id, income_name, category, amount, DATE_FORMAT(income_date, '%Y-%m-%d') AS income_date,
              account_id, account_name, remark, created_by, created_at
         FROM other_incomes ${where}
        ORDER BY income_date DESC, created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM other_incomes ${where}`, params);
    const [sumRow] = await pool.execute(`SELECT ROUND(SUM(amount), 2) AS total FROM other_incomes ${where}`, params);

    return success(res, {
      list: rows.map(r => ({
        incomeId: r.income_id,
        incomeName: r.income_name,
        category: r.category,
        amount: Number(r.amount) || 0,
        incomeDate: r.income_date,
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
    console.error('[mini/admin] 收入列表查询失败:', e);
    return error(res, '收入列表查询失败');
  }
}

// ── GET /mini/admin/incomes/options —— 表单选项（账户 + 类别）────────────────
// ⚠️ 必须注册在 `/incomes/:id` 之类的动态段**之前**（仓库陷阱：通配会吞掉具体路径）
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [accounts, categories] = await Promise.all([
      listActiveAccounts(conn),
      listCategories(conn, 'income', incomeController.PRESET_CATEGORIES)
    ]);
    return success(res, {
      accounts,
      presetCategories: categories.preset,
      customCategories: categories.custom
    });
  } catch (e) {
    console.error('[mini/admin] 收入表单选项查询失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/incomes/:id —— 单条明细（编辑页回填）─────────────────────
// ⚠️ 必须注册在 `/incomes/options` **之后**（静态段前置，仓库陷阱）
async function getIncomeById(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT income_id, income_name, category, amount, DATE_FORMAT(income_date, '%Y-%m-%d') AS income_date,
              account_id, account_name, remark, created_by, created_at
         FROM other_incomes WHERE income_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return error(res, '记录不存在', 404);
    const r = rows[0];
    return success(res, {
      incomeId: r.income_id,
      incomeName: r.income_name,
      category: r.category,
      amount: Number(r.amount) || 0,
      incomeDate: r.income_date,
      accountId: r.account_id,
      accountName: r.account_name,
      remark: r.remark,
      createdBy: r.created_by
    });
  } catch (e) {
    console.error('[mini/admin] 收入明细查询失败:', e);
    return error(res, '收入明细查询失败');
  }
}

// ── POST /mini/admin/incomes —— 新增（幂等 + 审计）───────────────────────────
async function createIncome(req, res) {
  const body = req.body || {};
  const errMsg = validateBody(body);
  if (errMsg) return error(res, errMsg, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { incomeName, amount, incomeDate, category, accountId, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.CREATE_INCOME;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ incomeName, amount, incomeDate, category, accountId: accountId || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { incomeId: claim.resultRef, replayed: true }, '该记录已创建（重复请求已合并）');
    }

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

    const incomeId = genId();
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
        operator
      ]
    );
    // 记账：**增加**账户余额 + 写收入流水（同一事务，失败整体回滚）
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
      operator
    );

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: incomeId });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_INCOME,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_INCOME',
      targetId: incomeId,
      detail: {
        incomeName,
        amount: Number(amount),
        incomeDate,
        category,
        accountId: accountId || null,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(res, { incomeId }, '新增成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 新增收入失败:', e);
    return error(res, businessMessage(e, '新增其他收入失败'), 500);
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/incomes/:id —— 编辑（撤销旧流水 → 改记录 → 按新值记账）──
async function updateIncome(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const errMsg = validateBody(body);
  if (errMsg) return error(res, errMsg, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { incomeName, amount, incomeDate, category, accountId, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.UPDATE_INCOME;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ id, incomeName, amount, incomeDate, category, accountId: accountId || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { incomeId: claim.resultRef, replayed: true }, '该修改已生效（重复请求已合并）');
    }

    const [exist] = await conn.query('SELECT income_id FROM other_incomes WHERE income_id = ?', [id]);
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }

    // ⚠️ 顺序不能反：先撤销旧流水（**扣回**余额），再按新值记账（**加回**新值）。
    //    若先记账再撤销，编辑后的账户余额会多出（旧值 + 新值）的差额而不报错。
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
      operator
    );

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_INCOME,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_INCOME',
      targetId: id,
      detail: {
        incomeName,
        amount: Number(amount),
        incomeDate,
        category,
        accountId: accountId || null,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(res, { incomeId: id }, '修改成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 修改收入失败:', e);
    return error(res, businessMessage(e, '修改其他收入失败'), 500);
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/incomes/:id —— 删除（撤销流水扣回余额 → 删记录）──────
async function deleteIncome(req, res) {
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

    const scope = IDEM_SCOPE.DELETE_INCOME;
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
      return success(res, { incomeId: claim.resultRef, replayed: true }, '该记录已删除（重复请求已合并）');
    }

    const [exist] = await conn.query(
      'SELECT income_id, income_name, amount, account_id FROM other_incomes WHERE income_id = ?',
      [id]
    );
    if (!exist.length) {
      await conn.rollback();
      return error(res, '记录不存在', 404);
    }

    // ⚠️ 撤销收入会**扣回账户余额**（删收入 = 这笔钱没进来），与「删除支出」方向相反 —— 别抄反。
    //    （好消息：方向由原语决定，本文件改不了它，所以只要不改原语就不会错。）
    await revertIncomeLedger(conn, id);
    await conn.query('DELETE FROM other_incomes WHERE income_id = ?', [id]);

    await walletService.completeIdempotency(conn, { scope, key: String(clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DELETE_INCOME,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'OTHER_INCOME',
      targetId: id,
      detail: {
        incomeName: exist[0].income_name,
        amount: Number(exist[0].amount) || 0,
        accountId: exist[0].account_id || null
      }
    });

    await conn.commit();
    return success(res, { incomeId: id }, '删除成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 删除收入失败:', e);
    return error(res, '删除其他收入失败');
  } finally {
    conn.release();
  }
}

module.exports = { listIncomes, getFormOptions, getIncomeById, createIncome, updateIncome, deleteIncome };

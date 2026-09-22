// 小程序管理端 · 工资域（Phase 8b 第 11 域，文档 §5.3）
// ===========================================================================
// 为什么这个域重要：工资是**唯一「公司 → 个人」的资金动作**，也是老板在手机上最想干的事
// （月底给配送员工发钱、临时给谁记一笔预支）。在此之前这两件事只能在 Web 上做。
//
// ⚠️ 资金纪律（事务体**全部复用** Web 端原语 services/salaryLedger.js，本文件只做编排）：
//   ① 发放：实发 = 应发（可手动改，用于补加其他工资）− 待扣预支；
//      实发为负 = 预支超过应发 → **不动账户、不写流水**，挂账下月继续扣。
//   ② 撤销发放：账户 **+** 回补。支出方向的撤销就是加 ——
//      抄成减会变成「撤一次反而再扣一笔」，而恒等式看起来仍然成立（本仓库第一条铁律）。
//   ③ 预支登记**即扣账户**（公司先把钱给出去了）；发放时才把挂账抵扣掉。两件事分开。
//   ④ 已参与结算的预支**不能直接撤**（抵扣明细挂在发放单上）→ 先撤对应月份的发放。
//
// ⚠️ 刻意**不提供**的动作（有意的范围决定，不是遗漏）：
//   · 不提供「编辑发放金额」：发放单要么撤销重发、要么不动。直接改金额会让它与
//     finance_transactions 里的那条流水对不上（流水是**快照**：balance_before/after 都已定死）。
//   · 不提供「批量发放全员」：手机上一键给全员发钱，错一次就是几十个人的账要逐个撤；
//     批量发放仍走 Web（那里有确认弹窗与逐行核对）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { parseMiniPage, requireIdemKey, listActiveAccounts, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const { resolveRange, RANGE_INVALID_MSG } = require('../../../utils/dateRange');
const { loadSalarySummary, round2 } = require('../../../services/salarySummary');
const salaryLedger = require('../../../services/salaryLedger');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');

const {
  isMonth,
  calcWorkerFee,
  loadPendingAdvances,
  buildAdvanceListWhere,
  applySalaryPayment,
  revertSalaryPaymentById,
  applySalaryAdvance,
  revertSalaryAdvanceById,
  EMPLOYEE_TYPE_TEXT
} = salaryLedger;

/** 当月（手机上没有「默认月份」可猜，由服务端给一个，避免两端各自取本地时间而跨月错位） */
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 幂等指纹里的“可选值”统一成 null（undefined 进 JSON 会被丢掉，导致两侧指纹不等） */
function optional(v) {
  return v === undefined ? null : v;
}

// ── GET /mini/admin/salary/options —— 表单选项（员工 / 启用账户 / 默认月份）──
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    // 只列在职员工：离职员工原语会拒（workers.status = 1），列出来是自造失败
    const [wk] = await conn.query(
      'SELECT worker_id, worker_name, employee_type FROM workers WHERE status = 1 ORDER BY employee_type, worker_name'
    );
    return success(res, {
      month: currentMonth(),
      workers: wk.map(w => ({
        workerId: w.worker_id,
        workerName: w.worker_name,
        employeeType: Number(w.employee_type),
        employeeTypeName: EMPLOYEE_TYPE_TEXT[w.employee_type] || '其他'
      })),
      activeAccounts: await listActiveAccounts(conn)
    });
  } catch (e) {
    console.error('[mini/admin] 工资表单选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/salary/summary?month=YYYY-MM —— 月度工资汇总 ─────────────
// ⚠️ 口径复用工资统计页的**唯一来源**（services/salarySummary.loadSalarySummary）——
//    不在这里另写公式：应发/实发/待扣预支的口径一旦分叉，两边数字对不上时
//    没人能判断哪个是对的。
// ⚠️ **不下发手机号**：loadSalarySummary 会带出 w.phone（Web 统计页要用），
//    而小程序接口按文档 §八 一律脱敏 —— 故这里**逐字段显式映射**，不做整体透传。
async function getSummary(req, res) {
  try {
    const r = resolveRange(req.query);
    if (!r) return error(res, RANGE_INVALID_MSG, 400);
    const { list, summary, multiMonth } = await loadSalarySummary(r);
    return success(res, {
      month: isMonth(req.query.month) ? req.query.month : currentMonth(),
      multiMonth,
      summary,
      list: list.map(x => ({
        workerId: x.workerId,
        workerName: x.workerName,
        employeeType: x.employeeType,
        employeeTypeName: EMPLOYEE_TYPE_TEXT[x.employeeType] || '其他',
        orderCount: x.orderCount,
        totalQty: x.totalQty,
        calcFee: x.calcFee,
        // 应发 = 区间内配送费（发放时可手动调整）
        due: x.due,
        pendingAdvance: x.pendingAdvance,
        // 实发 = 应发 − 待扣预支（可为负 = 挂账下月继续扣）
        net: x.net,
        paid: x.paid,
        paidAmount: x.paidAmount,
        paidMonths: x.paidMonths,
        paidAt: x.paidAt
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 工资汇总失败:', e);
    return error(res, '工资汇总查询失败');
  }
}

// ── GET /mini/admin/salary/worker/:workerId?month= —— 发放预览（确认页数据）──
// 「按下确认之前先看清这一笔到底怎么算」：应发、待扣预支（含**逐笔**明细）、实发。
async function getWorkerPreview(req, res) {
  const { workerId } = req.params;
  const month = req.query.month;
  if (!isMonth(month)) return error(res, '月份格式应为 YYYY-MM', 400);
  const conn = await pool.getConnection();
  try {
    const [wk] = await conn.query(
      'SELECT worker_id, worker_name, employee_type FROM workers WHERE worker_id = ? AND status = 1',
      [workerId]
    );
    if (!wk.length) return error(res, '员工不存在或已离职', 404);
    const w = wk[0];
    const calcFee = await calcWorkerFee(conn, workerId, month);
    const { advances, pending } = await loadPendingAdvances(conn, workerId);
    const [pay] = await conn.query(
      'SELECT payment_id, amount, account_name, paid_at, remark FROM salary_payments WHERE worker_id = ? AND salary_month = ?',
      [workerId, month]
    );
    const rec = pay[0] || null;
    return success(res, {
      workerId: w.worker_id,
      workerName: w.worker_name,
      employeeType: Number(w.employee_type),
      employeeTypeName: EMPLOYEE_TYPE_TEXT[w.employee_type] || '其他',
      month,
      calcFee,
      // 应发**默认** = 当月配送费（页面上可改，用于补加其他工资）
      due: calcFee,
      pendingAdvance: pending,
      net: round2(calcFee - pending),
      // 待抵扣明细：让用户知道这笔钱抵掉了哪几笔预支（撤销时要按同样的顺序还原）
      pendingAdvances: advances.map(a => ({
        advanceId: a.advance_id,
        amount: Number(a.amount) || 0,
        deductedAmount: Number(a.deducted_amount) || 0,
        remaining: round2(Number(a.amount) - Number(a.deducted_amount))
      })),
      paid: !!rec,
      payment: rec
        ? {
            paymentId: rec.payment_id,
            amount: Number(rec.amount) || 0,
            accountName: rec.account_name || '',
            paidAt: rec.paid_at,
            remark: rec.remark || ''
          }
        : null
    });
  } catch (e) {
    console.error('[mini/admin] 工资预览失败:', e);
    return error(res, '发放预览查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/salary/advances —— 预支台账（筛选：员工 / 状态）─────────
async function listAdvances(req, res) {
  const conn = await pool.getConnection();
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    // 筛选构造与 Web 端共用（salaryLedger.buildAdvanceListWhere）
    const { clause, params } = buildAdvanceListWhere(req.query);
    const [cnt] = await conn.execute(`SELECT COUNT(*) AS n FROM salary_advances ${clause}`, params);
    const [rows] = await conn.execute(
      `SELECT advance_id, worker_id, worker_name, amount, DATE_FORMAT(advance_date, '%Y-%m-%d') AS advance_date,
              deducted_amount, status, remark, created_at
         FROM salary_advances ${clause}
        ORDER BY advance_date DESC, created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const total = Number(cnt[0].n) || 0;
    return success(res, {
      list: rows.map(r => ({
        advanceId: r.advance_id,
        workerId: r.worker_id,
        workerName: r.worker_name,
        amount: Number(r.amount) || 0,
        advanceDate: r.advance_date,
        deductedAmount: Number(r.deducted_amount) || 0,
        pendingAmount: round2(Number(r.amount) - Number(r.deducted_amount)),
        settled: Number(r.status) === 1,
        // 已抵扣过的不能直接撤（要先撤对应发放）—— 前端据此决定撤销按钮是否可点，
        // 但**真正的拦截在服务端**（页面的置灰只是提示）
        canRevoke: Number(r.deducted_amount) === 0,
        remark: r.remark || '',
        createdAt: r.created_at
      })),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total
    });
  } catch (e) {
    console.error('[mini/admin] 预支列表失败:', e);
    return error(res, '预支列表查询失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/salary/pay —— 发放工资（幂等 + 审计）───────────────────
async function paySalary(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);
  if (!body.workerId) return error(res, '请选择员工', 400);
  if (!isMonth(body.month)) return error(res, '发放月份格式应为 YYYY-MM', 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.PAY_SALARY,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        workerId: body.workerId,
        month: body.month,
        accountId: optional(body.accountId),
        amount: optional(body.amount)
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { paymentId: claim.resultRef, replayed: true }, '该发放已执行（重复请求已合并）');
    }

    let r;
    try {
      // 单源原语：发放单 + 预支抵扣 + 账户扣款 + 支出流水，同一事务（与 Web 端共用）
      r = await applySalaryPayment(conn, {
        workerId: body.workerId,
        month: body.month,
        accountId: body.accountId,
        amount: body.amount,
        remark: body.remark,
        user: operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '工资发放失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.PAY_SALARY,
      key: String(body.clientRequestId),
      resultRef: r.paymentId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.PAY_SALARY,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'SALARY_PAYMENT',
      targetId: r.paymentId,
      detail: {
        workerId: body.workerId,
        month: body.month,
        due: r.due,
        pendingAdvance: r.pendingAdvance,
        // 实发（可为负 = 挂账）；负数时没有账户动作，故一并记下 accountId 是否为空
        net: r.amount,
        accountId: optional(body.accountId)
      }
    });
    await conn.commit();
    return success(res, r, '工资发放成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 工资发放失败:', e);
    return error(res, '工资发放失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/salary/payments/:id —— 撤销发放（幂等 + 审计）─────────
async function revokePayment(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.REVOKE_SALARY_PAYMENT,
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
      return success(res, { replayed: true }, '该操作已执行（重复请求已合并）');
    }

    try {
      await revertSalaryPaymentById(conn, req.params.id);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '撤销发放失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.REVOKE_SALARY_PAYMENT,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.REVOKE_SALARY_PAYMENT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'SALARY_PAYMENT',
      targetId: req.params.id,
      detail: { note: '撤销发放：账户回补 + 流水删除 + 预支抵扣反向还原' }
    });
    await conn.commit();
    return success(res, null, '已撤销发放，账户余额与预支已还原');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 撤销发放失败:', e);
    return error(res, '撤销发放失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/salary/advances —— 预支登记（幂等 + 审计）──────────────
async function createAdvance(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);
  if (!body.workerId) return error(res, '请选择员工', 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_SALARY_ADVANCE,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        workerId: body.workerId,
        amount: optional(body.amount),
        advanceDate: optional(body.advanceDate),
        accountId: optional(body.accountId)
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { advanceId: claim.resultRef, replayed: true }, '该预支已登记（重复请求已合并）');
    }

    let r;
    try {
      r = await applySalaryAdvance(conn, {
        workerId: body.workerId,
        amount: body.amount,
        advanceDate: body.advanceDate,
        accountId: body.accountId,
        remark: body.remark,
        user: operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '预支登记失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_SALARY_ADVANCE,
      key: String(body.clientRequestId),
      resultRef: r.advanceId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_SALARY_ADVANCE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'SALARY_ADVANCE',
      targetId: r.advanceId,
      detail: {
        workerId: body.workerId,
        amount: r.amount,
        advanceDate: body.advanceDate,
        accountId: optional(body.accountId)
      }
    });
    await conn.commit();
    return success(res, r, '预支登记成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 预支登记失败:', e);
    return error(res, '预支登记失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/salary/advances/:id —— 撤销预支（幂等 + 审计）────────
async function removeAdvance(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_SALARY_ADVANCE,
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
      return success(res, { replayed: true }, '该操作已执行（重复请求已合并）');
    }

    try {
      await revertSalaryAdvanceById(conn, req.params.id);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '撤销预支失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_SALARY_ADVANCE,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DELETE_SALARY_ADVANCE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'SALARY_ADVANCE',
      targetId: req.params.id,
      detail: { note: '撤销预支：账户回补 + 流水删除（仅未参与结算的预支可撤）' }
    });
    await conn.commit();
    return success(res, null, '已撤销预支，账户余额已回补');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 撤销预支失败:', e);
    return error(res, '撤销预支失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  getFormOptions,
  getSummary,
  getWorkerPreview,
  listAdvances,
  paySalary,
  revokePayment,
  createAdvance,
  removeAdvance
};

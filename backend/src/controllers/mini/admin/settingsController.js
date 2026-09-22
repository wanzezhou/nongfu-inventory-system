// 小程序管理端 · 系统设置域（Phase 8b 第 17 域，文档 §5.3）
// ===========================================================================
// 当前系统设置只有一项：**销售单打印使用的店长**（`system_settings.print_manager_worker_id`）。
// 业务口径（2026-09-16 确认）：**所有订单类型都打印同一位店长的电话**，
// 与订单类型 / 水站 / 机台无关；配置为空或指向的员工已不存在时，回退为「第一位启用的店长」。
//
// ⚠️ 为什么这一项值得放到手机上：**打印出来的联系电话是给客户回拨的** —— 配错了
//    要等到客户打不通才会被发现。管理员换人后应当能立刻改掉，而不是回电脑前。
//
// ⚠️ 校验与写入**都在服务层**（`services/systemSettings.setPrintManager`，Web 与小程序共用）：
//    「员工必须存在且在职」这条规则只能有一份实现 —— 否则会出现
//    「Web 允许设离职员工、小程序不允许」这类两端不一致。
//
// ⚠️ **不下发明文手机号**（文档 §八）：服务层 resolvePrintManager 会带出 phone（打印要用），
//    小程序侧一律脱敏后再下发 —— 管理员凭「姓名 + 尾号」足以确认选对了人。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const { resolvePrintManager, setPrintManager } = require('../../../services/systemSettings');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');

/** 手机号脱敏：只留前 3 后 4（服务端下发，前端不再各写一份） */
function maskPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s ? '***' : '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 统一形状：脱敏 + 来源中文名（页面直接用，不再维护一份映射） */
function shapeManager(m) {
  return {
    workerId: m.workerId,
    workerName: m.workerName,
    phoneMasked: maskPhone(m.phone),
    workerStatus: m.workerStatus,
    source: m.source,
    sourceLabel:
      { setting: '按配置', fallback: '回退为第一位在职店长', none: '系统内没有在职店长' }[m.source] || m.source
  };
}

// ── GET /mini/admin/settings/options —— 可选店长（在职员工）──────────────
// 打印店长按业务口径就是「店长」，故只列 employee_type = 1 且在职的员工；
// 但仍允许选择其他在职员工（历史配置可能指向前店长/管理员），故一并下发 activeWorkers。
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [managers] = await conn.query(
      'SELECT worker_id, worker_name, phone, employee_type FROM workers WHERE employee_type = 1 AND status = 1 ORDER BY worker_name'
    );
    const [allActive] = await conn.query(
      'SELECT worker_id, worker_name, phone, employee_type FROM workers WHERE status = 1 ORDER BY worker_name'
    );
    const shape = w => ({
      workerId: w.worker_id,
      workerName: w.worker_name,
      phoneMasked: maskPhone(w.phone),
      employeeType: Number(w.employee_type)
    });
    const current = await resolvePrintManager();
    return success(res, {
      // 首选：在职店长；若当前配置指向的是非店长（如管理员），页面需要能显示这个人
      storeManagers: managers.map(shape),
      activeWorkers: allActive.map(shape),
      current: shapeManager(current)
    });
  } catch (e) {
    console.error('[mini/admin] 系统设置选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/settings/print-manager —— 当前打印店长 ─────────────────
async function getPrintManager(req, res) {
  try {
    return success(res, shapeManager(await resolvePrintManager()));
  } catch (e) {
    console.error('[mini/admin] 读取打印店长失败:', e);
    return error(res, '读取打印店长配置失败');
  }
}

// ── PUT /mini/admin/settings/print-manager —— 设置（幂等 + 审计）────────────
// ⚠️ 传 workerId = null 表示**清空**（回退为第一位在职店长）——这是有意义的操作，
//    故与「不传 workerId」区分：后者一律 400（少传字段与「我要清空」是两件事）。
async function updatePrintManager(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const raw = body.workerId === undefined ? (body.worker_id === undefined ? undefined : body.worker_id) : body.workerId;
  if (raw === undefined) return error(res, '缺少 workerId（清空请显式传 null）', 400);
  const cleared = raw === null || raw === '';

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_SETTING,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ setting: 'print_manager_worker_id', workerId: cleared ? null : String(raw) }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { replayed: true }, '该设置已保存（重复请求已合并）');
    }

    const before = await resolvePrintManager();
    let after;
    try {
      // 校验（存在 + 在职）与写入都在服务层，两端同一套规则
      after = await setPrintManager(cleared ? null : String(raw), conn);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '保存打印店长失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_SETTING,
      key: String(body.clientRequestId),
      resultRef: cleared ? 'CLEARED' : String(after.workerId)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_SETTING,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'SYSTEM_SETTING',
      targetId: 'print_manager_worker_id',
      detail: {
        beforeWorkerId: before.workerId,
        beforeWorkerName: before.workerName,
        afterWorkerId: after.workerId,
        afterWorkerName: after.workerName,
        cleared
      }
    });
    await conn.commit();
    return success(res, shapeManager(after), cleared ? '已清除设置，回退为第一位在职店长' : '销售单打印店长已更新');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 保存打印店长失败:', e);
    return error(res, '保存打印店长配置失败');
  } finally {
    conn.release();
  }
}

module.exports = { getFormOptions, getPrintManager, updatePrintManager };

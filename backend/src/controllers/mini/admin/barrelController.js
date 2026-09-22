// 小程序管理端 · 回桶域（Phase 8b 第 16 域，文档 §5.3）
// ===========================================================================
// 本域两件事：**押金台账**（收/退押金，资金动作）与**桶型配置**（押金单价）。
//
// ⚠️ 资金纪律：押金收取 = 账户 **+**、押金退回 = 账户 **−**（与服务端原语一致，
//    这里不写任何记账语句 —— 全部走 `services/barrelService`，两端物理上同一段实现）。
//    ⚠️ 本域**没有**「编辑/删除押金流水」：押金是一笔已经发生的收付，
//       记错了要开一笔反向流水（退回/再收），不能改历史 —— 与入库单只能作废是同一原则。
//    （原生 SQL 直删押金会绕过账户回冲，scripts/smokeCleanup 里对订单已有同类保护。）
//
// ⚠️ 桶型配置是**跨端联动**的配置类数据：押金登记时会校验「桶型存在且已启用」——
//    所以「改价/停用/删除」的效果必须在**下游**（押金登记）被断言到，不能只验配置接口本身
//    回了对（定式 ⑫）。冒烟第 19 节对此有专门断言。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { parseMiniPage, requireIdemKey, listActiveAccounts, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const barrelService = require('../../../services/barrelService');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');

/** 押金类型（与 barrelService 的 DEPOSIT_TYPES 对应；此处只做展示与入参白名单） */
const DEPOSIT_TYPES = { COLLECT: 'collect', RETURN: 'return' };
const DEPOSIT_TYPE_LABEL = { collect: '收取押金', return: '退回押金' };

const optional = v => (v === undefined ? null : v);

// ── GET /mini/admin/barrels/options —— 登记表单选项 ─────────────────────────
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    // 桶型：只列启用（登记时服务端会校验启用状态，列停用的等于自造失败）
    const configs = await barrelService.listConfigs(conn);
    const activeConfigs = configs.filter(c => Number(c.status) === 1);
    // 水站：只列启用
    const [stations] = await conn.query(
      'SELECT station_id, station_name FROM sub_stations WHERE status = 1 ORDER BY station_name'
    );
    return success(res, {
      depositTypes: Object.keys(DEPOSIT_TYPE_LABEL).map(k => ({ value: k, label: DEPOSIT_TYPE_LABEL[k] })),
      barrelTypes: activeConfigs.map(c => ({
        id: c.id,
        barrelType: c.barrelType,
        depositPrice: Number(c.depositPrice) || 0
      })),
      stations: stations.map(s => ({ stationId: s.station_id, stationName: s.station_name })),
      activeAccounts: await listActiveAccounts(conn)
    });
  } catch (e) {
    console.error('[mini/admin] 回桶表单选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/barrels/summary —— 押金在押汇总 ─────────────────────────
// ⚠️ **逐字段显式映射**，不整体透传：服务层的 partyName 对零售客户会拼成
//    「姓名（手机号）」—— 那是打印/Web 台账要用的完整信息，而小程序接口按文档 §八
//    一律不下发明文手机号。这里重建名称、丢掉 phone 字段。
async function getSummary(req, res) {
  try {
    const { partyType, stationId, customerName, barrelType } = req.query;
    const list = await barrelService.getSummary({ partyType, stationId, customerName, barrelType });
    return success(res, {
      list: list.map(s => ({
        partyType: s.partyType,
        partyName:
          s.partyType === 'customer' ? s.customerName || '零售客户' : s.stationName || s.stationId || '（未知水站）',
        barrelType: s.barrelType,
        pendingQty: Number(s.pendingQty) || 0,
        pendingAmount: Math.round((Number(s.pendingAmount) || 0) * 100) / 100,
        unitPrice: Number(s.unitPrice) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 押金汇总失败:', e);
    return error(res, '押金汇总查询失败');
  }
}

// ── GET /mini/admin/barrels/deposits —— 押金流水（分页 + 筛选）──────────────
async function listDeposits(req, res) {
  try {
    const { page, pageSize } = parseMiniPage(req.query);
    const data = await barrelService.getDepositList({
      page,
      pageSize,
      partyType: req.query.partyType,
      stationId: req.query.stationId,
      customerName: req.query.customerName,
      barrelType: req.query.barrelType,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });
    // ⚠️ 同样逐字段映射（服务层的 partyName 内嵌手机号，且带 customerPhone 字段）
    const list = (data.list || []).map(d => ({
      id: d.id,
      depositNo: d.depositNo,
      partyType: d.partyType,
      partyName:
        d.partyType === 'customer' ? d.customerName || '零售客户' : d.stationName || d.stationId || '（未知水站）',
      barrelType: d.barrelType,
      quantity: Number(d.quantity) || 0,
      unitPrice: Number(d.unitPrice) || 0,
      amount: Math.round((Number(d.amount) || 0) * 100) / 100,
      depositType: d.depositType,
      depositTypeLabel: DEPOSIT_TYPE_LABEL[d.depositType] || d.depositType,
      accountName: d.accountName || '',
      remark: d.remark || '',
      createdAt: d.createdAt
    }));
    const total = Number(data.total) || 0;
    return success(res, { list, total, page, pageSize, hasMore: page * pageSize < total });
  } catch (e) {
    console.error('[mini/admin] 押金流水失败:', e);
    return error(res, '押金流水查询失败');
  }
}

// ── GET /mini/admin/barrels/configs —— 桶型配置（含停用，供管理）────────────
async function listConfigs(req, res) {
  const conn = await pool.getConnection();
  try {
    const list = await barrelService.listConfigs(conn);
    return success(res, {
      list: list.map(c => ({
        id: c.id,
        barrelType: c.barrelType,
        depositPrice: Number(c.depositPrice) || 0,
        status: Number(c.status) === 1,
        sortOrder: Number(c.sortOrder) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 桶型配置失败:', e);
    return error(res, '桶型配置查询失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/barrels/deposits —— 押金登记（资金动作，幂等 + 审计）────
async function createDeposit(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);
  if (!body.accountId) return error(res, '请选择资金账户', 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_BARREL_DEPOSIT,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        depositType: optional(body.depositType),
        partyType: optional(body.partyType),
        stationId: optional(body.stationId),
        customerName: optional(body.customerName),
        barrelType: optional(body.barrelType),
        quantity: optional(body.quantity),
        unitPrice: optional(body.unitPrice),
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
      return success(res, { depositNo: claim.resultRef, replayed: true }, '该押金已登记（重复请求已合并）');
    }

    let r;
    try {
      // 单源原语：账户变动 + 流水 + 押金记录，同一事务（与 Web 端共用）
      r = await barrelService.createDeposit(conn, {
        depositType: body.depositType,
        partyType: body.partyType || 'station',
        stationId: body.stationId,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        barrelType: body.barrelType,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        accountId: body.accountId,
        remark: body.remark,
        operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '押金登记失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_BARREL_DEPOSIT,
      key: String(body.clientRequestId),
      resultRef: r.depositNo
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_BARREL_DEPOSIT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'BARREL_DEPOSIT',
      targetId: r.depositNo,
      detail: {
        depositType: r.depositType,
        partyType: body.partyType || 'station',
        barrelType: body.barrelType,
        quantity: Number(body.quantity) || 0,
        amount: r.amount,
        accountId: body.accountId
      }
    });
    await conn.commit();
    return success(res, r, r.message);
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 押金登记失败:', e);
    return error(res, '押金登记失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/barrels/configs —— 新增桶型（幂等 + 审计）──────────────
async function createConfig(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_BARREL_CONFIG,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        barrelType: optional(body.barrelType),
        depositPrice: optional(body.depositPrice),
        sortOrder: optional(body.sortOrder)
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { id: claim.resultRef, replayed: true }, '该桶型已存在（重复请求已合并）');
    }

    let r;
    try {
      r = await barrelService.createConfig(conn, {
        barrelType: body.barrelType,
        depositPrice: body.depositPrice,
        sortOrder: body.sortOrder
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '新增桶型失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CREATE_BARREL_CONFIG,
      key: String(body.clientRequestId),
      resultRef: String(r.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_BARREL_CONFIG,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'BARREL_CONFIG',
      targetId: String(r.id),
      detail: { barrelType: r.barrelType, depositPrice: r.depositPrice }
    });
    await conn.commit();
    return success(res, r, '新增成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 新增桶型失败:', e);
    return error(res, '新增失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/barrels/configs/:id —— 改价 / 停启用（幂等 + 审计）──────
async function updateConfig(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_BARREL_CONFIG,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        id: req.params.id,
        barrelType: optional(body.barrelType),
        depositPrice: optional(body.depositPrice),
        status: optional(body.status),
        sortOrder: optional(body.sortOrder)
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { id: req.params.id, replayed: true }, '该操作已执行（重复请求已合并）');
    }

    let r;
    try {
      r = await barrelService.updateConfig(conn, req.params.id, {
        barrelType: body.barrelType,
        depositPrice: body.depositPrice,
        status: body.status,
        sortOrder: body.sortOrder
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '保存桶型失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_BARREL_CONFIG,
      key: String(body.clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_BARREL_CONFIG,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'BARREL_CONFIG',
      targetId: String(req.params.id),
      detail: { depositPrice: r.depositPrice, status: r.status, barrelType: body.barrelType }
    });
    await conn.commit();
    return success(res, r, '已保存');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 保存桶型失败:', e);
    return error(res, '保存失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/barrels/configs/:id —— 删除桶型（幂等 + 审计）────────
async function removeConfig(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_BARREL_CONFIG,
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

    let r;
    try {
      r = await barrelService.deleteConfig(conn, req.params.id);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '删除桶型失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.DELETE_BARREL_CONFIG,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DELETE_BARREL_CONFIG,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'BARREL_CONFIG',
      targetId: String(req.params.id),
      detail: { barrelType: r.barrelType }
    });
    await conn.commit();
    return success(res, r, '删除成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 删除桶型失败:', e);
    return error(res, '删除失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  getFormOptions,
  getSummary,
  listDeposits,
  listConfigs,
  createDeposit,
  createConfig,
  updateConfig,
  removeConfig,
  DEPOSIT_TYPES
};

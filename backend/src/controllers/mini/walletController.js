// 小程序积分钱包（文档 §11 / §14 / §18 / §21.5 / §21.8 / §33）
// ===========================================================================
// ⚠️ 权限口径（§22.3）：水站/业务员**只能**读自己的钱包、消费自己的钱包、看自己的流水。
//    因此所有钱包 ID 都从令牌推导，**不接受请求体传入 walletId**（管理员端除外，见 §21.8）。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const walletService = require('../../services/walletService');
const walletSummary = require('../../services/walletSummary');
const {
  ROLE_TO_OWNER_TYPE,
  WALLET_OWNER_TYPE,
  WALLET_TX_TYPE,
  TX_DIRECTION,
  IDEM_SCOPE,
  IDEM_KEY_MAX_LEN,
  AUDIT_ACTION,
  MINI_MESSAGE
} = require('../../constants/mini');

function handleError(res, err, fallback) {
  if (err && err.business) {
    // hazard-allow: bizFail 业务校验文案（设计输出，与 orderController 同一约定）
    return error(res, err.message, err.httpStatus || 400);
  }
  console.error(`[mini/wallet] ${fallback}:`, err);
  return error(res, fallback);
}

/** 取当前登录者的钱包（不存在则按主体开立 —— 钱包跟随主体，不跟随 openid，§4.6.1） */
async function resolveMyWallet(conn, mini) {
  const ownerType = ROLE_TO_OWNER_TYPE[mini.role];
  if (!ownerType) throw walletService.businessError('当前身份没有积分钱包');

  const existing = await walletService.findWallet(conn, ownerType, mini.targetId);
  if (existing) return existing;

  let ownerName = null;
  if (ownerType === WALLET_OWNER_TYPE.STATION) {
    const [rows] = await conn.execute('SELECT station_name FROM sub_stations WHERE station_id = ?', [mini.targetId]);
    ownerName = rows.length ? rows[0].station_name : null;
  } else {
    const [rows] = await conn.execute('SELECT worker_name FROM workers WHERE worker_id = ?', [mini.targetId]);
    ownerName = rows.length ? rows[0].worker_name : null;
  }
  return walletService.ensureWallet(conn, { ownerType, ownerId: mini.targetId, ownerName });
}

/**
 * GET /api/mini/wallet —— 我的积分
 * §33：当前积分 ≈ 当前可用订货额度；直营水站额外展示分销配送费积分（由 byType 提供）
 */
async function getWallet(req, res) {
  const conn = await pool.getConnection();
  try {
    const wallet = await resolveMyWallet(conn, req.mini);
    const overview = await walletSummary.getWalletOverview(conn, wallet.wallet_id);
    return success(res, {
      ...overview,
      /** 1 元 = 1 积分（§3.3）：直接给出等值人民币便于展示 */
      equivalentRmb: overview.balance,
      tips: {
        exchangeRate: '1 元 = 1 积分',
        usage: '积分是公司的内部订货预存额度，不是微信零钱，也不能在用户之间转移（§3.3）',
        wechatPayNotOpen: MINI_MESSAGE.WECHAT_PAY_NOT_OPEN
      }
    });
  } catch (err) {
    return handleError(res, err, '获取积分钱包失败');
  } finally {
    conn.release();
  }
}

/** GET /api/mini/wallet/transactions —— 我的积分流水 */
async function getTransactions(req, res) {
  const conn = await pool.getConnection();
  try {
    const wallet = await resolveMyWallet(conn, req.mini);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const type = req.query.type || req.query.transactionType || null;

    if (type && !Object.values(WALLET_TX_TYPE).includes(String(type).toUpperCase())) {
      return error(res, '流水类型无效', 400);
    }

    const result = await walletSummary.listWalletTransactions(conn, {
      walletId: wallet.wallet_id,
      transactionType: type ? String(type).toUpperCase() : null,
      page,
      size: pageSize
    });

    return pagination(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) {
    return handleError(res, err, '获取积分流水失败');
  } finally {
    conn.release();
  }
}

/**
 * POST /api/mini/wallet/recharge —— 微信充值（文档 §13）
 *
 * ⚠️ 本端点属 **Phase 6**，本次交付范围（Phase 1~5 + 8a）**不含**，
 *    因此按 §13.8「资质未就绪时的降级路径」返回明确文案，而不是返回假数据或静默成功：
 *      「资质就绪前：钱包正向入账来源 = 管理员手工调增积分（§18）+ 水票发行分销配送费（§12）
 *        → 业务员/水站订单链路、钱包扣减、退款、对账 均可端到端开发与验证；
 *        → 仅「微信充值」这一期（Phase 6）挂起」
 *    §13.8 同时明确：降级期间**不要造假数据**（不得写测试用的"已充值"流水进生产库）。
 *
 *    因此这里既不写流水、也不返回伪成功，只返回「未开通」+ 替代路径指引。
 */
async function recharge(req, res) {
  try {
    return error(res, MINI_MESSAGE.WECHAT_PAY_NOT_OPEN, 503);
  } catch (err) {
    return handleError(res, err, '充值失败');
  }
}

// ── 管理员端（§18 / §21.8 / Phase 5 + 8a）────────────────────────────────────
/** GET /api/mini/wallet/admin/overview —— 全部钱包总览 */
async function adminOverview(req, res) {
  const conn = await pool.getConnection();
  try {
    const ownerType = req.query.ownerType ? String(req.query.ownerType).toUpperCase() : null;
    if (ownerType && !Object.values(WALLET_OWNER_TYPE).includes(ownerType)) {
      return error(res, '主体类型无效', 400);
    }
    const data = await walletSummary.listWalletsForAdmin(conn, { ownerType });
    const totals = await walletSummary.sumBalanceByOwnerType(conn);
    return success(res, { ...data, totals });
  } catch (err) {
    console.error('[mini/wallet] 钱包总览失败:', err);
    return error(res, '获取钱包总览失败');
  } finally {
    conn.release();
  }
}

/** GET /api/mini/wallet/admin/:walletId/transactions —— 指定钱包流水 */
async function adminWalletTransactions(req, res) {
  const conn = await pool.getConnection();
  try {
    const walletId = req.params.walletId;
    const wallet = await walletService.findWalletById(conn, walletId);
    if (!wallet) return error(res, '积分钱包不存在', 404);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const type = req.query.type ? String(req.query.type).toUpperCase() : null;
    if (type && !Object.values(WALLET_TX_TYPE).includes(type)) {
      return error(res, '流水类型无效', 400);
    }

    // 单源：与小程序端、对账页共用同一取数实现（§53）
    const overview = await walletSummary.getWalletOverview(conn, walletId);
    const result = await walletSummary.listWalletTransactions(conn, {
      walletId,
      transactionType: type,
      page,
      size: pageSize
    });
    const reconciliation = await walletSummary.reconcileWallet(conn, {
      walletId,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    });

    return success(res, {
      wallet: overview,
      transactions: result.list,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      reconciliation
    });
  } catch (err) {
    console.error('[mini/wallet] 钱包流水失败:', err);
    return error(res, '获取钱包流水失败');
  } finally {
    conn.release();
  }
}

/**
 * POST /api/mini/wallet/admin/adjust —— 管理员手工增减积分（§18 / Phase 5）
 *
 * ⚠️ §18 硬要求：必须强制填写「操作原因 / 备注 / 操作人 / 操作时间」并生成独立流水。
 *    其中「操作时间」由数据库 NOW() 落库，「操作人」取令牌（不接受请求体传入，
 *    §22.2：不得由客户端决定操作人）。
 *
 * ⚠️ 幂等（§45「管理员重复点击增加积分/减少积分」必测项）：
 *    要求客户端传 clientRequestId，同键重复提交只生效一次、第二次返回首次结果。
 */
async function adminAdjust(req, res) {
  const body = req.body || {};
  const walletId = body.walletId;
  const direction = String(body.direction || '').toUpperCase();
  const amount = Number(body.amount);
  const reason = (body.reason || '').trim();
  const remark = (body.remark || '').trim();
  const clientRequestId = body.clientRequestId;

  if (!walletId) return error(res, '缺少 walletId', 400);
  if (direction !== 'IN' && direction !== 'OUT') {
    return error(res, 'direction 只能是 IN（增加）或 OUT（扣减）', 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) return error(res, '积分数量必须为正数', 400);
  if (!reason) return error(res, '必须填写操作原因（文档 §18）', 400);
  if (!clientRequestId || String(clientRequestId).length > IDEM_KEY_MAX_LEN) {
    return error(res, `缺少或非法 clientRequestId（幂等键，长度不超过 ${IDEM_KEY_MAX_LEN}）`, 400);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const wallet = await walletService.findWalletById(conn, walletId);
    if (!wallet) {
      await conn.rollback();
      return error(res, '积分钱包不存在', 404);
    }

    const idemScope = `${IDEM_SCOPE.WALLET_ADJUST}:${walletId}`;
    const claim = await walletService.claimIdempotency(conn, {
      scope: idemScope,
      key: String(clientRequestId),
      requestHash: `${direction}:${amount}:${reason}`,
      miniAccountId: req.mini.accountId
    });

    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(
        res,
        { walletId, transactionNo: claim.resultRef, replayed: true },
        '该操作已处理（重复请求已合并）'
      );
    }

    // ⚠️ 按方向选择加锁方式：
    //    增加积分是收入方向 → 允许停用钱包（撤销类同理，§11.7 第 4 条）；
    //    扣减积分是支出方向 → 必须校验钱包启用 + 余额充足。
    const walletRow =
      direction === 'IN'
        ? await walletService.loadWalletForUpdateIncludingDisabled(conn, walletId)
        : await walletService.loadWalletForUpdate(conn, walletId);

    const tx = await walletService.applyTransaction(conn, walletRow, {
      txType: direction === 'IN' ? WALLET_TX_TYPE.ADJUST_IN : WALLET_TX_TYPE.ADJUST_OUT,
      amount,
      direction: direction === 'IN' ? TX_DIRECTION.IN : TX_DIRECTION.OUT,
      relatedType: 'MANUAL_ADJUST',
      relatedId: null,
      operatorId: `mini:${req.mini.accountId}`,
      operatorRole: req.mini.role,
      // 操作原因必填（§18）；备注可空
      remark: remark ? `${reason}｜${remark}` : reason
    });

    await walletService.completeIdempotency(conn, {
      scope: idemScope,
      key: String(clientRequestId),
      resultRef: tx.transaction_no
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.WALLET_ADJUST,
      actorType: 'MINI',
      actorId: `mini:${req.mini.accountId}`,
      targetType: 'WALLET',
      targetId: walletId,
      detail: { direction, amount, reason, remark, transactionNo: tx.transaction_no }
    });

    await conn.commit();

    const after = await walletStrategyAfter(conn, walletId);
    return success(
      res,
      {
        walletId,
        transactionNo: tx.transaction_no,
        direction,
        amount,
        balanceBefore: tx.balance_before,
        balanceAfter: tx.balance_after,
        wallet: after
      },
      direction === 'IN' ? '积分已增加' : '积分已扣减'
    );
  } catch (err) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[mini/wallet] 调整回滚失败:', re);
    }
    return handleError(res, err, '调整积分失败，请稍后重试');
  } finally {
    conn.release();
  }
}

/** 事务提交后重新读一次钱包概览，让前端拿到权威余额 */
async function walletStrategyAfter(conn, walletId) {
  return walletSummary.getWalletOverview(conn, walletId);
}

module.exports = {
  getWallet,
  getTransactions,
  recharge,
  adminOverview,
  adminWalletTransactions,
  adminAdjust
};

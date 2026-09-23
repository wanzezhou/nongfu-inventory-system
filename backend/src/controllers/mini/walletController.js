// 小程序积分钱包（文档 §11 / §14 / §18 / §21.5 / §21.8 / §33）
// ===========================================================================
// ⚠️ 权限口径（§22.3）：水站/业务员**只能**读自己的钱包、消费自己的钱包、看自己的流水。
//    因此所有钱包 ID 都从令牌推导，**不接受请求体传入 walletId**（管理员端除外，见 §21.8）。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const walletService = require('../../services/walletService');
const walletSummary = require('../../services/walletSummary');
// ★ 2026-09-23：「调整积分」的业务规则抽到共享服务，Web 管理端与本控制器共用同一份
//   （见 services/walletAdminService.js 顶部说明）。本文件只留事务边界与响应外形。
const walletAdminService = require('../../services/walletAdminService');
const {
  ROLE_TO_OWNER_TYPE,
  WALLET_OWNER_TYPE,
  WALLET_TX_TYPE,
  POINTS_TYPE_VALUES,
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
    // ★ 双积分（2026-09-23）：配送费积分**按月发放明细**（业务要求「能看每月发了多少」）
    const deliveryFeeMonthly = await walletSummary.getDeliveryFeeMonthly(conn, wallet.wallet_id);
    return success(res, {
      ...overview,
      deliveryFeeMonthly,
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
    // ★ 双积分：可按积分类型筛选（「只看充值积分 / 只看配送费积分」）
    const pointsType = req.query.pointsType ? String(req.query.pointsType).toUpperCase() : null;

    if (type && !Object.values(WALLET_TX_TYPE).includes(String(type).toUpperCase())) {
      return error(res, '流水类型无效', 400);
    }
    if (pointsType && !POINTS_TYPE_VALUES.includes(pointsType)) {
      return error(res, `积分类型只能是 ${POINTS_TYPE_VALUES.join(' 或 ')}`, 400);
    }

    const result = await walletSummary.listWalletTransactions(conn, {
      walletId: wallet.wallet_id,
      transactionType: type ? String(type).toUpperCase() : null,
      pointsType,
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

// ⚠️ 在线充值（微信支付 / Phase 6）**已按业务要求整体下线**（2026-09-23）：
//    本控制器不再提供 recharge，路由 POST /wallet/recharge 同步删除，
//    小程序页 pages/wallet-recharge 也已移除。
//    充值积分改由管理员在后台设置（POST /wallet/admin/adjust，默认积分类型 RECHARGE）。
//    保留这段说明是为了让后来者知道这里**曾经有**、以及为什么没有 —— 避免被「顺手补上」。

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
    // ★ 双积分：可按积分类型筛选
    const pointsType = req.query.pointsType ? String(req.query.pointsType).toUpperCase() : null;
    if (pointsType && !POINTS_TYPE_VALUES.includes(pointsType)) {
      return error(res, `积分类型只能是 ${POINTS_TYPE_VALUES.join(' 或 ')}`, 400);
    }

    // 单源：与小程序端、对账页共用同一取数实现（§53）
    const overview = await walletSummary.getWalletOverview(conn, walletId);
    // ★ 双积分：配送费积分的按月发放明细（管理员对账时看「这个水站每月收了多少」）
    const deliveryFeeMonthly = await walletSummary.getDeliveryFeeMonthly(conn, walletId);
    const result = await walletSummary.listWalletTransactions(conn, {
      walletId,
      transactionType: type,
      pointsType,
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
      deliveryFeeMonthly,
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
 *
 * ★ 2026-09-23：**核心逻辑已抽到 services/walletAdminService**（Web 管理端与小程序
 *   管理端共用同一份）。这里只负责「事务边界」与「响应外形」—— 两端唯一的差别就是
 *   这两件事（操作人身份取令牌、响应字段命名），业务规则不再有第二份实现。
 */
async function adminAdjust(req, res) {
  // 入参规范化在**事务外**（非法入参不该占用行锁）：抛 bizFail → 统一 400
  let input;
  try {
    input = walletAdminService.normalizeAdjustInput(req.body || {});
  } catch (err) {
    return handleError(res, err, '调整积分失败，请稍后重试');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const result = await walletAdminService.applyAdjust(conn, input, {
      scope: walletAdminService.buildIdemScope('MINI', input.walletId),
      actorType: 'MINI',
      actorId: `mini:${req.mini.accountId}`,
      operatorId: `mini:${req.mini.accountId}`,
      operatorRole: req.mini.role,
      miniAccountId: req.mini.accountId
    });

    if (result.replayed) {
      await conn.rollback();
      return success(
        res,
        { walletId: input.walletId, transactionNo: result.transactionNo, replayed: true },
        '该操作已处理（重复请求已合并）'
      );
    }

    await conn.commit();

    const after = await walletStrategyAfter(conn, input.walletId);
    return success(
      res,
      {
        walletId: input.walletId,
        transactionNo: result.transactionNo,
        direction: input.direction,
        amount: input.amount,
        pointsType: input.pointsType,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        wallet: after
      },
      input.direction === 'IN' ? '积分已增加' : '积分已扣减'
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
  adminOverview,
  adminWalletTransactions,
  adminAdjust
};

// Web 管理端 · 积分钱包管理（文档 §11.4 / §18 / §33 / §53）
// ===========================================================================
// 定位：小程序端只能「看 / 花自己的积分」；**给谁加积分是 Web 管理端的职责** ——
//   在线充值（微信支付）已于 2026-09-23 按业务要求整体下线后，充值积分的来源只剩
//   两处：本页 + 小程序管理端「积分钱包 → 手工调整」。
//
// ⚠️ 与小程序端的边界（刻意如此划分）：
//   · 业务规则（入参校验 / 幂等去重 / 按方向选择加锁 / 记账 / 审计同事务）
//     **不在本文件** —— 统一在 services/walletAdminService.js，两端共用同一份实现。
//     两端各自手写一份的话，任一端漏掉「支出方向校验余额」都不会报错、账面也看不出来，
//     只会表现为「另一端的钱对不上」（仓库既有教训）。
//   · 本文件只做三件事：鉴权后的入参整理、事务边界、响应外形。
//
// ⚠️ 主体与钱包是「一对零或一」：主体（水站 / 业务员）先存在，钱包后开立。
//   因此列表接口以**主体为主表** —— 未开立钱包的主体也必须出现在列表里，
//   否则管理员既没法给它开钱包，也就永远没法给它加充值积分。
//
// ⚠️ 权限：本模块全部接口都读/写**他人的**资产，故一律 requireAdmin（挂路由层）。
// ===========================================================================
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const walletService = require('../services/walletService');
const walletSummary = require('../services/walletSummary');
const walletAdminService = require('../services/walletAdminService');
const {
  WALLET_OWNER_TYPE,
  WALLET_OWNER_TYPE_VALUES,
  POINTS_TYPE_VALUES,
  POINTS_TYPE_LABEL,
  EMPLOYEE_TYPE
} = require('../constants/mini');

/** 主体类型 → 中文（下发前端，避免两端各维护一份映射） */
const OWNER_TYPE_LABEL = {
  [WALLET_OWNER_TYPE.STATION]: '直营水站',
  [WALLET_OWNER_TYPE.SALESMAN]: '业务员'
};

/** 积分类型下拉项（**由常量派生**，前端不再硬编码两个取值的中文名） */
const POINTS_TYPE_OPTIONS = POINTS_TYPE_VALUES.map(v => ({ value: v, label: POINTS_TYPE_LABEL[v] }));

/** 业务校验失败 → 400/404；其余错误记日志后回 500（与 mini 侧 handleError 同形） */
function handleError(res, err, fallback) {
  if (err && err.business) {
    // hazard-allow: bizFail 业务校验文案（设计输出，与 orderController 同一约定）
    return error(res, err.message, err.httpStatus || 400);
  }
  console.error(`[web/wallet] ${fallback}:`, err);
  return error(res, fallback);
}

/**
 * 主体清单（水站 + 业务员）—— 全量，**不以内连接钱包**
 *
 * ⚠️ 业务员即 workers.employee_type = EMPLOYEE_TYPE.SALESMAN
 *    （业务员并入员工管理，不单独维护 salesmen 主数据，与小程序手机号消歧同源）。
 * ⚠️ 刻意逐表查询、**不做跨表 JOIN**：workers / sub_stations 的字符集与 collation
 *    并不完全一致（仓库既有陷阱），逐表查询从根上避开该问题（与 miniAccountService 同法）。
 * ⚠️ 不做 SELECT *（仓库红线 R3），列清单显式列出。
 */
async function listSubjects(conn, ownerType = null) {
  const subjects = [];

  if (!ownerType || ownerType === WALLET_OWNER_TYPE.STATION) {
    const [rows] = await conn.execute(
      `SELECT station_id, station_name, status FROM sub_stations ORDER BY station_id ASC`
    );
    for (const r of rows) {
      subjects.push({
        ownerType: WALLET_OWNER_TYPE.STATION,
        ownerId: r.station_id,
        ownerName: r.station_name,
        ownerStatus: Number(r.status)
      });
    }
  }

  if (!ownerType || ownerType === WALLET_OWNER_TYPE.SALESMAN) {
    const [rows] = await conn.execute(
      `SELECT worker_id, worker_name, status FROM workers WHERE employee_type = ? ORDER BY worker_id ASC`,
      [EMPLOYEE_TYPE.SALESMAN]
    );
    for (const r of rows) {
      subjects.push({
        ownerType: WALLET_OWNER_TYPE.SALESMAN,
        ownerId: r.worker_id,
        ownerName: r.worker_name,
        ownerStatus: Number(r.status)
      });
    }
  }

  return subjects;
}

/** 主体定位键（owner_type + owner_id 才是唯一键 —— 单独 owner_id 在两域之间不保证不重名） */
const subjectKey = (ownerType, ownerId) => `${ownerType}::${ownerId}`;

/**
 * GET /api/wallets —— 主体积分钱包总览
 *
 * 返回**主体全量**（含未开立钱包者），让管理员一眼看出「谁还没开钱包」。
 * 查询参数：ownerType（可选，STATION | SALESMAN）、keyword（可选，按名称/ID 模糊匹配）
 */
async function getWallets(req, res) {
  const conn = await pool.getConnection();
  try {
    const ownerType = req.query.ownerType ? String(req.query.ownerType).toUpperCase() : null;
    if (ownerType && !WALLET_OWNER_TYPE_VALUES.includes(ownerType)) {
      return error(res, '主体类型无效', 400);
    }
    const keyword = String(req.query.keyword || '')
      .trim()
      .toLowerCase();

    const subjects = await listSubjects(conn, ownerType);
    // 钱包取数复用既有单源服务（§53：禁止在控制器里另写聚合 SQL）
    const wallets = await walletSummary.listWalletsForAdmin(conn, { ownerType });
    const walletMap = new Map(wallets.list.map(w => [subjectKey(w.ownerType, w.ownerId), w]));

    // ⚠️ 关键字过滤放在内存里做：主体是主数据量级（水站 + 业务员，几十条），
    //    为此拼动态 SQL（列名/条件拼接）反而引入红线风险，不值得。
    const filtered = keyword
      ? subjects.filter(
          s =>
            String(s.ownerName || '')
              .toLowerCase()
              .includes(keyword) || String(s.ownerId).toLowerCase().includes(keyword)
        )
      : subjects;

    const list = filtered.map(s => {
      const w = walletMap.get(subjectKey(s.ownerType, s.ownerId)) || null;
      return {
        ownerType: s.ownerType,
        ownerTypeLabel: OWNER_TYPE_LABEL[s.ownerType] || s.ownerType,
        ownerId: s.ownerId,
        ownerName: s.ownerName,
        /** 主体自身状态（离职 / 水站停用）—— 与钱包 status 是两件事，故分列 */
        ownerStatus: s.ownerStatus,
        /** 钱包是否已开立：未开立时下方各余额恒为 0，前端据此展示「开立钱包」按钮 */
        opened: !!w,
        walletId: w ? w.walletId : null,
        walletStatus: w ? w.status : null,
        balance: w ? w.balance : 0,
        rechargeBalance: w ? w.rechargeBalance : 0,
        deliveryFeeBalance: w ? w.deliveryFeeBalance : 0,
        txCount: w ? w.txCount : 0,
        lastTxAt: w ? w.lastTxAt : null
      };
    });

    const totals = await walletSummary.sumBalanceByOwnerType(conn);

    return success(res, {
      count: list.length,
      openedCount: list.filter(i => i.opened).length,
      unopenedCount: list.filter(i => !i.opened).length,
      totals,
      // 供前端渲染下拉：积分类型取值与中文名由服务端下发（枚举单源）
      pointsTypeOptions: POINTS_TYPE_OPTIONS,
      /** 1 元 = 1 积分（§3.3），此处显式声明以免前端自行假定汇率 */
      exchangeRate: { points: 1, rmb: 1 },
      list
    });
  } catch (err) {
    return handleError(res, err, '获取积分钱包总览失败');
  } finally {
    conn.release();
  }
}

/**
 * POST /api/wallets/open —— 为主体开立积分钱包
 *
 * 为什么需要这个接口：钱包**跟随主体开立**（§4.6.1），小程序端在本人首次进入钱包页时自动
 * 开立；但「从没用过小程序的水站」永远不会自己长出钱包 —— 而管理员恰恰要给这种水站
 * 加充值积分。没有开立入口，本页对未接入小程序的水站就是不可用的。
 *
 * ⚠️ 幂等性：**天然幂等**（wallet_accounts 对 owner_type+owner_id 有唯一索引，
 *    ensureWallet 命中重复键时返回既有钱包），因此不需要客户端幂等键 ——
 *    重复点击只会拿到同一个钱包，不会产生第二个、也不会动钱。
 */
async function openWallet(req, res) {
  const body = req.body || {};
  const ownerType = String(body.ownerType || '').toUpperCase();
  const ownerId = body.ownerId ? String(body.ownerId).trim() : '';

  if (!WALLET_OWNER_TYPE_VALUES.includes(ownerType)) {
    return error(res, `主体类型只能是 ${WALLET_OWNER_TYPE_VALUES.join(' 或 ')}`, 400);
  }
  if (!ownerId) return error(res, '缺少 ownerId', 400);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 主体必须真实存在 —— 否则会开出一个「没有主人的钱包」（钱进得去、没人能花）
    let ownerName = null;
    if (ownerType === WALLET_OWNER_TYPE.STATION) {
      const [rows] = await conn.execute(`SELECT station_name FROM sub_stations WHERE station_id = ?`, [ownerId]);
      if (!rows.length) {
        await conn.rollback();
        return error(res, '水站不存在', 404);
      }
      ownerName = rows[0].station_name;
    } else {
      const [rows] = await conn.execute(`SELECT worker_name FROM workers WHERE worker_id = ? AND employee_type = ?`, [
        ownerId,
        EMPLOYEE_TYPE.SALESMAN
      ]);
      if (!rows.length) {
        await conn.rollback();
        return error(res, '业务员不存在（员工类型须为业务员）', 404);
      }
      ownerName = rows[0].worker_name;
    }

    const wallet = await walletService.ensureWallet(conn, { ownerType, ownerId, ownerName });

    await conn.commit();

    const overview = await walletSummary.getWalletOverview(conn, wallet.wallet_id);
    return success(
      res,
      { walletId: wallet.wallet_id, ownerType, ownerId, ownerName: wallet.owner_name || ownerName, wallet: overview },
      '积分钱包已开立'
    );
  } catch (err) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[web/wallet] 开立回滚失败:', re);
    }
    return handleError(res, err, '开立积分钱包失败');
  } finally {
    conn.release();
  }
}

/**
 * POST /api/wallets/:walletId/adjust —— 管理员手工增减积分
 *
 * 请求体：{ direction: 'IN'|'OUT', amount, reason(必填), remark?, pointsType?(默认 RECHARGE),
 *          clientRequestId(幂等键，必填) }
 *
 * ⚠️ 幂等键**必须由客户端传**：服务端自造键等于每次都当新请求，重复点击就真的加两次钱。
 *    前端在**打开弹窗时生成一个键**、成功后丢弃 —— 这样「误触两次」「网络重试」都只生效一次。
 * ⚠️ 操作人取登录态（web:<用户名>），**不接受请求体传入**（§22.2：不得由客户端决定操作人）。
 */
async function adjustWallet(req, res) {
  const walletId = req.params.walletId;
  const operator = (req.user && (req.user.username || req.user.id)) || null;

  let input;
  try {
    // 入参规范化在**事务外**（非法入参不该占用行锁），且与小程序端共用同一份校验
    input = walletAdminService.normalizeAdjustInput({ ...(req.body || {}), walletId });
  } catch (err) {
    return handleError(res, err, '调整积分失败，请稍后重试');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const result = await walletAdminService.applyAdjust(conn, input, {
      // ⚠️ 作用域带渠道（WEB）：与小程序端的幂等键空间隔离，
      //    避免两端各自生成的键偶然相同而被误判成「重放」（详见 walletAdminService 注释）
      scope: walletAdminService.buildIdemScope('WEB', input.walletId),
      actorType: 'WEB',
      actorId: operator ? `web:${operator}` : null,
      operatorId: operator ? `web:${operator}` : null,
      operatorRole: 'admin',
      miniAccountId: null
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

    // 事务提交后重新读一次，让前端拿到权威余额（不拿事务内快照）
    const after = await walletSummary.getWalletOverview(conn, input.walletId);
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
      console.error('[web/wallet] 调整回滚失败:', re);
    }
    return handleError(res, err, '调整积分失败，请稍后重试');
  } finally {
    conn.release();
  }
}

/**
 * GET /api/wallets/:walletId/transactions —— 指定钱包的流水 / 月度明细 / 区间对账
 *
 * 查询参数：page、pageSize、type（流水类型）、pointsType（积分类型）、startDate、endDate
 * ⚠️ 取数一律走 walletSummary（与小程序端、对账页同一实现，§53 单源）。
 */
async function getWalletTransactions(req, res) {
  const conn = await pool.getConnection();
  try {
    const walletId = req.params.walletId;
    const { page, size } = parsePage(req.query);

    const wallet = await walletSummary.getWalletOverview(conn, walletId);
    if (!wallet) return error(res, '积分钱包不存在', 404);

    const pointsType = req.query.pointsType ? String(req.query.pointsType).toUpperCase() : null;
    if (pointsType && !POINTS_TYPE_VALUES.includes(pointsType)) {
      return error(res, `积分类型只能是 ${POINTS_TYPE_VALUES.join(' 或 ')}`, 400);
    }

    const result = await walletSummary.listWalletTransactions(conn, {
      walletId,
      pointsType,
      page,
      size
    });
    // ★ 配送费积分的按月发放明细（管理员核对「这个水站每月返货发了多少」）
    const deliveryFeeMonthly = await walletSummary.getDeliveryFeeMonthly(conn, walletId);
    const reconciliation = await walletSummary.reconcileWallet(conn, {
      walletId,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null
    });

    return success(res, {
      wallet,
      transactions: result.list,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      deliveryFeeMonthly,
      reconciliation,
      pointsTypeOptions: POINTS_TYPE_OPTIONS
    });
  } catch (err) {
    return handleError(res, err, '获取积分流水失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  OWNER_TYPE_LABEL,
  getWallets,
  openWallet,
  adjustWallet,
  getWalletTransactions
};

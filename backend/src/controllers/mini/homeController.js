// 小程序首页聚合（文档 §28 / §29 / §30）
// ===========================================================================
// ⚠️ §28 末句：「全部来自服务端聚合，不在小程序 JS 自己汇总」——
//    因此首页所有数字都在这里算好，前端不做任何跨接口加总。
//
// ⚠️ 「空数据非 bug」必须显式说明（仓库既有约定：商品销售统计不带 range 时是当月口径，
//    空表不是 bug）。本期有两个来源**天然为 0**：
//      · 本月充值          —— 微信充值属 Phase 6，尚未开通（§13.8 降级路径）
//      · 本月分销配送费积分 —— 水票发行入账属 Phase 7，尚未接入
//    若不写明，管理员/业务员会把 0 当成系统故障。故这里随响应回传 notes。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error } = require('../../utils/response');
const walletService = require('../../services/walletService');
const walletSummary = require('../../services/walletSummary');
const { resolveRange, buildRangeWhere } = require('../../utils/dateRange');
const {
  MINI_ROLES,
  ROLE_TO_OWNER_TYPE,
  WALLET_TX_TYPE,
  WALLET_OWNER_TYPE,
  MINI_MESSAGE
} = require('../../constants/mini');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** 本月区间（start 含、end 不含，与仪表盘同一约定） */
function monthRange() {
  const r = resolveRange({ range: 'month' });
  return r;
}

/** 当前用户的钱包概览（无钱包则返回 null，不自动创建 —— 首页是只读视图） */
async function walletOf(conn, mini) {
  const ownerType = ROLE_TO_OWNER_TYPE[mini.role];
  if (!ownerType) return null;
  const wallet = await walletService.findWallet(conn, ownerType, mini.targetId);
  if (!wallet) return null;
  return walletSummary.getWalletOverview(conn, wallet.wallet_id);
}

/** 最近 N 笔订单（列表卡片复用小程序订单的字段形状） */
async function recentOrders(conn, mini, limit = 5) {
  const params = ['MINI_PROGRAM'];
  let where = 'WHERE o.order_source = ?';
  if (mini.role !== MINI_ROLES.ADMIN) {
    where += ' AND o.buyer_type = ? AND o.buyer_id = ?';
    params.push(mini.buyerType, mini.targetId);
  }
  const [rows] = await conn.execute(
    `SELECT o.order_id, o.order_type, o.fulfillment_type, o.fulfillment_status, o.refund_status,
            o.order_amount, o.customer_name, o.created_at,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count
       FROM orders o ${where}
      ORDER BY o.created_at DESC, o.order_id DESC
      LIMIT ${parseInt(limit, 10)}`,
    params
  );
  return rows.map(r => ({
    orderId: r.order_id,
    orderType: Number(r.order_type),
    fulfillmentType: r.fulfillment_type,
    fulfillmentStatus: r.fulfillment_status,
    refundStatus: r.refund_status,
    orderAmount: Number(r.order_amount) || 0,
    customerName: r.customer_name,
    itemCount: Number(r.item_count) || 0,
    createdAt: r.created_at
  }));
}

/** 指定履约状态的本方订单数 */
async function countByStage(conn, mini, stages) {
  const params = ['MINI_PROGRAM', ...stages];
  let where = `WHERE o.order_source = ? AND o.canceled_at IS NULL
               AND o.fulfillment_status IN (${stages.map(() => '?').join(',')})`;
  if (mini.role !== MINI_ROLES.ADMIN) {
    where += ' AND o.buyer_type = ? AND o.buyer_id = ?';
    params.push(mini.buyerType, mini.targetId);
  }
  const [rows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM orders o ${where}`, params);
  return Number(rows[0].cnt) || 0;
}

/** 业务员首页（§29） */
async function buildSalesmanHome(conn, mini) {
  const r = monthRange();
  const rw = buildRangeWhere('o.created_at', r);

  // 本月订货（区间口径与仪表盘一致：start 含、end 不含）
  const [orderStats] = await conn.execute(
    `SELECT COUNT(*) AS month_count,
            ROUND(COALESCE(SUM(o.order_amount), 0), 2) AS month_amount
       FROM orders o
      WHERE o.order_source = 'MINI_PROGRAM' AND o.buyer_type = 'SALESMAN' AND o.buyer_id = ?
        AND o.canceled_at IS NULL AND ${rw.clause}`,
    [mini.targetId, ...rw.params]
  );

  // 今日订货（按自然日，不走区间工具 —— 与「今天」的直觉一致）
  const [todayRow] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM orders
      WHERE order_source = 'MINI_PROGRAM' AND buyer_type = 'SALESMAN' AND buyer_id = ?
        AND canceled_at IS NULL AND DATE(created_at) = CURDATE()`,
    [mini.targetId]
  );

  const wallet = await walletOf(conn, mini);

  return {
    role: 'SALESMAN',
    wallet,
    /** §29 当前积分在 wallet 里，这里给业务维度指标 */
    today: {
      orderCount: Number(todayRow[0].cnt) || 0
    },
    month: {
      orderCount: Number(orderStats[0].month_count) || 0,
      orderAmount: round2(orderStats[0].month_amount)
    },
    pipeline: {
      pendingStock: await countByStage(conn, mini, ['PAID', 'PROCESSING']),
      delivering: await countByStage(conn, mini, ['DELIVERING'])
    },
    recentOrders: await recentOrders(conn, mini, 5),
    notes: [
      '业务员订单成交价受「最低成交价」保护，低于底线会被服务端拒绝（§8.4）',
      '自购与代客下单的最低成交价约束相同（§7.5，V1.1 暂按安全方向执行）'
    ]
  };
}

/** 直营水站首页（§30） */
async function buildStationHome(conn, mini) {
  const r = monthRange();
  const rw = buildRangeWhere('o.created_at', r);
  const wallet = await walletOf(conn, mini);
  const walletId = wallet ? wallet.walletId : null;

  // 本月充值 / 本月分销配送费积分（两个来源本期天然为 0，见文件头说明）
  let rechargeSum = 0;
  let distributionSum = 0;
  if (walletId) {
    const [txRows] = await conn.execute(
      `SELECT transaction_type, ROUND(COALESCE(SUM(amount), 0), 2) AS total
         FROM wallet_transactions
        WHERE wallet_id = ? AND transaction_type IN (?)
          AND created_at >= ? AND created_at < ?
        GROUP BY transaction_type`,
      [walletId, WALLET_TX_TYPE.DISTRIBUTION_FEE, r.start, r.end]
    );
    for (const row of txRows) {
      if (row.transaction_type === WALLET_TX_TYPE.DISTRIBUTION_FEE) distributionSum = round2(row.total);
    }
    const [rechargeRows] = await conn.execute(
      `SELECT transaction_type, ROUND(COALESCE(SUM(amount), 0), 2) AS total
         FROM wallet_transactions
        WHERE wallet_id = ? AND transaction_type = ?
          AND created_at >= ? AND created_at < ?
        GROUP BY transaction_type`,
      [walletId, WALLET_TX_TYPE.RECHARGE, r.start, r.end]
    );
    if (rechargeRows.length) rechargeSum = round2(rechargeRows[0].total);
  }

  const [orderStats] = await conn.execute(
    `SELECT COUNT(*) AS month_count, ROUND(COALESCE(SUM(o.order_amount), 0), 2) AS month_amount
       FROM orders o
      WHERE o.order_source = 'MINI_PROGRAM' AND o.buyer_type = 'STATION' AND o.buyer_id = ?
        AND o.canceled_at IS NULL AND ${rw.clause}`,
    [mini.targetId, ...rw.params]
  );

  const [ticketRows] = await conn.execute(
    `SELECT COUNT(*) AS available, COUNT(DISTINCT product_id) AS kinds
       FROM water_tickets WHERE station_id = ? AND status = 1`,
    [mini.targetId]
  );

  return {
    role: 'STATION',
    wallet,
    month: {
      orderCount: Number(orderStats[0].month_count) || 0,
      orderAmount: round2(orderStats[0].month_amount),
      recharge: rechargeSum,
      distributionPoints: distributionSum
    },
    pipeline: {
      pendingStock: await countByStage(conn, mini, ['PAID', 'PROCESSING']),
      delivering: await countByStage(conn, mini, ['DELIVERING'])
      // ⚠️ 2026-09-20 自提下线：原 `readyForPickup` 计数已删除
      //    （前端首页的「待自提」卡片与待办同步移除，两侧必须一起改）
    },
    waterTickets: {
      available: Number(ticketRows[0].available) || 0,
      productKinds: Number(ticketRows[0].kinds) || 0
    },
    recentOrders: await recentOrders(conn, mini, 5),
    notes: [
      '小程序水站订单不产生欠款，必须积分足额支付（§3.6 / §6.5）',
      '本月充值恒为 0：微信充值属 Phase 6，尚未开通（§13.8 降级路径）',
      '本月分销配送费积分恒为 0：水票发行入账属 Phase 7，尚未接入'
    ]
  };
}

/** GET /api/mini/home —— 按角色返回首页聚合 */
async function getHome(req, res) {
  const conn = await pool.getConnection();
  try {
    if (req.mini.role === MINI_ROLES.SALESMAN) {
      return success(res, {
        ...(await buildSalesmanHome(conn, req.mini)),
        blocked: req.mini.blocked || null
      });
    }
    if (req.mini.role === MINI_ROLES.STATION) {
      return success(res, {
        ...(await buildStationHome(conn, req.mini)),
        blocked: req.mini.blocked || null
      });
    }
    // 管理员：首页即 §28 仪表盘（复用同一聚合，避免两处口径）
    if (req.mini.role === MINI_ROLES.ADMIN) {
      const walletTotals = await walletSummary.sumBalanceByOwnerType(conn);
      return success(res, {
        role: 'ADMIN',
        redirect: 'ADMIN_DASHBOARD',
        stationPoints: {
          salesmanTotal: walletTotals[WALLET_OWNER_TYPE.SALESMAN] || 0,
          stationTotal: walletTotals[WALLET_OWNER_TYPE.STATION] || 0,
          total: walletTotals.total || 0
        },
        wechatPayNotOpen: MINI_MESSAGE.WECHAT_PAY_NOT_OPEN,
        blocked: req.mini.blocked || null
      });
    }
    return error(res, '未知角色', 403);
  } catch (err) {
    console.error('[mini/home] 首页聚合失败:', err);
    return error(res, '获取首页数据失败');
  } finally {
    conn.release();
  }
}

module.exports = { getHome };

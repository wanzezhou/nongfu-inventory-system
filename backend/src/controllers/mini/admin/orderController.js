// 小程序管理端 · 订单域（Phase 8b 第 9 域，文档 §16 / §27 / §31 / §5.3）
// ===========================================================================
// 与业务员/水站订单页（mini/orderController）的区别：
//   · **全来源** —— Web 端建的订单也要能看到、能推进履约状态（既有 listOrders
//     限 `order_source = 'MINI_PROGRAM'`，管理员端不能受限于此）；
//   · **写操作** —— 履约推进与管理员取消（业务员/水站端只有下单/取消自己的单）。
// 状态机与取消链全部复用 miniOrderService 的单源函数，本文件只做编排与鉴权。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error, pagination } = require('../../../utils/response');
const { parseMiniPage, requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, FULFILLMENT_STATUS } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const miniOrderService = require('../../../services/miniOrderService');
// ⚠️ 两个 Label 映射定义在 miniOrderService（不在 constants）—— 从错误的来源解构
//    得到 undefined，第一次访问属性就 500（实测踩到，堆栈指向 shapeRow 第 43 行）
const { hashRequest } = require('../../../utils/requestHash');
const { FULFILLMENT_LABEL, REFUND_LABEL } = miniOrderService;

/** 状态筛选 → SQL 条件（§31 的管理员超集：全部来源 + 退款态） */
const STATUS_FILTERS = {
  ALL: null,
  PENDING_STOCK: ['PAID', 'PROCESSING'],
  DELIVERING: ['DELIVERING'],
  COMPLETED: ['COMPLETED'],
  CANCELED: ['CANCELED'],
  REFUNDED: null // 单独走 refund_status，不走 fulfillment_status IN
};

/** 订单行（管理员视角：含来源与买家，业务员视角不展示这些） */
function shapeRow(r) {
  return {
    orderId: r.order_id,
    orderType: Number(r.order_type),
    source: r.order_source,
    buyerType: r.buyer_type,
    buyerId: r.buyer_id,
    paymentMethod: r.payment_method,
    fulfillmentStatus: r.fulfillment_status,
    fulfillmentStatusLabel: FULFILLMENT_LABEL[r.fulfillment_status] || r.fulfillment_status || '—',
    refundStatus: r.refund_status,
    refundStatusLabel: REFUND_LABEL[r.refund_status] || r.refund_status,
    orderAmount: Number(r.order_amount) || 0,
    paidAmount: Number(r.paid_amount) || 0,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    itemCount: Number(r.item_count) || 0,
    createdAt: r.created_at,
    canceledAt: r.canceled_at,
    // 管理员视角的可操作标记：推进允许前进到任一后续状态；取消只看是否已取消
    canAdvance: !r.canceled_at && ['PAID', 'PROCESSING', 'DELIVERING'].includes(r.fulfillment_status),
    canCancel: !r.canceled_at && r.fulfillment_status !== FULFILLMENT_STATUS.CANCELED
  };
}

// ── GET /mini/admin/orders —— 全来源订单列表 ─────────────────────────────────
async function listOrders(req, res) {
  const conn = await pool.getConnection();
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);

    const parts = [];
    const params = [];

    const statusKey = String(req.query.status || 'ALL').toUpperCase();
    if (statusKey === 'REFUNDED') {
      parts.push('o.refund_status = ?');
      params.push('REFUNDED');
    } else if (STATUS_FILTERS[statusKey]) {
      parts.push(`o.fulfillment_status IN (${STATUS_FILTERS[statusKey].map(() => '?').join(',')})`);
      params.push(...STATUS_FILTERS[statusKey]);
    }

    // 关键词：订单号 / 客户名 / 电话（全来源订单的常用查找方式）
    const keyword = String(req.query.keyword || '').trim();
    if (keyword) {
      parts.push('(o.order_id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (req.query.buyerType) {
      parts.push('o.buyer_type = ?');
      params.push(String(req.query.buyerType));
    }
    if (req.query.startDate) {
      parts.push('o.created_at >= ?');
      params.push(`${req.query.startDate} 00:00:00`);
    }
    if (req.query.endDate) {
      parts.push('o.created_at <= ?');
      params.push(`${req.query.endDate} 23:59:59`);
    }

    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [cnt] = await conn.execute(`SELECT COUNT(*) AS n FROM orders o ${where}`, params);
    const total = Number(cnt[0].n) || 0;

    const [rows] = await conn.execute(
      `SELECT o.order_id, o.order_type, o.order_source, o.buyer_type, o.buyer_id, o.payment_method,
              o.fulfillment_status, o.refund_status, o.order_amount, o.paid_amount,
              o.customer_name, o.customer_phone, o.canceled_at, o.created_at,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count
         FROM orders o ${where}
        ORDER BY o.created_at DESC, o.order_id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return pagination(res, rows.map(shapeRow), total, page, pageSize);
  } catch (e) {
    console.error('[mini/admin] 订单列表失败:', e);
    return error(res, '订单列表查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/orders/:id —— 详情（全来源）─────────────────────────────
async function getOrderById(req, res) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT o.*, 
              (SELECT ROUND(SUM(oi.subtotal), 2) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_amount
         FROM orders o WHERE o.order_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return error(res, '订单不存在', 404);
    const o = rows[0];
    const [items] = await conn.execute(
      `SELECT product_id, quantity, unit_price, subtotal FROM order_items WHERE order_id = ?`,
      [req.params.id]
    );
    return success(res, {
      order: Object.assign(shapeRow(o), {
        customerAddress: o.customer_address,
        deliveryType: Number(o.delivery_type),
        stationId: o.station_id,
        remark: o.remark,
        itemAmount: Number(o.item_amount) || 0,
        totalReceivable: Number(o.total_receivable) || 0
      }),
      items: items.map(it => ({
        productId: it.product_id,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price) || 0,
        subtotal: Number(it.subtotal) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 订单详情失败:', e);
    return error(res, '订单详情查询失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/orders/:id/fulfillment —— 履约推进（幂等 + 审计）─────────
// 单事务：幂等占用 → 推进（状态机 + 审计）→ 幂等完成 → 提交。
async function advance(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const to = String(body.to || '').toUpperCase();
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.ADVANCE_ORDER,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ orderId: req.params.id, to }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { orderId: claim.resultRef, replayed: true }, '该操作已执行（重复请求已合并）');
    }

    let r;
    try {
      r = await miniOrderService.advanceFulfillment(conn, req.params.id, to, { operatorId: operator });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '履约状态推进失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.ADVANCE_ORDER,
      key: String(body.clientRequestId),
      resultRef: String(req.params.id)
    });

    await conn.commit();
    return success(res, { orderId: r.orderId, from: r.from, to: r.to }, `履约状态已推进：${r.from} → ${r.to}`);
  } catch (e) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[mini/admin] 履约推进回滚失败:', re);
    }
    console.error('[mini/admin] 履约推进失败:', e);
    return error(res, '履约状态推进失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/orders/:id/cancel —— 管理员取消（幂等 + 审计）───────────
// 单事务：幂等占用 → 取消链（钱包退回或现金单回冲 + 审计）→ 幂等完成 → 提交。
async function cancel(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CANCEL_ORDER_ADMIN,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ orderId: req.params.id, action: 'cancel' }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { orderId: claim.resultRef, replayed: true }, '该操作已执行（重复请求已合并）');
    }

    let r;
    try {
      r = await miniOrderService.cancelOrderByAdmin(conn, req.params.id, {
        reason: body.reason,
        operatorId: operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '取消订单失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CANCEL_ORDER_ADMIN,
      key: String(body.clientRequestId),
      resultRef: String(req.params.id)
    });

    await conn.commit();
    return success(
      res,
      { orderId: r.orderId, walletRefunded: r.walletRefunded, alreadySettled: r.alreadySettled },
      r.alreadySettled ? '订单已退款（重复请求已合并）' : '订单已取消'
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[mini/admin] 取消订单回滚失败:', re);
    }
    console.error('[mini/admin] 取消订单失败:', e);
    return error(res, '取消订单失败');
  } finally {
    conn.release();
  }
}

module.exports = { listOrders, getOrderById, advance, cancel };

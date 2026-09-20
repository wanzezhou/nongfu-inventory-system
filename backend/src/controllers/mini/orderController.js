// 小程序订单（文档 §14 / §15 / §16 / §21.3 / §21.4 / §31 / §32）
// ===========================================================================
// ⚠️ 本 controller **只做参数整形与响应组装**，订单的一切业务动作都在
//    services/miniOrderService.js 编排（§42.3：不要往 miniOrderController 里抄逻辑）。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const miniOrderService = require('../../services/miniOrderService');
const { MINI_ROLES, MINI_PAGE, WALLET_TX_TYPE, WALLET_RELATED_TYPE } = require('../../constants/mini');

const { FULFILLMENT_LABEL, REFUND_LABEL } = miniOrderService;

/** 业务错误出口：只对 e.business 透传文案（设计输出），其余走通用 500 */
function handleError(res, err, fallback) {
  if (err && err.business) {
    // hazard-allow: bizFail 业务校验文案（设计输出，与 orderController 同一约定）
    return error(res, err.message, err.httpStatus || 400);
  }
  console.error(`[mini/order] ${fallback}:`, err);
  return error(res, fallback);
}

/** 履约状态筛选（§31：业务员与水站的筛选项不同） */
const STATUS_FILTERS = {
  ALL: null,
  // 待备货：已支付但尚未开始配送（PAID 与 PROCESSING 都归入「待备货」）
  PENDING_STOCK: ['PAID', 'PROCESSING'],
  DELIVERING: ['DELIVERING'],
  COMPLETED: ['COMPLETED'],
  CANCELED: ['CANCELED']
};
// ⚠️ 2026-09-20：`READY_FOR_PICKUP: ['READY_FOR_PICKUP']` 随自提下线删除。
//    前端 order-list 的「待自提」页签也同步移除 —— 两侧必须一起改，
//    否则页签会传一个服务端不认的 status（落到 ALL 还是报错取决于实现，都是隐性坑）。

/**
 * 订单列表
 * GET /api/mini/orders?status=&page=&pageSize=
 * §44.1：业务员只能看到自己的业务数据、水站只能看到自己的水站数据 —— 主体条件来自令牌，不接受入参。
 */
async function listOrders(req, res) {
  const conn = await pool.getConnection();
  try {
    const { role, buyerType, targetId } = req.mini;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      MINI_PAGE.MAX_SIZE,
      Math.max(1, parseInt(req.query.pageSize, 10) || MINI_PAGE.DEFAULT_SIZE)
    );
    const offset = (page - 1) * pageSize;

    let where = 'WHERE o.order_source = ?';
    const params = ['MINI_PROGRAM'];

    // 主体隔离：非管理员一律只能看自己的单
    if (role !== MINI_ROLES.ADMIN) {
      where += ' AND o.buyer_type = ? AND o.buyer_id = ?';
      params.push(buyerType, targetId);
    }

    const statusKey = String(req.query.status || 'ALL').toUpperCase();
    if (statusKey === 'REFUNDED') {
      where += ' AND o.refund_status = ?';
      params.push('REFUNDED');
    } else if (STATUS_FILTERS[statusKey]) {
      const list = STATUS_FILTERS[statusKey];
      where += ` AND o.fulfillment_status IN (${list.map(() => '?').join(',')})`;
      params.push(...list);
    }

    const [countRows] = await conn.execute(`SELECT COUNT(*) AS total FROM orders o ${where}`, params);
    const total = Number(countRows[0].total) || 0;

    const [rows] = await conn.execute(
      `SELECT o.order_id, o.order_type, o.order_source, o.buyer_type, o.buyer_id, o.payment_method,
              o.fulfillment_type, o.fulfillment_status, o.refund_status, o.order_amount,
              o.total_receivable, o.paid_amount, o.customer_name, o.customer_phone, o.customer_address,
              o.station_id, o.delivery_type, o.remark, o.canceled_at, o.created_at, o.updated_at,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count,
              (SELECT ROUND(SUM(oi.subtotal), 2) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_amount
         FROM orders o ${where}
        ORDER BY o.created_at DESC, o.order_id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return pagination(
      res,
      rows.map(r => shapeOrderSummary(r)),
      total,
      page,
      pageSize
    );
  } catch (err) {
    console.error('[mini/order] 订单列表失败:', err);
    return error(res, '获取订单列表失败');
  } finally {
    conn.release();
  }
}

/** 列表行（§31 列表不需要明细，避免 N+1） */
function shapeOrderSummary(r) {
  return {
    orderId: r.order_id,
    orderType: Number(r.order_type),
    source: r.order_source,
    buyerType: r.buyer_type,
    paymentMethod: r.payment_method,
    fulfillmentType: r.fulfillment_type,
    fulfillmentStatus: r.fulfillment_status,
    fulfillmentStatusLabel: FULFILLMENT_LABEL[r.fulfillment_status] || r.fulfillment_status,
    refundStatus: r.refund_status,
    refundStatusLabel: REFUND_LABEL[r.refund_status] || r.refund_status,
    orderAmount: Number(r.order_amount) || 0,
    totalReceivable: Number(r.total_receivable) || 0,
    paidAmount: Number(r.paid_amount) || 0,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    itemCount: Number(r.item_count) || 0,
    createdAt: r.created_at,
    canceledAt: r.canceled_at,
    canCancel: ['PAID', 'PROCESSING'].includes(r.fulfillment_status),
    canRefund: r.refund_status === 'NONE' && ['DELIVERING', 'COMPLETED'].includes(r.fulfillment_status)
  };
}

/**
 * 订单详情（§32：必须显示 16 项）
 * ⚠️ 额外显示「最低成交价校验结果」（§32 末段：用于内部审计，不一定对终端客户展示）
 *    —— 本实现回传每行的 minPriceCheck，前端按角色决定是否展示。
 */
async function getOrderById(req, res) {
  const conn = await pool.getConnection();
  try {
    const orderId = req.params.id;

    const [orderRows] = await conn.execute(
      `SELECT o.order_id, o.order_type, o.order_source, o.buyer_type, o.buyer_id, o.payment_method,
              o.wallet_id, o.fulfillment_type, o.fulfillment_status, o.refund_status, o.order_scene,
              o.order_amount, o.delivery_fee, o.total_receivable, o.paid_amount, o.payment_status,
              o.customer_name, o.customer_phone, o.customer_address, o.contact_name,
              o.station_id, o.delivery_type, o.worker_id, o.created_by, o.canceled_at,
              o.remark, o.created_at, o.updated_at,
              s.station_name,
              w.worker_name AS delivery_staff_name
         FROM orders o
         LEFT JOIN sub_stations s ON o.station_id = s.station_id
         LEFT JOIN workers w ON o.worker_id = w.worker_id
        WHERE o.order_id = ?`,
      [orderId]
    );
    if (!orderRows.length) return error(res, '订单不存在', 404);
    const order = orderRows[0];

    // §44.1 越权防护：只能看自己的单（管理员只读视角放行）
    if (req.mini.role !== MINI_ROLES.ADMIN) {
      const isMine = order.buyer_type === req.mini.buyerType && order.buyer_id === req.mini.targetId;
      if (!isMine) return error(res, '无权查看该订单', 403);
    }

    const [items] = await conn.execute(
      `SELECT oi.item_id, oi.product_id, oi.quantity, oi.unit_price, oi.pricing_type, oi.ticket_qty,
              oi.subtotal, oi.retail_price, oi.wholesale_price,
              p.product_name, p.product_code, p.specification, p.unit, p.image_url,
              p.salesman_min_price
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.product_id
        WHERE oi.order_id = ?
        ORDER BY oi.item_id ASC`,
      [orderId]
    );

    // 钱包流水号（§32 必须显示）：取该订单的支付流水
    const [payTx] = await conn.execute(
      `SELECT transaction_no, amount, balance_before, balance_after, created_at
         FROM wallet_transactions
        WHERE related_type = ? AND related_id = ? AND transaction_type = ?
        ORDER BY created_at ASC LIMIT 1`,
      [WALLET_RELATED_TYPE.ORDER, orderId, WALLET_TX_TYPE.ORDER_PAYMENT]
    );
    const [refundTx] = await conn.execute(
      `SELECT transaction_no, amount, created_at
         FROM wallet_transactions
        WHERE related_type = ? AND related_id = ? AND transaction_type = ?
        ORDER BY created_at ASC LIMIT 1`,
      [WALLET_RELATED_TYPE.ORDER, orderId, WALLET_TX_TYPE.REFUND]
    );

    return success(res, {
      orderId: order.order_id,
      orderType: Number(order.order_type),
      orderTypeLabel:
        order.order_type === 3
          ? '业务员线下零售'
          : order.order_type === 2
            ? '直营水站销售'
            : `类型 ${order.order_type}`,
      source: order.order_source,
      sourceLabel: order.order_source === 'MINI_PROGRAM' ? '微信小程序' : 'Web 管理端',
      buyerType: order.buyer_type,
      buyerId: order.buyer_id,
      buyerLabel: order.buyer_type === 'STATION' ? order.station_name || order.buyer_id : order.buyer_id || null,
      paymentMethod: order.payment_method,
      paymentMethodLabel: order.payment_method === 'WALLET' ? '积分' : '沿用既有记账',
      walletId: order.wallet_id,
      orderScene: order.order_scene,
      customer: {
        name: order.customer_name,
        phone: order.customer_phone,
        address: order.customer_address,
        contactName: order.contact_name
      },
      amount: {
        orderAmount: Number(order.order_amount) || 0,
        deliveryFee: Number(order.delivery_fee) || 0,
        totalReceivable: Number(order.total_receivable) || 0,
        paidAmount: Number(order.paid_amount) || 0,
        paymentStatus: Number(order.payment_status),
        /** 订单积分 = 实际扣除的积分（取支付流水金额这一权威值，不重算） */
        pointsPaid: payTx.length ? Number(payTx[0].amount) : 0,
        pointsRefunded: refundTx.length ? Number(refundTx[0].amount) : 0
      },
      items: items.map(it => ({
        itemId: it.item_id,
        productId: it.product_id,
        productName: it.product_name,
        productCode: it.product_code,
        specification: it.specification,
        unit: it.unit,
        imageUrl: it.image_url || null,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unit_price) || 0,
        subtotal: Number(it.subtotal) || 0,
        pricingType: Number(it.pricing_type),
        ticketQty: Number(it.ticket_qty) || 0,
        /** §32 业务员订单显示最低成交价校验结果（内部审计用途） */
        minPriceCheck:
          it.salesman_min_price === null || it.salesman_min_price === undefined
            ? null
            : {
                minPrice: Number(it.salesman_min_price),
                unitPrice: Number(it.unit_price) || 0,
                passed: (Number(it.unit_price) || 0) + 1e-9 >= Number(it.salesman_min_price)
              }
      })),
      delivery: {
        fulfillmentType: order.fulfillment_type,
        // ⚠️ 自提已下线（2026-09-20）→ `FULFILLMENT_TYPE` 只剩 DELIVERY，展示恒为「配送」。
        //    字段本身保留：前端 order-detail 用它拼区块标题，且将来若恢复自提不必改契约。
        fulfillmentTypeLabel: '配送',
        deliveryType: Number(order.delivery_type),
        deliveryTypeLabel: deliveryTypeLabel(order.delivery_type),
        deliveryStaffId: order.worker_id,
        deliveryStaffName: order.delivery_staff_name || null
      },
      fulfillmentStatus: order.fulfillment_status,
      fulfillmentStatusLabel: FULFILLMENT_LABEL[order.fulfillment_status] || order.fulfillment_status,
      refundStatus: order.refund_status,
      refundStatusLabel: REFUND_LABEL[order.refund_status] || order.refund_status,
      walletTransactions: {
        payment: payTx.length
          ? {
              transactionNo: payTx[0].transaction_no,
              amount: Number(payTx[0].amount),
              balanceBefore: Number(payTx[0].balance_before),
              balanceAfter: Number(payTx[0].balance_after),
              createdAt: payTx[0].created_at
            }
          : null,
        refund: refundTx.length
          ? {
              transactionNo: refundTx[0].transaction_no,
              amount: Number(refundTx[0].amount),
              createdAt: refundTx[0].created_at
            }
          : null
      },
      remark: order.remark,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      canceledAt: order.canceled_at,
      canCancel: ['PAID', 'PROCESSING'].includes(order.fulfillment_status) && !order.canceled_at,
      canRefund: order.refund_status === 'NONE' && ['DELIVERING', 'COMPLETED'].includes(order.fulfillment_status)
    });
  } catch (err) {
    console.error('[mini/order] 订单详情失败:', err);
    return error(res, '获取订单详情失败');
  } finally {
    conn.release();
  }
}

/**
 * 配送方式展示文案（delivery_type：谁去送）
 *
 * ⚠️ 2026-09-20 自提下线后，小程序订单**不可能**出现 delivery_type = 3
 *    （产生 3 的那条分支已删，见 miniOrderService.resolveDeliveryExecution 的注释）。
 *    这里仍保留 `3 → 无需配送` 的兜底：万一读到历史/手工改库的行，展示成
 *    「无需配送」比落进 else 分支更贴近原语义 —— 但**它不代表小程序还会产生这种订单**。
 *
 * ⚠️ 这个取值与 fulfillment_type（怎么取货）是两个维度，别合并（§10.1.1）；
 *    原先「自提 → 无需配送（自提）」的展示分支已随自提下线删除。
 */
function deliveryTypeLabel(deliveryType) {
  const n = Number(deliveryType);
  if (n === 1) return '自有员工配送';
  if (n === 2) return '水站配送';
  return '无需配送';
}

/** POST /api/mini/orders —— 创建订单（下单即钱包支付，§14.1） */
async function createOrder(req, res) {
  try {
    const result = await miniOrderService.createMiniOrder(req.mini, req.body || {});
    // 统一回传完整详情：① 正常下单；② 幂等重放时给出首次成功的同一订单（§23.1）
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT order_id, order_amount, total_receivable, fulfillment_type, fulfillment_status, created_at
           FROM orders WHERE order_id = ?`,
        [result.orderId]
      );
      if (!rows.length) {
        // 幂等命中但订单已被删除（例如管理员硬删）→ 明确告知，不伪造成功
        return error(res, '订单已不存在，请刷新订单列表', 409);
      }
      const o = rows[0];
      return success(
        res,
        {
          orderId: o.order_id,
          orderAmount: Number(o.order_amount) || 0,
          pointsPaid: Number(o.total_receivable) || 0,
          fulfillmentType: o.fulfillment_type,
          fulfillmentStatus: o.fulfillment_status,
          fulfillmentStatusLabel: FULFILLMENT_LABEL[o.fulfillment_status] || o.fulfillment_status,
          createdAt: o.created_at,
          replayed: result.replayed
        },
        result.replayed ? '订单已提交（重复请求已合并）' : '下单成功'
      );
    } finally {
      conn.release();
    }
  } catch (err) {
    return handleError(res, err, '下单失败，请稍后重试');
  }
}

/** POST /api/mini/orders/:id/cancel */
async function cancelOrder(req, res) {
  try {
    const result = await miniOrderService.cancelMiniOrder(req.mini, req.params.id, {
      reason: (req.body && req.body.reason) || null
    });
    return success(res, result, result.alreadySettled ? '订单已取消（此前已完成退款）' : '订单已取消，积分已退回钱包');
  } catch (err) {
    return handleError(res, err, '取消订单失败，请稍后重试');
  }
}

/** POST /api/mini/orders/:id/refund */
async function refundOrder(req, res) {
  try {
    const result = await miniOrderService.refundMiniOrder(req.mini, req.params.id, {
      reason: (req.body && req.body.reason) || null
    });
    return success(res, result, result.alreadySettled ? '订单已退款，请勿重复申请' : '退款成功，积分已退回钱包');
  } catch (err) {
    return handleError(res, err, '申请退款失败，请稍后重试');
  }
}

/**
 * GET /api/mini/customer-history?customerPhone=&productId=
 * 业务员历史成交价参考（§8.6 / §21.3）
 *
 * ⚠️ 两条硬约束：
 *   ① 只查询**当前业务员自己**的历史订单（buyer_id = 令牌里的 worker_id）；
 *      不得向业务员泄露其他业务员的客户价格历史（§8.6 末句）。
 *   ② 历史价**只作参考，不自动覆盖当前成交价**（这里只返回数据，不参与任何写路径）。
 */
async function getCustomerHistory(req, res) {
  const conn = await pool.getConnection();
  try {
    if (req.mini.role !== MINI_ROLES.SALESMAN) {
      // 水站订单没有「自由成交价」概念（§9.1 由服务端取分销价），故该接口仅业务员可用
      return error(res, '仅业务员可查询历史成交价', 403);
    }
    const { customerPhone, productId } = req.query;
    if (!customerPhone || !productId) {
      return error(res, '缺少 customerPhone 或 productId 参数', 400);
    }

    const [rows] = await conn.execute(
      `SELECT o.order_id, o.created_at, oi.unit_price, oi.quantity, o.customer_name
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.order_source = 'MINI_PROGRAM'
          AND o.buyer_type = 'SALESMAN'
          AND o.buyer_id = ?
          AND oi.product_id = ?
          AND o.customer_phone = ?
        ORDER BY o.created_at DESC
        LIMIT 3`,
      [req.mini.targetId, productId, customerPhone]
    );

    return success(res, {
      customerPhone,
      productId,
      /** 最近一次成交价 */
      latest: rows.length ? Number(rows[0].unit_price) : null,
      /** 最近 3 次成交价（按时间倒序） */
      recent: rows.map(r => ({
        orderId: r.order_id,
        unitPrice: Number(r.unit_price) || 0,
        quantity: Number(r.quantity) || 0,
        createdAt: r.created_at
      })),
      /** 明确标注：参考值，不自动套用（§8.6） */
      notice: '历史成交价仅供参考，不会自动填入当前订单'
    });
  } catch (err) {
    console.error('[mini/order] 历史成交价查询失败:', err);
    return error(res, '查询历史成交价失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  listOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  refundOrder,
  getCustomerHistory
};

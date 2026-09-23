// 小程序订单编排服务（文档 §6 / §7 / §9 / §10 / §14 / §15 / §24.5 / §34）
// ===========================================================================
// ⚠️ 2026-09-20：**自提（PICKUP）已业务下线，前后端一并移除。**
//    本文件原有一整套自提支持（fulfillment_type=PICKUP、自提地点配置解析与快照、
//    「自提 → delivery_type=3」）已删除。现存约束：
//      · 履约方式为**白名单**，只接受 DELIVERY（`FULFILLMENT_TYPE` 已只剩一个值）；
//      · 所有订单都是配送单 → **配送地址一律必填**；
//      · `delivery_type` 只可能为 1（业务员/自有员工配送）或 2（水站配送）。
//    文档 §10.4 / §44.14（自提相关）随之不再适用，见 docs/小程序开发说明.md。
// ===========================================================================
// ⚠️ 本文件**只做编排**，绝不复制任何一段核心业务逻辑（§41 头号禁止项 / §42.3）：
//     定价        → services/orderPricingService.buildOrderItems
//     最低价校验  → services/orderPricingService.assertSalesmanMinPrice
//     水票核销    → services/orderPricingService.writeOffTickets
//     库存扣减    → services/orderPricingService.deductInventoryForSale
//     营收入账    → services/orderRevenuePosting.postOrderRevenue
//     钱包三联    → services/walletService.applyTransaction
//     订单号      → utils/orderIdGen.generateOrderId
//   本文件负责的是「这些步骤以什么顺序、在哪个事务里、带哪些订单新字段被触发」。
//
// 完整事务顺序（§24.5 补全版，逐条对应）：
//   BEGIN
//    锁钱包（FOR UPDATE）            ← 第二套账本，§11.7 第 2 条
//    锁库存 / 读商品
//    服务端重算成交价与总额（§22.6）
//    校验最低价（type 3）/ 强制分销价（type 2）
//    写订单（payment_status 置为已支付 + 回填 paid_amount）   ← §6.5.1 ②
//    写订单明细
//    扣钱包 + 写钱包流水              ← §11.7 三联事务
//    核销水票（仅 type 2，复用 writeOffTickets）
//    扣库存（复用 deductInventoryForSale）
//    营收入账 postOrderRevenue        ← type 2 会拆两账户
//    [type 2 且非小程序] addStationDebt ← **小程序订单跳过**，§6.5.1 ①
//   COMMIT
//
// 关键约束（§24.5）：
//   ① 两套账本（wallet_accounts 与 finance_accounts）必须**同一事务**完成，
//      否则会出现「钱包扣了但营收没入账」或反之 —— 这类差异不会自动暴露，只能靠对账发现；
//   ② 既有入账函数不改写，小程序只是多触发一次钱包扣减；
//   ③ 账户停用（finance_accounts.status = 0）时 postOrderRevenue 会抛业务错误并整体回滚，
//      **不得吞掉该错误后仍扣钱包**；
//   ④ 回滚后钱包余额必须回到原值，且**不留下 wallet_transactions 记录**（同事务保证）。
// ===========================================================================
const { pool } = require('../config/db');
const {
  fetchProductMap,
  buildOrderItems,
  writeOffTickets,
  deductInventoryForSale,
  assertSalesmanMinPrice,
  stripClientUnitPrice
} = require('./orderPricingService');
const { postOrderRevenue, revertOrderRevenue } = require('./orderRevenuePosting');
const walletService = require('./walletService');
const { generateOrderId } = require('../utils/orderIdGen');
const { hashRequest } = require('../utils/requestHash');
const { restoreWrittenOffTickets } = require('./orderPricingService');
const { restoreSalesEffects } = require('./orderPricingService');
const {
  MINI_ROLES,
  ROLE_TO_OWNER_TYPE,
  MINI_ORDER_TYPE,
  ORDER_SOURCE,
  PAYMENT_METHOD,
  FULFILLMENT_TYPE,
  FULFILLMENT_STATUS,
  REFUND_STATUS,
  ORDER_SCENE,
  WALLET_TX_TYPE,
  WALLET_RELATED_TYPE,
  IDEM_SCOPE,
  IDEM_KEY_MAX_LEN,
  AUDIT_ACTION,
  MINI_MESSAGE
} = require('../constants/mini');

const {
  round2,
  businessError,
  ensureWallet,
  loadWalletForUpdate,
  creditWallet,
  writeAuditLog,
  claimIdempotency,
  completeIdempotency,
  findTransactionsByRelated
} = walletService;

// ── 工具 ─────────────────────────────────────────────────────────────────────
/**
 * ★ 解析下单的积分分配（双积分，2026-09-23）
 *
 * 请求体字段（驼峰 —— D7 normalizeBody 已把 snake_case 归一）：
 *   pointsRecharge      充值积分抵扣额
 *   pointsDeliveryFee   配送费积分抵扣额
 *
 * 规则（业务方确认：两类可混合，**由用户自己选**各出多少）：
 *   ① 两个字段都不传 → **自动分配**：先用配送费积分（专款专用），不足部分用充值积分。
 *      保留这条兜底是为了让老调用方（以及将来可能的其他入口）不传也能下单；
 *      水站手上有配送费积分时也不会被白白闲置（否则明明够钱却下不了单）。
 *   ② 传了就按传的来，但**之和必须等于应付积分** —— 小程序订单只能钱包足额支付、
 *      不产生欠款（§3.6 / §6.5.1）；允许少付等于凭空产生应收账款，而系统里没有
 *      在线支付来补这笔钱。
 *   ③ 负数、超可用余额一律拒绝 —— 后者由 applyTransaction 按**分账户**兜底校验
 *      （总额够但那一类不够同样会被拦，文案指明是哪一类积分不足）。
 */
function resolvePointsSplit(body, payable, walletRow) {
  const has = v => v !== undefined && v !== null && v !== '';
  const givenRecharge = has(body.pointsRecharge);
  const givenDelivery = has(body.pointsDeliveryFee);

  if (!givenRecharge && !givenDelivery) {
    const availableDelivery = round2(walletRow.delivery_fee_balance || 0);
    const useDelivery = round2(Math.min(availableDelivery, payable));
    return { recharge: round2(payable - useDelivery), deliveryFee: useDelivery, auto: true };
  }

  const recharge = round2(givenRecharge ? body.pointsRecharge : 0);
  const deliveryFee = round2(givenDelivery ? body.pointsDeliveryFee : 0);
  if (!Number.isFinite(recharge) || !Number.isFinite(deliveryFee) || recharge < 0 || deliveryFee < 0) {
    throw businessError('抵扣积分不能为负数或非数字');
  }
  const sum = round2(recharge + deliveryFee);
  if (Math.abs(sum - round2(payable)) > 0.005) {
    throw businessError(`抵扣积分之和（${sum}）必须等于应付积分（${round2(payable)}）`);
  }
  return { recharge, deliveryFee, auto: false };
}

/** 履约状态 → 中文（下发给小程序，前端不再维护一份映射） */
const FULFILLMENT_LABEL = {
  [FULFILLMENT_STATUS.PAID]: '已支付',
  [FULFILLMENT_STATUS.PROCESSING]: '备货中',
  [FULFILLMENT_STATUS.DELIVERING]: '配送中',
  [FULFILLMENT_STATUS.COMPLETED]: '已完成',
  [FULFILLMENT_STATUS.CANCELED]: '已取消'
};
const REFUND_LABEL = {
  [REFUND_STATUS.NONE]: '未退款',
  [REFUND_STATUS.REFUNDING]: '退款中',
  [REFUND_STATUS.REFUNDED]: '已退款'
};

/** 请求指纹：同幂等键但业务参数不同 → 视为客户端异常（§23.1）
 *  ⚠️ 已抽到 utils/requestHash.js 单源（2026-09-21）：管理端写操作也需要同一个指纹，
 *      各写一版会让「hash 怎么来的」分散在两处；且明文拼接串会超 varchar(64) 列宽。 */

/** 事务内二次校验主体状态（§4.5.1 第 4 条：防止「校验通过 → 扣款前被禁用」的竞态） */
async function assertSubjectActiveInTx(conn, role, targetId) {
  if (role === MINI_ROLES.SALESMAN) {
    const [rows] = await conn.execute('SELECT status FROM workers WHERE worker_id = ?', [targetId]);
    if (!rows.length || Number(rows[0].status) !== 1) {
      throw businessError('绑定的业务员已被停用，无法下单');
    }
  } else if (role === MINI_ROLES.STATION) {
    const [rows] = await conn.execute('SELECT status FROM sub_stations WHERE station_id = ?', [targetId]);
    if (!rows.length || Number(rows[0].status) !== 1) {
      throw businessError('绑定的水站已被停用，无法下单');
    }
  }
}

/** 取主体档案（下单快照用） */
async function loadStationProfile(conn, stationId) {
  const [rows] = await conn.execute(
    `SELECT station_id, station_name, contact_name, phone, address, status
       FROM sub_stations WHERE station_id = ?`,
    [stationId]
  );
  if (!rows.length) throw businessError('水站档案不存在');
  return rows[0];
}

// ── 下单 ─────────────────────────────────────────────────────────────────────
/**
 * 创建小程序订单（业务员 type 3 / 直营水站 type 2）
 *
 * @param {object} mini  req.mini（身份一律来自令牌，**不接受请求体传入**，§22.2 / §51.2 第 3 条）
 * @param {object} body  请求体（驼峰；全局 normalizeBody 已归一）
 * @returns {Promise<object>} 订单详情
 */
async function createMiniOrder(mini, body) {
  // ① 角色 → 订单类型（文档 §6.3 / §6.4；不新造 type 7）
  let orderType;
  let buyerType;
  if (mini.role === MINI_ROLES.SALESMAN) {
    orderType = MINI_ORDER_TYPE.SALESMAN; // 3 线下零售
    buyerType = 'SALESMAN';
  } else if (mini.role === MINI_ROLES.STATION) {
    orderType = MINI_ORDER_TYPE.STATION; // 2 直营水站销售
    buyerType = 'STATION';
  } else {
    // 管理员端订单管理属 Phase 8b（写操作全覆盖）；本期 8a 为只读，故此处明确拒绝，
    // 而不是「顺带支持」——那会让 requireMiniAdmin 的保护面在订单域失效。
    throw businessError('管理员下单请使用 Web 管理端（小程序管理员端本期为只读，见文档 §43 Phase 8a）');
  }

  // ② 入参基础校验
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw businessError('商品明细不能为空');

  // 履约方式：**白名单校验，只认 DELIVERY**（自提已于 2026-09-20 下线）
  //
  // ⚠️ 这里是「自提下线」的唯一强制点，写法上有两条刻意的选择：
  //   ① 用**白名单**而不是 `!== 'PICKUP'` 的黑名单 —— 黑名单只能拦住拼写完全一致的
  //      'PICKUP'，`'PICKUP_SELF'` / `'pickup'`（大写化后能拦住）/ `'SELF_PICKUP'` 之类
  //      会漏过去，落库成一个既非配送也非自提的第三种值；
  //   ② 缺失时**不默认成 DELIVERY** —— 与改动前行为一致（原先缺失也不在 [DELIVERY, PICKUP] 内），
  //      且下单是要扣钱的动作，宁可让调用方显式声明。
  //    前端已无自提入口，所以这里的拒绝只会被抓包/脚本触发，但仍必须存在：
  //    否则「界面删了、接口还收」就是一个可被利用的半状态。
  const fulfillmentType = String(body.fulfillmentType || '').toUpperCase();
  if (fulfillmentType !== FULFILLMENT_TYPE.DELIVERY) {
    throw businessError(MINI_MESSAGE.FULFILLMENT_INVALID);
  }

  // ③ 幂等键（§23.1：客户端在点「提交订单」那一刻生成一次，重试复用同一个键）
  const clientRequestId = body.clientRequestId || body.idempotencyKey;
  if (!clientRequestId || String(clientRequestId).length > IDEM_KEY_MAX_LEN) {
    throw businessError(`缺少或非法 clientRequestId（幂等键，长度不超过 ${IDEM_KEY_MAX_LEN}）`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ④ 幂等占用（必须与业务同事务写入，不能事后补写）
    const idemScope = `${IDEM_SCOPE.CREATE_ORDER}:${buyerType}:${mini.targetId}`;
    const claim = await claimIdempotency(conn, {
      scope: idemScope,
      key: String(clientRequestId),
      requestHash: hashRequest({
        orderType,
        fulfillmentType,
        orderScene: body.orderScene || null,
        customerName: body.customerName || null,
        customerPhone: body.customerPhone || null,
        customerAddress: body.customerAddress || null,
        items: items.map(i => ({
          productId: i.productId || i.product_id,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice !== undefined ? Number(i.unitPrice) : null,
          useTicket: !!i.useTicket,
          ticketQty: Number(i.ticketQty || 0)
        }))
      }),
      miniAccountId: mini.accountId
    });

    if (claim.conflict) {
      // §23.1：同键不同参数 → 客户端异常，返回 400 并记录日志，**不得静默按首次参数执行**
      await conn.rollback();
      console.error('[miniOrder] 幂等键冲突（同键不同参数）:', idemScope, clientRequestId);
      throw businessError('重复提交的请求内容不一致，请刷新后重试');
    }
    if (claim.replayed && claim.resultRef) {
      // 首次已成功 → 返回首次成功的**同一结果**（HTTP 200，不报错、不新建单）
      await conn.rollback();
      return { orderId: claim.resultRef, replayed: true };
    }
    if (claim.replayed && !claim.resultRef) {
      // 首次仍在进行中（同事务未提交时另一个请求已占用）：明确告知处理中，不得并发进入扣款
      await conn.rollback();
      throw businessError('订单正在处理中，请勿重复提交');
    }

    // ⑤ 主体状态事务内二次校验（§4.5.1 第 4 条）
    await assertSubjectActiveInTx(conn, mini.role, mini.targetId);

    // ⑥ 锁钱包（第二套账本）+ 取主体档案快照
    const ownerType = ROLE_TO_OWNER_TYPE[mini.role];
    const subject = mini.role === MINI_ROLES.STATION ? await loadStationProfile(conn, mini.targetId) : null;
    const wallet = await ensureWallet(conn, {
      ownerType,
      ownerId: mini.targetId,
      ownerName: subject ? subject.station_name : null
    });
    const walletRow = await loadWalletForUpdate(conn, wallet.wallet_id);

    // ⑦ 读商品 + 服务端定价（§22.6：前端传的金额只用于展示，入库/扣款/入账一律以服务端重算值为准）
    //
    // ⚠️ 直营水站订单（type 2）：§9.1「小程序首期禁止水站手工修改商品单价」→
    //    显式抹掉前端传入的单价，让定价服务回退到 products.wholesale_price。
    //    这不是「少做了一层校验」，而是把「前端值无效」做到位：抹掉之后前端就算伪造
    //    也没有任何字段可以被采信（§44.13 ① 对分销配送费是同一思路）。
    const pricingItems = orderType === MINI_ORDER_TYPE.STATION ? stripClientUnitPrice(items) : items;

    const productMap = await fetchProductMap(conn, pricingItems);

    // ⑧ 业务员订单：最低成交价校验（§8.4 / §8.5；§7.5 业务方已确认：自购同样受约束，2026-09-20）
    // ⚠️ 刻意**只按 orderType 判断、不看 orderScene** —— 自购与代客走同一道校验。
    //    若将来有人想「自购免校验」，等于给低价单开一条除「选自己订货」外无需任何技巧的通道。
    if (orderType === MINI_ORDER_TYPE.SALESMAN) {
      assertSalesmanMinPrice(productMap, pricingItems);
    }

    const { orderItems, orderAmount, hasTicketDeduct, ticketDemand } = buildOrderItems({
      orderType,
      items: pricingItems,
      productMap
    });
    const totalReceivable = round2(orderAmount); // delivery_fee 恒为 0（既有口径）

    // ⑨ 客户与地址快照（§7.2 / §10.2 / §10.3）
    // 注：自提下线后，所有订单都是配送单 → 地址一律必填（原先自提可免地址的分支已删）
    const snapshot = resolveCustomerSnapshot({
      role: mini.role,
      body,
      subject,
      orderType
    });

    // ⑩ 配送执行方（§10.5：继续沿用既有 delivery_type / worker_id 机制，不把两个维度混用）
    const delivery = await resolveDeliveryExecution(conn, { role: mini.role, body });

    // ⑪ 订单场景（仅业务员）
    let orderScene = null;
    if (orderType === MINI_ORDER_TYPE.SALESMAN) {
      orderScene = String(body.orderScene || '').toUpperCase();
      if (![ORDER_SCENE.SELF_PURCHASE, ORDER_SCENE.CUSTOMER_ORDER].includes(orderScene)) {
        throw businessError('请选择订货场景（自购 / 代客下单）');
      }
    }

    // ⑫ 写订单：payment_status 直接置为已支付 + 回填 paid_amount（§6.5.1 ②）
    const orderId = await generateOrderId(conn);
    const now = new Date();
    // ⚠️ created_by 是 workers.worker_id 的外键：业务员订单可填，水站订单**必须为空**
    //    （sub_stations.station_id 不是合法 workers 值，强行填会触发外键错误）
    const createdBy = mini.role === MINI_ROLES.SALESMAN ? mini.targetId : null;

    await conn.execute(
      `INSERT INTO orders (
         order_id, order_type, platform_type, platform_order_no, station_id, machine_station_id,
         customer_name, customer_phone, customer_address, contact_name, order_amount,
         delivery_fee, total_receivable, delivery_type, worker_id,
         payment_status, paid_amount, created_by, remark, created_at, updated_at,
         order_source, buyer_type, buyer_id, payment_method, wallet_id,
         fulfillment_type, fulfillment_status, order_scene, refund_status, created_from_mini_account_id
       ) VALUES (?, ?, NULL, NULL, ?, NULL,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         1, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?)`,
      [
        orderId,
        orderType,
        orderType === MINI_ORDER_TYPE.STATION ? mini.targetId : null,
        snapshot.customerName,
        snapshot.customerPhone,
        snapshot.customerAddress,
        snapshot.contactName,
        orderAmount,
        0,
        totalReceivable,
        delivery.deliveryType,
        delivery.workerId,
        totalReceivable,
        createdBy,
        body.remark || null,
        now,
        now,
        ORDER_SOURCE.MINI_PROGRAM,
        buyerType,
        mini.targetId,
        PAYMENT_METHOD.WALLET,
        walletRow.wallet_id,
        fulfillmentType,
        FULFILLMENT_STATUS.PAID,
        orderScene,
        REFUND_STATUS.NONE,
        mini.accountId
      ]
    );

    // ⑬ 写明细 + 扣库存
    for (const item of orderItems) {
      await conn.execute(
        `INSERT INTO order_items (
           order_id, product_id, quantity, unit_price,
           purchase_price, wholesale_price, retail_price, machine_price,
           total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee,
           worker_wholesale_delivery_fee, worker_machine_delivery_fee, pricing_type, ticket_qty, subtotal
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.purchase_price,
          item.wholesale_price,
          item.retail_price,
          item.machine_price,
          item.total_delivery_fee,
          item.distribution_delivery_fee,
          item.worker_retail_delivery_fee,
          item.worker_wholesale_delivery_fee,
          item.worker_machine_delivery_fee,
          item.pricing_type || 1,
          item.ticket_qty || 0,
          item.subtotal
        ]
      );
    }

    // ⑭ 扣钱包 + 写流水（三联事务的中间一环；积分不足在此抛业务错误 → 整体回滚，§14.3）
    // ★ 双积分（2026-09-23）：可用「充值积分 + 配送费积分」**自选分配**抵扣，
    //   拆成两条流水（各类型一条，同一 orderId）—— 对账与退款都按类型逐条走。
    const split = resolvePointsSplit(body, totalReceivable, walletRow);
    const paySplit = await walletService.debitWalletBySplit(
      conn,
      walletRow,
      { rechargeAmount: split.recharge, deliveryFeeAmount: split.deliveryFee },
      {
        txType: WALLET_TX_TYPE.ORDER_PAYMENT,
        relatedType: WALLET_RELATED_TYPE.ORDER,
        relatedId: orderId,
        operatorId: `mini:${mini.accountId}`,
        operatorRole: mini.role,
        remark: `小程序订单 ${orderId} 消费（充值积分 ${split.recharge} + 配送费积分 ${split.deliveryFee}）`
      }
    );
    const payTx = paySplit.txs[0] || null;

    // ⑮ 库存扣减（复用既有单源函数，行锁 + 允许负数）
    for (const item of orderItems) {
      await deductInventoryForSale(conn, item.product_id, item.quantity, now);
    }

    // ⑯ 水票核销（仅 type 2；仅核销实际抵扣张数，§9.2 / §9.3）
    if (hasTicketDeduct) {
      await writeOffTickets(conn, mini.targetId, ticketDemand, orderId, productMap, now);
    }

    // ⑰ 营收入账（既有函数，type 2 会拆两账户：水票抵扣→农夫上单账户 / 未抵扣→晟之溪公户）
    //    ⚠️ 这里**不 try/catch 吞错**：账户停用时它会抛业务错误，必须整体回滚（§24.5 约束 3）
    await postOrderRevenue(
      conn,
      { order_id: orderId, order_type: orderType, customer_name: snapshot.customerName },
      orderItems,
      `mini:${mini.accountId}`
    );

    // ⑱ ⚠️ 小程序水站订单**不得**增加水站欠款（§6.5.1）
    //    这里是「刻意什么都不做」的位置：既有 orderController 在 type 2 且 p.stationId 时
    //    **无条件**调用 addStationDebt（orderController.js:352），小程序订单必须跳过该分支。
    //    （因而不复用 restoreSalesEffects —— 它内含 current_debt 回减，对未加过欠款的
    //     小程序订单执行会让欠款变成负数。）
    //    小程序订单只能钱包足额支付，不产生欠款（§3.6 / §6.5）。

    // ⑲ 幂等结果回填 + 审计
    await completeIdempotency(conn, { scope: idemScope, key: String(clientRequestId), resultRef: orderId });
    await writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_ORDER,
      actorType: 'MINI',
      actorId: `mini:${mini.accountId}`,
      targetType: 'ORDER',
      targetId: orderId,
      detail: {
        orderType,
        buyerType,
        buyerId: mini.targetId,
        amount: totalReceivable,
        walletId: walletRow.wallet_id,
        fulfillmentType,
        orderScene,
        payTx: payTx ? payTx.transaction_no : null,
        pointsSplit: {
          recharge: split.recharge,
          deliveryFee: split.deliveryFee,
          auto: split.auto,
          txs: paySplit.txs.map(t => ({ pointsType: t.points_type, no: t.transaction_no, amount: t.amount }))
        }
      }
    });

    await conn.commit();
    return { orderId, replayed: false };
  } catch (e) {
    // 回滚后钱包余额回到原值，且不留下 wallet_transactions 记录（同事务保证，§24.5 约束 4）
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[miniOrder] 回滚失败:', rollbackErr);
    }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 客户与地址快照（§7.2 / §7.3 / §10.2 / §10.3）
 * ⚠️ 订单必须保存最终地址快照，历史订单不随水站档案地址变化（§10.3）
 */
function resolveCustomerSnapshot({ role, body, subject, orderType }) {
  const bodyName = (body.customerName || '').trim();
  const bodyPhone = (body.customerPhone || '').trim();
  const bodyAddress = (body.customerAddress || '').trim();

  let customerName = bodyName;
  let customerPhone = bodyPhone;

  // 直营水站：客户默认取水站档案（联系人 / 电话），允许覆盖
  if (role === MINI_ROLES.STATION && subject) {
    if (!customerName) customerName = subject.contact_name || subject.station_name;
    if (!customerPhone) customerPhone = subject.phone || '';
  }

  // §7.3：业务员自购时，客户字段可用业务员本人作为收货人快照
  if (role === MINI_ROLES.SALESMAN && orderType === MINI_ORDER_TYPE.SALESMAN && !customerName) {
    customerName = '';
  }

  // §7.2 / 现状一致：所有非机台类型强制校验「客户姓名 + 客户电话」
  // （既有 orderController.js:235-237 已对所有非机台类型强制，故本节不构成新增约束）
  if (!customerName) throw businessError('客户姓名不能为空');
  if (!customerPhone) throw businessError('客户电话不能为空');
  if (!/^[0-9+\-\s]{6,20}$/.test(customerPhone)) throw businessError('客户电话格式不正确');

  // 地址：自提下线后**所有订单都是配送单，地址一律必填**（原先「自提可免地址」的分支已删）
  // §10.2 地址来源二选一：STATION_DEFAULT（水站默认地址）/ ORDER_CUSTOM（本次临时填写）
  let customerAddress = null;
  const source = String(body.addressSource || '').toUpperCase();
  if (role === MINI_ROLES.STATION && subject && source === 'STATION_DEFAULT') {
    customerAddress = subject.address || null;
    if (!customerAddress) throw businessError('水站档案未维护地址，请选择「本次临时填写地址」');
  } else {
    customerAddress = bodyAddress || null;
  }
  if (!customerAddress) throw businessError('配送地址不能为空');

  return {
    customerName,
    customerPhone,
    customerAddress,
    // contact_name 与 customer_name 保持一致的收货人语义（既有字段，用于打印）
    contactName: customerName
  };
}

/**
 * 配送执行方（§10.5）
 * ⚠️ delivery_type 与 fulfillment_type 是**两个维度**，不互相替代（§10.1.1）：
 *      fulfillment_type = 怎么取货（自提下线后恒为 DELIVERY）
 *      delivery_type    = 谁去送
 * 取值由角色推导（不接受前端指定），避免把「配送方式」变成可绕过统计口径的入参：
 *      业务员 + 配送  → 1（自有员工配送）
 *      直营水站 + 配送 → 2（水站配送）
 *
 * ⚠️ 2026-09-20 自提下线时删掉了「自提 → delivery_type = 3（无需配送）」这一分支。
 *    因此本函数现在**只可能返回 1 或 2**，不会产出不参与配送统计的订单。
 */
async function resolveDeliveryExecution(conn, { role, body }) {
  const deliveryType = role === MINI_ROLES.STATION ? 2 : 1;

  // 可选指派配送员工：仅做「存在且在职」的完整性校验，不做业务规则扩展
  const workerId = body.deliveryStaffId || body.workerId || null;
  if (workerId) {
    const [rows] = await conn.execute('SELECT status FROM workers WHERE worker_id = ?', [workerId]);
    if (!rows.length) throw businessError('指定的配送员工不存在');
    if (Number(rows[0].status) !== 1) throw businessError('指定的配送员工已离职，无法指派');
  }
  return { deliveryType, workerId };
}

// ── 取消 / 退款 ───────────────────────────────────────────────────────────────
/**
 * 订单可取消 / 可退款的履约前置条件
 *
 * ⚠️ 文档 §16.1 第 4 条明确要求：「取消与退款是两条路径 …… 二者同时发生时的优先级
 *    须在实现时定死**并回写本节**」。以下是本实现的定死口径（V1.1 落地补充）：
 *
 *   | 路径   | 允许的履约状态                          | 结果                                                        |
 *   |--------|----------------------------------------|-------------------------------------------------------------|
 *   | 取消   | PAID / PROCESSING（尚未发货）            | 钱包全额退款 + refund_status=REFUNDED + canceled_at + 履约=CANCELED |
 *   | 退款   | DELIVERING / COMPLETED                 | 钱包全额退款 + refund_status=REFUNDED，**履约状态保留退款前最后事实**（不写成「已取消」） |
 *
 *   为什么取消必然同时退款：小程序订单是**下单即钱包支付**（§14.1），不存在「未支付的取消」，
 *   所以取消与退款在小程序侧天然重合；而 Web 侧未支付订单的取消仍只走 canceled_at。
 *
 * 库存/水票恢复条件（§15.3「恢复库存（符合条件时）」的落地）：
 *   当且仅当 `fulfillment_status !== COMPLETED`（尚未完成交付）时恢复库存与水票。
 *   —— 已完成交付后退款属「已出货」，库存需实物退回后人工盘库，不能自动加回。
 */
function assertCancelable(order) {
  if (order.canceled_at) throw businessError('订单已取消');
  if (Number(order.order_type) !== MINI_ORDER_TYPE.SALESMAN && Number(order.order_type) !== MINI_ORDER_TYPE.STATION) {
    throw businessError('该订单不支持在小程序内取消');
  }
  const st = order.fulfillment_status;
  if (![FULFILLMENT_STATUS.PAID, FULFILLMENT_STATUS.PROCESSING].includes(st)) {
    throw businessError(`订单当前状态为「${FULFILLMENT_LABEL[st] || st}」，无法取消；如需退款请申请退款`);
  }
}

function assertRefundable(order) {
  if (order.refund_status === REFUND_STATUS.REFUNDED) throw businessError('订单已退款，请勿重复申请');
  if (order.refund_status === REFUND_STATUS.REFUNDING) throw businessError('退款正在处理中，请稍候');
  const st = order.fulfillment_status;
  if (![FULFILLMENT_STATUS.DELIVERING, FULFILLMENT_STATUS.COMPLETED].includes(st)) {
    throw businessError(`订单当前状态为「${FULFILLMENT_LABEL[st] || st}」，请使用「取消订单」`);
  }
}

/**
 * 订单结算回滚的共享实现（取消 / 退款共用）
 *
 * 全过程在同一事务内（§15.3 流程），顺序：
 *   检查状态 → 恢复库存（符合条件时）→ 恢复水票（若有）→ 钱包 + 原订单实际扣除积分
 *   → 生成 REFUND 流水 → 订单进入已退款状态
 *
 * ⚠️ 退款金额取「原 ORDER_PAYMENT 流水的 amount」这个**权威值**，而不是用订单总额重算。
 *    原因：type 2 订单里水票抵扣的件数并不扣积分，用订单总额重算必然多退（§15.3 原文
 *    「钱包 + 原订单实际扣除积分」）。
 */
async function settleOrderReversal(conn, order, { reason, operatorId, operatorRole, markCanceled }) {
  // 1) 找买单流水（小程序订单必然有一条 ORDER_PAYMENT；没有则说明不是钱包支付订单）
  const payTxs = await findTransactionsByRelated(conn, {
    relatedType: WALLET_RELATED_TYPE.ORDER,
    relatedId: order.order_id,
    txType: WALLET_TX_TYPE.ORDER_PAYMENT
  });
  if (!payTxs.length) throw businessError('该订单不是积分钱包支付的订单，无法在小程序内退款');
  const payTx = payTxs[0];

  // 2) 幂等（§15.4）：已有 REFUND 流水 → 不得再次加积分，返回「已退款」
  const refundTxs = await findTransactionsByRelated(conn, {
    relatedType: WALLET_RELATED_TYPE.ORDER,
    relatedId: order.order_id,
    txType: WALLET_TX_TYPE.REFUND
  });
  if (refundTxs.length) {
    return { alreadySettled: true, refundTx: refundTxs[0] };
  }

  const notDelivered = order.fulfillment_status !== FULFILLMENT_STATUS.COMPLETED;

  // 3) 恢复库存：复用单源函数 deductInventoryForSale（传负数量即恢复），
  //    好处是同样走 FOR UPDATE 行锁与「库存记录必须存在」的校验。
  //    ⚠️ 刻意**不复用 restoreSalesEffects** —— 它内含「扣减水站 current_debt」，
  //       而小程序水站订单从未增加欠款，复用会让欠款变负（§6.5.1 的反向陷阱）。
  if (notDelivered) {
    const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [
      order.order_id
    ]);
    for (const it of items) {
      await deductInventoryForSale(conn, it.product_id, -Number(it.quantity));
    }
    // 4) 恢复已核销水票（复用既有实现，不重写水票恢复算法，§37）
    await restoreWrittenOffTickets(conn, order.order_id);
  }

  // 5) 钱包 + 原订单实际扣除积分（三联事务：余额 + 流水同事务）
  const walletRow = await walletService.loadWalletForUpdateIncludingDisabled(conn, order.wallet_id);
  // ⚠️ 双积分（2026-09-23）：混合抵扣会产生**多条** ORDER_PAYMENT 流水，
  //    必须**逐条**按原类型、原金额回冲。若只退第一条（本函数早先的写法），
  //    配送费积分那部分就永远退不回来 —— 而总额恒等式**仍然成立**，属静默错账。
  const createdRefunds = [];
  for (const pay of payTxs) {
    createdRefunds.push(
      await creditWallet(conn, walletRow, {
        txType: WALLET_TX_TYPE.REFUND,
        amount: round2(pay.amount),
        // 按原流水的积分类型回补（不得一律记成充值积分）
        pointsType: pay.points_type,
        relatedType: WALLET_RELATED_TYPE.ORDER,
        relatedId: order.order_id,
        reversalOf: pay.transaction_id,
        operatorId,
        operatorRole,
        remark: reason || `订单 ${order.order_id} 退款`
      })
    );
  }
  const refundTx = createdRefunds[0] || null;

  // 6) 回冲营收入账（既有函数；与钱包回补同事务，保证两套账本一致，§24.5 约束 1）
  await revertOrderRevenue(conn, order.order_id);

  // 7) 订单状态
  if (markCanceled) {
    await conn.execute(
      `UPDATE orders SET canceled_at = NOW(), fulfillment_status = ?, refund_status = ?, updated_at = NOW()
        WHERE order_id = ?`,
      [FULFILLMENT_STATUS.CANCELED, REFUND_STATUS.REFUNDED, order.order_id]
    );
  } else {
    // ⚠️ §16.1 第 3 条：退款成功后履约状态**保持退款前的最后事实**，不写成「已取消」
    await conn.execute(`UPDATE orders SET refund_status = ?, updated_at = NOW() WHERE order_id = ?`, [
      REFUND_STATUS.REFUNDED,
      order.order_id
    ]);
  }

  return { alreadySettled: false, refundTx, restoredStock: notDelivered, payTx };
}

/** 取消订单（用户主动，尚未发货） */
async function cancelMiniOrder(mini, orderId, { reason }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT order_id, order_type, station_id, buyer_type, buyer_id, wallet_id, order_amount, paid_amount,
              payment_status, payment_method, fulfillment_status, refund_status, canceled_at
         FROM orders WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    if (!rows.length) throw businessError('订单不存在');
    const order = rows[0];

    // 越权防护：只能操作**自己**的订单（身份来自令牌，§22.2）
    assertOrderOwnership(order, mini);
    assertCancelable(order);

    const result = await settleOrderReversal(conn, order, {
      reason: reason || `订单 ${orderId} 取消并退款`,
      operatorId: `mini:${mini.accountId}`,
      operatorRole: mini.role,
      markCanceled: true
    });

    await writeAuditLog(conn, {
      action: AUDIT_ACTION.CANCEL_ORDER,
      actorType: 'MINI',
      actorId: `mini:${mini.accountId}`,
      targetType: 'ORDER',
      targetId: orderId,
      detail: {
        alreadySettled: result.alreadySettled,
        refundTx: result.refundTx ? result.refundTx.transaction_no : null
      }
    });

    await conn.commit();
    return { orderId, alreadySettled: result.alreadySettled };
  } catch (e) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[miniOrder] 取消回滚失败:', re);
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** 申请退款（已发货后，只支持全额退款，§15.3） */
async function refundMiniOrder(mini, orderId, { reason }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT order_id, order_type, station_id, buyer_type, buyer_id, wallet_id, order_amount, paid_amount,
              payment_status, payment_method, fulfillment_status, refund_status, canceled_at
         FROM orders WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    if (!rows.length) throw businessError('订单不存在');
    const order = rows[0];

    assertOrderOwnership(order, mini);
    assertRefundable(order);

    const result = await settleOrderReversal(conn, order, {
      reason: reason || `订单 ${orderId} 全额退款`,
      operatorId: `mini:${mini.accountId}`,
      operatorRole: mini.role,
      markCanceled: false
    });

    await writeAuditLog(conn, {
      action: AUDIT_ACTION.REFUND_ORDER,
      actorType: 'MINI',
      actorId: `mini:${mini.accountId}`,
      targetType: 'ORDER',
      targetId: orderId,
      detail: {
        alreadySettled: result.alreadySettled,
        refundTx: result.refundTx ? result.refundTx.transaction_no : null
      }
    });

    await conn.commit();
    return { orderId, alreadySettled: result.alreadySettled };
  } catch (e) {
    try {
      await conn.rollback();
    } catch (re) {
      console.error('[miniOrder] 退款回滚失败:', re);
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** 订单归属校验：只能读/操作自己的订单（§44.1：业务员A只能看到自己的业务数据） */
function assertOrderOwnership(order, mini) {
  if (mini.role === MINI_ROLES.ADMIN) return; // 管理员只读视角另由路由控制
  const isMine = order.buyer_type === mini.buyerType && order.buyer_id === mini.targetId;
  if (!isMine) throw businessError('无权操作该订单');
}

// ── Phase 8b 第 9 域：履约推进与管理员取消（§16 / §27）────────────────────────
// ⚠️ 在此之前全系统没有任何推进 `fulfillment_status` 的路径 —— 下单后永远停在 PAID，
//    「备货中 / 配送中 / 已完成」三个状态从未可达。本函数是这条状态机的**唯一入口**，
//    Web 端将来要做发货管理也应复用它（不要在别处再写一份 UPDATE）。

/** 履约状态机的合法前进顺序（§16；自提下线后没有 READY_FOR_PICKUP） */
const FULFILLMENT_FLOW = [
  FULFILLMENT_STATUS.PAID,
  FULFILLMENT_STATUS.PROCESSING,
  FULFILLMENT_STATUS.DELIVERING,
  FULFILLMENT_STATUS.COMPLETED
];

/**
 * 履约状态推进（管理员，§16 / §27）
 * 规则：
 *   · 只允许**前进**（目标在当前状态之后），不允许回退 —— 「已完成 → 配送中」会让
 *     「货已履约完成」这一事实被覆盖，与 §16.1「状态是事实记录」的设计相悖；
 *   · 允许跳级前进（PAID → COMPLETED）：内部订货里「货直接给客户」是真实场景，
 *     强制逐级会把管理动作变成三连点；
 *   · CANCELED 是终态（取消的单不允许再推进）；COMPLETED 也是终态（不可再推进）。
 * ⚠️ 接受外部连接（调用方的统一事务内：幂等占用 → 推进 → 审计 → complete → commit），
 *    审计也在这里写 —— 状态变更与审计必须同事务，否则会出现「状态变了但审计没落」。
 */
async function advanceFulfillment(conn, orderId, to, { operatorId } = {}) {
  if (!FULFILLMENT_FLOW.includes(to)) {
    throw businessError(`非法的履约状态「${to}」`);
  }

  const [rows] = await conn.execute(
    `SELECT order_id, order_source, fulfillment_status, refund_status, canceled_at
       FROM orders WHERE order_id = ? FOR UPDATE`,
    [orderId]
  );
  if (!rows.length) {
    throw Object.assign(businessError('订单不存在'), { status: 404 });
  }
  const order = rows[0];
  if (order.canceled_at || order.fulfillment_status === FULFILLMENT_STATUS.CANCELED) {
    throw businessError('订单已取消，无法推进履约状态');
  }
  const current = order.fulfillment_status || FULFILLMENT_STATUS.PAID; // 迁移加列前的历史单视为 PAID
  const fromIdx = FULFILLMENT_FLOW.indexOf(current);
  const toIdx = FULFILLMENT_FLOW.indexOf(to);
  if (fromIdx < 0) {
    throw businessError(`订单当前状态「${FULFILLMENT_LABEL[current] || current}」不在履约流程内，无法推进`);
  }
  if (toIdx <= fromIdx) {
    throw businessError(
      toIdx === fromIdx
        ? `订单已是「${FULFILLMENT_LABEL[to]}」，无需重复操作`
        : `不能从「${FULFILLMENT_LABEL[current]}」回退到「${FULFILLMENT_LABEL[to]}」`
    );
  }

  await conn.execute('UPDATE orders SET fulfillment_status = ?, updated_at = NOW() WHERE order_id = ?', [to, orderId]);

  await writeAuditLog(conn, {
    action: AUDIT_ACTION.ADVANCE_ORDER,
    actorType: 'MINI',
    actorId: operatorId,
    targetType: 'ORDER',
    targetId: orderId,
    detail: { from: current, to }
  });

  return { orderId, from: current, to };
}

/**
 * 管理员取消订单（§16.1：取消与退款是两条路径；已支付要退钱走退款）
 * 与业务员取消（cancelMiniOrder）的区别：
 *   · 不做归属校验（管理员可取消**任意**订单）；
 *   · 能处理**全来源**订单 —— Web 端建的现金单也要能取消，而业务员取消只认钱包支付的小程序单。
 * 两条链（都走已验证的既有路径，不重写）：
 *   · 钱包支付（有 ORDER_PAYMENT 流水）→ settleOrderReversal：库存 + 水票 + 钱包退回 + 营收回冲 + 状态；
 *   · 其余（现金/挂账单）→ restoreSalesEffects + 水票 + 营收回冲 + canceled_at（Web deleteOrder 等价链，
 *     补写 fulfillment_status = CANCELED —— 迁移加列后 Web 的取消不写这个字段）。
 * ⚠️ 接受外部连接（调用方统一事务），与 advanceFulfillment 同理。
 */
async function cancelOrderByAdmin(conn, orderId, { reason, operatorId } = {}) {
  const [rows] = await conn.execute(
    `SELECT order_id, order_source, order_type, station_id, wallet_id, order_amount, paid_amount,
            fulfillment_status, refund_status, canceled_at
       FROM orders WHERE order_id = ? FOR UPDATE`,
    [orderId]
  );
  if (!rows.length) throw Object.assign(businessError('订单不存在'), { status: 404 });
  const order = rows[0];
  if (order.canceled_at) throw businessError('订单已取消，请刷新后查看');

  // 钱包支付的小程序单：完整退款取消链（幂等：已有 REFUND 流水时 alreadySettled=true）
  let result = null;
  const payTxs = await findTransactionsByRelated(conn, {
    relatedType: WALLET_RELATED_TYPE.ORDER,
    relatedId: order.order_id,
    txType: WALLET_TX_TYPE.ORDER_PAYMENT
  });
  if (payTxs.length) {
    result = await settleOrderReversal(conn, order, {
      reason: reason || `管理员取消订单 ${orderId} 并退款`,
      operatorId,
      operatorRole: 'admin',
      markCanceled: true
    });
  } else {
    // 现金/挂账单：没有钱包可退。库存/水票/营收回冲与 Web 端取消语义一致。
    const [items] = await conn.execute('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
    await restoreSalesEffects(conn, order, items);
    await restoreWrittenOffTickets(conn, orderId);
    await revertOrderRevenue(conn, orderId);
    await conn.execute(
      'UPDATE orders SET canceled_at = NOW(), fulfillment_status = ?, updated_at = NOW() WHERE order_id = ?',
      [FULFILLMENT_STATUS.CANCELED, orderId]
    );
  }

  await writeAuditLog(conn, {
    action: AUDIT_ACTION.CANCEL_ORDER_ADMIN,
    actorType: 'MINI',
    actorId: operatorId,
    targetType: 'ORDER',
    targetId: orderId,
    detail: {
      source: order.order_source,
      walletRefunded: !!result,
      alreadySettled: result ? result.alreadySettled : null,
      reason: reason || null
    }
  });

  return { orderId, walletRefunded: !!result, alreadySettled: result ? result.alreadySettled : null };
}

module.exports = {
  createMiniOrder,
  cancelMiniOrder,
  refundMiniOrder,
  advanceFulfillment,
  cancelOrderByAdmin,
  assertOrderOwnership,
  FULFILLMENT_LABEL,
  REFUND_LABEL
};

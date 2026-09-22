/**
 * 订单定价/抵扣服务（D1/A1 重构）
 * 合并 orderController 中 createOrder/updateOrder/deleteOrder/hardDeleteOrder
 * 复制的四类逻辑：① 计算定价 ② 扣库存 ③ 抵水票 ④ 恢复（库存/欠款/水票）。
 *
 * 错误约定：业务校验失败抛 bizFail（err.business=true），
 * 由调用方 catch 统一 rollback 并返回 400；系统异常仍走 500。
 *
 * 定价口径（2026-08-27，2026-09-14 增补类型5）：
 *   类型1 送水到府（原「官方平台销售」）→ 进货价
 *   类型2 直营水站销售 → 行级混合：水票抵扣件数按进货价（不计金额）+ 剩余件数按分销价（手填或档案分销价）
 *   类型3 线下零售     → 零售价（手填或档案零售价）
 *   类型5 水公社       → 与线下零售同口径：零售价（手填或档案零售价），不支持水票抵扣
 *   类型4/6 机台供货   → 不计商品价格（价格在机台销量录入）
 *   delivery_fee 恒为 0
 */
const { TICKET_STATUS } = require('../constants/waterTicket');

const bizFail = message => {
  const e = new Error(message);
  e.business = true;
  return e;
};

/**
 * 提取订单请求体字段（create/update 共用）。
 * D7 约定：normalizeBody 中间件已把蛇形键统一转成驼峰，此处只读驼峰，不再写 `body.xxx_yyy || body.xxxYyy`。
 * 注意三个字段存在「前端历史驼峰别名」与「归一化后驼峰」两套名字，命名不同不可想当然：
 *   delivery_type → deliveryType，前端别名 deliveryMethod
 *   worker_id     → workerId，    前端别名 deliveryStaffId
 *   created_by    → createdBy，   前端别名 createdById
 */
function normalizeOrderPayload(body = {}) {
  return {
    orderType: body.orderType,
    platformType: body.platformType,
    platformOrderNo: body.platformOrderNo,
    stationId: body.stationId || null,
    machineStationId: body.machineStationId || null,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerAddress: body.customerAddress,
    contactName: body.contactName,
    deliveryType: body.deliveryMethod !== undefined ? body.deliveryMethod : body.deliveryType,
    workerId: (body.deliveryStaffId !== undefined ? body.deliveryStaffId : body.workerId) || null,
    createdById: (body.createdById !== undefined ? body.createdById : body.createdBy) || null,
    items: body.items || []
  };
}

/** 行字段驼峰/蛇形取值 */
function pick(item, snake, camel) {
  return item[snake] !== undefined ? item[snake] : item[camel];
}

/** 行手填单价的规范化读取（type 2/3/5 共用） */
function pickItemUnitPrice(item) {
  if (item.unit_price !== undefined) return Number(item.unit_price);
  if (item.unitPrice !== undefined) return Number(item.unitPrice);
  return null;
}

/**
 * 业务员小程序最低成交价校验（文档 §8.4 / §8.5 / §7.5）
 *
 * ⚠️ 为什么必须放在这里而不是 miniOrderController：§42.3 明确要求
 *    「订单修改必须优先扩展 services/orderPricingService.js，不要复制到 miniOrderController.js」。
 *    成交价的最终取值逻辑（手填 → 回退 retail_price）本来就在本文件的 buildOrderItems 里，
 *    校验若在别处再推一遍，两处一旦分叉就会出现「校验用 A、入库用 B」的静默漏洞。
 *
 * 规则（**V1.1 已定，不允许 AI 自行改变**）：
 *   ① 业务员成交价必须 >= salesman_min_price，否则拒绝下单（HTTP 400
 *      业务提示：「成交价低于公司允许的最低价格」）；
 *   ② 允许高于最低价，也允许高于商品参考零售价（只校验下界）；
 *   ③ §8.5：未开启 salesman_mini_enabled，**或**未配置有效 salesman_min_price 的商品，
 *      业务员**不可下单** —— 不得把「未配置」当成 0 元最低价
 *      （否则 retail_price = 0 的商品会意外变成可零元销售；现状核实：products.retail_price
 *        多数为 0.00，这正是必须守住这条的原因）；
 *   ④ §7.5：`order_scene`（SELF_PURCHASE / CUSTOMER_ORDER）**不影响**本校验 ——
 *      无论自购还是代客下单，一律执行。理由：最低成交价保护的是公司价格体系；
 *      若只约束「代客下单」，则任何低价单只要选「自购」即可绕过，规则形同虚设。
 *      ✅ **业务方已确认（2026-09-20）**：自购同样受最低成交价约束。
 *      文档原文即按此方向编写（§7.5「无论 SELF_PURCHASE 还是 CUSTOMER_ORDER，一律执行」），
 *      现由业务方拍板确认，不再是「按假设实现」。
 *      ⚠️ 因此本函数**不得**接收 `order_scene` 参数、不得按场景分支 ——
 *         一旦按场景放行，自购就成了绕过最低价的免费通道。
 *
 * ⚠️ 与前端的分工：前端 成交价输入框 + 最低价红字提示 只是**体验优化**，
 *    安全边界**只有**服务端这一处。前端可填成交价（Phase 3「成交价（前端可填）」），
 *    所以这里的校验不是可有可无的兜底，而是唯一的约束点。
 *
 * @param {object} productMap product_id → products 行（须含 salesman_mini_enabled / salesman_min_price）
 * @param {Array}  items      原始请求明细
 * @returns {Array<{productId:string, productName:string, unitPrice:number, minPrice:number}>} 校验明细（供审计）
 */
function assertSalesmanMinPrice(productMap, items) {
  const checked = [];
  for (const item of items) {
    const pid = item.product_id || item.productId;
    const product = productMap[pid];
    if (!product) throw bizFail(`商品不存在: ${pid}`);
    const name = product.product_name || pid;

    if (!Number(product.salesman_mini_enabled)) {
      throw bizFail(`商品「${name}」未开启业务员小程序销售，无法下单`);
    }

    const rawMin = product.salesman_min_price;
    const hasMin = rawMin !== null && rawMin !== undefined && rawMin !== '' && !isNaN(Number(rawMin));
    if (!hasMin) {
      throw bizFail(`商品「${name}」未配置最低成交价，无法下单（请联系管理员配置）`);
    }
    const minPrice = Number(rawMin);

    const rawUnit = pickItemUnitPrice(item);
    const unitPrice = rawUnit !== null && !isNaN(rawUnit) ? rawUnit : Number(product.retail_price);

    if (unitPrice + 1e-9 < minPrice) {
      throw bizFail(`商品「${name}」成交价 ${unitPrice} 低于公司允许的最低价格 ${minPrice}`);
    }
    checked.push({ productId: pid, productName: name, unitPrice, minPrice });
  }
  return checked;
}

/**
 * 直营水站小程序订单：把小程序的请求明细**规范化成服务端定价的输入**
 * （文档 §9.1：小程序首期禁止水站手工修改商品单价，直接使用系统水站分销价格）
 *
 * 做法：显式把手填单价抹掉（置 undefined），让 buildOrderItems 的 type 2 分支
 * 回退到 `product.wholesale_price`。这样价格**只能**由服务端从商品档案取，
 * 前端传什么都无效（§22.1 / §22.6「一切金额均由服务端重算」）。
 * ⚠️ 不要图省事在这里自己算价 —— 那是复制第二套价格算法（§41 头号禁止项）。
 */
function stripClientUnitPrice(items) {
  return items.map(it => {
    const next = { ...it };
    delete next.unit_price;
    delete next.unitPrice;
    return next;
  });
}

/** 查询并映射商品价格档案；任一商品不存在即 bizFail */
async function fetchProductMap(connection, items) {
  const productIds = items.map(item => item.product_id || item.productId);
  if (productIds.length === 0) return {};
  const placeholders = productIds.map(() => '?').join(',');
  const [productRows] = await connection.execute(
    `SELECT * FROM products WHERE product_id IN (${placeholders})`,
    productIds
  );
  const productMap = {};
  for (const p of productRows) productMap[p.product_id] = p;
  for (const item of items) {
    const pid = item.product_id || item.productId;
    if (!productMap[pid]) throw bizFail(`商品不存在: ${pid}`);
  }
  return productMap;
}

/**
 * 计算订单明细与金额（create/update 共用的定价核心）
 * @returns {{ orderItems: Array, orderAmount: number, hasTicketDeduct: boolean, ticketDemand: Object<string,number> }}
 */
function buildOrderItems({ orderType, items, productMap }) {
  const typeNum = Number(orderType);
  const isStationType = typeNum === 2;
  let orderAmount = 0;
  let hasTicketDeduct = false;
  const ticketDemand = {};
  const orderItems = [];

  for (const item of items) {
    const pid = item.product_id || item.productId;
    const product = productMap[pid];
    const quantity = Number(item.quantity);
    const itemUnitPrice =
      item.unit_price !== undefined
        ? Number(item.unit_price)
        : item.unitPrice !== undefined
          ? Number(item.unitPrice)
          : null;

    if (isNaN(quantity) || quantity <= 0) throw bizFail('商品数量必须为正数');

    // 直营水站销售：行级水票抵扣张数（use_ticket 勾选后生效，上限=数量，超出部分按分销价）
    let ticketQty = 0;
    if (isStationType) {
      const useTicket = pick(item, 'use_ticket', 'useTicket');
      if (useTicket) {
        ticketQty = Math.max(0, parseInt(pick(item, 'ticket_qty', 'ticketQty'), 10) || 0);
        if (ticketQty > quantity) {
          throw bizFail(`商品「${product.product_name}」水票抵扣张数(${ticketQty})不能大于数量(${quantity})`);
        }
        if (ticketQty > 0) {
          hasTicketDeduct = true;
          ticketDemand[pid] = (ticketDemand[pid] || 0) + ticketQty;
        }
      }
    }

    // 根据订单类型计算商品单价（配送费统一不计算，2026-08-27）
    let unitPrice = 0;
    switch (typeNum) {
      case 1:
        unitPrice = product.purchase_price;
        break;
      case 2:
        unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.wholesale_price;
        break;
      case 3:
      case 5: // 水公社（2026-09-14）：与线下零售同口径——单价可手填，不填回退零售价
        unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.retail_price;
        break;
      case 4: // 量贩机供货：不计算商品价格（价格在机台销量录入）
      case 6: // 零售机供货：同上
        unitPrice = 0;
        break;
    }

    // 行级小计：水票抵扣件数不计金额，仅未抵扣件数按分销价（2026-08-27）
    const subtotal = isStationType && ticketQty > 0 ? unitPrice * (quantity - ticketQty) : unitPrice * quantity;
    orderAmount += subtotal;

    // 快照价：水站分销(2)/线下零售(3)/水公社(5) 的单价由前端手动填写，快照需用手填值，
    // 否则财务统计（按 wholesale_price / retail_price）取到的是商品档案值而非成交值
    const snapshotWholesale =
      typeNum === 2 && itemUnitPrice !== null && !isNaN(itemUnitPrice) && itemUnitPrice >= 0
        ? itemUnitPrice
        : product.wholesale_price;
    const snapshotRetail =
      (typeNum === 3 || typeNum === 5) && itemUnitPrice !== null && !isNaN(itemUnitPrice) && itemUnitPrice >= 0
        ? itemUnitPrice
        : product.retail_price;

    orderItems.push({
      product_id: pid,
      quantity,
      unit_price: unitPrice,
      purchase_price: product.purchase_price,
      wholesale_price: snapshotWholesale,
      retail_price: snapshotRetail,
      machine_price: product.machine_price,
      total_delivery_fee: product.total_delivery_fee,
      distribution_delivery_fee: product.distribution_delivery_fee,
      worker_retail_delivery_fee: product.worker_retail_delivery_fee,
      worker_wholesale_delivery_fee: product.worker_wholesale_delivery_fee,
      worker_machine_delivery_fee: product.worker_machine_delivery_fee,
      pricing_type: isStationType && ticketQty > 0 ? 2 : 1,
      ticket_qty: isStationType ? ticketQty : 0,
      subtotal
    });
  }

  return { orderItems, orderAmount, hasTicketDeduct, ticketDemand };
}

/** 直营水站销售：聚合校验并核销水票（status 未用→已核销，关联订单）；票不足 bizFail（调用方回滚） */
async function writeOffTickets(connection, stationId, ticketDemand, orderId, productMap, now = new Date()) {
  for (const [pid, need] of Object.entries(ticketDemand)) {
    // ⚠️ 这个 SELECT 只是**预检**（为了给出「还剩几张」的友好文案），**它不是守卫**：
    //    它是普通读，在 REPEATABLE-READ 下读的是本事务第一次读时的快照 ——
    //    看不到「本事务开始之后、别人提交的核销」。真正的守卫在下面的条件更新上。
    const [tickets] = await connection.execute(
      `SELECT ticket_id FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = ? ORDER BY ticket_id LIMIT ${parseInt(need, 10)}`,
      [stationId, pid, TICKET_STATUS.UNUSED]
    );
    if (tickets.length < need) {
      throw bizFail(
        `水站水票不足：商品「${productMap[pid].product_name}」需抵扣 ${need} 张，可用 ${tickets.length} 张（剩余数量按分销价计价）`
      );
    }
    const placeholders = tickets.map(() => '?').join(',');
    // ⚠️⚠️ `AND status = ?` 不是装饰，是**唯一的并发守卫** —— 条件更新（CAS）。
    //    UPDATE 不受事务快照影响（永远基于最新已提交版本判定 WHERE），因此并发的第二笔
    //    会在这里命中 0 行 → affectedRows 不满足 need → 抛 bizFail → 整单回滚。
    //    ⚠️ 实测（smoke_concurrency 第 1 段，2026-09-22）：不加这个条件时，库里正好 3 张票、
    //    两笔订单各要 3 张，两笔都能通过上面的预检 → 同一批票被核销两次；后提交那笔把
    //    `order_id` 覆盖成自己，于是**先提交的订单已经按抵扣价结算、却没有任何一张票指向它**
    //    —— 账面完全看不出来（票数对得上、订单也查得到）。
    //    ⚠️ 这里刻意**不用 `SELECT ... FOR UPDATE`**：water_tickets 只有 station_id / product_id /
    //    status 三个**单列索引**（无联合索引），锁定读会把访问路径上扫到的不匹配行一起锁住，
    //    间隙锁面扩大 → 同水站不同商品的并发订单之间更容易互锁。CAS 只锁真正命中的那几行。
    const [upd] = await connection.execute(
      `UPDATE water_tickets SET status = ?, used_at = ?, order_id = ?
        WHERE ticket_id IN (${placeholders}) AND status = ?`,
      [TICKET_STATUS.USED, now, orderId, ...tickets.map(t => t.ticket_id), TICKET_STATUS.UNUSED]
    );
    if (upd.affectedRows !== need) {
      throw bizFail(
        `水站水票不足：商品「${productMap[pid].product_name}」需抵扣 ${need} 张，可核销 ${upd.affectedRows} 张（可能已被并发订单占用）`
      );
    }
  }
}

/** 还原该订单核销的水票（status 已核销→未用，清空核销关联），避免取消/改单/硬删永久损失水票 */
async function restoreWrittenOffTickets(connection, orderId) {
  await connection.execute(
    'UPDATE water_tickets SET status = ?, used_at = NULL, order_id = NULL WHERE order_id = ? AND status = ?',
    [TICKET_STATUS.UNUSED, orderId, TICKET_STATUS.USED]
  );
}

/** 销售扣库存（行锁 + 库存记录缺失 bizFail；允许负数） */
async function deductInventoryForSale(connection, productId, quantity, now = new Date()) {
  const [inventoryRows] = await connection.execute(
    'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
    [productId]
  );
  if (inventoryRows.length === 0) throw bizFail(`商品库存不存在: ${productId}`);
  const newQuantity = Number(inventoryRows[0].quantity) - Number(quantity);
  await connection.execute(
    'UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?',
    [newQuantity, now, now, productId]
  );
}

/**
 * 恢复订单的销售副作用：恢复库存 + 扣减水站欠款（deleteOrder/hardDeleteOrder/updateOrder 旧数据共用）
 * 注：原 mode='return'（旧返货单 type5 反向恢复库存）已随 type5 停用（2026-08-25）移除，恢复方向恒为"退回库存"
 */
async function restoreSalesEffects(connection, order, items) {
  const now = new Date();
  for (const item of items) {
    const [invRows] = await connection.execute('SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE', [
      item.product_id
    ]);
    if (invRows.length > 0) {
      const q = Number(invRows[0].quantity);
      const newQty = q + Number(item.quantity);
      await connection.execute('UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?', [
        newQty,
        now,
        item.product_id
      ]);
    }
  }

  // 如果是水站订单，扣减水站欠款（下限 0）
  if (Number(order.order_type) === 2 && order.station_id) {
    const [stRows] = await connection.execute(
      'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
      [order.station_id]
    );
    if (stRows.length > 0) {
      const newDebt = Math.max(0, Number(stRows[0].current_debt) - Number(order.order_amount));
      await connection.execute('UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?', [
        newDebt,
        now,
        order.station_id
      ]);
    }
  }
}

/** 水站订单欠款 += 金额（调用方自行判断订单类型） */
async function addStationDebt(connection, stationId, amount, now = new Date()) {
  const [stRows] = await connection.execute('SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE', [
    stationId
  ]);
  if (stRows.length > 0) {
    const newDebt = Number(stRows[0].current_debt) + Number(amount);
    await connection.execute('UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?', [
      newDebt,
      now,
      stationId
    ]);
  }
}

module.exports = {
  normalizeOrderPayload,
  fetchProductMap,
  buildOrderItems,
  writeOffTickets,
  restoreWrittenOffTickets,
  deductInventoryForSale,
  restoreSalesEffects,
  addStationDebt,
  // 小程序扩展（2026-09-20，文档 §8.4 / §9.1）—— 追加导出，不改既有行为
  assertSalesmanMinPrice,
  stripClientUnitPrice,
  pickItemUnitPrice
};

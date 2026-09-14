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

const bizFail = (message) => {
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
    const itemUnitPrice = item.unit_price !== undefined ? Number(item.unit_price)
      : (item.unitPrice !== undefined ? Number(item.unitPrice) : null);

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
      case 1: unitPrice = product.purchase_price; break;
      case 2: unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.wholesale_price; break;
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
    const subtotal = isStationType && ticketQty > 0
      ? unitPrice * (quantity - ticketQty)
      : unitPrice * quantity;
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
    const [tickets] = await connection.execute(
      `SELECT ticket_id FROM water_tickets WHERE station_id = ? AND product_id = ? AND status = ? ORDER BY ticket_id LIMIT ${parseInt(need, 10)}`,
      [stationId, pid, TICKET_STATUS.UNUSED]
    );
    if (tickets.length < need) {
      throw bizFail(`水站水票不足：商品「${productMap[pid].product_name}」需抵扣 ${need} 张，可用 ${tickets.length} 张（剩余数量按分销价计价）`);
    }
    const placeholders = tickets.map(() => '?').join(',');
    await connection.execute(
      `UPDATE water_tickets SET status = ?, used_at = ?, order_id = ? WHERE ticket_id IN (${placeholders})`,
      [TICKET_STATUS.USED, now, orderId, ...tickets.map(t => t.ticket_id)]
    );
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
    const [invRows] = await connection.execute(
      'SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE',
      [item.product_id]
    );
    if (invRows.length > 0) {
      const q = Number(invRows[0].quantity);
      const newQty = q + Number(item.quantity);
      await connection.execute(
        'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
        [newQty, now, item.product_id]
      );
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
      await connection.execute(
        'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
        [newDebt, now, order.station_id]
      );
    }
  }
}

/** 水站订单欠款 += 金额（调用方自行判断订单类型） */
async function addStationDebt(connection, stationId, amount, now = new Date()) {
  const [stRows] = await connection.execute(
    'SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
    [stationId]
  );
  if (stRows.length > 0) {
    const newDebt = Number(stRows[0].current_debt) + Number(amount);
    await connection.execute(
      'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
      [newDebt, now, stationId]
    );
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
  addStationDebt
};

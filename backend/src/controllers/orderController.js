const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { VALID_ORDER_TYPES } = require('../constants/order');
const { parsePage } = require('../utils/pagination');
// 营收口径唯一来源（A6）：与财务模块共用同一表达式，前端只展示
const { itemRevenueExpr } = require('../utils/revenueExpr');
const {
  normalizeOrderPayload, fetchProductMap, buildOrderItems,
  writeOffTickets, restoreWrittenOffTickets, deductInventoryForSale,
  restoreSalesEffects, addStationDebt
} = require('../services/orderPricingService');

// 生成订单ID：SZX + 年月日 + 5位序号（每天从00001开始递增）
async function generateOrderId(connection) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;
  const prefix = `SZX${datePart}`;

  // 查询当天已有的最大订单号
  const [rows] = await connection.execute(
    `SELECT order_id FROM orders WHERE order_id LIKE ? ORDER BY order_id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    const lastOrderId = rows[0].order_id;
    const lastSeq = parseInt(lastOrderId.slice(prefix.length), 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  const seqPart = String(seq).padStart(5, '0');
  return `${prefix}${seqPart}`;
}

// 格式化订单数据，转成前端需要的驼峰命名
function formatOrder(order) {
  if (!order) return null;
  return {
    id: order.order_id,
    orderNo: order.order_id,
    orderType: order.order_type,
    platformType: order.platform_type,
    platformOrderNo: order.platform_order_no,
    stationId: order.station_id,
    machineStationId: order.machine_station_id || null,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    customerAddress: order.customer_address,
    contactName: order.contact_name,
    orderAmount: Number(order.order_amount) || 0,
    deliveryFee: Number(order.delivery_fee) || 0,
    totalAmount: Number(order.total_receivable) || 0,
    deliveryMethod: order.delivery_type,
    deliveryStaffId: order.worker_id,
    deliveryStaff: order.delivery_staff_name || null,
    paymentStatus: order.payment_status,
    paidAmount: Number(order.paid_amount) || 0,
    createdById: order.created_by || null,
    createdByName: order.creator_name || null,
    remark: order.remark,
    createTime: order.created_at,
    updateTime: order.updated_at
  };
}

// 获取订单列表
async function getOrderList(req, res) {
  try {
    const { keyword, order_type, orderType, startDate, endDate, page = 1, pageSize = 10 } = req.query;

    // 兼容驼峰和蛇形命名
    const actualOrderType = order_type !== undefined ? order_type : orderType;

    // 构建查询条件（统一带 o. 别名，计数与列表两条 SQL 共用同一份条件，不再做字符串替换）
    let whereClause = 'WHERE 1=1';
    const params = [];

    // 关键词模糊搜索（订单号或客户名）
    if (keyword) {
      whereClause += ' AND (o.order_id LIKE ? OR o.customer_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 订单类型筛选
    if (actualOrderType !== undefined && actualOrderType !== '' && actualOrderType !== null) {
      whereClause += ' AND o.order_type = ?';
      params.push(Number(actualOrderType));
    }

    // 开始日期筛选
    if (startDate) {
      whereClause += ' AND DATE(o.created_at) >= ?';
      params.push(startDate);
    }

    // 结束日期筛选
    if (endDate) {
      whereClause += ' AND DATE(o.created_at) <= ?';
      params.push(endDate);
    }

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询（LEFT JOIN workers 获取创建人姓名）
    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

    const listSql = `SELECT o.*, w.worker_name AS creator_name
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      ${whereClause}
      ORDER BY o.created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const formattedList = list.map(item => formatOrder(item));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取订单列表失败:', err);
    return error(res, '获取订单列表失败: ' + err.message);
  }
}

// 获取订单详情
async function getOrderById(req, res) {
  try {
    const { id } = req.params;

    // 查询订单基本信息（LEFT JOIN workers 获取创建人姓名和配送员工姓名）
    const orderSql = `SELECT o.*, w.worker_name AS creator_name, dw.worker_name AS delivery_staff_name
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      LEFT JOIN workers dw ON o.worker_id = dw.worker_id
      WHERE o.order_id = ?`;
    const [orderRows] = await pool.execute(orderSql, [id]);

    if (orderRows.length === 0) {
      return error(res, '订单不存在', 404);
    }

    // 查询商品明细
    const itemsSql = `
      SELECT 
        oi.*,
        p.product_name,
        p.product_code,
        p.specification,
        p.unit
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.item_id ASC
    `;
    const [items] = await pool.execute(itemsSql, [id]);

    const formattedItems = items.map(item => ({
      id: item.item_id,
      productId: item.product_id,
      productName: item.product_name,
      productCode: item.product_code,
      spec: item.specification,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: Number(item.unit_price) || 0,
      purchasePrice: Number(item.purchase_price) || 0,
      wholesalePrice: Number(item.wholesale_price) || 0,
      retailPrice: Number(item.retail_price) || 0,
      machinePrice: Number(item.machine_price) || 0,
      totalDeliveryFee: Number(item.total_delivery_fee) || 0,
      distributionDeliveryFee: Number(item.distribution_delivery_fee) || 0,
      workerRetailDeliveryFee: Number(item.worker_retail_delivery_fee) || 0,
      workerWholesaleDeliveryFee: Number(item.worker_wholesale_delivery_fee) || 0,
      workerMachineDeliveryFee: Number(item.worker_machine_delivery_fee) || 0,
      pricingType: Number(item.pricing_type) || 1,
      ticketQty: Number(item.ticket_qty) || 0,
      subtotal: Number(item.subtotal) || 0
    }));

    // 营收口径唯一归后端（A6，2026-08-28）：与财务汇总/明细同一 itemRevenueExpr；
    // 类型4/6 商品明细不计营收（营收按机台销量 machine_sales 统计，此处为 0 属预期）
    const [revRows] = await pool.execute(
      `SELECT ROUND(SUM(${itemRevenueExpr()}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.order_id = ?`,
      [id]
    );
    const revenue = Number(revRows[0]?.revenue) || 0;
    // deliveryFeePart 仅为详情弹窗展示拆分（营收 - 商品金额），非独立口径
    const deliveryFeePart = Math.round((revenue - (Number(orderRows[0].order_amount) || 0)) * 100) / 100;

    const order = {
      ...formatOrder(orderRows[0]),
      items: formattedItems,
      // 营收与配送费拆分由后端计算，前端不再有 calcOrderRevenue 实现
      revenue,
      deliveryFeePart
    };

    return success(res, order);
  } catch (err) {
    console.error('获取订单详情失败:', err);
    return error(res, '获取订单详情失败: ' + err.message);
  }
}

// 创建订单
async function createOrder(req, res) {
  const connection = await pool.getConnection();
  try {
    const p = normalizeOrderPayload(req.body);
    const typeNum = Number(p.orderType);

    // 校验必填字段（量贩机供货/零售机供货时客户电话非必填）
    const needPhone = ![4, 6].includes(typeNum);
    if (!p.orderType || !p.customerName || (needPhone && !p.customerPhone) || !p.deliveryType || p.items.length === 0) {
      return error(res, '订单类型、客户姓名、配送方式和商品明细不能为空', 400);
    }

    // 校验订单类型（1/2/3/4/5/6；旧 5-线下水站返货 于 2026-08-25 删除，编号 5 于 2026-09-14 复用为「水公社」）
    if (!VALID_ORDER_TYPES.includes(typeNum)) {
      return error(res, '订单类型无效', 400);
    }

    // 校验配送类型
    if (![1, 2, 3].includes(Number(p.deliveryType))) {
      return error(res, '配送方式无效', 400);
    }

    // 直营水站销售必须选择水站
    if (typeNum === 2 && !p.stationId) {
      return error(res, '水站订单必须选择水站', 400);
    }

    // 机台供货订单（量贩机供货/零售机供货）必须关联机台
    if ((typeNum === 4 || typeNum === 6) && !p.machineStationId) {
      return error(res, '机台供货订单必须选择机台', 400);
    }

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();
    const orderId = await generateOrderId(connection);

    // 商品价格映射 + 定价计算（定价核心在 orderPricingService）
    const productMap = await fetchProductMap(connection, p.items);
    const { orderItems, orderAmount, hasTicketDeduct, ticketDemand } = buildOrderItems({
      orderType: p.orderType,
      items: p.items,
      productMap
    });

    // delivery_fee 恒为 0（2026-08-27）
    const deliveryFee = 0;
    const totalReceivable = orderAmount + deliveryFee;

    // 插入订单表
    const insertOrderSql = `INSERT INTO orders (
      order_id, order_type, platform_type, platform_order_no, station_id, machine_station_id,
      customer_name, customer_phone, customer_address, contact_name, order_amount,
      delivery_fee, total_receivable, delivery_type, worker_id,
      payment_status, paid_amount, created_by, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const orderValues = [
      orderId,
      typeNum,
      p.platformType || null,
      p.platformOrderNo || null,
      p.stationId || null,
      p.machineStationId || null,
      p.customerName,
      p.customerPhone || null,
      p.customerAddress || null,
      p.contactName || null,
      orderAmount,
      deliveryFee,
      totalReceivable,
      Number(p.deliveryType),
      p.workerId,
      0, // payment_status: 0未付
      0, // paid_amount
      p.createdById,
      req.body.remark || null,
      now,
      now
    ];

    await connection.execute(insertOrderSql, orderValues);

    // 批量插入订单明细 + 销售扣库存
    const insertItemSql = `INSERT INTO order_items (
      order_id, product_id, quantity, unit_price,
      purchase_price, wholesale_price, retail_price, machine_price,
      total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee,
      worker_wholesale_delivery_fee, worker_machine_delivery_fee, pricing_type, ticket_qty, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const item of orderItems) {
      const itemValues = [
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
      ];

      await connection.execute(insertItemSql, itemValues);

      // 销售：扣减库存（允许负数）
      await deductInventoryForSale(connection, item.product_id, item.quantity, now);
    }

    // 直营水站销售：核销水票（status 1→2，关联订单；仅核销实际抵扣张数）
    if (hasTicketDeduct) {
      await writeOffTickets(connection, p.stationId, ticketDemand, orderId, productMap, now);
    }

    // 如果是水站订单，更新水站欠款
    if (typeNum === 2 && p.stationId) {
      await addStationDebt(connection, p.stationId, orderAmount, now);
    }

    // 提交事务
    await connection.commit();

    // 查询创建的订单详情（JOIN workers 获取创建人姓名）
    const [orderResult] = await pool.execute(
      `SELECT o.*, w.worker_name AS creator_name FROM orders o LEFT JOIN workers w ON o.created_by = w.worker_id WHERE o.order_id = ?`,
      [orderId]
    );
    const [itemsResult] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

    const result = {
      ...formatOrder(orderResult[0]),
      items: itemsResult
    };

    return success(res, result, '订单创建成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('创建订单失败:', err);
    if (err.business) return error(res, err.message, 400);
    return error(res, '创建订单失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

// 取消订单（设置 canceled_at 标志）
async function deleteOrder(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    // 开始事务
    await connection.beginTransaction();

    // 查询订单信息
    const [orderRows] = await connection.execute(
      'SELECT * FROM orders WHERE order_id = ? FOR UPDATE',
      [id]
    );

    if (orderRows.length === 0) {
      await connection.rollback();
      return error(res, '订单不存在', 404);
    }

    const order = orderRows[0];

    if (order.canceled_at) {
      await connection.rollback();
      return error(res, '订单已取消', 400);
    }

    // 查询订单明细
    const [items] = await connection.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );

    // 恢复库存 + 扣减水站欠款（与硬删除共用）
    await restoreSalesEffects(connection, order, items);

    // 还原该订单核销的水票（status 2→1，清空核销关联），避免取消订单永久损失水票
    await restoreWrittenOffTickets(connection, id);

    // 更新订单状态为已取消
    const updateSql = 'UPDATE orders SET canceled_at = ?, updated_at = ? WHERE order_id = ?';
    await connection.execute(updateSql, [new Date(), new Date(), id]);

    // 提交事务
    await connection.commit();

    return success(res, null, '订单取消成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('取消订单失败:', err);
    if (err.business) return error(res, err.message, 400);
    return error(res, '取消订单失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

// 硬删除订单（物理删除订单及其明细）
async function hardDeleteOrder(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    // 开始事务
    await connection.beginTransaction();

    // 查询订单信息
    const [orderRows] = await connection.execute(
      'SELECT * FROM orders WHERE order_id = ? FOR UPDATE',
      [id]
    );

    if (orderRows.length === 0) {
      await connection.rollback();
      return error(res, '订单不存在', 404);
    }

    const order = orderRows[0];

    // 查询订单明细
    const [items] = await connection.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );

    // 恢复库存 + 扣减水站欠款（与取消订单共用）
    await restoreSalesEffects(connection, order, items);

    // 还原该订单核销的水票（status 2→1），必须在删除订单前执行（依赖 order_id 关联）
    await restoreWrittenOffTickets(connection, id);

    // 物理删除订单明细
    await connection.execute('DELETE FROM order_items WHERE order_id = ?', [id]);

    // 物理删除订单
    await connection.execute('DELETE FROM orders WHERE order_id = ?', [id]);

    // 提交事务
    await connection.commit();

    return success(res, null, '订单删除成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('删除订单失败:', err);
    if (err.business) return error(res, err.message, 400);
    return error(res, '删除订单失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

// 修改订单
async function updateOrder(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const p = normalizeOrderPayload(req.body);

    // 校验订单类型（1/2/3/4/5/6；旧 5-线下水站返货 于 2026-08-25 删除，编号 5 于 2026-09-14 复用为「水公社」）
    // 注意：此时尚未 beginTransaction，不能调用 rollback（A3 修复）
    if (p.orderType !== undefined && p.orderType !== null) {
      if (!VALID_ORDER_TYPES.includes(Number(p.orderType))) {
        return error(res, '订单类型无效', 400);
      }
    }

    await connection.beginTransaction();

    // 查询订单
    const [orderRows] = await connection.execute('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (orderRows.length === 0) {
      await connection.rollback();
      return error(res, '订单不存在', 404);
    }

    const oldOrder = orderRows[0];

    // 恢复旧商品的库存 + 扣减旧水站欠款（先查旧明细；返货单类型5 已于 2026-08-25 停用、库内无残留，恢复方向恒为"退回库存"）
    const [oldItems] = await connection.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);
    await restoreSalesEffects(connection, oldOrder, oldItems);

    // 还原旧订单核销的水票（status 2→1）：先全部释放，新明细核销在下方按新票量重新执行（F3 修复）
    await restoreWrittenOffTickets(connection, id);

    // 商品价格映射 + 按新明细重新定价（与创建同口径）
    const productMap = await fetchProductMap(connection, p.items);
    const { orderItems, orderAmount, hasTicketDeduct, ticketDemand } = buildOrderItems({
      orderType: p.orderType,
      items: p.items,
      productMap
    });

    // delivery_fee 恒为 0（2026-08-27）
    const deliveryFee = 0;
    const totalReceivable = orderAmount + deliveryFee;

    // 更新订单主表
    await connection.execute(`UPDATE orders SET order_type=?, platform_type=?, platform_order_no=?, station_id=?, machine_station_id=?, customer_name=?, customer_phone=?, customer_address=?, contact_name=?, order_amount=?, delivery_fee=?, total_receivable=?, delivery_type=?, worker_id=?, created_by=?, remark=?, updated_at=? WHERE order_id=?`,
      [Number(p.orderType), p.platformType || null, p.platformOrderNo || null, p.stationId, p.machineStationId || null, p.customerName, p.customerPhone || null, p.customerAddress || null, p.contactName || null, orderAmount, deliveryFee, totalReceivable, Number(p.deliveryType), p.workerId, p.createdById, req.body.remark || null, new Date(), id]);

    // 删除旧明细
    await connection.execute('DELETE FROM order_items WHERE order_id = ?', [id]);

    // 插入新明细 + 销售扣库存
    for (const item of orderItems) {
      await connection.execute(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, pricing_type, ticket_qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.wholesale_price, item.retail_price, item.machine_price, item.total_delivery_fee, item.distribution_delivery_fee, item.worker_retail_delivery_fee, item.worker_wholesale_delivery_fee, item.worker_machine_delivery_fee, item.pricing_type || 1, item.ticket_qty || 0, item.subtotal]);

      await deductInventoryForSale(connection, item.product_id, item.quantity);
    }

    // 直营水站销售：按新明细重新核销水票（与创建同规则，F3 修复）
    if (Number(p.orderType) === 2 && p.stationId && hasTicketDeduct) {
      await writeOffTickets(connection, p.stationId, ticketDemand, id, productMap);
    }

    // 如果是水站订单，增加新欠款
    if (Number(p.orderType) === 2 && p.stationId) {
      await addStationDebt(connection, p.stationId, orderAmount);
    }

    await connection.commit();
    return success(res, null, '订单修改成功');
  } catch (err) {
    await connection.rollback();
    console.error('修改订单失败:', err);
    if (err.business) return error(res, err.message, 400);
    return error(res, '修改订单失败: ' + err.message);
  } finally {
    connection.release();
  }
}


module.exports = {
  getOrderList,
  getOrderById,
  hardDeleteOrder,
  createOrder,
  updateOrder,
  deleteOrder
};

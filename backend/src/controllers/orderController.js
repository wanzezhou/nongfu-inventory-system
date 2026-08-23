const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

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

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];

    // 关键词模糊搜索（订单号或客户名）
    if (keyword) {
      whereClause += ' AND (order_id LIKE ? OR customer_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 订单类型筛选
    if (actualOrderType !== undefined && actualOrderType !== '' && actualOrderType !== null) {
      whereClause += ' AND order_type = ?';
      params.push(Number(actualOrderType));
    }

    // 开始日期筛选
    if (startDate) {
      whereClause += ' AND DATE(created_at) >= ?';
      params.push(startDate);
    }

    // 结束日期筛选
    if (endDate) {
      whereClause += ' AND DATE(created_at) <= ?';
      params.push(endDate);
    }

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM orders ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询（LEFT JOIN workers 获取创建人姓名）
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT o.*, w.worker_name AS creator_name
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      ${whereClause.replace(/\border_id\b/g, 'o.order_id').replace(/\bcustomer_name\b/g, 'o.customer_name').replace(/\border_type\b/g, 'o.order_type').replace(/\bcreated_at\b/g, 'o.created_at')}
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
      subtotal: Number(item.subtotal) || 0
    }));

    const order = {
      ...formatOrder(orderRows[0]),
      items: formattedItems
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
    const {
      // 蛇形命名
      order_type, platform_type, platform_order_no, station_id, machine_station_id,
      customer_name, customer_phone, customer_address, contact_name,
      delivery_type, worker_id, remark, items, created_by,
      // 驼峰命名
      orderType, platformType, platformOrderNo, stationId, machineStationId,
      customerName, customerPhone, customerAddress, contactName,
      deliveryMethod, deliveryStaffId, createdById
    } = req.body;

    // 统一字段名
    const actualOrderType = order_type !== undefined ? order_type : orderType;
    const actualPlatformType = platform_type !== undefined ? platform_type : platformType;
    const actualPlatformOrderNo = platform_order_no !== undefined ? platform_order_no : platformOrderNo;
    const actualStationId = (station_id !== undefined ? station_id : stationId) || null;
    const actualMachineStationId = (machine_station_id !== undefined ? machine_station_id : machineStationId) || null;
    const actualCustomerName = customer_name !== undefined ? customer_name : customerName;
    const actualCustomerPhone = customer_phone !== undefined ? customer_phone : customerPhone;
    const actualCustomerAddress = customer_address !== undefined ? customer_address : customerAddress;
    const actualContactName = contact_name !== undefined ? contact_name : contactName;
    // 配送类型：delivery_type（蛇形）或 deliveryMethod（驼峰）
    const actualDeliveryType = delivery_type !== undefined ? delivery_type : deliveryMethod;
    // 员工ID：worker_id（蛇形）或 deliveryStaffId（驼峰，注意不是deliveryMethod）
    const actualWorkerId = (worker_id !== undefined ? worker_id : deliveryStaffId) || null;
    // 创建人ID：created_by（蛇形）或 createdById（驼峰）
    const actualCreatedById = (created_by !== undefined ? created_by : createdById) || null;

    const actualItems = items || [];

    // 校验必填字段（量贩机供货/零售机供货时客户电话非必填）
    const needPhone = ![4, 6].includes(Number(actualOrderType));
    if (!actualOrderType || !actualCustomerName || (needPhone && !actualCustomerPhone) || !actualDeliveryType || !actualItems || actualItems.length === 0) {
      return error(res, '订单类型、客户姓名、配送方式和商品明细不能为空', 400);
    }

    // 校验订单类型
    const validOrderTypes = [1, 2, 3, 4, 5, 6];
    if (!validOrderTypes.includes(Number(actualOrderType))) {
      return error(res, '订单类型无效', 400);
    }

    // 校验配送类型
    const validDeliveryTypes = [1, 2, 3];
    if (!validDeliveryTypes.includes(Number(actualDeliveryType))) {
      return error(res, '配送方式无效', 400);
    }

    // 水站订单（分销/返货）必须有水站ID
    if ((Number(actualOrderType) === 2 || Number(actualOrderType) === 5) && !actualStationId) {
      return error(res, '水站订单必须选择水站', 400);
    }

    // 机台供货订单（量贩机供货/零售机供货）必须关联机台
    if ((Number(actualOrderType) === 4 || Number(actualOrderType) === 6) && !actualMachineStationId) {
      return error(res, '机台供货订单必须选择机台', 400);
    }

    // 返货订单：使用水站配送，无需额外校验
    const isReturnOrder = Number(actualOrderType) === 5;

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();
    const orderId = await generateOrderId(connection);

    // 查询所有商品的价格信息（兼容 productId 和 product_id）
    const productIds = actualItems.map(item => item.product_id || item.productId);
    const placeholders = productIds.map(() => '?').join(',');
    const productsSql = `SELECT * FROM products WHERE product_id IN (${placeholders})`;
    const [productRows] = await connection.execute(productsSql, productIds);

    // 构建商品价格映射
    const productMap = {};
    for (const product of productRows) {
      productMap[product.product_id] = product;
    }

    // 校验所有商品是否存在
    for (const item of actualItems) {
      const pid = item.product_id || item.productId;
      if (!productMap[pid]) {
        await connection.rollback();
        return error(res, `商品不存在: ${pid}`, 400);
      }
    }

    // 计算订单金额和配送费
    let order_amount = 0;
    let delivery_fee = 0;
    const orderItems = [];

    for (const item of actualItems) {
      const pid = item.product_id || item.productId;
      const product = productMap[pid];
      const quantity = Number(item.quantity);
      const itemUnitPrice = item.unit_price !== undefined ? Number(item.unit_price) : (item.unitPrice !== undefined ? Number(item.unitPrice) : null);

      if (isNaN(quantity) || quantity <= 0) {
        await connection.rollback();
        return error(res, '商品数量必须为正数', 400);
      }

      // 根据订单类型计算商品单价
      let unitPrice = 0;
      let deliveryFeePerUnit = 0;

      switch (Number(actualOrderType)) {
        case 1: // 线上平台销售：进货价 + 工人零售配送费
          unitPrice = product.purchase_price;
          deliveryFeePerUnit = product.worker_retail_delivery_fee;
          break;
        case 2: // 水站分销：分销价 + 工人水站配送费
          unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.wholesale_price;
          deliveryFeePerUnit = product.worker_wholesale_delivery_fee;
          break;
        case 3: // 线下零售：零售价 + 工人零售配送费（无需配送时为0）
          unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.retail_price;
          deliveryFeePerUnit = Number(actualDeliveryType) === 3 ? 0 : product.worker_retail_delivery_fee;
          break;
        case 4: // 量贩机供货：进货价 + 工人零售机配送费
          unitPrice = product.purchase_price;
          deliveryFeePerUnit = product.worker_machine_delivery_fee;
          break;
        case 6: // 零售机供货：与量贩机供货一致（进货价 + 工人零售机配送费）
          unitPrice = product.purchase_price;
          deliveryFeePerUnit = product.worker_machine_delivery_fee;
          break;
        case 5: // 线下水站返货：进货价 + 工人水站配送费
          unitPrice = product.purchase_price;
          deliveryFeePerUnit = product.worker_wholesale_delivery_fee;
          break;
      }

      const subtotal = unitPrice * quantity;
      const itemDeliveryFee = deliveryFeePerUnit * quantity;

      order_amount += subtotal;
      delivery_fee += itemDeliveryFee;

      orderItems.push({
        product_id: pid,
        quantity: quantity,
        unit_price: unitPrice,
        purchase_price: product.purchase_price,
        wholesale_price: product.wholesale_price,
        retail_price: product.retail_price,
        machine_price: product.machine_price,
        total_delivery_fee: product.total_delivery_fee,
        distribution_delivery_fee: product.distribution_delivery_fee,
        worker_retail_delivery_fee: product.worker_retail_delivery_fee,
        worker_wholesale_delivery_fee: product.worker_wholesale_delivery_fee,
        worker_machine_delivery_fee: product.worker_machine_delivery_fee,
        subtotal: subtotal
      });
    }

    const total_receivable = order_amount + delivery_fee;

    // 插入订单表
    const insertOrderSql = `INSERT INTO orders (
      order_id, order_type, platform_type, platform_order_no, station_id, machine_station_id,
      customer_name, customer_phone, customer_address, contact_name, order_amount,
      delivery_fee, total_receivable, delivery_type, worker_id,
      payment_status, paid_amount, created_by, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const orderValues = [
      orderId,
      Number(actualOrderType),
      actualPlatformType || null,
      actualPlatformOrderNo || null,
      actualStationId || null,
      actualMachineStationId || null,
      actualCustomerName,
      actualCustomerPhone || null,
      actualCustomerAddress || null,
      actualContactName || null,
      order_amount,
      delivery_fee,
      total_receivable,
      Number(actualDeliveryType),
      actualWorkerId,
      0, // payment_status: 0未付
      0, // paid_amount
      actualCreatedById,
      remark || null,
      now,
      now
    ];

    await connection.execute(insertOrderSql, orderValues);

    // 批量插入订单明细
    for (let i = 0; i < orderItems.length; i++) {
      const item = orderItems[i];
      const insertItemSql = `INSERT INTO order_items (
        order_id, product_id, quantity, unit_price,
        purchase_price, wholesale_price, retail_price, machine_price,
        total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee,
        worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
        item.subtotal
      ];

      await connection.execute(insertItemSql, itemValues);

      // 库存处理（返货订单增加库存，其他订单扣减库存）
      const [inventoryRows] = await connection.execute(
        'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (inventoryRows.length === 0) {
        await connection.rollback();
        return error(res, `商品库存不存在: ${item.product_id}`, 400);
      }

      const currentQuantity = inventoryRows[0].quantity;
      let newQuantity;
      if (isReturnOrder) {
        // 返货：增加库存
        newQuantity = currentQuantity + item.quantity;
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?',
          [newQuantity, now, now, item.product_id]
        );
      } else {
        // 销售：扣减库存（允许负数）
        newQuantity = currentQuantity - item.quantity;
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?',
          [newQuantity, now, now, item.product_id]
        );
      }
    }

    // 如果是水站订单，更新水站欠款
    if (Number(actualOrderType) === 2 && actualStationId) {
      const [stationRows] = await connection.execute(
        'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [actualStationId]
      );

      if (stationRows.length > 0) {
        const newDebt = Number(stationRows[0].current_debt) + order_amount;
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [newDebt, now, actualStationId]
        );
      }
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

    // 恢复库存
    const isReturnOrder = Number(order.order_type) === 5;
    for (const item of items) {
      const [inventoryRows] = await connection.execute(
        'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (inventoryRows.length > 0) {
        if (isReturnOrder) {
          const newQuantity = Math.max(0, inventoryRows[0].quantity - item.quantity);
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [newQuantity, new Date(), item.product_id]
          );
        } else {
          const newQuantity = inventoryRows[0].quantity + item.quantity;
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [newQuantity, new Date(), item.product_id]
          );
        }
      }
    }

    // 如果是水站订单，扣减水站欠款
    if (Number(order.order_type) === 2 && order.station_id) {
      const [stationRows] = await connection.execute(
        'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [order.station_id]
      );

      if (stationRows.length > 0) {
        const newDebt = Number(stationRows[0].current_debt) - order.order_amount;
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [Math.max(0, newDebt), new Date(), order.station_id]
        );
      }
    }

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

    // 恢复库存
    const isReturnOrder = Number(order.order_type) === 5;
    for (const item of items) {
      const [inventoryRows] = await connection.execute(
        'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (inventoryRows.length > 0) {
        if (isReturnOrder) {
          const newQuantity = Math.max(0, inventoryRows[0].quantity - item.quantity);
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [newQuantity, new Date(), item.product_id]
          );
        } else {
          const newQuantity = inventoryRows[0].quantity + item.quantity;
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [newQuantity, new Date(), item.product_id]
          );
        }
      }
    }

    // 如果是水站订单，扣减水站欠款
    if (Number(order.order_type) === 2 && order.station_id) {
      const [stationRows] = await connection.execute(
        'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [order.station_id]
      );

      if (stationRows.length > 0) {
        const newDebt = Number(stationRows[0].current_debt) - order.order_amount;
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [Math.max(0, newDebt), new Date(), order.station_id]
        );
      }
    }

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
    const {
      order_type, platform_type, platform_order_no, station_id, machine_station_id,
      customer_name, customer_phone, customer_address, contact_name,
      delivery_type, worker_id, remark, items, created_by,
      orderType, platformType, platformOrderNo, stationId, machineStationId,
      customerName, customerPhone, customerAddress, contactName,
      deliveryMethod, deliveryStaffId, createdById
    } = req.body;

    // 统一字段名
    const actualOrderType = order_type !== undefined ? order_type : orderType;
    const actualPlatformType = platform_type !== undefined ? platform_type : platformType;
    const actualPlatformOrderNo = platform_order_no !== undefined ? platform_order_no : platformOrderNo;
    const actualStationId = (station_id !== undefined ? station_id : stationId) || null;
    const actualMachineStationId = (machine_station_id !== undefined ? machine_station_id : machineStationId) || null;
    const actualCustomerName = customer_name !== undefined ? customer_name : customerName;
    const actualCustomerPhone = customer_phone !== undefined ? customer_phone : customerPhone;
    const actualCustomerAddress = customer_address !== undefined ? customer_address : customerAddress;
    const actualContactName = contact_name !== undefined ? contact_name : contactName;
    const actualDeliveryType = delivery_type !== undefined ? delivery_type : deliveryMethod;
    const actualWorkerId = (worker_id !== undefined ? worker_id : deliveryStaffId) || null;
    const actualCreatedById = (created_by !== undefined ? created_by : createdById) || null;
    const actualItems = items || [];

    // 校验订单类型
    if (actualOrderType !== undefined && actualOrderType !== null) {
      const validOrderTypes = [1, 2, 3, 4, 5, 6];
      if (!validOrderTypes.includes(Number(actualOrderType))) {
        await connection.rollback();
        return error(res, '订单类型无效', 400);
      }
    }

    const isReturnOrder = Number(actualOrderType) === 5;

    await connection.beginTransaction();

    // 查询订单
    const [orderRows] = await connection.execute('SELECT * FROM orders WHERE order_id = ? FOR UPDATE', [id]);
    if (orderRows.length === 0) {
      await connection.rollback();
      return error(res, '订单不存在', 404);
    }

    const oldOrderType = Number(orderRows[0].order_type);
    const oldIsReturn = oldOrderType === 5;

    // 恢复旧商品的库存（先查旧明细）
    const [oldItems] = await connection.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);
    for (const oldItem of oldItems) {
      const [invRows] = await connection.execute('SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE', [oldItem.product_id]);
      if (invRows.length > 0) {
        if (oldIsReturn) {
          // 旧订单是返货，恢复时扣减库存
          await connection.execute('UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?', [Math.max(0, invRows[0].quantity - oldItem.quantity), new Date(), oldItem.product_id]);
        } else {
          // 旧订单是销售，恢复时增加库存
          await connection.execute('UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?', [invRows[0].quantity + oldItem.quantity, new Date(), oldItem.product_id]);
        }
      }
    }

    // 如果是水站订单，扣减旧欠款
    if (oldOrderType === 2 && orderRows[0].station_id) {
      const [stRows] = await connection.execute('SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE', [orderRows[0].station_id]);
      if (stRows.length > 0) {
        await connection.execute('UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?', [Math.max(0, Number(stRows[0].current_debt) - Number(orderRows[0].order_amount)), new Date(), orderRows[0].station_id]);
      }
    }

    // 查询新商品价格
    const productIds = actualItems.map(item => item.product_id || item.productId);
    const placeholders = productIds.map(() => '?').join(',');
    const [productRows] = await connection.execute(`SELECT * FROM products WHERE product_id IN (${placeholders})`, productIds);
    const productMap = {};
    for (const p of productRows) productMap[p.product_id] = p;

    // 计算新金额
    let order_amount = 0;
    let delivery_fee = 0;
    const orderItems = [];

    for (const item of actualItems) {
      const pid = item.product_id || item.productId;
      const product = productMap[pid];
      if (!product) { await connection.rollback(); return error(res, `商品不存在: ${pid}`, 400); }
      const quantity = Number(item.quantity);
      const itemUnitPrice = item.unit_price !== undefined ? Number(item.unit_price) : (item.unitPrice !== undefined ? Number(item.unitPrice) : null);

      let unitPrice = 0;
      let deliveryFeePerUnit = 0;
      switch (Number(actualOrderType)) {
        case 1: unitPrice = product.purchase_price; deliveryFeePerUnit = product.worker_retail_delivery_fee; break;
        case 2: unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.wholesale_price;
          if (Number(actualDeliveryType) === 2) deliveryFeePerUnit = product.distribution_delivery_fee;
          else if (Number(actualDeliveryType) === 1) deliveryFeePerUnit = product.worker_wholesale_delivery_fee; break;
        case 3: unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : product.retail_price; deliveryFeePerUnit = Number(actualDeliveryType) === 3 ? 0 : product.worker_retail_delivery_fee; break;
        case 4: unitPrice = product.purchase_price; deliveryFeePerUnit = product.worker_machine_delivery_fee; break;
        case 6: unitPrice = product.purchase_price; deliveryFeePerUnit = product.worker_machine_delivery_fee; break;
        case 5: unitPrice = product.purchase_price; deliveryFeePerUnit = 0; break;
      }

      const subtotal = unitPrice * quantity;
      order_amount += subtotal;
      delivery_fee += deliveryFeePerUnit * quantity;

      orderItems.push({ product_id: pid, quantity, unit_price: unitPrice, purchase_price: product.purchase_price, wholesale_price: product.wholesale_price, retail_price: product.retail_price, machine_price: product.machine_price, total_delivery_fee: product.total_delivery_fee, distribution_delivery_fee: product.distribution_delivery_fee, worker_retail_delivery_fee: product.worker_retail_delivery_fee, worker_wholesale_delivery_fee: product.worker_wholesale_delivery_fee, worker_machine_delivery_fee: product.worker_machine_delivery_fee, subtotal });
    }

    const total_receivable = order_amount + delivery_fee;

    // 更新订单主表
    await connection.execute(`UPDATE orders SET order_type=?, platform_type=?, platform_order_no=?, station_id=?, machine_station_id=?, customer_name=?, customer_phone=?, customer_address=?, contact_name=?, order_amount=?, delivery_fee=?, total_receivable=?, delivery_type=?, worker_id=?, created_by=?, remark=?, updated_at=? WHERE order_id=?`,
      [Number(actualOrderType), actualPlatformType || null, actualPlatformOrderNo || null, actualStationId, actualMachineStationId || null, actualCustomerName, actualCustomerPhone || null, actualCustomerAddress || null, actualContactName || null, order_amount, delivery_fee, total_receivable, Number(actualDeliveryType), actualWorkerId, actualCreatedById, remark || null, new Date(), id]);

    // 删除旧明细
    await connection.execute('DELETE FROM order_items WHERE order_id = ?', [id]);

    // 插入新明细并处理库存
    for (const item of orderItems) {
      await connection.execute(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.wholesale_price, item.retail_price, item.machine_price, item.total_delivery_fee, item.distribution_delivery_fee, item.worker_retail_delivery_fee, item.worker_wholesale_delivery_fee, item.worker_machine_delivery_fee, item.subtotal]);

      // 库存处理
      const [invRows] = await connection.execute('SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE', [item.product_id]);
      if (invRows.length === 0) { await connection.rollback(); return error(res, `商品库存不存在: ${item.product_id}`, 400); }
      
      if (isReturnOrder) {
        // 返货：增加库存
        await connection.execute('UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?', [invRows[0].quantity + item.quantity, new Date(), new Date(), item.product_id]);
      } else {
        // 销售：扣减库存（允许负数）
        await connection.execute('UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?', [invRows[0].quantity - item.quantity, new Date(), new Date(), item.product_id]);
      }
    }

    // 如果是水站订单，增加新欠款
    if (Number(actualOrderType) === 2 && actualStationId) {
      const [stRows] = await connection.execute('SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE', [actualStationId]);
      if (stRows.length > 0) {
        await connection.execute('UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?', [Number(stRows[0].current_debt) + order_amount, new Date(), actualStationId]);
      }
    }

    await connection.commit();
    return success(res, null, '订单修改成功');
  } catch (err) {
    await connection.rollback();
    console.error('修改订单失败:', err);
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

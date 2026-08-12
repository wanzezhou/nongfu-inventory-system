const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const { getOrderScope } = require('../../services/scopeService');

// 生成订单ID：SZX + 年月日 + 5位序号（每天从00001开始递增）
async function generateOrderId(connection) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;
  const prefix = `SZX${datePart}`;
  const [rows] = await connection.execute(
    `SELECT order_id FROM orders WHERE order_id LIKE ? ORDER BY order_id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length > 0) {
    const lastSeq = parseInt(rows[0].order_id.slice(prefix.length), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// 订单类型文本映射
function orderTypeText(type) {
  const map = { 1: '线上平台销售', 2: '线下水站分销', 3: '线下零售', 4: '零售机供货', 5: '线下水站返货' };
  return map[type] || '未知';
}

// 角色与允许的订单类型映射
const roleOrderTypes = {
  admin: [1, 2, 3, 4, 5],
  salesman: [1, 2, 3, 4, 5],
  worker: [1, 3],
  station: [2, 5]
};

// 订单列表（带数据隔离）
async function list(req, res) {
  try {
    const { page = 1, pageSize = 20, orderType, keyword, status } = req.query;
    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    const whereParts = [];
    const params = [];

    // 数据隔离：worker 需要特殊处理（worker_id 或 created_by）
    if (role === 'worker') {
      whereParts.push('(o.worker_id = ? OR o.created_by = ?)');
      params.push(targetId, targetId);
    } else {
      const scope = getOrderScope(req.miniUser);
      for (const [key, value] of Object.entries(scope)) {
        whereParts.push(`${key} = ?`);
        params.push(value);
      }
    }

    // 订单状态筛选：0待配送 / 1配送中 / 2已完成
    if (status !== undefined && status !== '' && status !== null) {
      whereParts.push('o.order_status = ?');
      params.push(Number(status));
    }

    // 订单类型筛选
    if (orderType !== undefined && orderType !== '' && orderType !== null) {
      whereParts.push('o.order_type = ?');
      params.push(Number(orderType));
    }

    // 关键词模糊搜索（订单号或客户名）
    if (keyword) {
      whereParts.push('(o.order_id LIKE ? OR o.customer_name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;

    // 分页查询（JOIN workers 获取创建人/配送员姓名，JOIN sub_stations 获取水站名）
    const listSql = `SELECT o.*, w.worker_name AS creator_name, dw.worker_name AS delivery_staff_name, s.station_name
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      LEFT JOIN workers dw ON o.worker_id = dw.worker_id
      LEFT JOIN sub_stations s ON o.station_id = s.station_id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const formattedList = list.map(item => ({
      id: item.order_id,
      orderNo: item.order_id,
      orderType: item.order_type,
      orderTypeText: orderTypeText(item.order_type),
      customerName: item.customer_name,
      customerPhone: item.customer_phone,
      totalAmount: Number(item.total_receivable) || 0,
      deliveryFee: Number(item.delivery_fee) || 0,
      workerName: item.delivery_staff_name || null,
      stationName: item.station_name || null,
      createdAt: item.created_at,
      orderStatus: item.order_status
    }));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取订单列表失败:', err);
    return error(res, '获取订单列表失败: ' + err.message);
  }
}

// 订单详情（带归属校验）
async function detail(req, res) {
  try {
    const { id } = req.params;

    const orderSql = `SELECT o.*, w.worker_name AS creator_name, dw.worker_name AS delivery_staff_name, s.station_name
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      LEFT JOIN workers dw ON o.worker_id = dw.worker_id
      LEFT JOIN sub_stations s ON o.station_id = s.station_id
      WHERE o.order_id = ?`;
    const [orderRows] = await pool.execute(orderSql, [id]);

    if (orderRows.length === 0) {
      return error(res, '订单不存在', 404);
    }

    const order = orderRows[0];
    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    // 归属校验
    let allowed = false;
    if (role === 'admin') {
      allowed = true;
    } else if (role === 'worker') {
      allowed = String(order.worker_id) === String(targetId) || String(order.created_by) === String(targetId);
    } else if (role === 'station') {
      allowed = String(order.station_id) === String(targetId);
    } else if (role === 'salesman') {
      allowed = String(order.created_by) === String(targetId);
    }

    if (!allowed) {
      return res.json({ code: 403, message: '无权查看此订单', data: null });
    }

    // 查询订单明细（带商品信息）
    const itemsSql = `SELECT
        oi.*,
        p.product_name,
        p.product_code,
        p.specification,
        p.unit
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.product_id
      WHERE oi.order_id = ?
      ORDER BY oi.item_id ASC`;
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

    const detail = {
      id: order.order_id,
      orderNo: order.order_id,
      orderType: order.order_type,
      orderTypeText: orderTypeText(order.order_type),
      platformType: order.platform_type,
      platformOrderNo: order.platform_order_no,
      stationId: order.station_id,
      stationName: order.station_name || null,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerAddress: order.customer_address,
      contactName: order.contact_name,
      orderAmount: Number(order.order_amount) || 0,
      deliveryFee: Number(order.delivery_fee) || 0,
      totalAmount: Number(order.total_receivable) || 0,
      deliveryType: order.delivery_type,
      workerId: order.worker_id,
      workerName: order.delivery_staff_name || null,
      creatorId: order.created_by,
      creatorName: order.creator_name || null,
      paymentStatus: order.payment_status,
      paidAmount: Number(order.paid_amount) || 0,
      orderStatus: order.order_status,
      remark: order.remark,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: formattedItems
    };

    return success(res, detail);
  } catch (err) {
    console.error('获取订单详情失败:', err);
    return error(res, '获取订单详情失败: ' + err.message);
  }
}

// 创建订单（带角色类型限制）
async function create(req, res) {
  const connection = await pool.getConnection();
  try {
    const {
      orderType, customerName, customerPhone, customerAddress,
      stationId, workerId, deliveryType, remark, items
    } = req.body;

    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    // 订单类型必选
    if (orderType === undefined || orderType === null || orderType === '') {
      return error(res, '请选择订单类型', 400);
    }

    // 角色类型限制校验
    const allowedTypes = roleOrderTypes[role];
    if (!allowedTypes || !allowedTypes.includes(Number(orderType))) {
      return res.json({ code: 403, message: '无权创建此类型订单', data: null });
    }

    // 校验必填字段（零售机供货时客户电话非必填）
    const needPhone = Number(orderType) !== 4;
    if (!orderType || !customerName || (needPhone && !customerPhone) || !items || items.length === 0) {
      return error(res, '订单类型、客户姓名、配送方式和商品明细不能为空', 400);
    }

    // 校验订单类型
    const validOrderTypes = [1, 2, 3, 4, 5];
    if (!validOrderTypes.includes(Number(orderType))) {
      return error(res, '订单类型无效', 400);
    }

    // 水站订单（分销/返货）必须有水站ID
    const actualStationId = stationId || null;
    if ((Number(orderType) === 2 || Number(orderType) === 5) && !actualStationId) {
      return error(res, '水站订单必须选择水站', 400);
    }

    // 自动注入创建人
    const actualCreatedBy = targetId;
    const actualWorkerId = workerId || null;
    const isReturnOrder = Number(orderType) === 5;

    // 配送类型：未传则按订单类型默认
    let actualDeliveryType;
    if (deliveryType !== undefined && deliveryType !== null && deliveryType !== '') {
      actualDeliveryType = Number(deliveryType);
    } else {
      switch (Number(orderType)) {
        case 1: actualDeliveryType = 1; break;  // 线上平台销售：自有员工配送
        case 2: actualDeliveryType = 2; break;  // 线下水站分销：水站配送
        case 3: actualDeliveryType = 1; break;  // 线下零售：自有员工配送
        case 4: actualDeliveryType = 2; break;  // 零售机供货
        case 5: actualDeliveryType = 2; break;  // 线下水站返货：水站配送
        default: actualDeliveryType = 1;
      }
    }

    const validDeliveryTypes = [1, 2, 3];
    if (!validDeliveryTypes.includes(Number(actualDeliveryType))) {
      return error(res, '配送方式无效', 400);
    }

    // 如果有水站ID，获取水站联系人名
    let stationContactName = null;
    if (actualStationId) {
      const [stationRows] = await connection.execute(
        'SELECT contact_name FROM sub_stations WHERE station_id = ?',
        [actualStationId]
      );
      if (stationRows.length > 0) {
        stationContactName = stationRows[0].contact_name;
      }
    }

    await connection.beginTransaction();

    // 查询所有商品的价格信息
    const productIds = items.map(item => item.productId || item.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const [productRows] = await connection.execute(
      `SELECT * FROM products WHERE product_id IN (${placeholders})`,
      productIds
    );
    const productMap = {};
    for (const product of productRows) {
      productMap[product.product_id] = product;
    }

    // 校验商品是否存在并计算金额
    let order_amount = 0;
    let delivery_fee = 0;
    const orderItems = [];

    for (const item of items) {
      const pid = item.productId || item.product_id;
      const product = productMap[pid];
      if (!product) {
        await connection.rollback();
        return error(res, `商品不存在: ${pid}`, 400);
      }
      const quantity = Number(item.quantity);
      if (isNaN(quantity) || quantity <= 0) {
        await connection.rollback();
        return error(res, '商品数量必须为正数', 400);
      }

      const itemUnitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : (item.unit_price !== undefined ? Number(item.unit_price) : null);

      // 根据订单类型计算单价和配送费
      let unitPrice = 0;
      let deliveryFeePerUnit = 0;

      switch (Number(orderType)) {
        case 1: // 线上平台销售：进货价 + 工人零售配送费
          unitPrice = Number(product.purchase_price) || 0;
          deliveryFeePerUnit = Number(product.worker_retail_delivery_fee) || 0;
          break;
        case 2: // 水站分销：分销价 + 工人水站配送费
          unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : (Number(product.wholesale_price) || 0);
          deliveryFeePerUnit = Number(product.worker_wholesale_delivery_fee) || 0;
          break;
        case 3: // 线下零售：零售价 + 工人零售配送费（无需配送时为0）
          unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : (Number(product.retail_price) || 0);
          deliveryFeePerUnit = Number(actualDeliveryType) === 3 ? 0 : (Number(product.worker_retail_delivery_fee) || 0);
          break;
        case 4: // 零售机供货：进货价 + 工人零售机配送费
          unitPrice = Number(product.purchase_price) || 0;
          deliveryFeePerUnit = Number(product.worker_machine_delivery_fee) || 0;
          break;
        case 5: // 线下水站返货：进货价 + 工人水站配送费
          unitPrice = Number(product.purchase_price) || 0;
          deliveryFeePerUnit = Number(product.worker_wholesale_delivery_fee) || 0;
          break;
      }

      const subtotal = unitPrice * quantity;
      order_amount += subtotal;
      delivery_fee += deliveryFeePerUnit * quantity;

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
    const now = new Date();
    const orderId = await generateOrderId(connection);

    // 插入订单表
    const insertOrderSql = `INSERT INTO orders (
      order_id, order_type, platform_type, platform_order_no, station_id,
      customer_name, customer_phone, customer_address, contact_name, order_amount,
      delivery_fee, total_receivable, delivery_type, worker_id,
      payment_status, paid_amount, order_status, created_by, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const orderValues = [
      orderId,
      Number(orderType),
      null,
      null,
      actualStationId,
      customerName,
      customerPhone || null,
      customerAddress || null,
      stationContactName,
      order_amount,
      delivery_fee,
      total_receivable,
      Number(actualDeliveryType),
      actualWorkerId,
      0, // payment_status: 0未付
      0, // paid_amount
      0, // order_status: 0待处理
      actualCreatedBy,
      remark || null,
      now,
      now
    ];

    await connection.execute(insertOrderSql, orderValues);

    // 插入订单明细并处理库存
    for (const item of orderItems) {
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.wholesale_price, item.retail_price, item.machine_price, item.total_delivery_fee, item.distribution_delivery_fee, item.worker_retail_delivery_fee, item.worker_wholesale_delivery_fee, item.worker_machine_delivery_fee, item.subtotal]
      );

      const [invRows] = await connection.execute(
        'SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );
      if (invRows.length === 0) {
        await connection.rollback();
        return error(res, `商品库存不存在: ${item.product_id}`, 400);
      }

      if (isReturnOrder) {
        // 返货：增加库存
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?',
          [invRows[0].quantity + item.quantity, now, now, item.product_id]
        );
      } else {
        // 销售：扣减库存（允许负数）
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?',
          [invRows[0].quantity - item.quantity, now, now, item.product_id]
        );
      }
    }

    // 水站分销订单：更新水站欠款
    if (Number(orderType) === 2 && actualStationId) {
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

    await connection.commit();

    return success(res, { orderNo: orderId, id: orderId }, '订单创建成功');
  } catch (err) {
    await connection.rollback();
    console.error('小程序创建订单失败:', err);
    return error(res, '创建订单失败: ' + err.message);
  } finally {
    connection.release();
  }
}

// 修改订单（带归属校验，仅待处理状态可改）
async function update(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      orderType, customerName, customerPhone, customerAddress,
      stationId, workerId, deliveryType, remark, items
    } = req.body;

    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    await connection.beginTransaction();

    // 查询订单（加锁）
    const [orderRows] = await connection.execute(
      'SELECT * FROM orders WHERE order_id = ? FOR UPDATE',
      [id]
    );
    if (orderRows.length === 0) {
      await connection.rollback();
      return error(res, '订单不存在', 404);
    }

    const order = orderRows[0];

    // 归属校验
    let allowed = false;
    if (role === 'admin') {
      allowed = true;
    } else if (role === 'worker') {
      allowed = String(order.worker_id) === String(targetId) || String(order.created_by) === String(targetId);
    } else if (role === 'station') {
      allowed = String(order.station_id) === String(targetId);
    } else if (role === 'salesman') {
      allowed = String(order.created_by) === String(targetId);
    }

    if (!allowed) {
      await connection.rollback();
      return res.json({ code: 403, message: '无权修改此订单', data: null });
    }

    // 仅待处理状态可修改
    if (Number(order.order_status) !== 0) {
      await connection.rollback();
      return error(res, '只有待处理状态的订单可以修改', 400);
    }

    // 校验订单类型
    if (orderType !== undefined && orderType !== null) {
      const validOrderTypes = [1, 2, 3, 4, 5];
      if (!validOrderTypes.includes(Number(orderType))) {
        await connection.rollback();
        return error(res, '订单类型无效', 400);
      }
    }

    const actualOrderType = orderType !== undefined ? orderType : order.order_type;
    const actualStationId = stationId !== undefined ? (stationId || null) : order.station_id;
    const actualWorkerId = workerId !== undefined ? (workerId || null) : order.worker_id;
    const actualCustomerName = customerName !== undefined ? customerName : order.customer_name;
    const actualCustomerPhone = customerPhone !== undefined ? customerPhone : order.customer_phone;
    const actualCustomerAddress = customerAddress !== undefined ? customerAddress : order.customer_address;
    const actualRemark = remark !== undefined ? remark : order.remark;
    const actualItems = items || [];

    // 配送类型
    let actualDeliveryType;
    if (deliveryType !== undefined && deliveryType !== null && deliveryType !== '') {
      actualDeliveryType = Number(deliveryType);
    } else {
      actualDeliveryType = order.delivery_type;
    }
    const validDeliveryTypes = [1, 2, 3];
    if (!validDeliveryTypes.includes(Number(actualDeliveryType))) {
      await connection.rollback();
      return error(res, '配送方式无效', 400);
    }

    const isReturnOrder = Number(actualOrderType) === 5;
    const oldIsReturn = Number(order.order_type) === 5;
    const now = new Date();

    // 如果有水站ID，获取水站联系人名
    let stationContactName = order.contact_name;
    if (actualStationId) {
      const [stInfo] = await connection.execute(
        'SELECT contact_name FROM sub_stations WHERE station_id = ?',
        [actualStationId]
      );
      if (stInfo.length > 0) {
        stationContactName = stInfo[0].contact_name;
      }
    }

    // 恢复旧库存
    const [oldItems] = await connection.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );
    for (const oldItem of oldItems) {
      const [invRows] = await connection.execute(
        'SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [oldItem.product_id]
      );
      if (invRows.length > 0) {
        if (oldIsReturn) {
          // 旧订单是返货，恢复时扣减库存
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [Math.max(0, invRows[0].quantity - oldItem.quantity), now, oldItem.product_id]
          );
        } else {
          // 旧订单是销售，恢复时增加库存
          await connection.execute(
            'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
            [invRows[0].quantity + oldItem.quantity, now, oldItem.product_id]
          );
        }
      }
    }

    // 旧订单是水站分销，扣减旧欠款
    if (Number(order.order_type) === 2 && order.station_id) {
      const [stRows] = await connection.execute(
        'SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [order.station_id]
      );
      if (stRows.length > 0) {
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [Math.max(0, Number(stRows[0].current_debt) - Number(order.order_amount)), now, order.station_id]
        );
      }
    }

    // 查询新商品价格并计算金额
    let order_amount = 0;
    let delivery_fee = 0;
    const orderItems = [];

    if (actualItems.length > 0) {
      const productIds = actualItems.map(item => item.productId || item.product_id);
      const placeholders = productIds.map(() => '?').join(',');
      const [productRows] = await connection.execute(
        `SELECT * FROM products WHERE product_id IN (${placeholders})`,
        productIds
      );
      const productMap = {};
      for (const p of productRows) productMap[p.product_id] = p;

      for (const item of actualItems) {
        const pid = item.productId || item.product_id;
        const product = productMap[pid];
        if (!product) {
          await connection.rollback();
          return error(res, `商品不存在: ${pid}`, 400);
        }
        const quantity = Number(item.quantity);
        if (isNaN(quantity) || quantity <= 0) {
          await connection.rollback();
          return error(res, '商品数量必须为正数', 400);
        }

        const itemUnitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : (item.unit_price !== undefined ? Number(item.unit_price) : null);

        let unitPrice = 0;
        let deliveryFeePerUnit = 0;

        switch (Number(actualOrderType)) {
          case 1:
            unitPrice = Number(product.purchase_price) || 0;
            deliveryFeePerUnit = Number(product.worker_retail_delivery_fee) || 0;
            break;
          case 2:
            unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : (Number(product.wholesale_price) || 0);
            deliveryFeePerUnit = Number(product.worker_wholesale_delivery_fee) || 0;
            break;
          case 3:
            unitPrice = itemUnitPrice !== null && !isNaN(itemUnitPrice) ? itemUnitPrice : (Number(product.retail_price) || 0);
            deliveryFeePerUnit = Number(actualDeliveryType) === 3 ? 0 : (Number(product.worker_retail_delivery_fee) || 0);
            break;
          case 4:
            unitPrice = Number(product.purchase_price) || 0;
            deliveryFeePerUnit = Number(product.worker_machine_delivery_fee) || 0;
            break;
          case 5:
            unitPrice = Number(product.purchase_price) || 0;
            deliveryFeePerUnit = Number(product.worker_wholesale_delivery_fee) || 0;
            break;
        }

        const subtotal = unitPrice * quantity;
        order_amount += subtotal;
        delivery_fee += deliveryFeePerUnit * quantity;

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
    }

    const total_receivable = order_amount + delivery_fee;

    // 更新订单主表（保留原 created_by、order_status、payment_status）
    await connection.execute(
      `UPDATE orders SET order_type=?, platform_type=?, platform_order_no=?, station_id=?, customer_name=?, customer_phone=?, customer_address=?, contact_name=?, order_amount=?, delivery_fee=?, total_receivable=?, delivery_type=?, worker_id=?, remark=?, updated_at=? WHERE order_id=?`,
      [Number(actualOrderType), null, null, actualStationId, actualCustomerName, actualCustomerPhone || null, actualCustomerAddress || null, stationContactName, order_amount, delivery_fee, total_receivable, Number(actualDeliveryType), actualWorkerId, actualRemark || null, now, id]
    );

    // 删除旧明细
    await connection.execute('DELETE FROM order_items WHERE order_id = ?', [id]);

    // 插入新明细并处理库存
    for (const item of orderItems) {
      await connection.execute(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.product_id, item.quantity, item.unit_price, item.purchase_price, item.wholesale_price, item.retail_price, item.machine_price, item.total_delivery_fee, item.distribution_delivery_fee, item.worker_retail_delivery_fee, item.worker_wholesale_delivery_fee, item.worker_machine_delivery_fee, item.subtotal]
      );

      const [invRows] = await connection.execute(
        'SELECT quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );
      if (invRows.length === 0) {
        await connection.rollback();
        return error(res, `商品库存不存在: ${item.product_id}`, 400);
      }

      if (isReturnOrder) {
        // 返货：增加库存
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?',
          [invRows[0].quantity + item.quantity, now, now, item.product_id]
        );
      } else {
        // 销售：扣减库存
        await connection.execute(
          'UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?',
          [invRows[0].quantity - item.quantity, now, now, item.product_id]
        );
      }
    }

    // 新订单是水站分销，增加新欠款
    if (Number(actualOrderType) === 2 && actualStationId) {
      const [stRows] = await connection.execute(
        'SELECT current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [actualStationId]
      );
      if (stRows.length > 0) {
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [Number(stRows[0].current_debt) + order_amount, now, actualStationId]
        );
      }
    }

    await connection.commit();
    return success(res, null, '订单修改成功');
  } catch (err) {
    await connection.rollback();
    console.error('小程序修改订单失败:', err);
    return error(res, '修改订单失败: ' + err.message);
  } finally {
    connection.release();
  }
}

// 获取商品列表（用于下单选择）
async function products(req, res) {
  try {
    const [rows] = await pool.execute(`
      SELECT
        p.product_id as id,
        p.product_name as name,
        p.specification as spec,
        p.unit,
        p.image_url,
        p.purchase_price as purchasePrice,
        p.wholesale_price as wholesalePrice,
        p.retail_price as retailPrice,
        p.machine_price as machinePrice,
        p.total_delivery_fee as totalDeliveryFee,
        p.distribution_delivery_fee as distributionDeliveryFee,
        p.worker_retail_delivery_fee as workerRetailDeliveryFee,
        p.worker_wholesale_delivery_fee as workerWholesaleDeliveryFee,
        p.worker_machine_delivery_fee as workerMachineDeliveryFee,
        COALESCE(i.quantity, 0) as stock
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ORDER BY p.created_at DESC
    `);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const products = rows.map(p => ({
      id: p.id,
      name: p.name,
      spec: p.spec,
      unit: p.unit,
      image: p.image_url ? (p.image_url.startsWith('http') ? p.image_url : `${baseUrl}${p.image_url}`) : '',
      purchasePrice: Number(p.purchasePrice) || 0,
      wholesalePrice: Number(p.wholesalePrice) || 0,
      retailPrice: Number(p.retailPrice) || 0,
      machinePrice: Number(p.machinePrice) || 0,
      totalDeliveryFee: Number(p.totalDeliveryFee) || 0,
      distributionDeliveryFee: Number(p.distributionDeliveryFee) || 0,
      workerRetailDeliveryFee: Number(p.workerRetailDeliveryFee) || 0,
      workerWholesaleDeliveryFee: Number(p.workerWholesaleDeliveryFee) || 0,
      workerMachineDeliveryFee: Number(p.workerMachineDeliveryFee) || 0,
      stock: Number(p.stock) || 0
    }));
    return success(res, products);
  } catch (err) {
    console.error('获取商品列表失败:', err);
    return error(res, '获取商品列表失败: ' + err.message);
  }
}

// 获取水站列表（用于下单选择）
async function stations(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT station_id AS id, station_name AS name, contact_name AS contact, phone, address
       FROM sub_stations WHERE status = 1 ORDER BY station_name ASC`
    );
    const stations = rows.map(s => ({
      id: s.id,
      name: s.name,
      contact: s.contact || '',
      phone: s.phone || '',
      address: s.address || ''
    }));
    return success(res, stations);
  } catch (err) {
    console.error('获取水站列表失败:', err);
    return error(res, '获取水站列表失败: ' + err.message);
  }
}

// 获取员工列表（用于配送选择）
async function workers(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT worker_id AS id, worker_name AS name, phone, vehicle_type AS vehicleType
       FROM workers WHERE status = 1 ORDER BY worker_name ASC`
    );
    const workers = rows.map(w => ({
      id: w.id,
      name: w.name,
      phone: w.phone,
      vehicleType: w.vehicleType
    }));
    return success(res, workers);
  } catch (err) {
    console.error('获取员工列表失败:', err);
    return error(res, '获取员工列表失败: ' + err.message);
  }
}

module.exports = {
  list,
  detail,
  create,
  update,
  products,
  stations,
  workers
};

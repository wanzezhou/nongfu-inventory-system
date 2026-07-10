const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

// 生成订单ID：OD + 时间戳 + 4位随机数
function generateOrderId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `OD${timestamp}${random}`;
}

// 获取订单列表
async function getOrderList(req, res) {
  try {
    const { keyword, order_type, order_status, page = 1, pageSize = 10 } = req.query;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];

    // 关键词模糊搜索（订单号或客户名）
    if (keyword) {
      whereClause += ' AND (order_id LIKE ? OR customer_name LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 订单类型筛选
    if (order_type !== undefined && order_type !== '') {
      whereClause += ' AND order_type = ?';
      params.push(Number(order_type));
    }

    // 订单状态筛选
    if (order_status !== undefined && order_status !== '') {
      whereClause += ' AND order_status = ?';
      params.push(Number(order_status));
    }

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM orders ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取订单列表失败:', err);
    return error(res, '获取订单列表失败: ' + err.message);
  }
}

// 获取订单详情
async function getOrderById(req, res) {
  try {
    const { id } = req.params;

    // 查询订单基本信息
    const orderSql = 'SELECT * FROM orders WHERE order_id = ?';
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

    const order = {
      ...orderRows[0],
      items: items
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
      order_type,
      platform_type,
      platform_order_no,
      station_id,
      customer_name,
      customer_phone,
      customer_address,
      delivery_type,
      worker_id,
      remark,
      items
    } = req.body;

    // 校验必填字段
    if (!order_type || !customer_name || !customer_phone || !delivery_type || !items || items.length === 0) {
      return error(res, '订单类型、客户姓名、客户电话、配送方式和商品明细不能为空', 400);
    }

    // 校验订单类型
    const validOrderTypes = [1, 2, 3, 4];
    if (!validOrderTypes.includes(Number(order_type))) {
      return error(res, '订单类型无效', 400);
    }

    // 校验配送类型
    const validDeliveryTypes = [1, 2, 3];
    if (!validDeliveryTypes.includes(Number(delivery_type))) {
      return error(res, '配送方式无效', 400);
    }

    // 水站订单必须有水站ID
    if (Number(order_type) === 2 && !station_id) {
      return error(res, '水站订单必须选择水站', 400);
    }

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();
    const orderId = generateOrderId();

    // 查询所有商品的价格信息
    const productIds = items.map(item => item.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const productsSql = `SELECT * FROM products WHERE product_id IN (${placeholders})`;
    const [productRows] = await connection.execute(productsSql, productIds);

    // 构建商品价格映射
    const productMap = {};
    for (const product of productRows) {
      productMap[product.product_id] = product;
    }

    // 校验所有商品是否存在
    for (const item of items) {
      if (!productMap[item.product_id]) {
        await connection.rollback();
        return error(res, `商品不存在: ${item.product_id}`, 400);
      }
    }

    // 计算订单金额和配送费
    let order_amount = 0;
    let delivery_fee = 0;
    const orderItems = [];

    for (const item of items) {
      const product = productMap[item.product_id];
      const quantity = Number(item.quantity);

      if (isNaN(quantity) || quantity <= 0) {
        await connection.rollback();
        return error(res, '商品数量必须为正数', 400);
      }

      // 根据订单类型计算商品单价
      let unitPrice = 0;
      let deliveryFeePerUnit = 0;

      switch (Number(order_type)) {
        case 1: // 线上
          unitPrice = product.purchase_price;
          deliveryFeePerUnit = product.worker_retail_delivery_fee;
          break;
        case 2: // 水站
          unitPrice = product.wholesale_price;
          if (Number(delivery_type) === 2) {
            // 水站配送
            deliveryFeePerUnit = product.distribution_delivery_fee;
          } else if (Number(delivery_type) === 1) {
            // 员工配送
            deliveryFeePerUnit = product.worker_wholesale_delivery_fee;
          }
          break;
        case 3: // 零售
          unitPrice = product.retail_price;
          deliveryFeePerUnit = product.worker_retail_delivery_fee;
          break;
        case 4: // 零售机
          unitPrice = product.machine_price;
          deliveryFeePerUnit = product.worker_machine_delivery_fee;
          break;
      }

      const subtotal = unitPrice * quantity;
      const itemDeliveryFee = deliveryFeePerUnit * quantity;

      order_amount += subtotal;
      delivery_fee += itemDeliveryFee;

      orderItems.push({
        product_id: item.product_id,
        quantity: quantity,
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
      order_id, order_type, platform_type, platform_order_no, station_id,
      customer_name, customer_phone, customer_address, order_amount,
      delivery_fee, total_receivable, delivery_type, worker_id,
      payment_status, paid_amount, order_status, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const orderValues = [
      orderId,
      order_type,
      platform_type || null,
      platform_order_no || null,
      station_id || null,
      customer_name,
      customer_phone,
      customer_address || null,
      order_amount,
      delivery_fee,
      total_receivable,
      delivery_type,
      worker_id || null,
      0, // payment_status: 0未付
      0, // paid_amount
      0, // order_status: 0待处理
      remark || null,
      now,
      now
    ];

    await connection.execute(insertOrderSql, orderValues);

    // 批量插入订单明细
    for (let i = 0; i < orderItems.length; i++) {
      const item = orderItems[i];
      const insertItemSql = `INSERT INTO order_items (
        item_id, order_id, product_id, quantity, purchase_price,
        wholesale_price, retail_price, machine_price, total_delivery_fee,
        distribution_delivery_fee, worker_retail_delivery_fee,
        worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      const itemId = `${orderId}-${(i + 1).toString().padStart(3, '0')}`;
      const itemValues = [
        itemId,
        orderId,
        item.product_id,
        item.quantity,
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

      // 扣减库存
      const [inventoryRows] = await connection.execute(
        'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (inventoryRows.length === 0) {
        await connection.rollback();
        return error(res, `商品库存不存在: ${item.product_id}`, 400);
      }

      const currentQuantity = inventoryRows[0].quantity;
      if (currentQuantity < item.quantity) {
        await connection.rollback();
        return error(res, `库存不足，商品: ${item.product_id}，当前库存: ${currentQuantity}`, 400);
      }

      const newQuantity = currentQuantity - item.quantity;
      await connection.execute(
        'UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?',
        [newQuantity, now, now, item.product_id]
      );
    }

    // 如果是水站订单，更新水站欠款
    if (Number(order_type) === 2 && station_id) {
      const [stationRows] = await connection.execute(
        'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [station_id]
      );

      if (stationRows.length > 0) {
        const newDebt = Number(stationRows[0].current_debt) + order_amount;
        await connection.execute(
          'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
          [newDebt, now, station_id]
        );
      }
    }

    // 提交事务
    await connection.commit();

    // 查询创建的订单详情
    const [orderResult] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    const [itemsResult] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

    const result = {
      ...orderResult[0],
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

// 更新订单状态
async function updateOrderStatus(req, res) {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { order_status } = req.body;

    if (order_status === undefined || order_status === null) {
      return error(res, '订单状态不能为空', 400);
    }

    const validStatuses = [0, 1, 2, 3];
    if (!validStatuses.includes(Number(order_status))) {
      return error(res, '订单状态无效', 400);
    }

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

    // 如果订单变为已完成且是水站订单，根据付款状态更新欠款
    if (Number(order_status) === 2 && Number(order.order_type) === 2 && order.station_id) {
      // 查询水站信息
      const [stationRows] = await connection.execute(
        'SELECT station_id, current_debt FROM sub_stations WHERE station_id = ? FOR UPDATE',
        [order.station_id]
      );

      if (stationRows.length > 0) {
        let debtChange = 0;
        if (Number(order.payment_status) === 0) {
          // 未付款，欠款增加
          debtChange = order.order_amount;
        } else if (Number(order.payment_status) === 1) {
          // 已付款，欠款不变
          debtChange = 0;
        } else if (Number(order.payment_status) === 2) {
          // 部分付款，欠款增加未付部分
          debtChange = order.order_amount - order.paid_amount;
        }

        if (debtChange !== 0) {
          const newDebt = Number(stationRows[0].current_debt) + debtChange;
          await connection.execute(
            'UPDATE sub_stations SET current_debt = ?, updated_at = ? WHERE station_id = ?',
            [newDebt, new Date(), order.station_id]
          );
        }
      }
    }

    // 更新订单状态
    const updateSql = 'UPDATE orders SET order_status = ?, updated_at = ? WHERE order_id = ?';
    await connection.execute(updateSql, [order_status, new Date(), id]);

    // 提交事务
    await connection.commit();

    // 查询更新后的订单
    const [result] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [id]);

    return success(res, result[0], '订单状态更新成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('更新订单状态失败:', err);
    return error(res, '更新订单状态失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

// 取消订单（软删除，order_status设为3）
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

    if (Number(order.order_status) === 3) {
      await connection.rollback();
      return error(res, '订单已取消', 400);
    }

    // 查询订单明细
    const [items] = await connection.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );

    // 恢复库存
    for (const item of items) {
      const [inventoryRows] = await connection.execute(
        'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
        [item.product_id]
      );

      if (inventoryRows.length > 0) {
        const newQuantity = inventoryRows[0].quantity + item.quantity;
        await connection.execute(
          'UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?',
          [newQuantity, new Date(), item.product_id]
        );
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
    const updateSql = 'UPDATE orders SET order_status = 3, updated_at = ? WHERE order_id = ?';
    await connection.execute(updateSql, [new Date(), id]);

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

module.exports = {
  getOrderList,
  getOrderById,
  createOrder,
  updateOrderStatus,
  deleteOrder
};

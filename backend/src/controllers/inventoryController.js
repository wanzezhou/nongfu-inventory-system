const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

// 生成进货记录ID：PR + 时间戳 + 4位随机数
function generatePurchaseId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PR${timestamp}${random}`;
}

// 格式化库存数据，转成前端需要的驼峰命名
function formatInventory(item, baseUrl) {
  if (!item) return null;
  return {
    id: item.product_id,
    inventoryId: item.inventory_id,
    code: item.product_code,
    name: item.product_name,
    spec: item.specification,
    unit: item.unit,
    category: item.category,
    stock: Number(item.quantity) || 0,
    purchasePrice: Number(item.purchase_price) || 0,
    lastStockInTime: item.last_in_time,
    lastStockOutTime: item.last_out_time,
    updatedAt: item.updated_at,
    image: item.image_url ? `${baseUrl}${item.image_url}` : null
  };
}

// 获取库存列表
async function getInventoryList(req, res) {
  try {
    const { keyword, category, categoryId, page = 1, pageSize = 10, sortBy = 'quantity', sortOrder = 'desc', sortProp } = req.query;

    // 兼容前端传的 categoryId 和 sortProp
    const actualCategory = category || categoryId;
    const actualSortBy = sortBy || sortProp || 'quantity';

    // 构建查询条件 - 以products表为主表，LEFT JOIN inventory
    let whereClause = 'WHERE p.status = 1';
    const params = [];

    // 关键词模糊搜索（商品名称或商品编码）
    if (keyword) {
      whereClause += ' AND (p.product_name LIKE ? OR p.product_code LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 分类筛选
    if (actualCategory) {
      whereClause += ' AND p.category = ?';
      params.push(actualCategory);
    }

    // 验证排序字段，防止SQL注入
    const allowedSortFields = ['quantity', 'last_in_time', 'last_out_time', 'updated_at', 'product_name', 'product_code'];
    const sortField = allowedSortFields.includes(actualSortBy) ? actualSortBy : 'quantity';
    const actualSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

    // 计算总数
    const countSql = `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ${whereClause}
    `;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `
      SELECT
        i.inventory_id,
        p.product_id,
        i.quantity,
        i.last_in_time,
        i.last_out_time,
        i.updated_at,
        p.product_code,
        p.product_name,
        p.specification,
        p.unit,
        p.category,
        p.image_url,
        p.purchase_price,
        p.wholesale_price,
        p.retail_price
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ${whereClause}
      ORDER BY i.${sortField} ${actualSortOrder}
      LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}
    `;
    const [list] = await pool.execute(listSql, params);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const formattedList = list.map(item => formatInventory(item, baseUrl));

    // 库存价值合计（进货价×库存数量，全量统计，受搜索/分类过滤联动）
    const sumSql = `
      SELECT COALESCE(SUM(p.purchase_price * i.quantity), 0) AS total_value
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ${whereClause}
    `;
    const [sumResult] = await pool.execute(sumSql, params);
    const totalValue = Math.round(Number(sumResult[0].total_value) * 100) / 100;

    return success(res, {
      list: formattedList,
      total,
      page: currentPage,
      pageSize: size,
      summary: { totalValue }
    });
  } catch (err) {
    console.error('获取库存列表失败:', err);
    return error(res, '获取库存列表失败: ' + err.message);
  }
}

// 获取单个商品库存详情
async function getInventoryByProductId(req, res) {
  try {
    const { productId } = req.params;

    const sql = `
      SELECT 
        i.inventory_id,
        i.product_id,
        i.quantity,
        i.last_in_time,
        i.last_out_time,
        i.updated_at,
        p.product_code,
        p.product_name,
        p.specification,
        p.unit,
        p.category,
        p.purchase_price,
        p.wholesale_price,
        p.retail_price
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.product_id
      WHERE i.product_id = ?
    `;
    const [rows] = await pool.execute(sql, [productId]);

    if (rows.length === 0) {
      return error(res, '该商品库存不存在', 404);
    }

    return success(res, rows[0]);
  } catch (err) {
    console.error('获取库存详情失败:', err);
    return error(res, '获取库存详情失败: ' + err.message);
  }
}

// 入库操作
async function stockIn(req, res) {
  const connection = await pool.getConnection();
  try {
    // 兼容驼峰和蛇形命名
    const product_id = req.body.product_id || req.body.productId;
    const quantity = req.body.quantity;
    const unit_price = req.body.unit_price ?? req.body.unitPrice ?? 0;
    const supplier_id = req.body.supplier_id || req.body.supplierId;
    const remark = req.body.remark;

    // 校验必填字段
    if (!product_id || !quantity) {
      return error(res, '商品ID和入库数量不能为空', 400);
    }

    // 校验数量是否为正数
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return error(res, '入库数量必须为正数', 400);
    }

    // 检查商品是否存在
    const [productRows] = await connection.execute('SELECT product_id FROM products WHERE product_id = ?', [product_id]);
    if (productRows.length === 0) {
      return error(res, '商品不存在', 404);
    }

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();

    // 检查库存记录是否存在
    const [inventoryRows] = await connection.execute(
      'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
      [product_id]
    );

    if (inventoryRows.length === 0) {
      // 库存记录不存在，创建新记录
      const inventoryId = generatePurchaseId().replace('PR', 'INV');
      await connection.execute(
        `INSERT INTO inventory (inventory_id, product_id, quantity, last_in_time, updated_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [inventoryId, product_id, qty, now, now]
      );
    } else {
      // 库存记录存在，增加数量
      const newQuantity = inventoryRows[0].quantity + qty;
      await connection.execute(
        `UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?`,
        [newQuantity, now, now, product_id]
      );
    }

    // 生成进货记录ID
    const purchase_id = generatePurchaseId();

    // 新增进货记录
    await connection.execute(
      `INSERT INTO purchase_records (
        purchase_id, product_id, quantity, unit_price, supplier_id, 
        total_amount, remark, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchase_id,
        product_id,
        qty,
        unit_price || 0,
        supplier_id || null,
        (unit_price || 0) * qty,
        remark || null,
        now
      ]
    );

    // 提交事务
    await connection.commit();

    // 查询更新后的库存
    const [resultRows] = await pool.execute(
      `SELECT 
        i.inventory_id,
        i.product_id,
        i.quantity,
        i.last_in_time,
        i.updated_at,
        p.product_name,
        p.product_code
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.product_id
      WHERE i.product_id = ?`,
      [product_id]
    );

    return success(res, resultRows[0], '入库成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('入库操作失败:', err);
    return error(res, '入库操作失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

// 出库操作
async function stockOut(req, res) {
  const connection = await pool.getConnection();
  try {
    // 兼容驼峰和蛇形命名
    const product_id = req.body.product_id || req.body.productId;
    const quantity = req.body.quantity;
    const out_type = req.body.out_type || req.body.type || 1;
    const remark = req.body.remark;

    // 校验必填字段
    if (!product_id || !quantity) {
      return error(res, '商品ID和出库数量不能为空', 400);
    }

    // 校验数量是否为正数
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return error(res, '出库数量必须为正数', 400);
    }

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();

    // 检查库存记录是否存在并锁定
    const [inventoryRows] = await connection.execute(
      'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
      [product_id]
    );

    if (inventoryRows.length === 0) {
      await connection.rollback();
      return error(res, '该商品库存不存在', 404);
    }

    // 检查库存是否充足（盘库减少type=3时允许负数）
    const currentQuantity = inventoryRows[0].quantity;
    if (Number(out_type) !== 3 && currentQuantity < qty) {
      await connection.rollback();
      return error(res, '库存不足，当前库存: ' + currentQuantity, 400);
    }

    // 减少库存
    const newQuantity = currentQuantity - qty;
    await connection.execute(
      `UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?`,
      [newQuantity, now, now, product_id]
    );

    // 提交事务
    await connection.commit();

    // 查询更新后的库存
    const [resultRows] = await pool.execute(
      `SELECT 
        i.inventory_id,
        i.product_id,
        i.quantity,
        i.last_out_time,
        i.updated_at,
        p.product_name,
        p.product_code
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.product_id
      WHERE i.product_id = ?`,
      [product_id]
    );

    return success(res, resultRows[0], '出库成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    console.error('出库操作失败:', err);
    return error(res, '出库操作失败: ' + err.message);
  } finally {
    // 释放连接
    connection.release();
  }
}

module.exports = {
  getInventoryList,
  getInventoryByProductId,
  stockIn,
  stockOut
};

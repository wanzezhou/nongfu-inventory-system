const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');

// 生成商品ID：P + 时间戳 + 4位随机数
function generateProductId() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `P${timestamp}${random}`;
}

// 获取商品列表
async function getProductList(req, res) {
  try {
    const { keyword, category, status, page = 1, pageSize = 10 } = req.query;

    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];

    // 关键词模糊搜索（商品名称或商品编码）
    if (keyword) {
      whereClause += ' AND (product_name LIKE ? OR product_code LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // 分类筛选
    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    // 状态筛选
    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    // 计算总数
    const countSql = `SELECT COUNT(*) as total FROM products ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    // 分页查询
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (currentPage - 1) * size;

    const listSql = `SELECT * FROM products ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取商品列表失败:', err);
    return error(res, '获取商品列表失败: ' + err.message);
  }
}

// 获取单个商品详情
async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM products WHERE product_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '商品不存在', 404);
    }

    return success(res, rows[0]);
  } catch (err) {
    console.error('获取商品详情失败:', err);
    return error(res, '获取商品详情失败: ' + err.message);
  }
}

// 新增商品
async function createProduct(req, res) {
  try {
    const {
      product_code,
      product_name,
      specification,
      unit,
      purchase_price,
      wholesale_price,
      retail_price,
      machine_price,
      total_delivery_fee,
      distribution_delivery_fee,
      worker_retail_delivery_fee,
      worker_wholesale_delivery_fee,
      worker_machine_delivery_fee,
      category,
      image_url,
      status = 1
    } = req.body;

    // 校验必填字段
    if (!product_code || !product_name) {
      return error(res, '商品编码和商品名称不能为空', 400);
    }

    // 生成商品ID
    const product_id = generateProductId();

    // 当前时间
    const now = new Date();

    const sql = `INSERT INTO products (
      product_id, product_code, product_name, specification, unit,
      purchase_price, wholesale_price, retail_price, machine_price,
      total_delivery_fee, distribution_delivery_fee,
      worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee,
      category, image_url, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      product_id,
      product_code,
      product_name,
      specification || null,
      unit || null,
      purchase_price || 0,
      wholesale_price || 0,
      retail_price || 0,
      machine_price || 0,
      total_delivery_fee || 0,
      distribution_delivery_fee || 0,
      worker_retail_delivery_fee || 0,
      worker_wholesale_delivery_fee || 0,
      worker_machine_delivery_fee || 0,
      category || null,
      image_url || null,
      status,
      now,
      now
    ];

    await pool.execute(sql, values);

    // 查询新增的商品
    const [rows] = await pool.execute('SELECT * FROM products WHERE product_id = ?', [product_id]);

    return success(res, rows[0], '商品创建成功');
  } catch (err) {
    console.error('创建商品失败:', err);
    return error(res, '创建商品失败: ' + err.message);
  }
}

// 更新商品
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const {
      product_code,
      product_name,
      specification,
      unit,
      purchase_price,
      wholesale_price,
      retail_price,
      machine_price,
      total_delivery_fee,
      distribution_delivery_fee,
      worker_retail_delivery_fee,
      worker_wholesale_delivery_fee,
      worker_machine_delivery_fee,
      category,
      image_url,
      status
    } = req.body;

    // 检查商品是否存在
    const [existing] = await pool.execute('SELECT product_id FROM products WHERE product_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '商品不存在', 404);
    }

    // 构建更新语句
    const updateFields = [];
    const values = [];

    if (product_code !== undefined) {
      updateFields.push('product_code = ?');
      values.push(product_code);
    }
    if (product_name !== undefined) {
      updateFields.push('product_name = ?');
      values.push(product_name);
    }
    if (specification !== undefined) {
      updateFields.push('specification = ?');
      values.push(specification);
    }
    if (unit !== undefined) {
      updateFields.push('unit = ?');
      values.push(unit);
    }
    if (purchase_price !== undefined) {
      updateFields.push('purchase_price = ?');
      values.push(purchase_price);
    }
    if (wholesale_price !== undefined) {
      updateFields.push('wholesale_price = ?');
      values.push(wholesale_price);
    }
    if (retail_price !== undefined) {
      updateFields.push('retail_price = ?');
      values.push(retail_price);
    }
    if (machine_price !== undefined) {
      updateFields.push('machine_price = ?');
      values.push(machine_price);
    }
    if (total_delivery_fee !== undefined) {
      updateFields.push('total_delivery_fee = ?');
      values.push(total_delivery_fee);
    }
    if (distribution_delivery_fee !== undefined) {
      updateFields.push('distribution_delivery_fee = ?');
      values.push(distribution_delivery_fee);
    }
    if (worker_retail_delivery_fee !== undefined) {
      updateFields.push('worker_retail_delivery_fee = ?');
      values.push(worker_retail_delivery_fee);
    }
    if (worker_wholesale_delivery_fee !== undefined) {
      updateFields.push('worker_wholesale_delivery_fee = ?');
      values.push(worker_wholesale_delivery_fee);
    }
    if (worker_machine_delivery_fee !== undefined) {
      updateFields.push('worker_machine_delivery_fee = ?');
      values.push(worker_machine_delivery_fee);
    }
    if (category !== undefined) {
      updateFields.push('category = ?');
      values.push(category);
    }
    if (image_url !== undefined) {
      updateFields.push('image_url = ?');
      values.push(image_url);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      values.push(status);
    }

    // 添加更新时间
    updateFields.push('updated_at = ?');
    values.push(new Date());

    // 添加ID条件
    values.push(id);

    const sql = `UPDATE products SET ${updateFields.join(', ')} WHERE product_id = ?`;
    await pool.execute(sql, values);

    // 查询更新后的商品
    const [rows] = await pool.execute('SELECT * FROM products WHERE product_id = ?', [id]);

    return success(res, rows[0], '商品更新成功');
  } catch (err) {
    console.error('更新商品失败:', err);
    return error(res, '更新商品失败: ' + err.message);
  }
}

// 删除商品（软删除，status设为0）
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;

    // 检查商品是否存在
    const [existing] = await pool.execute('SELECT product_id, status FROM products WHERE product_id = ?', [id]);
    if (existing.length === 0) {
      return error(res, '商品不存在', 404);
    }

    // 软删除：将status设为0
    const sql = 'UPDATE products SET status = 0, updated_at = ? WHERE product_id = ?';
    await pool.execute(sql, [new Date(), id]);

    return success(res, null, '商品删除成功');
  } catch (err) {
    console.error('删除商品失败:', err);
    return error(res, '删除商品失败: ' + err.message);
  }
}

// 获取分类列表
async function getCategoryList(req, res) {
  try {
    const sql = `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category`;
    const [rows] = await pool.execute(sql);

    const data = rows.map((row, index) => ({
      id: index + 1,
      name: row.category
    }));

    return success(res, data);
  } catch (err) {
    console.error('获取分类列表失败:', err);
    return error(res, '获取分类列表失败: ' + err.message);
  }
}

module.exports = {
  getProductList,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategoryList
};

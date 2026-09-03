const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');

const generateProductId = () => generateId('P');

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function formatProduct(product, baseUrl) {
  if (!product) return null;
  return {
    id: product.product_id,
    code: product.product_code,
    name: product.product_name,
    spec: product.specification,
    unit: product.unit,
    purchasePrice: Number(product.purchase_price) || 0,
    wholesalePrice: Number(product.wholesale_price) || 0,
    retailPrice: Number(product.retail_price) || 0,
    vendingPrice: Number(product.machine_price) || 0,
    totalDeliveryFee: Number(product.total_delivery_fee) || 0,
    distributionDeliveryFee: Number(product.distribution_delivery_fee) || 0,
    workerRetailDeliveryFee: Number(product.worker_retail_delivery_fee) || 0,
    workerStationDeliveryFee: Number(product.worker_wholesale_delivery_fee) || 0,
    workerVendingDeliveryFee: Number(product.worker_machine_delivery_fee) || 0,
    category: product.category,
    categoryId: product.category,
    image: product.image_url ? `${baseUrl}${product.image_url}` : null,
    status: product.status,
    createdAt: product.created_at,
    updatedAt: product.updated_at
  };
}

async function getProductList(req, res) {
  try {
    const { keyword, category, status, page = 1, pageSize = 10 } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (keyword) {
      whereClause += ' AND (product_name LIKE ? OR product_code LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (category) {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    if (status !== undefined && status !== '') {
      whereClause += ' AND status = ?';
      params.push(Number(status));
    }

    const countSql = `SELECT COUNT(*) as total FROM products ${whereClause}`;
    const [countResult] = await pool.execute(countSql, params);
    const total = countResult[0].total;

    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

    const listSql = `SELECT * FROM products ${whereClause} ORDER BY created_at DESC LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [list] = await pool.execute(listSql, params);

    const baseUrl = getBaseUrl(req);
    const formattedList = list.map(item => formatProduct(item, baseUrl));

    return pagination(res, formattedList, total, currentPage, size);
  } catch (err) {
    console.error('获取商品列表失败:', err);
    return error(res, '获取商品列表失败: ' + err.message);
  }
}

async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const sql = 'SELECT * FROM products WHERE product_id = ?';
    const [rows] = await pool.execute(sql, [id]);

    if (rows.length === 0) {
      return error(res, '商品不存在', 404);
    }

    const baseUrl = getBaseUrl(req);
    return success(res, formatProduct(rows[0], baseUrl));
  } catch (err) {
    console.error('获取商品详情失败:', err);
    return error(res, '获取商品详情失败: ' + err.message);
  }
}

async function createProduct(req, res) {
  try {
    const body = req.body;
    const product_code = body.product_code || body.code;
    const product_name = body.product_name || body.name;
    const specification = body.specification || body.spec;
    const unit = body.unit;
    const purchase_price = body.purchase_price ?? body.purchasePrice;
    const wholesale_price = body.wholesale_price ?? body.wholesalePrice;
    const retail_price = body.retail_price ?? body.retailPrice;
    const machine_price = body.machine_price ?? body.vendingPrice;
    const total_delivery_fee = body.total_delivery_fee ?? body.totalDeliveryFee;
    const distribution_delivery_fee = body.distribution_delivery_fee ?? body.distributionDeliveryFee;
    const worker_retail_delivery_fee = body.worker_retail_delivery_fee ?? body.workerRetailDeliveryFee;
    const worker_wholesale_delivery_fee = body.worker_wholesale_delivery_fee ?? body.workerStationDeliveryFee;
    const worker_machine_delivery_fee = body.worker_machine_delivery_fee ?? body.workerVendingDeliveryFee;
    const category = body.category || body.categoryId;
    const image_url = body.image_url || body.image;
    const status = body.status !== undefined ? body.status : 1;

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

    const [rows] = await pool.execute('SELECT * FROM products WHERE product_id = ?', [product_id]);

    const baseUrl = getBaseUrl(req);
    return success(res, formatProduct(rows[0], baseUrl), '商品创建成功');
  } catch (err) {
    console.error('创建商品失败:', err);
    return error(res, '创建商品失败: ' + err.message);
  }
}

async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const body = req.body;

    const product_code = body.product_code || body.code;
    const product_name = body.product_name || body.name;
    const specification = body.specification !== undefined ? body.specification : body.spec;
    const unit = body.unit;
    const purchase_price = body.purchase_price ?? body.purchasePrice;
    const wholesale_price = body.wholesale_price ?? body.wholesalePrice;
    const retail_price = body.retail_price ?? body.retailPrice;
    const machine_price = body.machine_price ?? body.vendingPrice;
    const total_delivery_fee = body.total_delivery_fee ?? body.totalDeliveryFee;
    const distribution_delivery_fee = body.distribution_delivery_fee ?? body.distributionDeliveryFee;
    const worker_retail_delivery_fee = body.worker_retail_delivery_fee ?? body.workerRetailDeliveryFee;
    const worker_wholesale_delivery_fee = body.worker_wholesale_delivery_fee ?? body.workerStationDeliveryFee;
    const worker_machine_delivery_fee = body.worker_machine_delivery_fee ?? body.workerVendingDeliveryFee;
    const category = body.category || body.categoryId;
    const image_url = body.image_url !== undefined ? body.image_url : body.image;
    const status = body.status;

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

    const [rows] = await pool.execute('SELECT * FROM products WHERE product_id = ?', [id]);

    const baseUrl = getBaseUrl(req);
    return success(res, formatProduct(rows[0], baseUrl), '商品更新成功');
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

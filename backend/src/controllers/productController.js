const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { generateId } = require('../utils/idGen');

const generateProductId = () => generateId('P');

// ===== 商品图片上传 =====
// 图片落盘到「商品档案/商品图片/」，数据库只存相对路径（image_url varchar(500) 存不下 base64）。
// 该目录同时由 app.js 的 express.static('/product_images') 对外提供访问。
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../../商品档案/商品图片');

// 允许的图片类型（按 MIME 白名单，不信任扩展名）
const IMAGE_MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp'
};

function ensureImageDir() {
  if (!fs.existsSync(PRODUCT_IMAGE_DIR)) {
    fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
  }
  return PRODUCT_IMAGE_DIR;
}

const imageStorage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      cb(null, ensureImageDir());
    } catch (err) {
      cb(err);
    }
  },
  filename(req, file, cb) {
    // 扩展名以 MIME 白名单为准，避免用户端带奇形怪状的后缀
    const ext = IMAGE_MIME_EXT[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${generateId('IMG')}${ext}`);
  }
});

const uploadProductImageRaw = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (IMAGE_MIME_EXT[file.mimetype]) return cb(null, true);
    return cb(new Error('仅支持上传 png / jpg / webp / gif / bmp 格式的图片'));
  }
}).single('file');

// 包装 multer：把 fileFilter / limits 抛出的错误转成 400 业务提示。
// 不包装的话会冒泡成全局 500「服务器内部错误」，用户看不到真正原因（如「只支持图片」）。
//
// ⚠️ 磁盘存储下 multer 会**先落盘再校验大小**：超过 fileSize 限制时它抛
// LIMIT_FILE_SIZE 并中止，但那个「超大半成品」已经写在磁盘上了。这里负责清掉，
// 否则每被拒一次就多一个孤儿文件（曾经真实发生过）。
function cleanupOrphanUpload(file) {
  if (!file || !file.path) return;
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  } catch (e) {
    console.error('清理上传孤儿文件失败:', file.path, e.message);
  }
}

function uploadProductImage(req, res, next) {
  uploadProductImageRaw(req, res, (err) => {
    if (!err) return next();

    // 清理可能已落盘的半成品文件
    cleanupOrphanUpload(req.file);
    if (Array.isArray(err.storageErrors)) {
      err.storageErrors.forEach((se) => cleanupOrphanUpload(se.file));
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return error(res, '图片大小不能超过 5MB', 400);
      }
      return error(res, `图片上传失败：${err.message}`, 400);
    }
    // fileFilter 里自定义的 Error（格式不支持等）
    return error(res, err.message || '图片上传失败', 400);
  });
}

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
    // 字段名经 normalizeBody 中间件归一为驼峰；code/name/spec 等短别名保留兼容
    const product_code = body.productCode || body.code;
    const product_name = body.productName || body.name;
    const specification = body.specification || body.spec;
    const unit = body.unit;
    const purchase_price = body.purchasePrice;
    const wholesale_price = body.wholesalePrice;
    const retail_price = body.retailPrice;
    const machine_price = body.machinePrice ?? body.vendingPrice;
    const total_delivery_fee = body.totalDeliveryFee;
    const distribution_delivery_fee = body.distributionDeliveryFee;
    const worker_retail_delivery_fee = body.workerRetailDeliveryFee;
    const worker_wholesale_delivery_fee = body.workerWholesaleDeliveryFee ?? body.workerStationDeliveryFee;
    const worker_machine_delivery_fee = body.workerMachineDeliveryFee ?? body.workerVendingDeliveryFee;
    const category = body.category || body.categoryId;
    const image_url = body.imageUrl || body.image;
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

    const product_code = body.productCode || body.code;
    const product_name = body.productName || body.name;
    const specification = body.specification !== undefined ? body.specification : body.spec;
    const unit = body.unit;
    const purchase_price = body.purchasePrice;
    const wholesale_price = body.wholesalePrice;
    const retail_price = body.retailPrice;
    const machine_price = body.machinePrice ?? body.vendingPrice;
    const total_delivery_fee = body.totalDeliveryFee;
    const distribution_delivery_fee = body.distributionDeliveryFee;
    const worker_retail_delivery_fee = body.workerRetailDeliveryFee;
    const worker_wholesale_delivery_fee = body.workerWholesaleDeliveryFee ?? body.workerStationDeliveryFee;
    const worker_machine_delivery_fee = body.workerMachineDeliveryFee ?? body.workerVendingDeliveryFee;
    const category = body.category || body.categoryId;
    const image_url = body.imageUrl !== undefined ? body.imageUrl : body.image;
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

// 上传商品图片：返回可供 <img src> 直接使用的相对路径
// 前端拿到 path 后写入 productForm.image，随商品创建/更新一并提交
async function handleUploadImage(req, res) {
  try {
    if (!req.file) {
      return error(res, '未接收到图片文件', 400);
    }
    const relativePath = `/product_images/${req.file.filename}`;
    return success(
      res,
      {
        path: relativePath,
        url: `${getBaseUrl(req)}${relativePath}`,
        filename: req.file.filename,
        size: req.file.size
      },
      '图片上传成功'
    );
  } catch (err) {
    console.error('上传商品图片失败:', err);
    return error(res, '上传商品图片失败: ' + err.message);
  }
}

module.exports = {
  getProductList,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategoryList,
  uploadProductImage,
  handleUploadImage
};

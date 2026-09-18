const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const { parsePage } = require('../utils/pagination');
const { genTxId, genTxNo } = require('./financeAccountController');
const { generateId } = require('../utils/idGen');

// 生成进货记录ID：PR + 时间戳 + 4位随机数
const generatePurchaseId = () => generateId('PR');

// 生成出库记录ID：SO + 时间戳 + 4位随机数
const generateStockOutId = () => generateId('SO');

// 金额两位小数，避免浮点误差
function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// 业务校验失败：标记后由 catch 统一 rollback 并返回 400
function bizFail(message) {
  const e = new Error(message);
  e.business = true;
  return e;
}

// 入库单号 -> 资金流水关联模块
const TX_MODULE_PURCHASE = 'purchase';        // 入库扣款（支出）
const TX_MODULE_PURCHASE_VOID = 'purchase_void'; // 入库作废退回（收入）

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

/**
 * 库存下拉选项（2026-09-18 代码审查 #1 新增）
 *
 * 与「商品下拉」同因：下拉类数据此前借用分页接口 + 硬编码 pageSize 100/200，
 * 实体数一超上限，选项就静默缺失（本库 159 个商品 → 只能选到前 100 个）。
 * 本接口不分页、全量返回，字段与列表接口完全一致（复用 formatInventory），
 * 前端只需换接口名，合并库存的既有逻辑零改动。
 */
const INVENTORY_OPTIONS_MAX = Number(process.env.OPTIONS_MAX_ROWS || 5000);

async function getInventoryOptions(req, res) {
  try {
    const { category, categoryId } = req.query;
    const actualCategory = category || categoryId;

    let whereClause = 'WHERE p.status = 1';
    const params = [];
    if (actualCategory) {
      whereClause += ' AND p.category = ?';
      params.push(actualCategory);
    }

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) AS total FROM products p LEFT JOIN inventory i ON p.product_id = i.product_id ${whereClause}`,
      params
    );
    const total = Number(countResult[0].total) || 0;
    if (total > INVENTORY_OPTIONS_MAX) {
      return error(res, `库存记录 ${total} 条超过下拉上限 ${INVENTORY_OPTIONS_MAX}，请改用关键字搜索`, 400);
    }

    const [list] = await pool.execute(
      `SELECT
         i.inventory_id, p.product_id, i.quantity, i.last_in_time, i.last_out_time, i.updated_at,
         p.product_code, p.product_name, p.specification, p.unit, p.category,
         p.image_url, p.purchase_price
       FROM products p
       LEFT JOIN inventory i ON p.product_id = i.product_id
       ${whereClause}
       ORDER BY p.product_name ASC`,
      params
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return success(res, {
      list: list.map((item) => formatInventory(item, baseUrl)),
      total
    });
  } catch (err) {
    console.error('获取库存选项失败:', err);
    return error(res, '获取库存选项失败');
  }
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
    const { page: currentPage, size, offset } = parsePage({ page, pageSize });

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

    // 库存价值合计（Σ max(库存,0) × 进货价，全量统计，受搜索/分类过滤联动）
    //   GREATEST(quantity,0)：负库存不计负值，与仪表盘「库存总金额」口径保持一致
    const sumSql = `
      SELECT COALESCE(SUM(p.purchase_price * GREATEST(i.quantity, 0)), 0) AS total_value
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
    return error(res, '获取库存列表失败');
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
    return error(res, '获取库存详情失败');
  }
}

// 入库操作
async function stockIn(req, res) {
  const connection = await pool.getConnection();
  try {
    // 字段名经 normalizeBody 中间件归一为驼峰
    const product_id = req.body.productId;
    const quantity = req.body.quantity;
    const unit_price = req.body.unitPrice ?? 0;
    const supplier_id = req.body.supplierId;
    const account_id = req.body.accountId;
    const remark = req.body.remark;
    const handler = (req.user && (req.user.username || req.user.id)) || null;
    const unitPrice = Number(unit_price) || 0;

    // 校验必填字段
    if (!product_id || !quantity) {
      return error(res, '商品ID和入库数量不能为空', 400);
    }

    // 校验数量是否为正数
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return error(res, '入库数量必须为正数', 400);
    }

    if (unitPrice < 0) {
      return error(res, '入库单价不能为负数', 400);
    }

    // 付款账户必选（扣款与入库在同一事务，不允许"已入库未扣款"）
    if (!account_id) {
      return error(res, '请选择付款公司账户', 400);
    }

    // 检查商品是否存在
    const [productRows] = await connection.execute('SELECT product_id, product_name FROM products WHERE product_id = ?', [product_id]);
    if (productRows.length === 0) {
      return error(res, '商品不存在', 404);
    }

    // 开始事务
    await connection.beginTransaction();

    const now = new Date();
    const totalAmount = round2(unitPrice * qty);

    // 校验付款账户（行锁，防并发超扣）
    const [accRows] = await connection.query(
      'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE',
      [account_id]
    );
    if (accRows.length === 0) {
      throw bizFail('付款账户不存在或已停用');
    }
    const account = accRows[0];
    const balanceBefore = Number(account.current_balance);
    if (balanceBefore + 1e-9 < totalAmount) {
      throw bizFail(`账户「${account.account_name}」余额不足，当前余额 ¥${balanceBefore.toFixed(2)}，本次需扣款 ¥${totalAmount.toFixed(2)}`);
    }
    const balanceAfter = round2(balanceBefore - totalAmount);

    // 供应商名称（流水对手方）
    let counterparty = null;
    if (supplier_id) {
      const [supRows] = await connection.query('SELECT supplier_name FROM suppliers WHERE supplier_id = ?', [supplier_id]);
      counterparty = supRows.length ? supRows[0].supplier_name : null;
    }

    // 检查库存记录是否存在
    const [inventoryRows] = await connection.execute(
      'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
      [product_id]
    );

    if (inventoryRows.length === 0) {
      // 库存记录不存在，创建新记录（inventory_id 为 INT 自增，不手填）
      await connection.execute(
        `INSERT INTO inventory (product_id, quantity, last_in_time, updated_at) 
         VALUES (?, ?, ?, ?)`,
        [product_id, qty, now, now]
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

    // 新增进货记录（含付款账户与实付金额快照）
    await connection.execute(
      `INSERT INTO purchase_records (
        purchase_id, product_id, quantity, unit_price, supplier_id, account_id, account_name,
        total_amount, paid_amount, payment_status, status, payment_date, remark, handler, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
      [
        purchase_id,
        product_id,
        qty,
        unitPrice,
        supplier_id || null,
        account.account_id,
        account.account_name,
        totalAmount,
        totalAmount,
        now,
        remark || null,
        handler,
        now
      ]
    );

    // 账户扣款
    await connection.execute(
      'UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?',
      [balanceAfter, account.account_id]
    );

    // 资金流水（related_id = 入库单号，便于对账追溯）
    await connection.execute(
      `INSERT INTO finance_transactions
         (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
          related_module, related_id, tx_date, handler, counterparty, remark, created_at)
       VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
      [
        genTxId(), genTxNo(), account.account_id, account.account_name, '采购入库', totalAmount,
        balanceBefore, balanceAfter, TX_MODULE_PURCHASE, purchase_id, handler, counterparty,
        remark || `入库单 ${purchase_id} 采购付款`
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

    return success(res, {
      ...resultRows[0],
      purchaseId: purchase_id,
      accountId: account.account_id,
      accountName: account.account_name,
      paidAmount: totalAmount,
      balanceAfter
    }, '入库成功');
  } catch (err) {
    // 回滚事务：入库、扣款、流水一并撤销
    await connection.rollback();
    if (err.business) {
      return error(res, err.message, 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    }
    console.error('入库操作失败:', err);
    return error(res, '入库操作失败');
  } finally {
    // 释放连接
    connection.release();
  }
}

// 入库记录列表（筛选：商品/供应商/账户/状态/日期范围，分页）
async function getPurchaseRecords(req, res) {
  try {
    const { keyword, productId, supplierId, accountId, status, startDate, endDate, page = 1, pageSize = 10 } = req.query;
    const { page: p, size, offset } = parsePage({ page, pageSize });

    const parts = [];
    const params = [];
    if (keyword) {
      parts.push('(pr.purchase_id LIKE ? OR p.product_name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (productId) { parts.push('pr.product_id = ?'); params.push(productId); }
    if (supplierId) { parts.push('pr.supplier_id = ?'); params.push(supplierId); }
    if (accountId) { parts.push('pr.account_id = ?'); params.push(accountId); }
    if (status !== undefined && status !== '') { parts.push('pr.status = ?'); params.push(Number(status)); }
    if (startDate) { parts.push('DATE(pr.created_at) >= ?'); params.push(startDate); }
    if (endDate) { parts.push('DATE(pr.created_at) <= ?'); params.push(endDate); }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [rows] = await pool.query(
      `SELECT pr.*, p.product_name, p.product_code, p.specification, p.unit, s.supplier_name
       FROM purchase_records pr
       LEFT JOIN products p ON pr.product_id = p.product_id
       LEFT JOIN suppliers s ON pr.supplier_id = s.supplier_id
       ${where}
       ORDER BY pr.created_at DESC
       LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.query(
      `SELECT COUNT(*) n FROM purchase_records pr
       LEFT JOIN products p ON pr.product_id = p.product_id
       ${where}`,
      params
    );

    return success(res, {
      list: rows.map((r) => ({
        purchaseId: r.purchase_id,
        productId: r.product_id,
        productName: r.product_name || '',
        productCode: r.product_code || '',
        spec: r.specification || '',
        unit: r.unit || '',
        supplierId: r.supplier_id,
        supplierName: r.supplier_name || '',
        accountId: r.account_id,
        accountName: r.account_name || '',
        quantity: Number(r.quantity) || 0,
        unitPrice: Number(r.unit_price) || 0,
        totalAmount: Number(r.total_amount) || 0,
        paidAmount: Number(r.paid_amount) || 0,
        paymentStatus: Number(r.payment_status) || 0,
        status: Number(r.status) || 1,
        voidAt: r.void_at,
        voidBy: r.void_by || '',
        voidReason: r.void_reason || '',
        handler: r.handler || '',
        remark: r.remark || '',
        createdAt: r.created_at
      })),
      total: cnt[0].n,
      page: p, pageSize: size
    });
  } catch (err) {
    console.error('获取入库记录失败:', err);
    return error(res, '获取入库记录失败');
  }
}

// 作废入库单：回退库存 + 账户原路退回 + 反向流水（全部同一事务）
async function voidPurchaseRecord(req, res) {
  const connection = await pool.getConnection();
  try {
    const purchase_id = req.params.purchaseId || req.body.purchaseId;
    const reason = req.body.reason || req.body.voidReason;
    const handler = (req.user && (req.user.username || req.user.id)) || null;

    if (!purchase_id) return error(res, '入库单号不能为空', 400);

    await connection.beginTransaction();

    const [rows] = await connection.query(
      'SELECT * FROM purchase_records WHERE purchase_id = ? FOR UPDATE',
      [purchase_id]
    );
    if (rows.length === 0) throw bizFail('入库单不存在');
    const pr = rows[0];
    if (Number(pr.status) === 2) throw bizFail('该入库单已作废，无法重复操作');

    const qty = Number(pr.quantity) || 0;
    const refundAmount = round2(pr.paid_amount || 0);

    // 1. 回退库存（扣减入库数量）
    const [invRows] = await connection.query(
      'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
      [pr.product_id]
    );
    if (invRows.length === 0) throw bizFail('库存记录不存在，无法作废');
    const stock = Number(invRows[0].quantity) || 0;
    if (stock < qty) {
      throw bizFail(`库存不足，无法回退：当前库存 ${stock}，需回退 ${qty}`);
    }
    await connection.execute(
      'UPDATE inventory SET quantity = ?, updated_at = NOW() WHERE product_id = ?',
      [stock - qty, pr.product_id]
    );

    // 2. 账户原路退回
    let balanceAfter = null;
    if (pr.account_id) {
      const [accRows] = await connection.query(
        'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? FOR UPDATE',
        [pr.account_id]
      );
      if (accRows.length === 0) throw bizFail('原付款账户不存在，无法原路退回');
      const acc = accRows[0];
      const balanceBefore = Number(acc.current_balance);
      balanceAfter = round2(balanceBefore + refundAmount);
      await connection.execute(
        'UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?',
        [balanceAfter, acc.account_id]
      );
      await connection.execute(
        `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
        [
          genTxId(), genTxNo(), acc.account_id, acc.account_name, '入库退回', refundAmount,
          balanceBefore, balanceAfter, TX_MODULE_PURCHASE_VOID, purchase_id, handler,
          pr.account_name || null, reason || `入库单 ${purchase_id} 作废退回`
        ]
      );
    }

    // 3. 标记作废
    await connection.execute(
      `UPDATE purchase_records SET status = 2, void_at = NOW(), void_by = ?, void_reason = ?, payment_status = 0
       WHERE purchase_id = ?`,
      [handler, reason || null, purchase_id]
    );

    await connection.commit();
    return success(res, { purchaseId: purchase_id, refundAmount, balanceAfter }, '入库单已作废，款项原路退回');
  } catch (err) {
    await connection.rollback();
    if (err.business) return error(res, err.message, 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('作废入库单失败:', err);
    return error(res, '作废入库单失败');
  } finally {
    connection.release();
  }
}

// 出库操作
async function stockOut(req, res) {
  const connection = await pool.getConnection();
  try {
    // 字段名经 normalizeBody 中间件归一为驼峰
    const product_id = req.body.productId;
    const quantity = req.body.quantity;
    const out_type = req.body.outType || req.body.type || 1;
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

    // 写出库台账（商品名称/编码快照，F4 修复：此前出库无任何台账记录）
    const [productRows] = await connection.execute(
      'SELECT product_name, product_code FROM products WHERE product_id = ?',
      [product_id]
    );
    await connection.execute(
      `INSERT INTO stock_out_records (
        record_id, product_id, product_name, product_code,
        quantity, out_type, stock_after, remark, handler, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateStockOutId(),
        product_id,
        productRows[0] ? productRows[0].product_name : null,
        productRows[0] ? productRows[0].product_code : null,
        qty,
        Number(out_type) || 1,
        newQuantity,
        remark || null,
        (req.user && (req.user.username || req.user.name)) || null,
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
    return error(res, '出库操作失败');
  } finally {
    // 释放连接
    connection.release();
  }
}

// 出库台账列表（分页 + 筛选：关键词/商品/类型/日期区间）
async function getStockOutRecords(req, res) {
  try {
    const { page, size: pageSize, offset } = parsePage(req.query, { maxSize: 100 });

    const conditions = [];
    const params = [];

    const keyword = (req.query.keyword || '').trim();
    if (keyword) {
      conditions.push('(r.product_name LIKE ? OR r.product_code LIKE ? OR r.record_id LIKE ? OR r.remark LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const productId = (req.query.productId || '').trim();
    if (productId) {
      conditions.push('r.product_id = ?');
      params.push(productId);
    }
    const outType = parseInt(req.query.outType, 10);
    if (outType) {
      conditions.push('r.out_type = ?');
      params.push(outType);
    }
    if (req.query.startDate) {
      conditions.push('r.created_at >= ?');
      params.push(`${req.query.startDate} 00:00:00`);
    }
    if (req.query.endDate) {
      conditions.push('r.created_at <= ?');
      params.push(`${req.query.endDate} 23:59:59`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM stock_out_records r ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT r.record_id, r.product_id, r.product_name, r.product_code,
              r.quantity, r.out_type, r.stock_after, r.remark, r.handler, r.created_at
       FROM stock_out_records r ${whereSql}
       ORDER BY r.created_at DESC, r.record_id DESC
       LIMIT ${parseInt(offset, 10)}, ${parseInt(pageSize, 10)}`,
      params
    );

    return pagination(res, rows.map(r => ({
      recordId: r.record_id,
      productId: r.product_id,
      productName: r.product_name,
      productCode: r.product_code,
      quantity: r.quantity,
      outType: r.out_type,
      stockAfter: r.stock_after,
      remark: r.remark,
      handler: r.handler,
      createdAt: r.created_at
    })), total, page, pageSize);
  } catch (err) {
    console.error('获取出库台账失败:', err);
    return error(res, '获取出库台账失败');
  }
}

module.exports = {
  getInventoryList,
  getInventoryOptions,
  getInventoryByProductId,
  stockIn,
  stockOut,
  getPurchaseRecords,
  voidPurchaseRecord,
  getStockOutRecords
};

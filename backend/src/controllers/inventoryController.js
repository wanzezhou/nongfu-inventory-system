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

// 业务校验失败：标记后由调用方统一 rollback 并返回 400
//   status：少数校验需要 404（如「商品不存在」）。默认 400。
//   ⚠️ 之所以要有 status：下面抽出的 applyStockIn / applyStockOut 等**核心事务体不带 res**，
//      结果只能靠抛出的错误表达；若一律按 400 处理，Web 端原有的 404 会**静默变成 400**
//      （前端按状态码分支的提示就会跟着错）。
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

// 入库单号 -> 资金流水关联模块
const TX_MODULE_PURCHASE = 'purchase'; // 入库扣款（支出）
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

// ============================================================================
// 列表筛选构造（**单一来源**）
// ----------------------------------------------------------------------------
// Web 管理端与小程序管理端（Phase 8b）共用同一段条件拼装。
// ⚠️ 两处各写一份的代价不是啰嗦，而是「改了 Web 忘了小程序」→ 同一个页面在两端
//    给出不同结果，且**都不会报错**。本仓库的区间约定已有过此类分叉（见 §8 两套区间）。
// ============================================================================

/** 库存列表可排序字段白名单（防注入；导出以便小程序端共用同一份白名单，避免白名单分叉） */
const INVENTORY_SORT_FIELDS = [
  'quantity',
  'last_in_time',
  'last_out_time',
  'updated_at',
  'product_name',
  'product_code'
];

/**
 * 库存列表条件（主表是 products，条件一律带 p. 前缀）
 * @param {object} query 请求 query（兼容 categoryId 别名）
 * @returns {{clause: string, params: Array}} clause 含前导 WHERE
 */
function buildInventoryListWhere(query = {}) {
  const keyword = query.keyword;
  const category = query.category || query.categoryId;
  const parts = ['p.status = 1'];
  const params = [];

  if (keyword) {
    parts.push('(p.product_name LIKE ? OR p.product_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (category) {
    parts.push('p.category = ?');
    params.push(category);
  }
  return { clause: 'WHERE ' + parts.join(' AND '), params };
}

/** 进货（入库）记录条件（主表 purchase_records，别名 pr；产品别名 p） */
function buildPurchaseListWhere(query = {}) {
  const { keyword, productId, supplierId, accountId, status, startDate, endDate } = query;
  const parts = [];
  const params = [];

  if (keyword) {
    parts.push('(pr.purchase_id LIKE ? OR p.product_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (productId) {
    parts.push('pr.product_id = ?');
    params.push(productId);
  }
  if (supplierId) {
    parts.push('pr.supplier_id = ?');
    params.push(supplierId);
  }
  if (accountId) {
    parts.push('pr.account_id = ?');
    params.push(accountId);
  }
  // 注意：status 为 0 也要生效（0=未付款），故不能用真值判断
  if (status !== undefined && status !== '') {
    parts.push('pr.status = ?');
    params.push(Number(status));
  }
  if (startDate) {
    parts.push('DATE(pr.created_at) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    parts.push('DATE(pr.created_at) <= ?');
    params.push(endDate);
  }
  return { clause: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

/** 出库台账条件（主表 stock_out_records，别名 r） */
function buildStockOutListWhere(query = {}) {
  const conditions = [];
  const params = [];

  const keyword = (query.keyword || '').trim();
  if (keyword) {
    conditions.push('(r.product_name LIKE ? OR r.product_code LIKE ? OR r.record_id LIKE ? OR r.remark LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const productId = (query.productId || '').trim();
  if (productId) {
    conditions.push('r.product_id = ?');
    params.push(productId);
  }
  const outType = parseInt(query.outType, 10);
  if (outType) {
    conditions.push('r.out_type = ?');
    params.push(outType);
  }
  // 出库台账的时间是**时刻**（datetime），故补足到日界，与列表的「当天全部」直觉一致
  if (query.startDate) {
    conditions.push('r.created_at >= ?');
    params.push(`${query.startDate} 00:00:00`);
  }
  if (query.endDate) {
    conditions.push('r.created_at <= ?');
    params.push(`${query.endDate} 23:59:59`);
  }
  return { clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
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

    const { clause: whereClause, params } = buildInventoryListWhere({ category: actualCategory });

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
      list: list.map(item => formatInventory(item, baseUrl)),
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
    const { page = 1, pageSize = 10, sortBy = 'quantity', sortOrder = 'desc', sortProp } = req.query;

    // 兼容前端传的 sortProp
    const actualSortBy = sortBy || sortProp || 'quantity';

    // 构建查询条件 - 以products表为主表，LEFT JOIN inventory
    const { clause: whereClause, params } = buildInventoryListWhere(req.query);

    // 验证排序字段，防止SQL注入
    const sortField = INVENTORY_SORT_FIELDS.includes(actualSortBy) ? actualSortBy : 'quantity';
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

// ============================================================================
// 核心事务体（**单一来源**：Web 管理端与小程序管理端 Phase 8b 共用）
// ----------------------------------------------------------------------------
// ⚠️ 这几个函数**不管理事务**（不 begin / commit / rollback），连接由调用方传入。
//    原因：小程序端必须在**同一事务**里先占幂等键、再写审计日志，
//    若核心体自己 commit，占键与审计就被挤到事务外 → 弱网重放会重复记账/重复扣款。
//
// ⚠️ 资金纪律（见项目铁律 §8）：
//      入库 = 库存 + 进货记录 + 账户扣款 + 资金流水，四者同事务；
//      作废 = 回退库存 + **原路退回**（收入方向）+ 反向流水 + 标记作废，同事务。
//    扣款前一律 `FOR UPDATE` 锁账户并校验余额。
// ============================================================================

/**
 * 入库核心事务
 *
 * @param {*} conn 已开启事务的连接
 * @param {{productId:string, quantity:number, unitPrice?:number, supplierId?:string,
 *          accountId:string, remark?:string, handler?:string}} p
 * @returns {Promise<{purchaseId:string, accountId:string, accountName:string,
 *                    paidAmount:number, balanceAfter:number}>}
 * @throws {Error} business=true 的校验失败（err.status 为对应 HTTP 码）
 */
async function applyStockIn(conn, { productId, quantity, unitPrice = 0, supplierId, accountId, remark, handler }) {
  // ① 入参校验
  // ⚠️ quantity 用显式判空而不是 `!quantity`：0 是合法数字、会被 falsy 判断吞进
  //    「不能为空」，用户看到的文案与实际错误（数量必须是正数）对不上。
  if (!productId || quantity === undefined || quantity === null || quantity === '') {
    throw bizFail('商品ID和入库数量不能为空');
  }
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) throw bizFail('入库数量必须为正数');
  // ⚠️ 必须显式要求整数：`inventory.quantity` / `purchase_records.quantity` 都是 INT 列，
  //    传 2.5 进去 MySQL **不会报错**，而是四舍五入成 3 并只给一个 warning ——
  //    表现为「填了 2.5 件、库存多了 3 件」，且事后无从追溯。
  //    （本仓库对「静默四舍五入」有明确教训，故这里直接拒绝而不是依赖数据库行为。）
  if (!Number.isInteger(qty)) throw bizFail('入库数量必须为整数（库存按件计）');
  const price = Number(unitPrice) || 0;
  if (price < 0) throw bizFail('入库单价不能为负数');

  // ② 商品必须存在（先验业务对象，再验资金账户 —— 否则传了不存在的商品时，
  //    用户看到的错误是「请选择付款账户」，与真正的问题南辕北辙）
  const [productRows] = await conn.execute('SELECT product_id, product_name FROM products WHERE product_id = ?', [
    productId
  ]);
  if (productRows.length === 0) throw bizFail('商品不存在', 404);

  // ③ 付款账户必选（扣款与入库在同一事务，不允许「已入库未扣款」）
  if (!accountId) throw bizFail('请选择付款公司账户');

  const now = new Date();
  const totalAmount = round2(price * qty);

  // ④ 付款账户（行锁，防并发超扣）
  const [accRows] = await conn.query(
    'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? AND status = 1 FOR UPDATE',
    [accountId]
  );
  if (accRows.length === 0) throw bizFail('付款账户不存在或已停用');
  const account = accRows[0];
  const balanceBefore = Number(account.current_balance);
  if (balanceBefore + 1e-9 < totalAmount) {
    throw bizFail(
      `账户「${account.account_name}」余额不足，当前余额 ¥${balanceBefore.toFixed(2)}，本次需扣款 ¥${totalAmount.toFixed(2)}`
    );
  }
  const balanceAfter = round2(balanceBefore - totalAmount);

  // ④ 供应商名称（流水对手方）
  let counterparty = null;
  if (supplierId) {
    const [supRows] = await conn.query('SELECT supplier_name FROM suppliers WHERE supplier_id = ?', [supplierId]);
    counterparty = supRows.length ? supRows[0].supplier_name : null;
  }

  // ⑤ 库存（行锁）：不存在则建档，存在则累加
  //    注：inventory_id 是 INT 自增，不手填
  const [inventoryRows] = await conn.execute(
    'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
    [productId]
  );
  if (inventoryRows.length === 0) {
    await conn.execute(
      `INSERT INTO inventory (product_id, quantity, last_in_time, updated_at) 
       VALUES (?, ?, ?, ?)`,
      [productId, qty, now, now]
    );
  } else {
    await conn.execute(`UPDATE inventory SET quantity = ?, last_in_time = ?, updated_at = ? WHERE product_id = ?`, [
      Number(inventoryRows[0].quantity) + qty,
      now,
      now,
      productId
    ]);
  }

  // ⑥ 进货记录（含付款账户与实付金额快照）
  const purchaseId = generatePurchaseId();
  await conn.execute(
    `INSERT INTO purchase_records (
        purchase_id, product_id, quantity, unit_price, supplier_id, account_id, account_name,
        total_amount, paid_amount, payment_status, status, payment_date, remark, handler, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    [
      purchaseId,
      productId,
      qty,
      price,
      supplierId || null,
      account.account_id,
      account.account_name,
      totalAmount,
      totalAmount,
      now,
      remark || null,
      handler || null,
      now
    ]
  );

  // ⑦ 账户扣款
  await conn.execute('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
    balanceAfter,
    account.account_id
  ]);

  // ⑧ 资金流水（related_id = 入库单号，便于对账追溯）
  await conn.execute(
    `INSERT INTO finance_transactions
         (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
          related_module, related_id, tx_date, handler, counterparty, remark, created_at)
       VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
    [
      genTxId(),
      genTxNo(),
      account.account_id,
      account.account_name,
      '采购入库',
      totalAmount,
      balanceBefore,
      balanceAfter,
      TX_MODULE_PURCHASE,
      purchaseId,
      handler || null,
      counterparty,
      remark || `入库单 ${purchaseId} 采购付款`
    ]
  );

  return {
    purchaseId,
    accountId: account.account_id,
    accountName: account.account_name,
    paidAmount: totalAmount,
    balanceAfter
  };
}

/**
 * 出库核心事务（不动资金：出库是库存变动，付款/收款不在本域）
 *
 * @param {*} conn 已开启事务的连接
 * @param {{productId:string, quantity:number, outType?:number, remark?:string, handler?:string}} p
 * @returns {Promise<{recordId:string, stockAfter:number}>}
 */
async function applyStockOut(conn, { productId, quantity, outType = 1, remark, handler }) {
  if (!productId || !quantity) throw bizFail('商品ID和出库数量不能为空');
  const qty = Number(quantity);
  if (isNaN(qty) || qty <= 0) throw bizFail('出库数量必须为正数');
  // 同入库：INT 列不接受小数，且数据库**不会报错**——必须由业务层显式拒绝
  if (!Number.isInteger(qty)) throw bizFail('出库数量必须为整数（库存按件计）');
  const type = Number(outType) || 1;

  const now = new Date();

  // 检查库存记录是否存在并锁定
  const [inventoryRows] = await conn.execute(
    'SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE',
    [productId]
  );
  if (inventoryRows.length === 0) throw bizFail('该商品库存不存在', 404);

  // 检查库存是否充足（盘库减少 type=3 时允许负数）
  const currentQuantity = Number(inventoryRows[0].quantity) || 0;
  if (type !== 3 && currentQuantity < qty) {
    throw bizFail('库存不足，当前库存: ' + currentQuantity);
  }

  // 减少库存
  const newQuantity = currentQuantity - qty;
  await conn.execute(`UPDATE inventory SET quantity = ?, last_out_time = ?, updated_at = ? WHERE product_id = ?`, [
    newQuantity,
    now,
    now,
    productId
  ]);

  // 写出库台账（商品名称/编码快照，F4 修复：此前出库无任何台账记录）
  const [productRows] = await conn.execute('SELECT product_name, product_code FROM products WHERE product_id = ?', [
    productId
  ]);
  const recordId = generateStockOutId();
  await conn.execute(
    `INSERT INTO stock_out_records (
        record_id, product_id, product_name, product_code,
        quantity, out_type, stock_after, remark, handler, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recordId,
      productId,
      productRows[0] ? productRows[0].product_name : null,
      productRows[0] ? productRows[0].product_code : null,
      qty,
      type,
      newQuantity,
      remark || null,
      handler || null,
      now
    ]
  );

  return { recordId, stockAfter: newQuantity };
}

/**
 * 作废入库单核心事务（**撤销类**：必须回补余额 + 反向流水，见铁律 §8 第 4 条）
 *
 * ⚠️ 退回方向是**收入**（tx_type=1）：入库时是支出，作废是把钱拿回来。
 *    这里抄反会变成「作废一次再扣一笔」，而且「余额 = 期初 + 流水净额」仍成立 —— 账面无异常。
 *    冒烟对此有**绝对值**断言（作废后余额 = 入库前基线）。
 *
 * @param {*} conn 已开启事务的连接
 * @param {{purchaseId:string, reason?:string, handler?:string}} p
 * @returns {Promise<{purchaseId:string, refundAmount:number, balanceAfter:number|null}>}
 */
async function applyPurchaseVoid(conn, { purchaseId, reason, handler }) {
  if (!purchaseId) throw bizFail('入库单号不能为空');

  // 显式列名（不用星号通配）：表有 18 列而这里只读 7 列，按需取既省带宽，
  // 也避免将来加列（如大字段）时这条热路径被无谓拖慢。
  const [rows] = await conn.query(
    `SELECT purchase_id, product_id, quantity, paid_amount, status, account_id, account_name
       FROM purchase_records WHERE purchase_id = ? FOR UPDATE`,
    [purchaseId]
  );
  if (rows.length === 0) throw bizFail('入库单不存在');
  const pr = rows[0];
  if (Number(pr.status) === 2) throw bizFail('该入库单已作废，无法重复操作');

  const qty = Number(pr.quantity) || 0;
  const refundAmount = round2(pr.paid_amount || 0);

  // ① 回退库存（扣减入库数量）
  const [invRows] = await conn.query('SELECT inventory_id, quantity FROM inventory WHERE product_id = ? FOR UPDATE', [
    pr.product_id
  ]);
  if (invRows.length === 0) throw bizFail('库存记录不存在，无法作废');
  const stock = Number(invRows[0].quantity) || 0;
  if (stock < qty) {
    throw bizFail(`库存不足，无法回退：当前库存 ${stock}，需回退 ${qty}`);
  }
  await conn.execute('UPDATE inventory SET quantity = ?, updated_at = NOW() WHERE product_id = ?', [
    stock - qty,
    pr.product_id
  ]);

  // ② 账户原路退回
  let balanceAfter = null;
  if (pr.account_id) {
    const [accRows] = await conn.query(
      'SELECT account_id, account_name, current_balance FROM finance_accounts WHERE account_id = ? FOR UPDATE',
      [pr.account_id]
    );
    if (accRows.length === 0) throw bizFail('原付款账户不存在，无法原路退回');
    const acc = accRows[0];
    const balanceBefore = Number(acc.current_balance);
    balanceAfter = round2(balanceBefore + refundAmount);
    await conn.execute('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
      balanceAfter,
      acc.account_id
    ]);
    await conn.execute(
      `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
      [
        genTxId(),
        genTxNo(),
        acc.account_id,
        acc.account_name,
        '入库退回',
        refundAmount,
        balanceBefore,
        balanceAfter,
        TX_MODULE_PURCHASE_VOID,
        purchaseId,
        handler || null,
        pr.account_name || null,
        reason || `入库单 ${purchaseId} 作废退回`
      ]
    );
  }

  // ③ 标记作废
  await conn.execute(
    `UPDATE purchase_records SET status = 2, void_at = NOW(), void_by = ?, void_reason = ?, payment_status = 0
       WHERE purchase_id = ?`,
    [handler || null, reason || null, purchaseId]
  );

  return { purchaseId, refundAmount, balanceAfter };
}

// ── Web 入口（只做 HTTP 编排：开事务 → 调核心 → 组响应）────────────────────

// 入库操作
async function stockIn(req, res) {
  const connection = await pool.getConnection();
  try {
    // 字段名经 normalizeBody 中间件归一为驼峰
    await connection.beginTransaction();
    const r = await applyStockIn(connection, {
      productId: req.body.productId,
      quantity: req.body.quantity,
      unitPrice: req.body.unitPrice ?? 0,
      supplierId: req.body.supplierId,
      accountId: req.body.accountId,
      remark: req.body.remark,
      handler: (req.user && (req.user.username || req.user.id)) || null
    });
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
      [req.body.productId]
    );

    return success(res, { ...resultRows[0], ...r }, '入库成功');
  } catch (err) {
    // 回滚事务：入库、扣款、流水一并撤销
    await connection.rollback();
    if (err.business) {
      return error(res, err.message, err.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    }
    console.error('入库操作失败:', err);
    return error(res, '入库操作失败');
  } finally {
    // 释放连接
    connection.release();
  }
}

// 出库操作
async function stockOut(req, res) {
  const connection = await pool.getConnection();
  try {
    // 字段名经 normalizeBody 中间件归一为驼峰
    await connection.beginTransaction();
    await applyStockOut(connection, {
      productId: req.body.productId,
      quantity: req.body.quantity,
      outType: req.body.outType || req.body.type || 1,
      remark: req.body.remark,
      // ⚠️ 此处沿用既有取法（username || name）。stockIn 用的是 username || id ——
      //    历史上两处不一致，本次**刻意不改**：它影响的是入库/出库台账里 handler 的取值，
      //    改动会让同一批历史数据出现新旧两种写法，属于独立议题。
      handler: (req.user && (req.user.username || req.user.name)) || null
    });
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
      [req.body.productId]
    );

    return success(res, resultRows[0], '出库成功');
  } catch (err) {
    // 回滚事务
    await connection.rollback();
    if (err.business) {
      return error(res, err.message, err.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    }
    console.error('出库操作失败:', err);
    return error(res, '出库操作失败');
  } finally {
    // 释放连接
    connection.release();
  }
}

// 作废入库单：回退库存 + 账户原路退回 + 反向流水（全部同一事务）
async function voidPurchaseRecord(req, res) {
  const connection = await pool.getConnection();
  try {
    const purchase_id = req.params.purchaseId || req.body.purchaseId;
    await connection.beginTransaction();
    const r = await applyPurchaseVoid(connection, {
      purchaseId: purchase_id,
      reason: req.body.reason || req.body.voidReason,
      handler: (req.user && (req.user.username || req.user.id)) || null
    });
    await connection.commit();

    return success(res, r, '入库单已作废，款项原路退回');
  } catch (err) {
    await connection.rollback();
    if (err.business) {
      return error(res, err.message, err.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    }
    console.error('作废入库单失败:', err);
    return error(res, '作废入库单失败');
  } finally {
    connection.release();
  }
}

// 入库记录列表（筛选：商品/供应商/账户/状态/日期范围，分页）
async function getPurchaseRecords(req, res) {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const { page: p, size, offset } = parsePage({ page, pageSize });

    const { clause: where, params } = buildPurchaseListWhere(req.query);

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
      list: rows.map(r => ({
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
      page: p,
      pageSize: size
    });
  } catch (err) {
    console.error('获取入库记录失败:', err);
    return error(res, '获取入库记录失败');
  }
}

// 出库台账列表（分页 + 筛选：关键词/商品/类型/日期区间）
async function getStockOutRecords(req, res) {
  try {
    const { page, size: pageSize, offset } = parsePage(req.query, { maxSize: 100 });

    const { clause: whereSql, params } = buildStockOutListWhere(req.query);

    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM stock_out_records r ${whereSql}`, params);
    const total = countRows[0].total;

    const [rows] = await pool.execute(
      `SELECT r.record_id, r.product_id, r.product_name, r.product_code,
              r.quantity, r.out_type, r.stock_after, r.remark, r.handler, r.created_at
       FROM stock_out_records r ${whereSql}
       ORDER BY r.created_at DESC, r.record_id DESC
       LIMIT ${parseInt(offset, 10)}, ${parseInt(pageSize, 10)}`,
      params
    );

    return pagination(
      res,
      rows.map(r => ({
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
      })),
      total,
      page,
      pageSize
    );
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
  getStockOutRecords,
  // ── 供小程序管理端（Phase 8b 第 8 域）复用，避免两处各写一份 ──────────────
  //    ① 核心事务体：资金纪律的唯一实现（改这里，两端同时生效）
  //    ② 筛选构造 + 格式化 + 排序白名单：保证两端的列表口径完全一致
  formatInventory,
  buildInventoryListWhere,
  buildPurchaseListWhere,
  buildStockOutListWhere,
  INVENTORY_SORT_FIELDS,
  applyStockIn,
  applyStockOut,
  applyPurchaseVoid
};

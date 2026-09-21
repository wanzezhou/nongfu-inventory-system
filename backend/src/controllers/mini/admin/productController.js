// 小程序管理端 · 商品域（文档 §5.3「商品」/ §43 Phase 8b）
// ===========================================================================
// 定式见 `_shared.js` 与本仓库其它 admin 控制器（读挂 requireMiniAdmin、写加 requireMiniActive、
// 写接口带幂等键、资金动作调既有原语、事务内落审计、列表筛选复用既有构造）。
//
// 本域**没有资金动作**（商品档案不引起余额变动），所以「调账务原语」这条不适用；
// 但它有一个同等重要的隐性契约：
//
//   ⚠️ **「业务员可售」是业务员端能否下单的总闸门**（§8.5）。
//      §8.5 的判定是**两个条件同时成立**：`salesman_mini_enabled = 1` **且**
//      `salesman_min_price` 已配置。少了任何一个，业务员都下不了单。
//
//      也就是说，若管理员只开了开关却没填最低价，界面会显示「已开启」，
//      而业务员端实际上依然买不了 —— **一个静默失效的开关**，这正是本仓库最忌讳的
//      那类缺陷（看起来生效、实际没有）。故本实现在**配置时**就拒绝这种组合，
//      而不是等到下单时才发现（详见 validateSalesmanConfig）。
//
//   ⚠️ 另有一处只在手机上才会遇到的坑：**Web 端的 create/updateProduct 根本不处理
//      这两列**（它们是迁移新增的，Web 表单没接）。所以本域是它们**唯一的写入路径**，
//      同时也是**唯一能让业务员端真正可用的入口** —— 在此之前只能手工改库。
//
// 图片：本域只做「上传 + 存相对路径」，静态服务复用 Web 端的 `/product_images`
//      （商品照片属公开资产，见 app.js 的挂载注释）。库里**只存相对路径**，域名由各端自己拼。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { AUDIT_ACTION, IDEM_SCOPE } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const productController = require('../../productController');
const { hashRequest } = require('../../../utils/requestHash');
const { generateId } = require('../../../utils/idGen');
const { parseMiniPage, requireIdemKey } = require('./_shared');

// 复用 Web 端的列表筛选构造（单一来源）；商品 ID 复用同一个生成器 ——
// 小程序与 Web **共用 products 表**，两套编号实现会主键碰撞（与订单号同源问题）。
const { buildProductListWhere } = productController;
const generateProductId = () => generateId('P');

/**
 * 商品列的完整清单。
 * ⚠️ 刻意**不写 `SELECT *`**（红线 R3，且 Web 端那份是存量、本文件是新增行，新增行必须干净）。
 *    另一个理由是硬的：`SELECT *` 会把 21 列里将来新增的敏感列（如成本）无差别带出去，
 *    而本接口只应返回下面 shapeProduct 显式映射过的字段。
 */
const PRODUCT_COLUMNS = `product_id, product_code, product_name, specification, unit, category,
         purchase_price, wholesale_price, retail_price, machine_price,
         total_delivery_fee, distribution_delivery_fee,
         worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee,
         image_url, status, salesman_mini_enabled, salesman_min_price,
         created_at, updated_at`;

/** 商品行 → 小程序视图对象（字段名与业务员端 catalogController 保持一致，同一个商品两页不该有两种字段名） */
function shapeProduct(row) {
  const enabled = Number(row.salesman_mini_enabled) ? 1 : 0;
  const minPrice =
    row.salesman_min_price === null || row.salesman_min_price === undefined ? null : Number(row.salesman_min_price);
  return {
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    specification: row.specification,
    unit: row.unit,
    category: row.category,
    purchasePrice: Number(row.purchase_price) || 0,
    wholesalePrice: Number(row.wholesale_price) || 0,
    retailPrice: Number(row.retail_price) || 0,
    machinePrice: Number(row.machine_price) || 0,
    totalDeliveryFee: Number(row.total_delivery_fee) || 0,
    distributionDeliveryFee: Number(row.distribution_delivery_fee) || 0,
    workerRetailDeliveryFee: Number(row.worker_retail_delivery_fee) || 0,
    workerWholesaleDeliveryFee: Number(row.worker_wholesale_delivery_fee) || 0,
    workerMachineDeliveryFee: Number(row.worker_machine_delivery_fee) || 0,
    imageUrl: row.image_url || null,
    status: Number(row.status),
    salesmanMiniEnabled: enabled,
    salesmanMinPrice: minPrice,
    // 只读派生字段：业务员端**实际**能不能买。列表直接显示它，避免管理员自己推两个条件的与。
    salesmanReady: enabled === 1 && minPrice !== null
  };
}

/** 数字字段解析：空串/null/undefined → null（表示「未填写」），非法值 → NaN 交调用方判断 */
function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? NaN : n;
}

/**
 * 「业务员可售」配置的校验（本域的核心业务规则）
 *
 * 为什么必须硬校验（而不是留给 §8.5 在下单时判定）：
 *   ① **静默失效**：开启但没配最低价 → 界面显示"已开启"、业务员端买不了。管理员只能靠
 *      「业务员说买不了」这种下游反馈才发现，排查成本全落在别人身上。
 *   ② **最低价 > 零售价是个自相矛盾的配置**：业务员不手填时成交价回退到零售价（§8.4 取值逻辑），
 *      此时零售价本身就低于最低价 → 无论怎么下单都会被拒。也就是说这个组合下
 *      商品**永远卖不出去**，但界面看起来完全正常。
 *
 * @param {{enabled:number, minPrice:number|null, retailPrice:number|null}} cfg 合并后的最终值
 * @returns {string|null} 用户可读的错误文案；null 表示通过
 */
function validateSalesmanConfig({ enabled, minPrice, retailPrice }) {
  if (!enabled) return null; // 未开启 → 最低价无意义，不校验（允许留着旧值）
  if (minPrice === null) {
    return '开启「业务员小程序可售」时必须同时设置最低成交价（否则业务员端仍无法下单）';
  }
  if (isNaN(minPrice) || minPrice <= 0) {
    return '最低成交价必须为大于 0 的数字';
  }
  if (retailPrice !== null && !isNaN(retailPrice) && minPrice > retailPrice) {
    return `最低成交价（${minPrice}）不能高于参考零售价（${retailPrice}）—— 否则业务员按零售价下单也会被拒，商品永远卖不出去`;
  }
  return null;
}

/** 商品基础字段校验（与 Web 端同口径：编码与名称必填） */
function validateBase(body) {
  const { productCode, productName } = body;
  if (!productCode || !String(productCode).trim()) return '商品编码不能为空';
  if (!productName || !String(productName).trim()) return '商品名称不能为空';
  return null;
}

/** 非负金额字段（价格/配送费一律 ≥ 0；空值按 0 处理，与 Web 端 `|| 0` 一致） */
const MONEY_FIELDS = [
  ['purchasePrice', '进货价'],
  ['wholesalePrice', '批发价'],
  ['retailPrice', '参考零售价'],
  ['machinePrice', '零售机供货价'],
  ['totalDeliveryFee', '总包配送费'],
  ['distributionDeliveryFee', '分销配送费'],
  ['workerRetailDeliveryFee', '工人零售配送费'],
  ['workerWholesaleDeliveryFee', '工人水站配送费'],
  ['workerMachineDeliveryFee', '工人零售机配送费']
];

function validateMoney(body) {
  for (const [key, label] of MONEY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const v = num(body[key]);
    if (v !== null && (isNaN(v) || v < 0)) return `${label}必须为不小于 0 的数字`;
  }
  return null;
}

// ── GET /mini/admin/products —— 商品列表 ────────────────────────────────────
async function listProducts(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const { clause, params } = buildProductListWhere(req.query);

    const [rows] = await pool.execute(
      // hazard-allow: PRODUCT_COLUMNS 是模块内硬编码的字段名清单（不来自任何入参），非拼接式 SQL
      `SELECT ${PRODUCT_COLUMNS} FROM products ${clause}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM products ${clause}`, params);

    return success(res, {
      list: rows.map(shapeProduct),
      total: Number(cnt[0].n) || 0,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 商品列表查询失败:', e);
    return error(res, '商品列表查询失败');
  }
}

// ── GET /mini/admin/products/options —— 表单选项（类别）──────────────────────
// ⚠️ 必须注册在 `/products/:id` 之类的动态段**之前**（仓库陷阱：通配会吞掉具体路径）
async function getFormOptions(req, res) {
  try {
    // ⚠️ 刻意复用 Web 端 `getCategoryList` 的同一段语义（DISTINCT + 去空 + 排序），
    //    但**调用它的原始 SQL**不现实（那是个 res 出口函数），故这里用同一段取数——
    //    若将来类别规则变化（如独立类目表），两处必须一起改：这是已知的重复点。
    const [rows] = await pool.execute(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category`
    );
    return success(res, { categories: rows.map(r => r.category) });
  } catch (e) {
    console.error('[mini/admin] 商品类别查询失败:', e);
    return error(res, '商品类别查询失败');
  }
}

// ── GET /mini/admin/products/:id —— 商品详情（编辑页回填）────────────────────
// ⚠️ 必须注册在 `/products/options`、`/products/upload-image` **之后**（静态段前置）
async function getProductById(req, res) {
  try {
    // hazard-allow: 同上 —— PRODUCT_COLUMNS 为模块内硬编码清单，非拼接式 SQL
    const [rows] = await pool.execute(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE product_id = ?`, [req.params.id]);
    if (!rows.length) return error(res, '商品不存在', 404);
    return success(res, shapeProduct(rows[0]));
  } catch (e) {
    console.error('[mini/admin] 商品详情查询失败:', e);
    return error(res, '商品详情查询失败');
  }
}

/** 组装 INSERT/UPDATE 的公共字段值（顺序与 COLUMN_LIST 对应） */
const WRITABLE = [
  ['product_code', 'productCode', 'str'],
  ['product_name', 'productName', 'str'],
  ['specification', 'specification', 'nullableStr'],
  ['unit', 'unit', 'nullableStr'],
  ['purchase_price', 'purchasePrice', 'money'],
  ['wholesale_price', 'wholesalePrice', 'money'],
  ['retail_price', 'retailPrice', 'money'],
  ['machine_price', 'machinePrice', 'money'],
  ['total_delivery_fee', 'totalDeliveryFee', 'money'],
  ['distribution_delivery_fee', 'distributionDeliveryFee', 'money'],
  ['worker_retail_delivery_fee', 'workerRetailDeliveryFee', 'money'],
  ['worker_wholesale_delivery_fee', 'workerWholesaleDeliveryFee', 'money'],
  ['worker_machine_delivery_fee', 'workerMachineDeliveryFee', 'money'],
  ['category', 'category', 'nullableStr'],
  ['image_url', 'imageUrl', 'nullableStr'],
  ['status', 'status', 'int'],
  ['salesman_mini_enabled', 'salesmanMiniEnabled', 'int'],
  ['salesman_min_price', 'salesmanMinPrice', 'moneyNullable']
];

function convert(kind, raw) {
  switch (kind) {
    case 'str':
      return String(raw).trim();
    case 'nullableStr':
      return raw === undefined || raw === null || raw === '' ? null : String(raw).trim();
    case 'money': {
      const v = num(raw);
      return v === null || isNaN(v) ? 0 : v;
    }
    case 'moneyNullable': {
      const v = num(raw);
      return v === null || isNaN(v) ? null : v;
    }
    case 'int': {
      const v = num(raw);
      return v === null || isNaN(v) ? 0 : Number(v);
    }
    default:
      return raw;
  }
}

// ── POST /mini/admin/products —— 新增（幂等 + 审计）──────────────────────────
async function createProduct(req, res) {
  const body = req.body || {};
  const baseErr = validateBase(body);
  if (baseErr) return error(res, baseErr, 400);
  const moneyErr = validateMoney(body);
  if (moneyErr) return error(res, moneyErr, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  // 业务员可售配置（新建时默认关闭；开启则必须给最低价）
  const enabled = Number(body.salesmanMiniEnabled) === 1 ? 1 : 0;
  const minPrice = convert('moneyNullable', body.salesmanMinPrice);
  const retailPrice = convert('money', body.retailPrice);
  const cfgErr = validateSalesmanConfig({ enabled, minPrice, retailPrice });
  if (cfgErr) return error(res, cfgErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.CREATE_PRODUCT;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ code: body.productCode, name: body.productName, enabled, minPrice }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { productId: claim.resultRef, replayed: true }, '该商品已创建（重复请求已合并）');
    }

    // ⚠️ 编码唯一性：DB 有 uk_product_code，重复会抛 ER_DUP_ENTRY。
    //    这里先查一次是为了给出**用户能看懂**的文案；但仍要 catch 唯一键冲突，
    //    因为「查完到插入之间」存在竞态（两个人同时建同一个编码）。
    const [dup] = await conn.query('SELECT product_id FROM products WHERE product_code = ?', [
      String(body.productCode).trim()
    ]);
    if (dup.length) {
      await conn.rollback();
      return error(res, `商品编码「${String(body.productCode).trim()}」已存在`, 400);
    }

    const productId = generateProductId();

    const cols = [];
    const vals = [];
    for (const [col, key, kind] of WRITABLE) {
      // 未传的字段用默认值（与 Web 端 createProduct 的 `|| 0` / null 语义一致）
      cols.push(col);
      vals.push(convert(kind, body[key]));
    }
    // status 默认 1（启用）；显式传 0 也尊重
    const idxStatus = cols.indexOf('status');
    if (!Object.prototype.hasOwnProperty.call(body, 'status')) vals[idxStatus] = 1;

    await conn.query(
      `INSERT INTO products (product_id, ${cols.join(', ')}, created_at, updated_at)
       VALUES (?, ${cols.map(() => '?').join(', ')}, NOW(), NOW())`,
      [productId, ...vals]
    );

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: productId });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CREATE_PRODUCT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'PRODUCT',
      targetId: productId,
      detail: {
        productCode: String(body.productCode).trim(),
        productName: String(body.productName).trim(),
        retailPrice,
        salesmanMiniEnabled: enabled,
        salesmanMinPrice: minPrice
      }
    });

    await conn.commit();
    return success(res, { productId }, '商品创建成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 新增商品失败:', e);
    // 唯一键竞态：给出与前置检查同一条文案（而不是 500）
    if (e && e.code === 'ER_DUP_ENTRY') {
      return error(res, `商品编码「${String(body.productCode || '').trim()}」已存在`, 400);
    }
    return error(res, '创建商品失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/products/:id —— 编辑（幂等 + 审计）───────────────────────
// ⚠️ 语义：**部分更新** —— 只有请求体里出现的字段会被写。这是刻意的：
//    小程序端不提供图片上传入口的场景下（或将来只改价格时），不传 imageUrl 就不会把图清掉。
async function updateProduct(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const moneyErr = validateMoney(body);
  if (moneyErr) return error(res, moneyErr, 400);
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);
  // 名称/编码若提交了就不能是空串（不提交则保持原值）
  if (Object.prototype.hasOwnProperty.call(body, 'productCode') && !String(body.productCode || '').trim()) {
    return error(res, '商品编码不能为空', 400);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'productName') && !String(body.productName || '').trim()) {
    return error(res, '商品名称不能为空', 400);
  }

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 只取「合并校验」真正需要的列：不必拉全字段（顺带避开一处动态列名告警）
    // ⚠️ 列名务必逐字核对：是 `salesman_min_price`（不带 mini），与 `salesman_mini_enabled`
    //    的构词并不一致 —— 照 enabled 那列的拼法类推会写出不存在的列，直接 500。
    const [existRows] = await conn.query(
      `SELECT product_id, retail_price, salesman_mini_enabled, salesman_min_price
         FROM products WHERE product_id = ? FOR UPDATE`,
      [id]
    );
    if (!existRows.length) {
      await conn.rollback();
      return error(res, '商品不存在', 404);
    }
    const cur = existRows[0];

    // ⚠️ 校验必须建立在**合并后**的最终值上：只改名称时也得按现有的销售配置校验一次，
    //    否则「先建了非法组合、之后每次只改名字」就能一直带着非法值活下去。
    const nextEnabled = Object.prototype.hasOwnProperty.call(body, 'salesmanMiniEnabled')
      ? Number(body.salesmanMiniEnabled) === 1
        ? 1
        : 0
      : Number(cur.salesman_mini_enabled)
        ? 1
        : 0;
    const nextMin = Object.prototype.hasOwnProperty.call(body, 'salesmanMinPrice')
      ? convert('moneyNullable', body.salesmanMinPrice)
      : cur.salesman_min_price === null || cur.salesman_min_price === undefined
        ? null
        : Number(cur.salesman_min_price);
    const nextRetail = Object.prototype.hasOwnProperty.call(body, 'retailPrice')
      ? convert('money', body.retailPrice)
      : Number(cur.retail_price) || 0;
    const cfgErr = validateSalesmanConfig({ enabled: nextEnabled, minPrice: nextMin, retailPrice: nextRetail });
    if (cfgErr) {
      await conn.rollback();
      return error(res, cfgErr, 400);
    }

    const scope = IDEM_SCOPE.UPDATE_PRODUCT;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ id, name: body.productName, retail: nextRetail, enabled: nextEnabled, min: nextMin }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { productId: claim.resultRef, replayed: true }, '该修改已生效（重复请求已合并）');
    }

    // 编码改成别人已用的 → 提前给出可读文案（同样要 catch 竞态）
    if (Object.prototype.hasOwnProperty.call(body, 'productCode')) {
      const code = String(body.productCode).trim();
      const [dup] = await conn.query('SELECT product_id FROM products WHERE product_code = ? AND product_id <> ?', [
        code,
        id
      ]);
      if (dup.length) {
        await conn.rollback();
        return error(res, `商品编码「${code}」已被其它商品使用`, 400);
      }
    }

    const sets = [];
    const vals = [];
    for (const [col, key, kind] of WRITABLE) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      sets.push(`${col} = ?`);
      vals.push(convert(kind, body[key]));
    }
    if (!sets.length) {
      await conn.rollback();
      return error(res, '没有需要更新的字段', 400);
    }
    await conn.query(`UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE product_id = ?`, [...vals, id]);

    // 最低价是否真的变了（含"从无到有"与"从有到无"两种情况）
    const prevMin =
      cur.salesman_min_price === null || cur.salesman_min_price === undefined ? null : Number(cur.salesman_min_price);
    const minChanged = prevMin !== nextMin;

    await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_PRODUCT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'PRODUCT',
      targetId: id,
      detail: { changed: sets.length, salesmanMiniEnabled: nextEnabled, salesmanMinPrice: nextMin }
    });
    // ⚠️ 最低价变化**额外**记一条（常量第一期已定义，此前无人使用）：
    //    它是价格体系的关键变更，混在「改了 3 个字段」里会让事后追查变难。
    if (minChanged) {
      await walletService.writeAuditLog(conn, {
        action: AUDIT_ACTION.SET_PRODUCT_MIN_PRICE,
        actorType: 'MINI',
        actorId: operator,
        targetType: 'PRODUCT',
        targetId: id,
        detail: { before: prevMin, after: nextMin }
      });
    }

    await conn.commit();
    return success(res, { productId: id }, '修改成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 修改商品失败:', e);
    if (e && e.code === 'ER_DUP_ENTRY') {
      return error(res, '商品编码已被其它商品使用', 400);
    }
    return error(res, '修改商品失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/products/:id —— 停用（软删除 + 幂等 + 审计）───────────
// ⚠️ 商品**没有物理删除**：`order_items` / `inventory` / `machine_sales` 都引用 product_id，
//    真删会让历史订单查不到商品。Web 端 deleteProduct 也是软删除（status = 0），本域沿用。
async function disableProduct(req, res) {
  const { id } = req.params;
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.DISABLE_PRODUCT;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(clientRequestId),
      requestHash: hashRequest({ id }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { productId: claim.resultRef, replayed: true }, '该商品已停用（重复请求已合并）');
    }

    const [exist] = await conn.query('SELECT product_id, product_name, status FROM products WHERE product_id = ?', [
      id
    ]);
    if (!exist.length) {
      await conn.rollback();
      return error(res, '商品不存在', 404);
    }

    await conn.query('UPDATE products SET status = 0, updated_at = NOW() WHERE product_id = ?', [id]);

    await walletService.completeIdempotency(conn, { scope, key: String(clientRequestId), resultRef: id });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.DISABLE_PRODUCT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'PRODUCT',
      targetId: id,
      detail: { productName: exist[0].product_name, statusBefore: Number(exist[0].status) }
    });

    await conn.commit();
    return success(res, { productId: id }, '商品已停用');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    console.error('[mini/admin] 停用商品失败:', e);
    return error(res, '停用商品失败');
  } finally {
    conn.release();
  }
}

module.exports = { listProducts, getFormOptions, getProductById, createProduct, updateProduct, disableProduct };

// 小程序管理端 · 库存域（文档 §5.3「库存」/ §43 Phase 8b 第 8 域）
// ===========================================================================
// 本域与前面几个域**性质不同**，先说清楚：
//
//   ① 前 7 个域里，账务原语（`applyExpenseLedger` / `applyIncomeLedger`）是现成可调的；
//      库存域的入库/出库/作废**原本全部内联在 `inventoryController` 的 HTTP 处理器里**，
//      没有可复用的中间层。所以本轮先把它们抽成
//      `applyStockIn` / `applyStockOut` / `applyPurchaseVoid` 并导出（见该文件头部注释）。
//      → 本文件**一行库存或余额都不自己算**，全部调这三个函数。
//        Web 端 `POST /api/inventory/in` 现在也走同一段代码，两端不可能分叉。
//
//   ② 库存**没有「编辑」语义**。入库单记错了要**作废重开**，不允许直接改历史入库单：
//      入库单连着资金流水（扣款/退回），改数量会让流水与单据对不上，账实关系失去可追溯性。
//      所以本域只有 3 个写接口：入库 / 出库 / 作废。
//
//   ③ 资金纪律由核心事务体保证，但**事务边界在本文件**：占幂等键 → 核心动作 → 审计，
//      三者必须同事务（与前面各域一致）。核心事务体刻意不 begin/commit，就是为了这个。
//
// 8 个接口：
//   读：库存列表 / 表单选项 / 单品库存 / 进货记录 / 出库台账
//   写：入库 / 出库 / 作废入库单
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { AUDIT_ACTION, IDEM_SCOPE } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const inventoryController = require('../../inventoryController');
const { hashRequest } = require('../../../utils/requestHash');
const { parseMiniPage, listActiveAccounts, requireIdemKey, respondBusinessError } = require('./_shared');

// 复用 Web 端的核心事务体与列表口径（单一来源）
const {
  formatInventory,
  buildInventoryListWhere,
  buildPurchaseListWhere,
  buildStockOutListWhere,
  INVENTORY_SORT_FIELDS,
  applyStockIn,
  applyStockOut,
  applyPurchaseVoid
} = inventoryController;

/** 出库类型（取值以 `stock_out_records.out_type` 的**列注释**为准：1-销售出库 2-调拨出库 3-其他）
 *  ⚠️ 不要照抄前端某个对话框里的文案（历史上写过「盘库」），列注释才是权威。 */
const OUT_TYPES = [
  { value: 1, label: '销售出库' },
  { value: 2, label: '调拨出库' },
  { value: 3, label: '其他' }
];

/** 商品下拉上限（与 `getInventoryOptions` 同因：超上限要**报错**而不是静默截断） */
const PRODUCT_OPTIONS_MAX = Number(process.env.OPTIONS_MAX_ROWS || 5000);

/** baseUrl（图片相对路径 → 绝对地址；小程序侧 `fmt.imageUrl` 对绝对地址原样透传） */
function baseUrlOf(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ── GET /mini/admin/inventory —— 库存列表（含库存价值合计）───────────────────
async function listInventory(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const { clause: where, params } = buildInventoryListWhere(req.query);

    const sortBy = INVENTORY_SORT_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : 'quantity';
    const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [rows] = await pool.execute(
      `SELECT i.inventory_id, p.product_id, i.quantity, i.last_in_time, i.last_out_time, i.updated_at,
              p.product_code, p.product_name, p.specification, p.unit, p.category,
              p.image_url, p.purchase_price
         FROM products p
         LEFT JOIN inventory i ON p.product_id = i.product_id
         ${where}
        ORDER BY i.${sortBy} ${sortOrder}
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const [cnt] = await pool.execute(
      `SELECT COUNT(*) AS n FROM products p LEFT JOIN inventory i ON p.product_id = i.product_id ${where}`,
      params
    );
    // 库存价值合计：Σ max(库存,0) × 进货价 —— 与 Web「库存总金额」口径一致（负库存不计负值）
    const [sumRow] = await pool.execute(
      `SELECT COALESCE(SUM(p.purchase_price * GREATEST(i.quantity, 0)), 0) AS total_value
         FROM products p
         LEFT JOIN inventory i ON p.product_id = i.product_id
         ${where}`,
      params
    );

    const baseUrl = baseUrlOf(req);
    return success(res, {
      list: rows.map(r => formatInventory(r, baseUrl)),
      total: Number(cnt[0].n) || 0,
      totalValue: Math.round(Number(sumRow[0].total_value) * 100) / 100,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 库存列表查询失败:', e);
    return error(res, '库存列表查询失败');
  }
}

// ── GET /mini/admin/inventory/options —— 表单选项 ────────────────────────────
// ⚠️ 必须注册在 `/inventory/:productId` **之前**（静态段前置，仓库老陷阱）
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    // 商品下拉：全量返回（分页拉下拉会静默缺项，见 getInventoryOptions 的注释）
    const [cntRows] = await conn.query('SELECT COUNT(*) AS n FROM products WHERE status = 1');
    const total = Number(cntRows[0].n) || 0;
    if (total > PRODUCT_OPTIONS_MAX) {
      return error(res, `商品 ${total} 条超过下拉上限 ${PRODUCT_OPTIONS_MAX}，请改用关键字搜索`, 400);
    }

    const [products] = await conn.query(
      `SELECT p.product_id, p.product_name, p.product_code, p.unit, p.purchase_price,
              COALESCE(i.quantity, 0) AS quantity
         FROM products p
         LEFT JOIN inventory i ON p.product_id = i.product_id
        WHERE p.status = 1
        ORDER BY p.product_name ASC`
    );
    const [suppliers] = await conn.query(
      'SELECT supplier_id, supplier_name FROM suppliers WHERE status = 1 ORDER BY supplier_name'
    );
    const accounts = await listActiveAccounts(conn);

    return success(res, {
      products: products.map(p => ({
        productId: p.product_id,
        productName: p.product_name,
        productCode: p.product_code,
        unit: p.unit || '',
        purchasePrice: Number(p.purchase_price) || 0,
        stock: Number(p.quantity) || 0
      })),
      suppliers: suppliers.map(s => ({
        supplierId: s.supplier_id,
        supplierName: s.supplier_name
      })),
      accounts,
      outTypes: OUT_TYPES
    });
  } catch (e) {
    console.error('[mini/admin] 库存表单选项查询失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/inventory/:productId —— 单品库存详情 ─────────────────────
// ⚠️ 必须注册在 `/inventory/options` **之后**
async function getProductStock(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT i.inventory_id, i.product_id, i.quantity, i.last_in_time, i.last_out_time, i.updated_at,
              p.product_code, p.product_name, p.specification, p.unit, p.category,
              p.image_url, p.purchase_price, p.wholesale_price, p.retail_price
         FROM inventory i
         LEFT JOIN products p ON i.product_id = p.product_id
        WHERE i.product_id = ?`,
      [req.params.productId]
    );
    if (!rows.length) return error(res, '该商品库存不存在', 404);
    return success(res, formatInventory(rows[0], baseUrlOf(req)));
  } catch (e) {
    console.error('[mini/admin] 库存详情查询失败:', e);
    return error(res, '库存详情查询失败');
  }
}

// ── GET /mini/admin/purchases —— 进货（入库）记录 ────────────────────────────
async function listPurchases(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const { clause: where, params } = buildPurchaseListWhere(req.query);

    const [rows] = await pool.query(
      `SELECT pr.*, p.product_name, p.product_code, s.supplier_name
         FROM purchase_records pr
         LEFT JOIN products p ON pr.product_id = p.product_id
         LEFT JOIN suppliers s ON pr.supplier_id = s.supplier_id
         ${where}
        ORDER BY pr.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
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
        supplierName: r.supplier_name || '',
        accountName: r.account_name || '',
        quantity: Number(r.quantity) || 0,
        unitPrice: Number(r.unit_price) || 0,
        totalAmount: Number(r.total_amount) || 0,
        // ⚠️ status: 1=有效 2=已作废；不要用「有 void_at 就是作废」来推断（历史数据可能只有其一）
        status: Number(r.status) || 1,
        voidReason: r.void_reason || '',
        remark: r.remark || '',
        createdAt: r.created_at
      })),
      total: Number(cnt[0].n) || 0,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 进货记录查询失败:', e);
    return error(res, '进货记录查询失败');
  }
}

// ── GET /mini/admin/stock-out-records —— 出库台账 ────────────────────────────
async function listStockOutRecords(req, res) {
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const { clause: where, params } = buildStockOutListWhere(req.query);

    const [rows] = await pool.execute(
      `SELECT r.record_id, r.product_id, r.product_name, r.product_code,
              r.quantity, r.out_type, r.stock_after, r.remark, r.handler, r.created_at
         FROM stock_out_records r ${where}
        ORDER BY r.created_at DESC, r.record_id DESC
        LIMIT ${offset}, ${pageSize}`,
      params
    );
    const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM stock_out_records r ${where}`, params);

    const label = v => (OUT_TYPES.find(t => t.value === Number(v)) || {}).label || '未知';
    return success(res, {
      list: rows.map(r => ({
        recordId: r.record_id,
        productId: r.product_id,
        productName: r.product_name || '',
        productCode: r.product_code || '',
        quantity: Number(r.quantity) || 0,
        outType: Number(r.out_type) || 1,
        outTypeLabel: label(r.out_type),
        stockAfter: Number(r.stock_after) || 0,
        remark: r.remark || '',
        handler: r.handler || '',
        createdAt: r.created_at
      })),
      total: Number(cnt[0].n) || 0,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 出库台账查询失败:', e);
    return error(res, '出库台账查询失败');
  }
}

// ── POST /mini/admin/inventory/in —— 入库（幂等 + 审计）──────────────────────
async function stockIn(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { productId, quantity, unitPrice, supplierId, accountId, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.STOCK_IN;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({
        productId,
        quantity,
        unitPrice: unitPrice ?? 0,
        supplierId: supplierId || null,
        accountId: accountId || null
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { purchaseId: claim.resultRef, replayed: true }, '该入库单已创建（重复请求已合并）');
    }

    // 核心事务体：库存 + 进货记录 + 账户扣款 + 资金流水（同事务）
    const r = await applyStockIn(conn, {
      productId,
      quantity,
      unitPrice: unitPrice ?? 0,
      supplierId,
      accountId,
      remark,
      handler: operator
    });

    await walletService.completeIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      resultRef: r.purchaseId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.STOCK_IN,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'PURCHASE_RECORD',
      targetId: r.purchaseId,
      detail: {
        productId,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice) || 0,
        paidAmount: r.paidAmount,
        supplierId: supplierId || null,
        accountId: r.accountId,
        balanceAfter: r.balanceAfter,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(
      res,
      {
        purchaseId: r.purchaseId,
        paidAmount: r.paidAmount,
        accountName: r.accountName,
        balanceAfter: r.balanceAfter
      },
      '入库成功'
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    return respondBusinessError(res, e, '入库失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/inventory/out —— 出库（幂等 + 审计）─────────────────────
async function stockOut(req, res) {
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const { productId, quantity, outType, remark } = body;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.STOCK_OUT;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      requestHash: hashRequest({ productId, quantity, outType: outType || 1 }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { recordId: claim.resultRef, replayed: true }, '该出库单已创建（重复请求已合并）');
    }

    // 核心事务体：减库存 + 写出库台账（不动资金）
    const r = await applyStockOut(conn, {
      productId,
      quantity,
      outType: outType || 1,
      remark,
      handler: operator
    });

    await walletService.completeIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      resultRef: r.recordId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.STOCK_OUT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'STOCK_OUT_RECORD',
      targetId: r.recordId,
      detail: {
        productId,
        quantity: Number(quantity),
        outType: Number(outType) || 1,
        stockAfter: r.stockAfter,
        remark: remark || null
      }
    });

    await conn.commit();
    return success(res, { recordId: r.recordId, stockAfter: r.stockAfter }, '出库成功');
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    return respondBusinessError(res, e, '出库失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/purchases/:purchaseId/void —— 作废入库单（幂等 + 审计）──
// ⚠️ 撤销类：回退库存 + **原路退回款项**（收入方向）+ 反向流水 + 标记作废，同事务。
async function voidPurchase(req, res) {
  const { purchaseId } = req.params;
  const body = req.body || {};
  const idemErr = requireIdemKey(body.clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const reason = body.reason || body.voidReason;
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const scope = IDEM_SCOPE.VOID_PURCHASE;
    const claim = await walletService.claimIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      // ⚠️ 指纹必须含单号：同一把幂等键用在**不同入库单**上属于客户端错误，不能当重放合并
      requestHash: hashRequest({ purchaseId, reason: reason || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { purchaseId, replayed: true }, '该入库单已作废（重复请求已合并）');
    }

    const r = await applyPurchaseVoid(conn, { purchaseId, reason, handler: operator });

    await walletService.completeIdempotency(conn, {
      scope,
      key: String(body.clientRequestId),
      resultRef: purchaseId
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.VOID_PURCHASE,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'PURCHASE_RECORD',
      targetId: purchaseId,
      detail: {
        refundAmount: r.refundAmount,
        balanceAfter: r.balanceAfter,
        reason: reason || null
      }
    });

    await conn.commit();
    return success(
      res,
      { purchaseId, refundAmount: r.refundAmount, balanceAfter: r.balanceAfter },
      '入库单已作废，款项原路退回'
    );
  } catch (e) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('[mini/admin] 回滚失败:', rollbackErr);
    }
    return respondBusinessError(res, e, '作废入库单失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  listInventory,
  getFormOptions,
  getProductStock,
  listPurchases,
  listStockOutRecords,
  stockIn,
  stockOut,
  voidPurchase
};

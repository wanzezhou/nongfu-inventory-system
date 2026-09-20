// 小程序商城：商品列表 / 商品详情 / 分类（文档 §21.2 / §35）
// ===========================================================================
// ⚠️ 商品可售状态**按渠道区分**（§35 / §43 Phase 2 明确要求）：
//     业务员维度 → products.salesman_mini_enabled = 1 且 salesman_min_price 已配置
//     水站维度   → 沿用既有分销商品配置（products.status = 1）
//   两条口径不能混用：一个商品可以允许水站订、但不允许业务员卖（§35 末段）。
//
// ⚠️ 下拉/选项类取数不得用分页接口当全量接口（仓库红线 S1）：
//     /categories 是**独立的全量接口**，不走分页。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const { MINI_ROLES, MINI_PAGE } = require('../../constants/mini');
const miniAccountService = require('../../services/miniAccountService');

/** 按角色返回可售条件（唯一一处定义渠道口径） */
function buildVisibilityClause(role) {
  if (role === MINI_ROLES.SALESMAN) {
    return {
      sql: 'p.status = 1 AND p.salesman_mini_enabled = 1 AND p.salesman_min_price IS NOT NULL',
      why: '业务员仅可售已开启且已配置最低成交价的商品（§8.5 / §35）'
    };
  }
  // 直营水站与管理员：沿用既有分销商品可用状态
  return { sql: 'p.status = 1', why: '水站维度沿用既有分销商品配置（§35）' };
}

/** 按角色裁剪价格字段（不让业务员看到分销价、不让水站看到最低成交价） */
function shapePrice(row, role) {
  const base = {
    retailPrice: Number(row.retail_price) || 0
  };
  if (role === MINI_ROLES.SALESMAN) {
    return {
      ...base,
      // §29 商品页：商品图片 / 名称 / 规格 / 参考零售价 / 业务员允许最低价
      salesmanMinPrice: row.salesman_min_price === null ? null : Number(row.salesman_min_price)
    };
  }
  if (role === MINI_ROLES.STATION) {
    return { ...base, wholesalePrice: Number(row.wholesale_price) || 0 };
  }
  // ADMIN：管理员只读总览，给全量价格
  return {
    ...base,
    wholesalePrice: Number(row.wholesale_price) || 0,
    purchasePrice: Number(row.purchase_price) || 0,
    salesmanMinPrice: row.salesman_min_price === null ? null : Number(row.salesman_min_price)
  };
}

/**
 * 商品行 → 小程序视图对象
 * ⚠️ image_url 存的是站内相对路径（如 /product_images/xx.png），
 *    小程序端用 config.apiOrigin 拼成绝对地址 —— 不在库里写死域名，
 *    否则换域名要改数据（也避开了「硬编码服务地址」这条红线）。
 */
function shapeProduct(row, role) {
  return {
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    specification: row.specification,
    unit: row.unit,
    category: row.category,
    imageUrl: row.image_url || null,
    status: Number(row.status),
    ...shapePrice(row, role)
  };
}

/** GET /api/mini/products —— 商品列表（分页 + 关键词 + 分类） */
async function listProducts(req, res) {
  const conn = await pool.getConnection();
  try {
    const role = req.mini.role;
    const { keyword, category } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // ⚠️ 上限 50：不使用 ≥100 的「取数上限」（仓库红线 R5），
    //    列表一律真分页；下拉类数据走 /categories 这类专用全量接口。
    const pageSize = Math.min(
      MINI_PAGE.MAX_SIZE,
      Math.max(1, parseInt(req.query.pageSize, 10) || MINI_PAGE.DEFAULT_SIZE)
    );
    const offset = (page - 1) * pageSize;

    const vis = buildVisibilityClause(role);
    let where = `WHERE ${vis.sql}`;
    const params = [];

    if (keyword) {
      where += ' AND (p.product_name LIKE ? OR p.product_code LIKE ? OR p.specification LIKE ?)';
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    if (category) {
      where += ' AND p.category = ?';
      params.push(category);
    }

    const [countRows] = await conn.execute(`SELECT COUNT(*) AS total FROM products p ${where}`, params);
    const total = Number(countRows[0].total) || 0;

    // ⚠️ 显式列清单（不用 SELECT *，红线 R3）
    // ⚠️ mysql2 不支持 LIMIT ?，分页参数必须 parseInt 后内联（仓库陷阱）
    const [rows] = await conn.execute(
      `SELECT p.product_id, p.product_code, p.product_name, p.specification, p.unit, p.category,
              p.image_url, p.retail_price, p.wholesale_price, p.purchase_price,
              p.salesman_mini_enabled, p.salesman_min_price, p.status
         FROM products p ${where}
        ORDER BY p.product_code ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    return pagination(
      res,
      rows.map(r => shapeProduct(r, role)),
      total,
      page,
      pageSize
    );
  } catch (err) {
    console.error('[mini/catalog] 商品列表失败:', err);
    return error(res, '获取商品列表失败');
  } finally {
    conn.release();
  }
}

/**
 * GET /api/mini/products/categories
 * ⚠️ 必须注册在 `/products/:id` **之前**，否则会被通配路由吞掉（仓库既有陷阱，§21.1.1 第 3 条）
 */
async function listCategories(req, res) {
  const conn = await pool.getConnection();
  try {
    const role = req.mini.role;
    const vis = buildVisibilityClause(role);
    const [rows] = await conn.execute(
      `SELECT p.category, COUNT(*) AS cnt
         FROM products p
        WHERE ${vis.sql} AND p.category IS NOT NULL AND p.category <> ''
        GROUP BY p.category
        ORDER BY p.category ASC`
    );
    return success(res, {
      list: rows.map(r => ({ category: r.category, count: Number(r.cnt) })),
      visibility: vis.why
    });
  } catch (err) {
    console.error('[mini/catalog] 商品分类失败:', err);
    return error(res, '获取商品分类失败');
  } finally {
    conn.release();
  }
}

/** GET /api/mini/products/:id —— 商品详情 */
async function getProductById(req, res) {
  const conn = await pool.getConnection();
  try {
    const role = req.mini.role;
    const [rows] = await conn.execute(
      `SELECT p.product_id, p.product_code, p.product_name, p.specification, p.unit, p.category,
              p.image_url, p.retail_price, p.wholesale_price, p.purchase_price,
              p.salesman_mini_enabled, p.salesman_min_price, p.status
         FROM products p WHERE p.product_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return error(res, '商品不存在', 404);

    const row = rows[0];
    if (Number(row.status) !== 1) return error(res, '商品已停用', 404);
    if (role === MINI_ROLES.SALESMAN && (!Number(row.salesman_mini_enabled) || row.salesman_min_price === null)) {
      // 明确告知不可售原因，而不是静默 404（§8.5）
      return error(res, '该商品暂不支持业务员在小程序销售', 403);
    }

    const product = shapeProduct(row, role);

    // 直营水站：附带该商品当前可用水票数（§30 水票页口径 / §9.2 抵扣上限）
    if (role === MINI_ROLES.STATION) {
      const [tickets] = await conn.execute(
        `SELECT COUNT(*) AS available FROM water_tickets
          WHERE station_id = ? AND product_id = ? AND status = 1`,
        [req.mini.targetId, req.params.id]
      );
      product.availableTicketQty = Number(tickets[0].available) || 0;
    }

    // 直营水站：水站维度的客户默认快照（地址可选「使用现有水站地址」，§10.2）
    if (role === MINI_ROLES.STATION) {
      const [st] = await conn.execute('SELECT contact_name, phone, address FROM sub_stations WHERE station_id = ?', [
        req.mini.targetId
      ]);
      if (st.length) {
        product.stationDefault = {
          contactName: st[0].contact_name || null,
          // ⚠️ 手机号脱敏（§54）。前端**不需要**明文号码：
          //    选「使用水站默认地址」下单时，它只传 addressSource，
          //    联系人/电话由服务端从水站档案重取（miniOrderService.resolveCustomerSnapshot），
          //    这样明文号码不必经过客户端。
          phoneMasked: miniAccountService.maskPhone(st[0].phone),
          /** 前端据此判断「选了水站默认地址时」是否还需要用户手填电话 */
          phoneConfigured: !!st[0].phone,
          address: st[0].address || null
        };
      }
    }

    return success(res, product);
  } catch (err) {
    console.error('[mini/catalog] 商品详情失败:', err);
    return error(res, '获取商品详情失败');
  } finally {
    conn.release();
  }
}

module.exports = { listProducts, listCategories, getProductById };

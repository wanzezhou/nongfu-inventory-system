const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');

// 库存查询（只读，全角色可用）
async function search(req, res) {
  try {
    const { keyword, page = 1, pageSize = 20 } = req.query;
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;

    const whereParts = [];
    const params = [];
    if (keyword) {
      whereParts.push('(p.product_name LIKE ? OR p.product_code LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    const countSql = `SELECT COUNT(*) AS total FROM products p ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = countRows[0].total;

    const listSql = `SELECT
        p.product_id AS productId,
        p.product_name AS name,
        p.product_code AS productCode,
        p.specification AS spec,
        p.unit,
        p.image_url AS imageUrl,
        COALESCE(i.quantity, 0) AS quantity
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      ${whereClause}
      ORDER BY p.product_name ASC
      LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [rows] = await pool.execute(listSql, params);

    const list = rows.map(r => {
      const qty = Number(r.quantity) || 0;
      let stockStatus = 'sufficient';
      if (qty <= 0) stockStatus = 'out';
      else if (qty <= 10) stockStatus = 'low';
      return {
        productId: r.productId,
        name: r.name,
        productCode: r.productCode || null,
        spec: r.spec,
        unit: r.unit,
        quantity: qty,
        imageUrl: r.imageUrl || null,
        stockStatus
      };
    });

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('查询库存失败:', err);
    return res.json({ code: 500, message: '查询库存失败: ' + err.message, data: null });
  }
}

module.exports = {
  search
};

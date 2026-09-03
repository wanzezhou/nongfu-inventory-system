const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { writeWorkbook } = require('../utils/excel');

// 配送方式映射
const DELIVERY_TYPES = {
  1: '自有员工配送',
  2: '水站配送',
  3: '无需配送'
};

// 多选参数解析：兼容数组、逗号分隔字符串、单个值
function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map(x => String(x).trim()).filter(x => x !== '');
}

// 解析时间范围（day/week/month/year/custom）
function resolveDateRange(range, startDate, endDate) {
  const now = new Date();
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  let start, end;
  switch (range) {
    case 'day':
      // 今天 00:00 ~ 明天 00:00
      start = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      break;
    case 'week': {
      // 本周一 00:00 ~ 明天 00:00
      const day = now.getDay() || 7; // 周日=7
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      start = fmt(monday);
      end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      break;
    }
    case 'month':
      start = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      end = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1));
      break;
    case 'year':
      start = fmt(new Date(now.getFullYear(), 0, 1));
      end = fmt(new Date(now.getFullYear() + 1, 0, 1));
      break;
    case 'custom':
    default:
      start = startDate;
      end = endDate ? fmt(new Date(endDate)) : null;
      break;
  }
  return { start, end };
}

// 构建商品销售统计查询（多选筛选）
function buildProductSalesQuery(query) {
  const {
    range = 'month', startDate, endDate,
    keyword,
    sortBy = 'quantity' // quantity 仅按数量
  } = query;

  // 多选参数
  const orderTypes = toArray(query.orderTypes).map(Number).filter(n => !isNaN(n));
  const categories = toArray(query.categories);
  const deliveryTypes = toArray(query.deliveryTypes).map(Number).filter(n => !isNaN(n));
  const createdBys = toArray(query.createdBys);
  const workerIds = toArray(query.workerIds);
  const stationIds = toArray(query.stationIds);
  const machineStationIds = toArray(query.machineStationIds);
  // 兼容旧参数：单值 orderType / category / includeCanceled
  if (orderTypes.length === 0 && query.orderType !== undefined && query.orderType !== '' && query.orderType !== null) {
    orderTypes.push(Number(query.orderType));
  }
  if (categories.length === 0 && query.category) categories.push(query.category);

  const { start, end } = resolveDateRange(range, startDate, endDate);

  const whereParts = [];
  const params = [];

  // 时间条件
  if (start) {
    whereParts.push('o.created_at >= ?');
    params.push(start);
  }
  if (end) {
    whereParts.push('o.created_at < ?');
    params.push(end);
  }

  // 订单类型多选（销售统计默认排除返货 5，单独筛选时按选择）
  if (orderTypes.length > 0) {
    whereParts.push(`o.order_type IN (${orderTypes.map(() => '?').join(',')})`);
    params.push(...orderTypes);
  } else {
    // 默认只统计销售类订单（排除返货 5）
    whereParts.push('o.order_type IN (1,2,3,4,6)');
  }

  // 默认排除已取消订单（canceled_at 非空），保持统计口径一致
  whereParts.push('o.canceled_at IS NULL');

  // 配送方式多选
  if (deliveryTypes.length > 0) {
    whereParts.push(`o.delivery_type IN (${deliveryTypes.map(() => '?').join(',')})`);
    params.push(...deliveryTypes);
  }

  // 创建人多选
  if (createdBys.length > 0) {
    whereParts.push(`o.created_by IN (${createdBys.map(() => '?').join(',')})`);
    params.push(...createdBys);
  }

  // 配送员工多选
  if (workerIds.length > 0) {
    whereParts.push(`o.worker_id IN (${workerIds.map(() => '?').join(',')})`);
    params.push(...workerIds);
  }

  // 水站多选
  if (stationIds.length > 0) {
    whereParts.push(`o.station_id IN (${stationIds.map(() => '?').join(',')})`);
    params.push(...stationIds);
  }

  // 机台多选
  if (machineStationIds.length > 0) {
    whereParts.push(`o.machine_station_id IN (${machineStationIds.map(() => '?').join(',')})`);
    params.push(...machineStationIds);
  }

  // 关键词（商品名称/编码）
  if (keyword) {
    whereParts.push('(p.product_name LIKE ? OR p.product_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  // 商品分类多选
  if (categories.length > 0) {
    whereParts.push(`p.category IN (${categories.map(() => '?').join(',')})`);
    params.push(...categories);
  }

  const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

  // 只统计商品数量，不涉及金额
  const sql = `
    SELECT
      p.product_id AS productId,
      p.product_code AS productCode,
      p.product_name AS productName,
      p.specification AS specification,
      p.unit AS unit,
      p.category AS category,
      SUM(oi.quantity) AS quantity,
      COUNT(DISTINCT o.order_id) AS orderCount
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.order_id
    JOIN products p ON oi.product_id = p.product_id
    ${whereClause}
    GROUP BY p.product_id, p.product_code, p.product_name, p.specification, p.unit, p.category
    ORDER BY quantity DESC
  `;

  return { sql, params };
}

// 商品销售统计（只统计数量，不涉及金额）
async function getProductSales(req, res) {
  try {
    const { sql, params } = buildProductSalesQuery(req.query);
    const [rows] = await pool.execute(sql, params);

    const list = rows.map(r => ({
      productId: r.productId,
      productCode: r.productCode,
      productName: r.productName,
      specification: r.specification || '',
      unit: r.unit || '',
      category: r.category || '',
      quantity: Number(r.quantity) || 0,
      orderCount: Number(r.orderCount) || 0
    }));

    // 汇总（仅数量维度）
    const summary = {
      totalQuantity: list.reduce((s, x) => s + x.quantity, 0),
      productCount: list.length,
      orderCount: list.reduce((s, x) => s + x.orderCount, 0)
    };

    return success(res, { list, summary });
  } catch (err) {
    console.error('获取商品销售统计失败:', err);
    return error(res, '获取商品销售统计失败: ' + err.message);
  }
}

// 一键导出商品销售统计（xlsx，仅数量）
async function exportProductSales(req, res) {
  try {
    const { sql, params } = buildProductSalesQuery(req.query);
    const [rows] = await pool.execute(sql, params);

    const list = rows.map(r => ({
      序号: rows.indexOf(r) + 1,
      商品编码: r.productCode,
      商品名称: r.productName,
      规格: r.specification || '',
      分类: r.category || '',
      单位: r.unit || '',
      销量: Number(r.quantity) || 0,
      订单数: Number(r.orderCount) || 0
    }));

    const buffer = await writeWorkbook([{
      name: '商品销售统计',
      data: list,
      widths: [6, 18, 24, 14, 10, 6, 10, 8]
    }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=product_sales_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('导出商品销售统计失败:', err);
    return error(res, '导出商品销售统计失败: ' + err.message);
  }
}

module.exports = {
  getProductSales,
  exportProductSales
};

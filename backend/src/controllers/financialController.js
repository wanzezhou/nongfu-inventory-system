const { pool } = require('../config/db');
const { success, error, pagination } = require('../utils/response');
const XLSX = require('xlsx');

// 订单类型映射（与订单管理一致）
const ORDER_TYPES = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '量贩机供货',
  5: '线下水站返货',
  6: '零售机供货'
};

// 财务模块：订单类型 -> 统计指标映射
// 每个指标按「单价(来自 order_items) × 数量」聚合；
// 类型5（线下水站返货）需同时统计进货价与分销配送费两个指标。
const FINANCE_METRICS = {
  1: [
    { name: '总包配送费', column: 'totalDeliveryFee' }
  ],
  2: [
    { name: '分销价', column: 'wholesaleAmount' }
  ],
  3: [
    { name: '零售价', column: 'retailAmount' }
  ],
  4: [
    { name: '工人配送费', column: 'workerMachineFee' }
  ],
  5: [
    { name: '进货价', column: 'purchaseAmount' },
    { name: '分销配送费', column: 'distributionFee' }
  ]
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
      start = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      break;
    case 'week': {
      const day = now.getDay() || 7;
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

// 构建时间/类型筛选条件（财务统计默认排除已取消订单）
function buildFinanceWhere(query) {
  const { range = 'month', startDate, endDate } = query;
  const orderTypes = toArray(query.orderTypes).map(Number).filter(n => !isNaN(n) && ORDER_TYPES[n]);
  const { start, end } = resolveDateRange(range, startDate, endDate);

  const whereParts = [];
  const params = [];

  if (start) {
    whereParts.push('o.created_at >= ?');
    params.push(start);
  }
  if (end) {
    whereParts.push('o.created_at < ?');
    params.push(end);
  }

  // 财务模块始终统计用户指定的订单类型；未指定时默认覆盖 5 类业务订单（1-5）
  const types = orderTypes.length > 0 ? orderTypes : [1, 2, 3, 4, 5];
  whereParts.push(`o.order_type IN (${types.map(() => '?').join(',')})`);
  params.push(...types);

  // 排除已取消订单（canceled_at 非空），与全局统计口径一致
  whereParts.push('o.canceled_at IS NULL');

  const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';
  return { whereClause, params };
}

// 按订单类型聚合的 SELECT 字段（单价 × 数量）
const METRIC_SELECT = `
  o.order_type AS orderType,
  COUNT(DISTINCT o.order_id) AS orderCount,
  SUM(oi.quantity) AS totalQuantity,
  COALESCE(SUM(oi.total_delivery_fee * oi.quantity), 0) AS totalDeliveryFee,
  COALESCE(SUM(oi.wholesale_price * oi.quantity), 0) AS wholesaleAmount,
  COALESCE(SUM(oi.retail_price * oi.quantity), 0) AS retailAmount,
  COALESCE(SUM(oi.worker_machine_delivery_fee * oi.quantity), 0) AS workerMachineFee,
  COALESCE(SUM(oi.purchase_price * oi.quantity), 0) AS purchaseAmount,
  COALESCE(SUM(oi.distribution_delivery_fee * oi.quantity), 0) AS distributionFee
`;

// 财务汇总：按订单类型分组，映射出各类业务指标
async function getFinanceSummary(req, res) {
  try {
    const { whereClause, params } = buildFinanceWhere(req.query);

    const sql = `
      SELECT ${METRIC_SELECT}
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      ${whereClause}
      GROUP BY o.order_type
      ORDER BY o.order_type ASC
    `;

    const [rows] = await pool.execute(sql, params);

    // 将分组结果映射为指标行
    const list = [];
    let overallAmount = 0;
    let overallOrders = 0;

    rows.forEach(r => {
      const type = Number(r.orderType);
      const metrics = FINANCE_METRICS[type] || [];
      metrics.forEach(m => {
        const amount = Number(r[m.column]) || 0;
        list.push({
          orderType: type,
          orderTypeName: ORDER_TYPES[type] || type,
          metricName: m.name,
          amount: amount,
          orderCount: Number(r.orderCount) || 0
        });
        overallAmount += amount;
      });
      overallOrders += Number(r.orderCount) || 0;
    });

    return success(res, {
      list,
      overall: {
        totalAmount: Number(overallAmount.toFixed(2)),
        orderCount: overallOrders
      }
    });
  } catch (err) {
    console.error('获取财务汇总失败:', err);
    return error(res, '获取财务汇总失败: ' + err.message);
  }
}

// 财务逐单明细：每行订单带全部指标列，前端按类型展示对应指标
async function getFinanceOrders(req, res) {
  try {
    const { whereClause, params } = buildFinanceWhere(req.query);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const countSql = `
      SELECT COUNT(DISTINCT o.order_id) AS total
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const total = Number(countRows[0].total) || 0;

    const sql = `
      SELECT
        o.order_id AS orderId,
        o.order_type AS orderType,
        o.customer_name AS customerName,
        o.created_at AS createdAt,
        SUM(oi.quantity) AS quantity,
        COALESCE(SUM(oi.total_delivery_fee * oi.quantity), 0) AS totalDeliveryFee,
        COALESCE(SUM(oi.wholesale_price * oi.quantity), 0) AS wholesaleAmount,
        COALESCE(SUM(oi.retail_price * oi.quantity), 0) AS retailAmount,
        COALESCE(SUM(oi.worker_machine_delivery_fee * oi.quantity), 0) AS workerMachineFee,
        COALESCE(SUM(oi.purchase_price * oi.quantity), 0) AS purchaseAmount,
        COALESCE(SUM(oi.distribution_delivery_fee * oi.quantity), 0) AS distributionFee
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      ${whereClause}
      GROUP BY o.order_id, o.order_type, o.customer_name, o.created_at
      ORDER BY o.created_at DESC
      LIMIT ${parseInt(pageSize)} OFFSET ${parseInt(offset)}
    `;
    const [rows] = await pool.execute(sql, params);

    const list = rows.map(r => ({
      orderId: r.orderId,
      orderType: Number(r.orderType),
      orderTypeName: ORDER_TYPES[Number(r.orderType)] || r.orderType,
      customerName: r.customerName || '',
      createdAt: r.createdAt,
      quantity: Number(r.quantity) || 0,
      totalDeliveryFee: Number(r.totalDeliveryFee) || 0,
      wholesaleAmount: Number(r.wholesaleAmount) || 0,
      retailAmount: Number(r.retailAmount) || 0,
      workerMachineFee: Number(r.workerMachineFee) || 0,
      purchaseAmount: Number(r.purchaseAmount) || 0,
      distributionFee: Number(r.distributionFee) || 0
    }));

    return pagination(res, list, total, page, pageSize);
  } catch (err) {
    console.error('获取财务逐单明细失败:', err);
    return error(res, '获取财务逐单明细失败: ' + err.message);
  }
}

// 导出财务逐单明细（xlsx，忽略分页，导出全部）
async function exportFinanceOrders(req, res) {
  try {
    const { whereClause, params } = buildFinanceWhere(req.query);

    const sql = `
      SELECT
        o.order_id AS orderId,
        o.order_type AS orderType,
        o.customer_name AS customerName,
        o.created_at AS createdAt,
        SUM(oi.quantity) AS quantity,
        COALESCE(SUM(oi.total_delivery_fee * oi.quantity), 0) AS totalDeliveryFee,
        COALESCE(SUM(oi.wholesale_price * oi.quantity), 0) AS wholesaleAmount,
        COALESCE(SUM(oi.retail_price * oi.quantity), 0) AS retailAmount,
        COALESCE(SUM(oi.worker_machine_delivery_fee * oi.quantity), 0) AS workerMachineFee,
        COALESCE(SUM(oi.purchase_price * oi.quantity), 0) AS purchaseAmount,
        COALESCE(SUM(oi.distribution_delivery_fee * oi.quantity), 0) AS distributionFee
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      ${whereClause}
      GROUP BY o.order_id, o.order_type, o.customer_name, o.created_at
      ORDER BY o.created_at DESC
    `;
    const [rows] = await pool.execute(sql, params);

    const list = rows.map((r, i) => ({
      序号: i + 1,
      订单号: r.orderId,
      订单类型: ORDER_TYPES[Number(r.orderType)] || r.orderType,
      客户姓名: r.customerName || '',
      创建时间: r.createdAt,
      数量: Number(r.quantity) || 0,
      总包配送费: Number(r.totalDeliveryFee) || 0,
      分销价: Number(r.wholesaleAmount) || 0,
      零售价: Number(r.retailAmount) || 0,
      工人配送费: Number(r.workerMachineFee) || 0,
      进货价: Number(r.purchaseAmount) || 0,
      分销配送费: Number(r.distributionFee) || 0
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(list);
    ws['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 8 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, '财务明细');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=finance_detail_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error('导出财务明细失败:', err);
    return error(res, '导出财务明细失败: ' + err.message);
  }
}

module.exports = {
  getFinanceSummary,
  getFinanceOrders,
  exportFinanceOrders
};

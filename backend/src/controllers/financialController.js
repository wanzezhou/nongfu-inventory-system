const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const XLSX = require('xlsx');

// 订单类型映射（与订单管理一致）
const ORDER_TYPES = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '量贩机',
  5: '线下水站返货',
  6: '零售机'
};

// 机台类型映射（machine_stations.machine_type）
const MACHINE_TYPES = { 1: '量贩机', 2: '零售机' };

// ---------------------------------------------------------------------------
// 营收口径说明（2026-08-24 定版）：
//   订单类（orders + order_items，排除已取消订单 canceled_at IS NULL）：
//     类型1 线上平台销售：营收 = (进货价 + 总包配送费) × 数量
//     类型2 线下水站分销：营收 = 分销价 × 数量
//     类型3 线下零售：    营收 = 零售价 × 数量（下单时手动填写）
//     类型5 线下水站返货：营收 = (进货价 + 总包配送费) × 数量
//   机台类（machine_sales 手动录入，按销售日期统计）：
//     类型4 量贩机：营收 = 机台售价 × 销量
//     类型6 零售机：营收 = 机台售价 × 销量
// ---------------------------------------------------------------------------

// 财务版时间范围（闭区间 [start, end]，end 含当天）
function resolveDateRange(range, startDate, endDate) {
  const now = new Date();
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const today = fmt(now);

  switch (range) {
    case 'day':
      return { start: today, end: today };
    case 'week': {
      const day = now.getDay() || 7; // 周日=7
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      return { start: fmt(monday), end: today };
    }
    case 'month':
      return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    case 'year':
      return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: today };
    case 'custom':
    default:
      return { start: startDate || today, end: endDate || today };
  }
}

// 订单类营收表达式（按订单类型返回 SQL 表达式）
function revenueExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN (oi.purchase_price + oi.total_delivery_fee) * oi.quantity
      WHEN 2 THEN oi.wholesale_price * oi.quantity
      WHEN 3 THEN oi.retail_price * oi.quantity
      WHEN 5 THEN (oi.purchase_price + oi.total_delivery_fee) * oi.quantity
      WHEN 4 THEN oi.purchase_price * oi.quantity
      WHEN 6 THEN oi.purchase_price * oi.quantity
      ELSE 0 END)`;
}

// 订单类营收明细列表（分页；支持按订单类型 1-6 过滤，4/6 为量贩机/零售机供货订单）
async function getFinanceOrders(req, res) {
  try {
    const { range = 'month', startDate, endDate, orderType, page = 1, pageSize = 10 } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;

    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;
    let where;
    const params = [start, end];
    if (wantType && [1, 2, 3, 4, 5, 6].includes(wantType)) {
      where = `WHERE o.order_type = ? AND o.canceled_at IS NULL AND DATE(o.created_at) BETWEEN ? AND ?`;
      params.unshift(wantType);
    } else {
      where = `WHERE o.order_type IN (1,2,3,5) AND o.canceled_at IS NULL AND DATE(o.created_at) BETWEEN ? AND ?`;
    }
    const expr = revenueExpr();

    const [countRows] = await pool.execute(
      `SELECT COUNT(DISTINCT o.order_id) AS total FROM orders o JOIN order_items oi ON o.order_id = oi.order_id ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone, o.delivery_type,
              o.payment_status, o.created_at, o.canceled_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(${expr}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       ${where}
       GROUP BY o.order_id, o.order_type, o.customer_name, o.customer_phone, o.delivery_type, o.payment_status, o.created_at, o.canceled_at
       ORDER BY o.created_at DESC
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );

    const list = rows.map((r) => ({
      orderId: r.order_id,
      orderNo: r.order_id,
      orderType: r.order_type,
      typeName: ORDER_TYPES[r.order_type] || `类型${r.order_type}`,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      totalQty: Number(r.total_qty) || 0,
      revenue: Number(r.revenue) || 0,
      createTime: r.created_at,
      canceled: !!r.canceled_at
    }));

    return success(res, { list, total: countRows[0].total, page: p, pageSize: size, start, end });
  } catch (e) {
    console.error('getFinanceOrders error:', e);
    return error(res, '营收明细查询失败', 500);
  }
}

// 营收汇总：订单类 1/2/3/5 + 机台类 4/6；可选 orderType 只聚合该类型（前端二级菜单）
async function getFinanceSummary(req, res) {
  try {
    const { range = 'month', startDate, endDate, orderType } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const expr = revenueExpr();
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;
    const isOrderType = wantType !== null && [1, 2, 3, 5].includes(wantType);
    const isMachineType = wantType === 4 || wantType === 6;

    // 订单类：按订单类型分组（机台类型 4/6 时跳过订单）
    const orderWhere = isOrderType
      ? `o.order_type = ? AND o.canceled_at IS NULL AND DATE(o.created_at) BETWEEN ? AND ?`
      : (isMachineType
          ? `1=0`
          : `o.order_type IN (1,2,3,5) AND o.canceled_at IS NULL AND DATE(o.created_at) BETWEEN ? AND ?`);
    const orderParams = isOrderType ? [wantType, start, end] : [start, end];
    const [orderRows] = await pool.execute(
      `SELECT o.order_type, ROUND(SUM(${expr}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${orderWhere}
       GROUP BY o.order_type`,
      orderParams
    );

    // 机台类：按机台类型分组（1-量贩机 -> 订单类型4，2-零售机 -> 订单类型6；订单类型 1/2/3/5 时跳过）
    const wantMachineType = wantType === 4 ? 1 : (wantType === 6 ? 2 : null);
    const machineWhere = wantMachineType
      ? `sale_date BETWEEN ? AND ? AND machine_type = ?`
      : (isOrderType ? `1=0` : `sale_date BETWEEN ? AND ?`);
    const machineParams = wantMachineType ? [start, end, wantMachineType] : [start, end];
    const [machineRows] = await pool.execute(
      `SELECT machine_type, ROUND(SUM(sale_price * quantity), 2) AS revenue, SUM(quantity) AS total_qty
       FROM machine_sales
       WHERE ${machineWhere}
       GROUP BY machine_type`,
      machineParams
    );

    const revenueMap = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0
    };
    const qtyMap = {};

    orderRows.forEach((r) => {
      revenueMap[r.order_type] = Number(r.revenue) || 0;
    });

    machineRows.forEach((r) => {
      const key = r.machine_type === 2 ? 6 : 4; // 零售机 -> 6，量贩机 -> 4
      revenueMap[key] = Number(r.revenue) || 0;
      qtyMap[key] = Number(r.total_qty) || 0;
    });

    const list = [1, 2, 3, 4, 5, 6].map((t) => ({
      orderType: t,
      typeName: ORDER_TYPES[t],
      revenue: revenueMap[t] || 0,
      source: t === 4 || t === 6 ? 'machine' : 'order',
      qty: qtyMap[t] || 0
    }));

    const overall = {
      totalRevenue: Math.round(list.reduce((s, x) => s + x.revenue, 0) * 100) / 100
    };

    return success(res, { list, overall, start, end });
  } catch (e) {
    console.error('getFinanceSummary error:', e);
    return error(res, '营收汇总查询失败', 500);
  }
}

// 机台销量明细（分页，可按机台类型筛选）
async function getMachineSales(req, res) {
  try {
    const { range = 'month', startDate, endDate, machineType, page = 1, pageSize = 10 } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;

    let where = `s.sale_date BETWEEN ? AND ?`;
    const params = [start, end];
    if (machineType !== undefined && machineType !== '') {
      where += ` AND s.machine_type = ?`;
      params.push(Number(machineType));
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM machine_sales s WHERE ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT s.sale_id, s.machine_id, s.machine_type, s.product_id, s.quantity,
              s.sale_price, s.sale_date, s.remark, s.created_at, s.created_by,
              m.station_name, m.address AS machine_address,
              p.product_name, p.specification, p.unit
       FROM machine_sales s
       LEFT JOIN machine_stations m ON s.machine_id = m.machine_id
       LEFT JOIN products p ON s.product_id = p.product_id
       WHERE ${where}
       ORDER BY s.sale_date DESC, s.created_at DESC
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );

    const list = rows.map((r) => ({
      saleId: r.sale_id,
      machineId: r.machine_id,
      machineType: r.machine_type,
      machineTypeName: MACHINE_TYPES[r.machine_type] || `类型${r.machine_type}`,
      stationName: r.station_name || r.machine_id,
      machineAddress: r.machine_address || '',
      productId: r.product_id,
      productName: r.product_name || r.product_id,
      specification: r.specification || '',
      unit: r.unit || '',
      quantity: Number(r.quantity) || 0,
      salePrice: Number(r.sale_price) || 0,
      revenue: Math.round((Number(r.sale_price) || 0) * (Number(r.quantity) || 0) * 100) / 100,
      saleDate: r.sale_date,
      remark: r.remark || '',
      createdBy: r.created_by || '',
      createdAt: r.created_at
    }));

    return success(res, { list, total: countRows[0].total, page: p, pageSize: size, start, end });
  } catch (e) {
    console.error('getMachineSales error:', e);
    return error(res, '机台销量明细查询失败', 500);
  }
}

// 录入机台销量
async function createMachineSale(req, res) {
  try {
    const { machineId, productId, quantity, salePrice, saleDate, remark } = req.body || {};

    if (!machineId || !productId) {
      return error(res, '机台与商品必填', 400);
    }
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return error(res, '销量必须为正数', 400);
    }
    const price = Number(salePrice);
    if (isNaN(price) || price < 0) {
      return error(res, '售价必须大于等于0', 400);
    }
    if (!saleDate) {
      return error(res, '销售日期必填', 400);
    }

    // 校验机台存在并取机台类型
    const [machines] = await pool.execute('SELECT machine_id, machine_type FROM machine_stations WHERE machine_id = ?', [machineId]);
    if (machines.length === 0) {
      return error(res, '机台不存在', 404);
    }
    const machineType = Number(machines[0].machine_type) || 1;

    const saleId = `MS${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
    await pool.execute(
      `INSERT INTO machine_sales (sale_id, machine_id, machine_type, product_id, quantity, sale_price, sale_date, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [saleId, machineId, machineType, productId, qty, price, saleDate, remark || null, (req.user && (req.user.username || req.user.id)) || null]
    );

    return success(res, { saleId, machineType }, '机台销量录入成功');
  } catch (e) {
    console.error('createMachineSale error:', e);
    return error(res, '机台销量录入失败', 500);
  }
}

// 删除机台销量（误录可删）
async function deleteMachineSale(req, res) {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM machine_sales WHERE sale_id = ?', [id]);
    if (result.affectedRows === 0) {
      return error(res, '记录不存在', 404);
    }
    return success(res, null, '删除成功');
  } catch (e) {
    console.error('deleteMachineSale error:', e);
    return error(res, '删除失败', 500);
  }
}

// 一键导出（两个 sheet：订单营收明细 + 机台销量明细）
async function exportFinance(req, res) {
  try {
    const { range = 'month', startDate, endDate } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const expr = revenueExpr();

    const [orderRows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone, o.payment_status,
              o.created_at, SUM(oi.quantity) AS total_qty, ROUND(SUM(${expr}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE o.order_type IN (1,2,3,5) AND o.canceled_at IS NULL AND DATE(o.created_at) BETWEEN ? AND ?
       GROUP BY o.order_id, o.order_type, o.customer_name, o.customer_phone, o.payment_status, o.created_at
       ORDER BY o.created_at DESC`,
      [start, end]
    );

    const [machineRows] = await pool.execute(
      `SELECT s.sale_date, s.machine_type, s.quantity, s.sale_price, s.remark,
              m.station_name, p.product_name, p.specification, p.unit
       FROM machine_sales s
       LEFT JOIN machine_stations m ON s.machine_id = m.machine_id
       LEFT JOIN products p ON s.product_id = p.product_id
       WHERE s.sale_date BETWEEN ? AND ?
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      [start, end]
    );

    const orderSheet = orderRows.map((r) => ({
      订单号: r.order_id,
      订单类型: ORDER_TYPES[r.order_type] || `类型${r.order_type}`,
      客户: r.customer_name || '',
      电话: r.customer_phone || '',
      商品总数量: Number(r.total_qty) || 0,
      营收: Number(r.revenue) || 0,
      下单时间: r.created_at
    }));

    const machineSheet = machineRows.map((r) => ({
      销售日期: r.sale_date,
      机台类型: MACHINE_TYPES[r.machine_type] || `类型${r.machine_type}`,
      机台: r.station_name || '',
      商品: r.product_name || '',
      规格: r.specification || '',
      单位: r.unit || '',
      销量: Number(r.quantity) || 0,
      售价: Number(r.sale_price) || 0,
      营收: Math.round((Number(r.sale_price) || 0) * (Number(r.quantity) || 0) * 100) / 100,
      备注: r.remark || ''
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderSheet), '订单营收明细');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(machineSheet), '机台销量明细');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=finance_${start}_${end}.xlsx`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportFinance error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = {
  getFinanceSummary,
  getFinanceOrders,
  getMachineSales,
  createMachineSale,
  deleteMachineSale,
  exportFinance
};

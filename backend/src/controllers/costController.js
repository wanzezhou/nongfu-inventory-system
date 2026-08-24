const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// 成本口径（2026-08-24 定版，单件成本 = 进货价 + 对应配送费，取 order_items 快照）：
//   1 线上平台销售：进货价 + 工人零售配送费  worker_retail_delivery_fee
//   2 线下水站分销：进货价 + 工人水站配送费  worker_wholesale_delivery_fee
//   3 线下零售：    进货价 + 工人零售配送费  worker_retail_delivery_fee
//   4 量贩机供货：  进货价 + 工人零售机配送费 worker_machine_delivery_fee
//   5 线下水站返货：进货价 + 水站分销配送费  distribution_delivery_fee
//   6 零售机供货：  进货价 + 工人零售机配送费 worker_machine_delivery_fee
// 均排除已取消订单（canceled_at IS NULL）
// ---------------------------------------------------------------------------
const COST_TYPES = {
  1: '线上平台销售', 2: '线下水站分销', 3: '线下零售',
  4: '量贩机供货', 5: '线下水站返货', 6: '零售机供货'
};

// 每类订单的配送费字段（进货价统一 purchase_price）
const DELIVERY_FIELD = {
  1: 'worker_retail_delivery_fee',
  2: 'worker_wholesale_delivery_fee',
  3: 'worker_retail_delivery_fee',
  4: 'worker_machine_delivery_fee',
  5: 'distribution_delivery_fee',
  6: 'worker_machine_delivery_fee'
};

// 时间范围（与营收统计一致，all=无过滤）
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
    case 'all': return { start: null, end: null };
    case 'day': return { start: today, end: today };
    case 'week': {
      const day = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
      return { start: fmt(monday), end: today };
    }
    case 'month': return { start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    case 'year': return { start: fmt(new Date(now.getFullYear(), 0, 1)), end: today };
    case 'custom':
    default: return { start: startDate || today, end: endDate || today };
  }
}

// 营业成本汇总：按订单类型（可选 orderType 单类）
async function getCostSummary(req, res) {
  try {
    const { range = 'all', startDate, endDate, orderType } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;

    // 每类型一个查询成本高，改用 CASE 表达式一次查出各类型进货价/配送费/成本
    const deliveryExpr = `
      CASE
        WHEN o.order_type = 5 THEN oi.distribution_delivery_fee
        WHEN o.delivery_type = 3 THEN 0
        WHEN o.order_type = 1 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 2 THEN oi.worker_wholesale_delivery_fee
        WHEN o.order_type = 3 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 4 THEN oi.worker_machine_delivery_fee
        WHEN o.order_type = 6 THEN oi.worker_machine_delivery_fee
        ELSE 0 END`;

    const parts = ['o.canceled_at IS NULL'];
    const params = [];
    if (wantType && [1, 2, 3, 4, 5, 6].includes(wantType)) {
      parts.push('o.order_type = ?');
      params.push(wantType);
    } else {
      parts.push('o.order_type IN (1,2,3,4,5,6)');
    }
    if (start && end) {
      parts.push('DATE(o.created_at) BETWEEN ? AND ?');
      params.push(start, end);
    }

    const [rows] = await pool.execute(
      `SELECT o.order_type,
              ROUND(SUM(oi.purchase_price * oi.quantity), 2) AS purchase_total,
              ROUND(SUM(${deliveryExpr} * oi.quantity), 2) AS delivery_total
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${parts.join(' AND ')}
       GROUP BY o.order_type`,
      params
    );

    const map = {};
    rows.forEach((r) => {
      map[r.order_type] = {
        purchaseTotal: Number(r.purchase_total) || 0,
        deliveryTotal: Number(r.delivery_total) || 0
      };
    });

    const list = [1, 2, 3, 4, 5, 6].map((t) => {
      const m = map[t] || { purchaseTotal: 0, deliveryTotal: 0 };
      return {
        orderType: t,
        typeName: COST_TYPES[t],
        purchaseTotal: m.purchaseTotal,
        deliveryTotal: m.deliveryTotal,
        cost: Math.round((m.purchaseTotal + m.deliveryTotal) * 100) / 100
      };
    });

    const overall = {
      purchaseTotal: Math.round(list.reduce((s, x) => s + x.purchaseTotal, 0) * 100) / 100,
      deliveryTotal: Math.round(list.reduce((s, x) => s + x.deliveryTotal, 0) * 100) / 100,
      totalCost: Math.round(list.reduce((s, x) => s + x.cost, 0) * 100) / 100
    };

    return success(res, { list, overall, start, end });
  } catch (e) {
    console.error('getCostSummary error:', e);
    return error(res, '营业成本汇总查询失败', 500);
  }
}

// 营业成本明细（按订单行：进货价合计/配送费合计/成本）
async function getCostOrders(req, res) {
  try {
    const { range = 'all', startDate, endDate, orderType, page = 1, pageSize = 10 } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;

    const deliveryExpr = `
      CASE
        WHEN o.order_type = 5 THEN oi.distribution_delivery_fee
        WHEN o.delivery_type = 3 THEN 0
        WHEN o.order_type = 1 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 2 THEN oi.worker_wholesale_delivery_fee
        WHEN o.order_type = 3 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 4 THEN oi.worker_machine_delivery_fee
        WHEN o.order_type = 6 THEN oi.worker_machine_delivery_fee
        ELSE 0 END`;

    const parts = ['o.canceled_at IS NULL'];
    const params = [];
    if (wantType && [1, 2, 3, 4, 5, 6].includes(wantType)) {
      parts.push('o.order_type = ?');
      params.push(wantType);
    } else {
      parts.push('o.order_type IN (1,2,3,4,5,6)');
    }
    if (start && end) {
      parts.push('DATE(o.created_at) BETWEEN ? AND ?');
      params.push(start, end);
    }
    const where = 'WHERE ' + parts.join(' AND ');

    const [countRows] = await pool.execute(
      `SELECT COUNT(DISTINCT o.order_id) AS total FROM orders o JOIN order_items oi ON o.order_id = oi.order_id ${where}`,
      params
    );

    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone, o.created_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(oi.purchase_price * oi.quantity), 2) AS purchase_total,
              ROUND(SUM(${deliveryExpr} * oi.quantity), 2) AS delivery_total
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       ${where}
       GROUP BY o.order_id, o.order_type, o.customer_name, o.customer_phone, o.created_at
       ORDER BY o.created_at DESC
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );

    const list = rows.map((r) => {
      const purchaseTotal = Number(r.purchase_total) || 0;
      const deliveryTotal = Number(r.delivery_total) || 0;
      return {
        orderId: r.order_id,
        orderNo: r.order_id,
        orderType: r.order_type,
        typeName: COST_TYPES[r.order_type] || `类型${r.order_type}`,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        totalQty: Number(r.total_qty) || 0,
        purchaseTotal,
        deliveryTotal,
        cost: Math.round((purchaseTotal + deliveryTotal) * 100) / 100,
        createTime: r.created_at
      };
    });

    return success(res, { list, total: countRows[0].total, page: p, pageSize: size, start, end });
  } catch (e) {
    console.error('getCostOrders error:', e);
    return error(res, '营业成本明细查询失败', 500);
  }
}

// 营业成本导出（按当前类型+范围）
async function exportCost(req, res) {
  try {
    const { range = 'all', startDate, endDate, orderType } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;

    const deliveryExpr = `
      CASE
        WHEN o.order_type = 5 THEN oi.distribution_delivery_fee
        WHEN o.delivery_type = 3 THEN 0
        WHEN o.order_type = 1 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 2 THEN oi.worker_wholesale_delivery_fee
        WHEN o.order_type = 3 THEN oi.worker_retail_delivery_fee
        WHEN o.order_type = 4 THEN oi.worker_machine_delivery_fee
        WHEN o.order_type = 6 THEN oi.worker_machine_delivery_fee
        ELSE 0 END`;

    const parts = ['o.canceled_at IS NULL'];
    const params = [];
    if (wantType && [1, 2, 3, 4, 5, 6].includes(wantType)) {
      parts.push('o.order_type = ?');
      params.push(wantType);
    } else {
      parts.push('o.order_type IN (1,2,3,4,5,6)');
    }
    if (start && end) {
      parts.push('DATE(o.created_at) BETWEEN ? AND ?');
      params.push(start, end);
    }

    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone, o.created_at,
              SUM(oi.quantity) AS total_qty,
              ROUND(SUM(oi.purchase_price * oi.quantity), 2) AS purchase_total,
              ROUND(SUM(${deliveryExpr} * oi.quantity), 2) AS delivery_total
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       WHERE ${parts.join(' AND ')}
       GROUP BY o.order_id, o.order_type, o.customer_name, o.customer_phone, o.created_at
       ORDER BY o.created_at DESC`,
      params
    );

    const sheet = rows.map((r) => ({
      订单号: r.order_id,
      订单类型: COST_TYPES[r.order_type] || `类型${r.order_type}`,
      客户: r.customer_name || '',
      商品总数量: Number(r.total_qty) || 0,
      进货价合计: Number(r.purchase_total) || 0,
      配送费合计: Number(r.delivery_total) || 0,
      成本: Math.round(((Number(r.purchase_total) || 0) + (Number(r.delivery_total) || 0)) * 100) / 100,
      下单时间: r.created_at
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), '营业成本明细');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const typeTag = wantType ? COST_TYPES[wantType] : '全部';
    const fileName = `营业成本_${typeTag}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportCost error:', e);
    return error(res, '导出失败', 500);
  }
}

// ---------------------------------------------------------------------------
// 固定支出
// ---------------------------------------------------------------------------

// 固定支出汇总（按类型）
async function getFixedSummary(req, res) {
  try {
    const { range = 'all', startDate, endDate } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const parts = [];
    const params = [];
    if (start && end) {
      parts.push('expense_date BETWEEN ? AND ?');
      params.push(start, end);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [rows] = await pool.execute(
      `SELECT expense_type, ROUND(SUM(amount), 2) AS total, COUNT(*) AS cnt
       FROM fixed_expenses ${where}
       GROUP BY expense_type ORDER BY total DESC`,
      params
    );
    const list = rows.map((r) => ({
      expenseType: r.expense_type,
      total: Number(r.total) || 0,
      count: Number(r.cnt) || 0
    }));
    const overall = {
      total: Math.round(list.reduce((s, x) => s + x.total, 0) * 100) / 100,
      count: list.reduce((s, x) => s + x.count, 0)
    };
    return success(res, { list, overall, start, end });
  } catch (e) {
    console.error('getFixedSummary error:', e);
    return error(res, '固定支出汇总查询失败', 500);
  }
}

// 固定支出明细（分页）
async function getFixedExpenses(req, res) {
  try {
    const { range = 'all', startDate, endDate, expenseType, page = 1, pageSize = 10 } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const p = Math.max(1, parseInt(page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize) || 10));
    const offset = (p - 1) * size;

    const parts = [];
    const params = [];
    if (start && end) {
      parts.push('expense_date BETWEEN ? AND ?');
      params.push(start, end);
    }
    if (expenseType) {
      parts.push('expense_type = ?');
      params.push(expenseType);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM fixed_expenses ${where}`, params);
    const [rows] = await pool.execute(
      `SELECT expense_id, expense_type, amount, expense_date, remark, created_by, created_at
       FROM fixed_expenses ${where}
       ORDER BY expense_date DESC, created_at DESC
       LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`,
      params
    );
    const list = rows.map((r) => ({
      expenseId: r.expense_id,
      expenseType: r.expense_type,
      amount: Number(r.amount) || 0,
      expenseDate: r.expense_date,
      remark: r.remark || '',
      createdBy: r.created_by || '',
      createdAt: r.created_at
    }));
    return success(res, { list, total: countRows[0].total, page: p, pageSize: size, start, end });
  } catch (e) {
    console.error('getFixedExpenses error:', e);
    return error(res, '固定支出明细查询失败', 500);
  }
}

// 已使用的支出类型（下拉候选，含预设）
async function getExpenseTypes(req, res) {
  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT expense_type FROM fixed_expenses ORDER BY expense_type`
    );
    const preset = ['房租', '水电费', '物业费', '人工工资', '物流运输', '设备维护', '其他'];
    const used = rows.map((r) => r.expense_type);
    const list = [...new Set([...preset, ...used])];
    return success(res, { list });
  } catch (e) {
    console.error('getExpenseTypes error:', e);
    return error(res, '获取支出类型失败', 500);
  }
}

async function createFixedExpense(req, res) {
  try {
    const { expenseType, amount, expenseDate, remark } = req.body || {};
    if (!expenseType) return error(res, '支出类型必填', 400);
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return error(res, '金额必须大于0', 400);
    if (!expenseDate) return error(res, '发生日期必填', 400);

    const expenseId = `FE${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
    await pool.execute(
      `INSERT INTO fixed_expenses (expense_id, expense_type, amount, expense_date, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [expenseId, expenseType, amt, expenseDate, remark || null, (req.user && (req.user.username || req.user.id)) || null]
    );
    return success(res, { expenseId }, '录入成功');
  } catch (e) {
    console.error('createFixedExpense error:', e);
    return error(res, '录入失败', 500);
  }
}

async function updateFixedExpense(req, res) {
  try {
    const { id } = req.params;
    const { expenseType, amount, expenseDate, remark } = req.body || {};
    if (!expenseType) return error(res, '支出类型必填', 400);
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return error(res, '金额必须大于0', 400);
    if (!expenseDate) return error(res, '发生日期必填', 400);

    const [result] = await pool.execute(
      `UPDATE fixed_expenses SET expense_type=?, amount=?, expense_date=?, remark=?, updated_at=? WHERE expense_id=?`,
      [expenseType, amt, expenseDate, remark || null, new Date(), id]
    );
    if (result.affectedRows === 0) return error(res, '记录不存在', 404);
    return success(res, null, '修改成功');
  } catch (e) {
    console.error('updateFixedExpense error:', e);
    return error(res, '修改失败', 500);
  }
}

async function deleteFixedExpense(req, res) {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM fixed_expenses WHERE expense_id = ?', [id]);
    if (result.affectedRows === 0) return error(res, '记录不存在', 404);
    return success(res, null, '删除成功');
  } catch (e) {
    console.error('deleteFixedExpense error:', e);
    return error(res, '删除失败', 500);
  }
}

// 固定支出导出
async function exportFixed(req, res) {
  try {
    const { range = 'all', startDate, endDate } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const parts = [];
    const params = [];
    if (start && end) {
      parts.push('expense_date BETWEEN ? AND ?');
      params.push(start, end);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    const [rows] = await pool.execute(
      `SELECT expense_type, amount, expense_date, remark, created_by FROM fixed_expenses ${where} ORDER BY expense_date DESC`,
      params
    );
    const sheet = rows.map((r) => ({
      支出类型: r.expense_type,
      金额: Number(r.amount) || 0,
      发生日期: r.expense_date,
      备注: r.remark || '',
      录入人: r.created_by || ''
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), '固定支出明细');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `固定支出_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.send(buffer);
  } catch (e) {
    console.error('exportFixed error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = {
  getCostSummary,
  getCostOrders,
  exportCost,
  getFixedSummary,
  getFixedExpenses,
  getExpenseTypes,
  createFixedExpense,
  updateFixedExpense,
  deleteFixedExpense,
  exportFixed
};

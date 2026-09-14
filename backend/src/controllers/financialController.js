const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { ORDER_TYPES, VALID_ORDER_TYPES, NO_AMOUNT_TYPES } = require('../constants/order');
const { parsePage } = require('../utils/pagination');
const { writeWorkbook } = require('../utils/excel');
// 营收口径唯一来源（A6）：表达式抽到共享工具，订单详情接口（orderController）也使用同一口径
const { itemRevenueExpr } = require('../utils/revenueExpr');

// 机台类型映射（machine_stations.machine_type）
const MACHINE_TYPES = { 1: '量贩机', 2: '零售机' };

// 订单类型 SQL 片段（全部合法类型，含 5-水公社；由常量派生，避免各处硬编码漂移）
const ORDER_TYPE_IN = `o.order_type IN (${VALID_ORDER_TYPES.join(',')})`;

// ---------------------------------------------------------------------------
// 营收口径说明（2026-08-27 晚更新，总包配送费改为按商品算）：
//   订单类（orders + order_items，排除已取消订单 canceled_at IS NULL）：
//     总包配送费 = 商品档案 total_delivery_fee × 数量（订单级 delivery_fee 已停用为 0，不作为营收配送费来源）
//     类型1 送水到府（原「官方平台销售」）：营收 = Σ((进货价 + 总包配送费) × 数量)
//     类型2 直营水站销售：营收 = 分销价部分 + 水票抵扣部分
//        分销价件数：营收 = Σ(分销价 × 数量)
//        水票抵扣件数：营收 = Σ((进货价 + 总包配送费) × 抵扣件数)
//        行内混合 ticket_qty>0：= (进货价+总包配送费)×抵扣件数 + 分销价×剩余件数
//        旧整单抵扣数据（ticket_qty=0 且 pricing_type=2）：全量按 (进货价 + 总包配送费)
//     类型3 线下零售：    营收 = Σ(零售价×数量)（下单时手动填写）
//     类型5 水公社：      营收 = Σ(零售价×数量)（与线下零售同口径，2026-09-14 新增）
//   机台类（machine_sales 手动录入，按销售日期统计）：
//     类型4 量贩机：营收 = 机台售价 × 销量
//     类型6 零售机：营收 = 机台售价 × 销量
//   注：旧「线下水站返货」编号 5 已删除（2026-08-25），2026-09-14 起 5 复用为「水公社」
//   注：订单级 delivery_fee 自 2026-08-27 起新建订单恒为 0，营收不再使用。
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
    case 'all':
      // 全部时间（无时间过滤）
      return { start: null, end: null };
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

// itemRevenueExpr 已抽至 src/utils/revenueExpr.js（A6 营收口径唯一化），口径注释见该文件

// 订单类营收明细列表（分页；支持按订单类型 1-6 过滤，4/6 为量贩机/零售机供货订单）
async function getFinanceOrders(req, res) {
  try {
    const { range = 'month', startDate, endDate, orderType, page = 1, pageSize = 10 } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const { page: p, size, offset } = parsePage({ page, pageSize }, { maxSize: 100 });

    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;
    // 动态构建 WHERE（支持 range=all 无时间过滤）
    const parts = ['o.canceled_at IS NULL'];
    const params = [];
    if (wantType && VALID_ORDER_TYPES.includes(wantType)) {
      parts.push('o.order_type = ?');
      params.push(wantType);
    } else {
      parts.push(ORDER_TYPE_IN);
    }
    if (start && end) {
      parts.push('DATE(o.created_at) BETWEEN ? AND ?');
      params.push(start, end);
    }
    const where = 'WHERE ' + parts.join(' AND ');
    const expr = itemRevenueExpr();

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

// 原货款（类型1=进货价之和；类型2=分销价合计，仅非抵扣件数；类型3=零售价之和）
function goodsAmountExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN oi.purchase_price * oi.quantity
      WHEN 2 THEN IF(oi.ticket_qty > 0, oi.wholesale_price * (oi.quantity - oi.ticket_qty),
                     IF(oi.pricing_type = 2, 0, oi.wholesale_price * oi.quantity))
      WHEN 3 THEN oi.retail_price * oi.quantity
      ELSE 0 END)`;
}

// 总包配送费（类型1=全部件数；类型2=仅水票抵扣件数；类型3=0）
function deliveryFeeExpr() {
  return `(CASE o.order_type
      WHEN 1 THEN oi.total_delivery_fee * oi.quantity
      WHEN 2 THEN IF(oi.ticket_qty > 0, oi.total_delivery_fee * oi.ticket_qty,
                     IF(oi.pricing_type = 2, oi.total_delivery_fee * oi.quantity, 0))
      ELSE 0 END)`;
}

// 返货价值（类型2 水票抵扣件数 × 进货价；其他类型为 0）
function ticketValueExpr() {
  return `(CASE WHEN o.order_type = 2 THEN
      IF(oi.ticket_qty > 0, oi.purchase_price * oi.ticket_qty,
         IF(oi.pricing_type = 2, oi.purchase_price * oi.quantity, 0))
    ELSE 0 END)`;
}

// 营收汇总：订单类 1/2/3/5 + 机台类 4/6；可选 orderType 只聚合该类型（前端二级菜单）
async function getFinanceSummary(req, res) {
  try {
    const { range = 'month', startDate, endDate, orderType } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const expr = itemRevenueExpr();
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;
    const isOrderType = wantType !== null && VALID_ORDER_TYPES.includes(wantType);
    const isMachineType = wantType === 4 || wantType === 6;

    // 订单类：按订单类型分组（机台类型 4/6 时跳过订单；4/6 营收只来自机台销量 machine_sales，2026-08-27；range=all 无时间过滤）
    const orderParts = isMachineType ? [] : ['o.canceled_at IS NULL'];
    const orderParams = [];
    if (isOrderType) {
      orderParts.push('o.order_type = ?');
      orderParams.push(wantType);
    } else if (!isMachineType) {
      orderParts.push('o.order_type IN (1,2,3,5)');
    }
    if (start && end) {
      orderParts.push('DATE(o.created_at) BETWEEN ? AND ?');
      orderParams.push(start, end);
    }
    const orderWhere = isMachineType ? 'WHERE 1=0' : 'WHERE ' + orderParts.join(' AND ');
    // 先按订单聚合（原货款/总包配送费/返货价值/营收分列），再按类型汇总，避免配送费按件/按行重复累加
    const [orderRows] = await pool.execute(
      `SELECT t.order_type,
              ROUND(SUM(t.goods_amount), 2) AS goods_amount,
              ROUND(SUM(t.delivery_fee), 2) AS delivery_fee,
              ROUND(SUM(t.ticket_value), 2) AS ticket_value,
              ROUND(SUM(t.order_revenue), 2) AS revenue
       FROM (
         SELECT o.order_id, o.order_type,
                SUM(${goodsAmountExpr()}) AS goods_amount,
                SUM(${deliveryFeeExpr()}) AS delivery_fee,
                SUM(${ticketValueExpr()}) AS ticket_value,
                SUM(${expr}) AS order_revenue
         FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
         ${orderWhere}
         GROUP BY o.order_id, o.order_type
       ) t
       GROUP BY t.order_type`,
      orderParams
    );

    // 机台类：按机台类型分组（1-量贩机 -> 订单类型4，2-零售机 -> 订单类型6；订单类型 1/2/3/5 时跳过）
    const wantMachineType = wantType === 4 ? 1 : (wantType === 6 ? 2 : null);
    const machineParts = [];
    const machineParams = [];
    if (wantMachineType) {
      machineParts.push('machine_type = ?');
      machineParams.push(wantMachineType);
    }
    if (start && end) {
      machineParts.push('sale_date BETWEEN ? AND ?');
      machineParams.push(start, end);
    }
    const machineWhere = isOrderType ? 'WHERE 1=0' : (machineParts.length ? 'WHERE ' + machineParts.join(' AND ') : '');
    const [machineRows] = await pool.execute(
      `SELECT machine_type, ROUND(SUM(sale_price * quantity), 2) AS revenue, SUM(quantity) AS total_qty
       FROM machine_sales
       ${machineWhere}
       GROUP BY machine_type`,
      machineParams
    );

    const revenueMap = {
      1: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 },
      2: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 },
      3: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 },
      4: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 },
      5: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 },
      6: { revenue: 0, goodsAmount: 0, deliveryFee: 0, ticketValue: 0 }
    };
    const qtyMap = {};

    orderRows.forEach((r) => {
      revenueMap[r.order_type] = {
        revenue: Number(r.revenue) || 0,
        goodsAmount: Number(r.goods_amount) || 0,
        deliveryFee: Number(r.delivery_fee) || 0,
        ticketValue: Number(r.ticket_value) || 0
      };
    });

    machineRows.forEach((r) => {
      const key = r.machine_type === 2 ? 6 : 4; // 零售机 -> 6，量贩机 -> 4
      revenueMap[key].revenue = Number(r.revenue) || 0;
      qtyMap[key] = Number(r.total_qty) || 0;
    });

    const list = VALID_ORDER_TYPES.map((t) => ({
      orderType: t,
      typeName: ORDER_TYPES[t],
      revenue: revenueMap[t].revenue,
      goodsAmount: revenueMap[t].goodsAmount,
      deliveryFee: revenueMap[t].deliveryFee,
      ticketValue: revenueMap[t].ticketValue,
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
    const { page: p, size, offset } = parsePage({ page, pageSize }, { maxSize: 100 });

    const parts = [];
    const params = [];
    if (start && end) {
      parts.push('s.sale_date BETWEEN ? AND ?');
      params.push(start, end);
    }
    if (machineType !== undefined && machineType !== '') {
      parts.push('s.machine_type = ?');
      params.push(Number(machineType));
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM machine_sales s ${where}`,
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
       ${where}
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

// 录入机台销量（支持批量 items，兼容单条）
async function createMachineSale(req, res) {
  let connection;
  try {
    const { machineId, saleDate, remark } = req.body || {};
    const items = req.body && Array.isArray(req.body.items) ? req.body.items : null;

    if (!machineId) {
      return error(res, '机台必填', 400);
    }
    if (!saleDate) {
      return error(res, '销售日期必填', 400);
    }

    // 兼容单条：{ productId, quantity, salePrice }
    const list = items && items.length > 0
      ? items
      : [{ productId: req.body.productId, quantity: req.body.quantity, salePrice: req.body.salePrice }];

    if (list.length === 0) {
      return error(res, '至少需要一条商品明细', 400);
    }

    // 字段名经 normalizeBody 中间件归一为驼峰
    const cleanItems = list.map((it) => ({
      productId: it.productId,
      quantity: Number(it.quantity),
      salePrice: Number(it.salePrice !== undefined ? it.salePrice : 0)
    }));
    const invalid = cleanItems.some((it) => !it.productId || isNaN(it.quantity) || it.quantity <= 0 || isNaN(it.salePrice) || it.salePrice < 0);
    if (invalid) {
      return error(res, '每条明细需填写商品、销量（>0）、售价（≥0）', 400);
    }

    // 校验机台存在并取机台类型
    const [machines] = await pool.execute('SELECT machine_id, machine_type FROM machine_stations WHERE machine_id = ?', [machineId]);
    if (machines.length === 0) {
      return error(res, '机台不存在', 404);
    }
    const machineType = Number(machines[0].machine_type) || 1;
    const creator = (req.user && (req.user.username || req.user.id)) || null;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const saleIds = [];
    for (const it of cleanItems) {
      const saleId = `MS${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
      await connection.execute(
        `INSERT INTO machine_sales (sale_id, machine_id, machine_type, product_id, quantity, sale_price, sale_date, remark, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, machineId, machineType, it.productId, it.quantity, it.salePrice, saleDate, remark || null, creator]
      );
      saleIds.push(saleId);
    }
    await connection.commit();

    return success(res, { saleIds, machineType, count: saleIds.length }, `机台销量录入成功（${saleIds.length} 条）`);
  } catch (e) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('createMachineSale error:', e);
    return error(res, '机台销量录入失败', 500);
  } finally {
    if (connection) connection.release();
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

// 一键导出（按当前页面类型 orderType 过滤：1/2/3/5 导出该类型订单；4/6 导出该机台类型销量+供货订单）
async function exportFinance(req, res) {
  try {
    const { range = 'month', startDate, endDate, orderType } = req.query;
    const { start, end } = resolveDateRange(range, startDate, endDate);
    const expr = itemRevenueExpr();
    const wantType = orderType !== undefined && orderType !== '' ? Number(orderType) : null;
    const isOrderType = wantType !== null && VALID_ORDER_TYPES.includes(wantType);
    const isMachineType = wantType === 4 || wantType === 6;

    // 订单 sheet：指定订单类型时只导该类型；机台类型(4/6)时导供货订单；无类型时导 1/2/3/5 全部；range=all 无时间过滤
    const oParts = ['o.canceled_at IS NULL'];
    const orderParams = [];
    if (isOrderType || isMachineType) {
      oParts.push('o.order_type = ?');
      orderParams.push(wantType);
    } else {
      oParts.push(ORDER_TYPE_IN);
    }
    if (start && end) {
      oParts.push('DATE(o.created_at) BETWEEN ? AND ?');
      orderParams.push(start, end);
    }
    const orderWhere = 'WHERE ' + oParts.join(' AND ');
    const [orderRows] = await pool.execute(
      `SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone, o.payment_status,
              o.created_at, SUM(oi.quantity) AS total_qty, ROUND(SUM(${expr}), 2) AS revenue
       FROM orders o JOIN order_items oi ON o.order_id = oi.order_id
       ${orderWhere}
       GROUP BY o.order_id, o.order_type, o.customer_name, o.customer_phone, o.payment_status, o.created_at
       ORDER BY o.created_at DESC`,
      orderParams
    );

    // 机台销量 sheet：机台类型(4/6)时只导该类型；订单类型时跳过；无类型时导全部；range=all 无时间过滤
    const mParts = [];
    const machineParams = [];
    if (isMachineType) {
      mParts.push('s.machine_type = ?');
      machineParams.push(wantType === 4 ? 1 : 2);
    } else if (isOrderType) {
      mParts.push('1=0');
    }
    if (start && end) {
      mParts.push('s.sale_date BETWEEN ? AND ?');
      machineParams.push(start, end);
    }
    const machineWhere = mParts.length ? 'WHERE ' + mParts.join(' AND ') : '';
    const [machineRows] = await pool.execute(
      `SELECT s.sale_date, s.machine_type, s.quantity, s.sale_price, s.remark,
              m.station_name, p.product_name, p.specification, p.unit
       FROM machine_sales s
       LEFT JOIN machine_stations m ON s.machine_id = m.machine_id
       LEFT JOIN products p ON s.product_id = p.product_id
       ${machineWhere}
       ORDER BY s.sale_date DESC, s.created_at DESC`,
      machineParams
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

    // 订单类型页面：只导订单；机台类型页面：机台销量 + 供货订单；无类型：订单 + 机台全部
    const sheets = [];
    if (!isMachineType) {
      sheets.push({ name: isOrderType ? `订单明细(${ORDER_TYPES[wantType]})` : '订单营收明细', data: orderSheet });
    }
    if (!isOrderType) {
      sheets.push({ name: isMachineType ? `机台销量明细(${ORDER_TYPES[wantType]})` : '机台销量明细', data: machineSheet });
    }
    const buffer = await writeWorkbook(sheets);

    const typeTag = wantType ? ORDER_TYPES[wantType] : '全部';
    const fileName = `营收_${typeTag}_${start}_${end}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // 中文文件名需按 RFC 5987 编码，否则 Node 报 ERR_INVALID_CHAR
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
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

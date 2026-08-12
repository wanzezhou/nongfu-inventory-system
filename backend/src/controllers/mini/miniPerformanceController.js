const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');

// 根据周期计算起始时间
function getPeriodStart(period) {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
  // month（默认）
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

// 角色化业绩数据
async function getPerformance(req, res) {
  try {
    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;
    const period = req.query.period || 'month';
    const startDate = getPeriodStart(period);

    if (role === 'admin') {
      const [statRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_receivable), 0) AS sales
         FROM orders WHERE created_at >= ?`,
        [startDate]
      );
      // 配送员 Top5（按完成单数）
      const [topWorkers] = await pool.execute(
        `SELECT w.worker_id AS workerId, w.worker_name AS workerName,
                COUNT(o.order_id) AS deliveryCount,
                COALESCE(SUM(o.delivery_fee), 0) AS totalFee
         FROM orders o
         LEFT JOIN workers w ON o.worker_id = w.worker_id
         WHERE o.worker_id IS NOT NULL AND o.created_at >= ?
         GROUP BY o.worker_id, w.worker_name
         ORDER BY deliveryCount DESC
         LIMIT 5`,
        [startDate]
      );
      const top5Workers = topWorkers.map(r => ({
        workerId: r.workerId,
        workerName: r.workerName,
        deliveryCount: r.deliveryCount,
        totalFee: Number(r.totalFee) || 0
      }));
      // 业务员 Top5（按销售额）
      const [topSalesmen] = await pool.execute(
        `SELECT sm.salesman_id AS salesmanId, sm.salesman_name AS salesmanName,
                COUNT(o.order_id) AS orderCount,
                COALESCE(SUM(o.total_receivable), 0) AS salesAmount
         FROM orders o
         LEFT JOIN salesmen sm ON o.created_by = sm.salesman_id
         WHERE sm.salesman_id IS NOT NULL AND o.created_at >= ?
         GROUP BY sm.salesman_id, sm.salesman_name
         ORDER BY salesAmount DESC
         LIMIT 5`,
        [startDate]
      );
      const top5Salesmen = topSalesmen.map(r => ({
        salesmanId: r.salesmanId,
        salesmanName: r.salesmanName,
        orderCount: r.orderCount,
        salesAmount: Number(r.salesAmount) || 0
      }));
      return res.json({
        code: 200,
        data: {
          role,
          period,
          totalOrders: statRows[0].cnt,
          totalSales: Number(statRows[0].sales) || 0,
          top5Workers,
          top5Salesmen
        }
      });
    }

    if (role === 'worker') {
      const [statRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(delivery_fee), 0) AS fee
         FROM orders
         WHERE worker_id = ? AND created_at >= ?`,
        [targetId, startDate]
      );
      const [detailRows] = await pool.execute(
        `SELECT o.order_id AS orderId, o.order_type AS orderType,
                o.customer_name AS customerName, o.delivery_fee AS deliveryFee,
                o.order_status AS orderStatus, o.updated_at AS completedAt
         FROM orders o
         WHERE o.worker_id = ? AND o.created_at >= ?
         ORDER BY o.created_at DESC`,
        [targetId, startDate]
      );
      const detail = detailRows.map(r => ({
        orderId: r.orderId,
        orderType: r.orderType,
        customerName: r.customerName,
        deliveryFee: Number(r.deliveryFee) || 0,
        orderStatus: r.orderStatus,
        completedAt: r.completedAt
      }));
      return res.json({
        code: 200,
        data: {
          role,
          period,
          myDeliveryCount: statRows[0].cnt,
          totalDeliveryFee: Number(statRows[0].fee) || 0,
          detail
        }
      });
    }

    if (role === 'station') {
      const [distribRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(order_amount), 0) AS amt
         FROM orders
         WHERE station_id = ? AND order_type = 2 AND created_at >= ?`,
        [targetId, startDate]
      );
      const [returnRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(order_amount), 0) AS amt
         FROM orders
         WHERE station_id = ? AND order_type = 5 AND created_at >= ?`,
        [targetId, startDate]
      );
      const [allRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM orders WHERE station_id = ? AND created_at >= ?`,
        [targetId, startDate]
      );
      return res.json({
        code: 200,
        data: {
          role,
          period,
          distribAmount: Number(distribRows[0].amt) || 0,
          distribCount: distribRows[0].cnt,
          returnAmount: Number(returnRows[0].amt) || 0,
          returnCount: returnRows[0].cnt,
          orderCount: allRows[0].cnt,
          // 对账汇总占位（财务模块已删除）
          reconciledAmount: 0,
          pendingReconcileAmount: 0
        }
      });
    }

    if (role === 'salesman') {
      // 佣金率
      let commissionRate = 0;
      const [smRows] = await pool.execute(
        'SELECT commission_rate FROM salesmen WHERE salesman_id = ?',
        [targetId]
      );
      if (smRows.length > 0) commissionRate = Number(smRows[0].commission_rate) || 0;

      const [statRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_receivable), 0) AS sales
         FROM orders
         WHERE created_by = ? AND created_at >= ?`,
        [targetId, startDate]
      );
      const totalSales = Number(statRows[0].sales) || 0;
      const commission = Number((totalSales * commissionRate / 100).toFixed(2));

      const [detailRows] = await pool.execute(
        `SELECT order_id AS orderId, order_type AS orderType,
                customer_name AS customerName, total_receivable AS totalAmount,
                order_status AS orderStatus, created_at AS createdAt
         FROM orders
         WHERE created_by = ? AND created_at >= ?
         ORDER BY created_at DESC`,
        [targetId, startDate]
      );
      const detail = detailRows.map(r => ({
        orderId: r.orderId,
        orderType: r.orderType,
        customerName: r.customerName,
        totalAmount: Number(r.totalAmount) || 0,
        orderStatus: r.orderStatus,
        createdAt: r.createdAt
      }));
      return res.json({
        code: 200,
        data: {
          role,
          period,
          commissionRate,
          myOrderCount: statRows[0].cnt,
          totalSales,
          commissionAmount: commission,
          detail
        }
      });
    }

    return res.json({ code: 403, message: '未知角色', data: null });
  } catch (err) {
    console.error('获取业绩数据失败:', err);
    return res.json({ code: 500, message: '获取业绩数据失败: ' + err.message, data: null });
  }
}

module.exports = {
  getPerformance
};

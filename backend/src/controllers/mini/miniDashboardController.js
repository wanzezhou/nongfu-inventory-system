const { pool } = require('../../config/db');
const { success, error } = require('../../utils/response');

// 角色化仪表盘数据
async function getDashboard(req, res) {
  try {
    const role = req.miniUser.role;
    const targetId = req.miniUser.targetId;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    if (role === 'admin') {
      // 今日订单/销售额
      const [todayRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_receivable), 0) AS sales
         FROM orders WHERE created_at >= ?`,
        [todayStart]
      );
      // 待接单配送
      const [pendingRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM orders
         WHERE delivery_type = 1 AND worker_id IS NULL AND order_status IN (0, 1)`
      );
      // 待审批报销（表可能不存在）
      let pendingApprovals = 0;
      try {
        const [apprRows] = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM reimbursements WHERE status = 0`
        );
        pendingApprovals = apprRows[0].cnt;
      } catch (e) {
        pendingApprovals = 0;
      }
      // 最近 5 单
      const [recentRows] = await pool.execute(
        `SELECT order_id AS orderNo, order_id AS orderId, order_type AS orderType, customer_name AS customerName,
                total_receivable AS totalAmount, order_status AS orderStatus, created_at AS createdAt
         FROM orders ORDER BY created_at DESC LIMIT 5`
      );
      const recentOrders = recentRows.map(r => ({
        orderNo: r.orderNo,
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
          todayOrders: todayRows[0].cnt,
          todaySales: Number(todayRows[0].sales) || 0,
          pendingDelivery: pendingRows[0].cnt,
          pendingApprovals,
          recentOrders
        }
      });
    }

    if (role === 'worker') {
      const [todayDone] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(delivery_fee), 0) AS fee
         FROM orders
         WHERE worker_id = ? AND order_status = 2 AND updated_at >= ?`,
        [targetId, todayStart]
      );
      const [pendingCnt] = await pool.execute(
        `SELECT COUNT(*) AS cnt FROM orders
         WHERE worker_id = ? AND order_status IN (0, 1)`,
        [targetId]
      );
      const [monthDone] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(delivery_fee), 0) AS fee
         FROM orders
         WHERE worker_id = ? AND order_status = 2 AND updated_at >= ?`,
        [targetId, monthStart]
      );
      const [pendingOrdersRows] = await pool.execute(
        `SELECT order_id AS orderNo, order_id AS orderId, order_type AS orderType, customer_name AS customerName,
                customer_phone AS customerPhone, customer_address AS customerAddress,
                delivery_fee AS deliveryFee, order_status AS orderStatus, created_at AS createdAt
         FROM orders
         WHERE worker_id = ? AND order_status IN (0, 1)
         ORDER BY created_at DESC LIMIT 5`,
        [targetId]
      );
      const pendingOrders = pendingOrdersRows.map(r => ({
        orderNo: r.orderNo,
        orderId: r.orderId,
        orderType: r.orderType,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        customerAddress: r.customerAddress,
        deliveryFee: Number(r.deliveryFee) || 0,
        orderStatus: r.orderStatus,
        createdAt: r.createdAt
      }));
      return res.json({
        code: 200,
        data: {
          role,
          todayCompleted: todayDone[0].cnt,
          todayPending: pendingCnt[0].cnt,
          todayDeliveryFee: Number(todayDone[0].fee) || 0,
          monthCompleted: monthDone[0].cnt,
          monthDeliveryFee: Number(monthDone[0].fee) || 0,
          pendingOrders
        }
      });
    }

    if (role === 'station') {
      // 水站名
      let stationName = null;
      const [stRows] = await pool.execute(
        'SELECT station_name FROM sub_stations WHERE station_id = ?',
        [targetId]
      );
      if (stRows.length > 0) stationName = stRows[0].station_name;

      // 本周分销/返货金额
      const [distribRows] = await pool.execute(
        `SELECT COALESCE(SUM(order_amount), 0) AS amt FROM orders
         WHERE station_id = ? AND order_type = 2 AND created_at >= ?`,
        [targetId, weekStart]
      );
      const [returnRows] = await pool.execute(
        `SELECT COALESCE(SUM(order_amount), 0) AS amt FROM orders
         WHERE station_id = ? AND order_type = 5 AND created_at >= ?`,
        [targetId, weekStart]
      );
      // 最近 5 单
      const [recentRows] = await pool.execute(
        `SELECT order_id AS orderNo, order_id AS orderId, order_type AS orderType, customer_name AS customerName,
                order_amount AS orderAmount, order_status AS orderStatus, created_at AS createdAt
         FROM orders WHERE station_id = ?
         ORDER BY created_at DESC LIMIT 5`,
        [targetId]
      );
      const recentOrders = recentRows.map(r => ({
        orderNo: r.orderNo,
        orderId: r.orderId,
        orderType: r.orderType,
        customerName: r.customerName,
        orderAmount: Number(r.orderAmount) || 0,
        orderStatus: r.orderStatus,
        createdAt: r.createdAt
      }));
      return res.json({
        code: 200,
        data: {
          role,
          stationName,
          weekDistribAmount: Number(distribRows[0].amt) || 0,
          weekReturnAmount: Number(returnRows[0].amt) || 0,
          depositBarrels: 0,
          pendingReconcile: 0,
          recentOrders
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

      const [todayRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_receivable), 0) AS sales
         FROM orders WHERE created_by = ? AND created_at >= ?`,
        [targetId, todayStart]
      );
      const [monthRows] = await pool.execute(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_receivable), 0) AS sales
         FROM orders WHERE created_by = ? AND created_at >= ?`,
        [targetId, monthStart]
      );
      const [recentRows] = await pool.execute(
        `SELECT order_id AS orderNo, order_id AS orderId, order_type AS orderType, customer_name AS customerName,
                total_receivable AS totalAmount, order_status AS orderStatus, created_at AS createdAt
         FROM orders WHERE created_by = ?
         ORDER BY created_at DESC LIMIT 5`,
        [targetId]
      );
      const recentOrders = recentRows.map(r => ({
        orderNo: r.orderNo,
        orderId: r.orderId,
        orderType: r.orderType,
        customerName: r.customerName,
        totalAmount: Number(r.totalAmount) || 0,
        orderStatus: r.orderStatus,
        createdAt: r.createdAt
      }));
      const todaySales = Number(todayRows[0].sales) || 0;
      const monthSales = Number(monthRows[0].sales) || 0;
      return res.json({
        code: 200,
        data: {
          role,
          commissionRate,
          todayOrders: todayRows[0].cnt,
          todaySales,
          todayCommission: Number((todaySales * commissionRate / 100).toFixed(2)),
          monthOrders: monthRows[0].cnt,
          monthCommission: Number((monthSales * commissionRate / 100).toFixed(2)),
          recentOrders
        }
      });
    }

    // 未知角色
    return res.json({ code: 403, message: '未知角色', data: null });
  } catch (err) {
    console.error('获取仪表盘数据失败:', err);
    return res.json({ code: 500, message: '获取仪表盘数据失败: ' + err.message, data: null });
  }
}

module.exports = {
  getDashboard
};

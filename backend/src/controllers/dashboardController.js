const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// 获取统计数据
async function getSummary(req, res) {
  try {
    // totalInventoryValue：所有商品库存*进货价的总和
    const [inventoryRows] = await pool.execute(`
      SELECT COALESCE(SUM(i.quantity * p.purchase_price), 0) as totalInventoryValue
      FROM inventory i
      LEFT JOIN products p ON i.product_id = p.product_id
    `);
    const totalInventoryValue = inventoryRows[0].totalInventoryValue;

    // monthSales：本月已完成订单的order_amount总和
    const [salesRows] = await pool.execute(`
      SELECT COALESCE(SUM(order_amount), 0) as monthSales
      FROM orders
      WHERE order_status = 2
      AND YEAR(created_at) = YEAR(CURRENT_DATE)
      AND MONTH(created_at) = MONTH(CURRENT_DATE)
    `);
    const monthSales = salesRows[0].monthSales;

    // stationDebt：所有水站current_debt总和
    const [debtRows] = await pool.execute(`
      SELECT COALESCE(SUM(current_debt), 0) as stationDebt
      FROM sub_stations
      WHERE status = 1
    `);
    const stationDebt = debtRows[0].stationDebt;

    // pendingOrders：订单状态为0的数量
    const [pendingRows] = await pool.execute(`
      SELECT COUNT(*) as pendingOrders
      FROM orders
      WHERE order_status = 0
    `);
    const pendingOrders = pendingRows[0].pendingOrders;

    const result = {
      totalInventoryValue,
      monthSales,
      stationDebt,
      pendingOrders
    };

    return success(res, result);
  } catch (err) {
    console.error('获取统计数据失败:', err);
    return error(res, '获取统计数据失败: ' + err.message);
  }
}

// 获取近7天销售趋势
async function getTrend(req, res) {
  try {
    // 获取近7天的日期列表
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dates.push({
        date: date.toISOString().split('T')[0],
        amount: 0
      });
    }

    // 查询近7天已完成订单的每日销售总额
    const [trendRows] = await pool.execute(`
      SELECT 
        DATE(created_at) as date,
        SUM(order_amount) as amount
      FROM orders
      WHERE order_status = 2
      AND created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 6 DAY)
      AND created_at < DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // 合并数据
    const trendMap = {};
    for (const row of trendRows) {
      trendMap[row.date] = row.amount;
    }

    const result = dates.map(item => ({
      date: item.date,
      amount: trendMap[item.date] || 0
    }));

    return success(res, result);
  } catch (err) {
    console.error('获取销售趋势失败:', err);
    return error(res, '获取销售趋势失败: ' + err.message);
  }
}

module.exports = {
  getSummary,
  getTrend
};

const { pool } = require('../config/db');
const { success, error } = require('../utils/response');

// 获取统计数据
async function getSummary(req, res) {
  try {
    // totalInventoryValue：库存金额 = Σ max(库存,0) × 进货价，仅统计启用商品
    //   ① GREATEST(quantity,0)：负库存不计负值，避免单条脏数据把总额拉成负数
    //   ② INNER JOIN + status=1：软删商品不计入
    const [inventoryRows] = await pool.execute(`
      SELECT COALESCE(SUM(GREATEST(i.quantity, 0) * p.purchase_price), 0) as totalInventoryValue
      FROM inventory i
      INNER JOIN products p ON i.product_id = p.product_id AND p.status = 1
    `);
    const totalInventoryValue = inventoryRows[0].totalInventoryValue;

    // monthSales：本月全部订单（排除已取消）的 order_amount 总和
    const [salesRows] = await pool.execute(`
      SELECT COALESCE(SUM(order_amount), 0) as monthSales
      FROM orders
      WHERE canceled_at IS NULL
      AND YEAR(created_at) = YEAR(CURRENT_DATE)
      AND MONTH(created_at) = MONTH(CURRENT_DATE)
    `);
    const monthSales = salesRows[0].monthSales;

    // 注：原「水站欠款总额 / 在职水站数」聚合已于 2026-09-16 随仪表盘卡片一并下线
    //     （业务方确认不使用该指标；建单挂账逻辑仍在，仅不再对外展示）

    // pendingOrders（待配送数）：自有员工配送(delivery_type=1)且未分配配送员(worker_id IS NULL)且未取消
    const [pendingRows] = await pool.execute(`
      SELECT COUNT(*) as pendingOrders
      FROM orders
      WHERE delivery_type = 1
      AND worker_id IS NULL
      AND canceled_at IS NULL
    `);
    const pendingOrders = pendingRows[0].pendingOrders;

    const result = {
      totalInventoryValue,
      monthSales,
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

    // 查询近7天订单（排除已取消）的每日销售总额
    const [trendRows] = await pool.execute(`
      SELECT
        DATE(created_at) as date,
        SUM(order_amount) as amount
      FROM orders
      WHERE canceled_at IS NULL
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

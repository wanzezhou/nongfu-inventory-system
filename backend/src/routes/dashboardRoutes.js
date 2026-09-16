const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// 获取与时间无关的统计（当前仅「库存总金额」）
router.get('/summary', dashboardController.getSummary);

// 周期指标（总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润）
// 周期由 ?range=month|quarter|year 指定（仪表盘卡片各自选择，前端按 range 缓存复用）
router.get('/metrics', dashboardController.getMetrics);

// 月销售趋势（本年度 1~12 月，按商品件数）
router.get('/trend', dashboardController.getTrend);

module.exports = router;

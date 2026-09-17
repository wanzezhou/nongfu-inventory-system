const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// 获取与时间无关的统计（当前仅「库存总金额」）
router.get('/summary', dashboardController.getSummary);

// 周期指标（总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润）
// 周期由 ?range=month|quarter|year 指定（仪表盘卡片各自选择，前端按 range 缓存复用）
router.get('/metrics', dashboardController.getMetrics);

// 趋势（销售件数 / 营收 / 成本 / 利润），按 ?granularity=day|week|month|quarter|year 分桶
// 一次返回四张趋势图所需的全部序列，前端按粒度缓存复用
router.get('/trends', dashboardController.getTrends);

module.exports = router;

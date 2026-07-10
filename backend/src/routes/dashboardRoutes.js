const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// 获取统计数据
router.get('/summary', dashboardController.getSummary);

// 获取近7天销售趋势
router.get('/trend', dashboardController.getTrend);

module.exports = router;

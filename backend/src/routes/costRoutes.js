const express = require('express');
const router = express.Router();
const costController = require('../controllers/costController');

// 直营水站成本统计（按月）：按水站汇总水票抵扣成本
router.get('/station-summary', costController.getStationSummary);
// 指定水站当月抵扣订单明细
router.get('/station-orders', costController.getStationOrders);
// 订单内水票抵扣商品行成本
router.get('/order-items', costController.getOrderItems);

module.exports = router;

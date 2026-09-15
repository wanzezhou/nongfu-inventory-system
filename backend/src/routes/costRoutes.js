const express = require('express');
const router = express.Router();
const costController = require('../controllers/costController');
const auth = require('../middleware/auth');

// ---- 遗留接口（直营水站抵扣成本，保留向后兼容）----
// 直营水站成本统计（按月）：按水站汇总水票抵扣成本
router.get('/station-summary', auth, costController.getStationSummary);
// 指定水站当月抵扣订单明细
router.get('/station-orders', auth, costController.getStationOrders);
// 订单内水票抵扣商品行成本
router.get('/order-items', auth, costController.getOrderItems);

// ---- 需求 4（2026-09-15）：按订单类型的成本统计 ----
// ⚠️ 具体路径必须定义在通配之前
// 成本总览（全部类型横向对比）
router.get('/overview', auth, costController.getCostOverview);
// 机台成本（machineType 1=量贩机 / 2=零售机）
router.get('/machine', auth, costController.getMachineCost);
// 成本明细行（按 orderId 或 orderType+range）
router.get('/order-lines', auth, costController.getCostOrderLines);
// 单类型成本统计（orderType=1..6）
router.get('/by-type', auth, costController.getCostByType);

module.exports = router;

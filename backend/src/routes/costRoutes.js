const express = require('express');
const router = express.Router();
const costController = require('../controllers/costController');
const auth = require('../middleware/auth');

// ---- 需求 4（2026-09-15）：按订单类型的成本统计 ----
// ⚠️ 具体路径必须定义在通配之前
// 注：原 station-summary / station-orders / order-items 三遗留接口已于 2026-09-15（晚）
//     随「水站成本明细」页面删除，口径并入 /overview 与 /by-type。
// 成本总览（全部类型横向对比）
router.get('/overview', auth, costController.getCostOverview);
// 机台成本（machineType 1=量贩机 / 2=零售机）
router.get('/machine', auth, costController.getMachineCost);
// 成本明细行（按 orderId 或 orderType+range）
router.get('/order-lines', auth, costController.getCostOrderLines);
// 单类型成本统计（orderType=1..6）
router.get('/by-type', auth, costController.getCostByType);

module.exports = router;

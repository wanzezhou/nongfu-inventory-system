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

// ---- 一键导出（2026-09-16 晚 2）----
// 成本汇总页导出（各类型对比 + 其他支出 + 直营水站成本 + 员工工资）
router.get('/export/summary', auth, costController.exportCostSummary);
// 单类型成本 / 机台成本导出（含商品明细）；两者路径不同，与 '/export/summary' 无通配冲突
router.get('/export', auth, costController.exportCost);

module.exports = router;

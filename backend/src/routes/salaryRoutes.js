const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salaryController');
const auth = require('../middleware/auth');

// 工资统计（按月）：员工配送费汇总
router.get('/summary', auth, salaryController.getSalarySummary);
// 指定员工当月配送订单明细
router.get('/orders', auth, salaryController.getSalaryOrders);
// 指定订单的商品配送明细
router.get('/order-items', auth, salaryController.getSalaryOrderItems);
// 单员工当月配送费与发放状态
router.get('/worker-summary', auth, salaryController.getWorkerSummary);
// 工资预支列表（筛选员工/状态）
router.get('/advances', auth, salaryController.getAdvances);
// 一键导出（员工工资汇总 + 配送订单明细 + 配送商品明细）
router.get('/export', auth, salaryController.exportSalary);
// 确认发放（记录发放 + 公司账户支出）
router.post('/pay', auth, salaryController.paySalary);
// 预支登记（公司账户支出 + 员工挂账）
router.post('/advances', auth, salaryController.createAdvance);
// 撤销预支（仅未参与结算的预支）
router.delete('/advances/:id', auth, salaryController.deleteAdvance);
// 撤销发放（回补账户）
router.delete('/payments/:id', auth, salaryController.revokeSalaryPayment);

module.exports = router;

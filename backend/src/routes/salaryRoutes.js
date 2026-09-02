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
// 确认发放（记录发放 + 公司账户支出）
router.post('/pay', auth, salaryController.paySalary);
// 撤销发放（回补账户）
router.delete('/payments/:id', auth, salaryController.revokeSalaryPayment);

module.exports = router;

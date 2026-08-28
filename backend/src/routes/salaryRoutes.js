const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salaryController');

// 工资统计（按月）：员工配送费汇总
router.get('/summary', salaryController.getSalarySummary);
// 指定员工当月配送订单明细
router.get('/orders', salaryController.getSalaryOrders);

module.exports = router;

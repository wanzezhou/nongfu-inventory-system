const express = require('express');
const router = express.Router();
const financialController = require('../controllers/financialController');
const auth = require('../middleware/auth');

// 营收汇总（按订单类型 1/2/3/5 + 机台 4/6）
router.get('/summary', auth, financialController.getFinanceSummary);

// 订单营收明细（分页）
router.get('/orders', auth, financialController.getFinanceOrders);

// 机台销量明细（分页）
router.get('/machine-sales', auth, financialController.getMachineSales);

// 录入机台销量
router.post('/machine-sales', auth, financialController.createMachineSale);

// 删除机台销量
router.delete('/machine-sales/:id', auth, financialController.deleteMachineSale);

// 一键导出（订单营收 + 机台销量）
router.get('/export', auth, financialController.exportFinance);

module.exports = router;

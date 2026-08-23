const express = require('express');
const router = express.Router();
const financialController = require('../controllers/financialController');
const auth = require('../middleware/auth');

// 财务汇总（按订单类型统计各类指标）
router.get('/summary', auth, financialController.getFinanceSummary);
// 财务逐单明细（分页）
router.get('/orders', auth, financialController.getFinanceOrders);
// 导出财务逐单明细（xlsx）
router.get('/orders/export', auth, financialController.exportFinanceOrders);

module.exports = router;

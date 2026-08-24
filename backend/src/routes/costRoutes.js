const express = require('express');
const router = express.Router();
const costController = require('../controllers/costController');
const auth = require('../middleware/auth');

// ---- 营业成本（按订单类型 1-6 自动计算）----
router.get('/summary', auth, costController.getCostSummary);
router.get('/orders', auth, costController.getCostOrders);
router.get('/export', auth, costController.exportCost);

// ---- 固定支出（手动录入）----
router.get('/fixed-summary', auth, costController.getFixedSummary);
router.get('/fixed-expenses', auth, costController.getFixedExpenses);
router.get('/expense-types', auth, costController.getExpenseTypes);
router.post('/fixed-expenses', auth, costController.createFixedExpense);
router.put('/fixed-expenses/:id', auth, costController.updateFixedExpense);
router.delete('/fixed-expenses/:id', auth, costController.deleteFixedExpense);
router.get('/fixed-export', auth, costController.exportFixed);

module.exports = router;

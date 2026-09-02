const express = require('express');
const router = express.Router();
const financeAccountController = require('../controllers/financeAccountController');
const auth = require('../middleware/auth');

// 公司账户管理：查看与维护（7 类账户相互独立，支持互转）
router.get('/', auth, financeAccountController.getAccounts);
router.post('/', auth, financeAccountController.createAccount);
router.put('/:id', auth, financeAccountController.updateAccount);
router.delete('/:id', auth, financeAccountController.deleteAccount);
router.post('/:id/adjust', auth, financeAccountController.adjustBalance);
router.get('/:id/transactions', auth, financeAccountController.getTransactions);
router.post('/transfer', auth, financeAccountController.transferBetween);

module.exports = router;

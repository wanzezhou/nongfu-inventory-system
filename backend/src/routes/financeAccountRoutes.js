const express = require('express');
const router = express.Router();
const financeAccountController = require('../controllers/financeAccountController');
const auth = require('../middleware/auth');
const requireAdmin = auth.requireAdmin;

// 公司账户管理：查看与维护（7 类账户相互独立，支持互转）
// 读取类接口：登录即可（入库等业务需要选择账户）
router.get('/', auth, financeAccountController.getAccounts);
router.get('/:id/transactions', auth, financeAccountController.getTransactions);

// 变更类接口：仅管理员（S4 角色鉴权）
router.post('/', auth, requireAdmin, financeAccountController.createAccount);
router.put('/:id', auth, requireAdmin, financeAccountController.updateAccount);
router.delete('/:id', auth, requireAdmin, financeAccountController.deleteAccount);
router.post('/:id/adjust', auth, requireAdmin, financeAccountController.adjustBalance);
router.post('/transfer', auth, requireAdmin, financeAccountController.transferBetween);

module.exports = router;

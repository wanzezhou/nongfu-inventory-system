const express = require('express');
const router = express.Router();
const financeAccountController = require('../controllers/financeAccountController');
const auth = require('../middleware/auth');

// 账户列表（其他支出选账户下拉 / 账户管理模块基础）
router.get('/', auth, financeAccountController.getAccounts);

module.exports = router;

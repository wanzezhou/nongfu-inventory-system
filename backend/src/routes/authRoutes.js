const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { login, getProfile, changePassword } = require('../controllers/authController');

// 登录
router.post('/login', login);

// 获取当前用户信息
router.get('/profile', auth, getProfile);

// 修改密码
router.put('/password', auth, changePassword);

module.exports = router;

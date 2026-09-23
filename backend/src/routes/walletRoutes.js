const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const auth = require('../middleware/auth');
const requireAdmin = auth.requireAdmin;

// 积分钱包管理（Web 管理端）—— 双积分：充值积分 / 配送费积分
//
// ⚠️ 路由顺序：具体路径必须写在通配 `/:walletId/...` **之前**。
//    Express 对同名路由重复注册**不报错**，请求会静默命中先注册的那个 ——
//    本仓库实际踩过（账号管理域首版把 /admin/accounts* 写成公司账户域的前缀，
//    结果「列表返回公司账户、删除删的是公司账户」）。故 /open 声明在最前。
//
// ⚠️ 权限：本模块读写的都是**他人**的资产（水站/业务员的积分），
//    因此读接口也要求管理员 —— 这点与「公司账户」域（登录即可读，供入库选择账户）
//    不同：后者的读是为了选账户，这里没有这种下游需求。
//    ⚠️ 不复用小程序端的 requireMiniAdmin：那是校验小程序令牌的中间件，
//       套在 Web 路由上会让所有请求 401。
router.get('/', auth, requireAdmin, walletController.getWallets);
router.post('/open', auth, requireAdmin, walletController.openWallet);
router.post('/:walletId/adjust', auth, requireAdmin, walletController.adjustWallet);
router.get('/:walletId/transactions', auth, requireAdmin, walletController.getWalletTransactions);

module.exports = router;

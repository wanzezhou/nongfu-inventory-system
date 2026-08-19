const express = require('express');
const router = express.Router();
const { miniAuth } = require('../middleware/miniAuth');
const { requireRole } = require('../middleware/miniRole');
const miniAuthController = require('../controllers/mini/miniAuthController');
const miniOrderController = require('../controllers/mini/miniOrderController');
const miniDeliveryController = require('../controllers/mini/miniDeliveryController');
const miniDashboardController = require('../controllers/mini/miniDashboardController');
const miniInventoryController = require('../controllers/mini/miniInventoryController');
const miniPerformanceController = require('../controllers/mini/miniPerformanceController');
const miniDepositController = require('../controllers/mini/miniDepositController');
const miniReimburseController = require('../controllers/mini/miniReimburseController');

// 公开认证路由（无需 token）
router.post('/auth/wx-login', miniAuthController.wxLogin);
router.post('/auth/bind-phone', miniAuthController.bindPhone);
router.post('/auth/sms-send', miniAuthController.sendSms);
router.post('/auth/sms-login', miniAuthController.smsLogin);
router.post('/auth/password-login', miniAuthController.passwordLogin);

// 以下路由均需 miniAuth 中间件
router.use(miniAuth);

router.get('/auth/me', miniAuthController.getMe);
router.put('/auth/update-phone', miniAuthController.updatePhone);
router.post('/auth/logout', miniAuthController.logout);

// 订单路由（静态路由必须在 /orders/:id 之前定义，避免被 :id 捕获）
router.get('/orders', miniOrderController.list);
router.get('/orders/products', miniOrderController.products);
router.get('/orders/stations', miniOrderController.stations);
router.get('/orders/workers', miniOrderController.workers);
router.get('/orders/:id', miniOrderController.detail);
router.post('/orders', miniOrderController.create);
router.put('/orders/:id', miniOrderController.update);

// 仪表盘（角色化数据）
router.get('/dashboard', miniDashboardController.getDashboard);

// 配送（worker + admin）
router.get('/delivery/pending', requireRole('worker', 'admin'), miniDeliveryController.pending);
router.get('/delivery/mine', requireRole('worker', 'admin'), miniDeliveryController.mine);
router.post('/delivery/accept/:id', requireRole('worker'), miniDeliveryController.accept);
router.post('/delivery/complete/:id', requireRole('worker'), miniDeliveryController.complete);
router.post('/delivery/upload-photo', requireRole('worker', 'admin'), miniDeliveryController.upload.single('file'), miniDeliveryController.uploadPhoto);
router.post('/delivery/assign', requireRole('admin'), miniDeliveryController.assign);

// 库存查询（只读，全角色可用）
router.get('/inventory/search', miniInventoryController.search);

// 业绩（角色化数据）
router.get('/performance', miniPerformanceController.getPerformance);

// 押金
router.get('/deposits', miniDepositController.list);
router.post('/deposits', miniDepositController.create);

// 报销
router.get('/reimbursements', miniReimburseController.list);
router.get('/reimbursements/:id', miniReimburseController.detail);
router.post('/reimbursements', miniReimburseController.create);
router.put('/reimbursements/:id/approve', requireRole('admin'), miniReimburseController.approve);
router.post('/reimbursements/upload-attachment', miniReimburseController.upload.single('file'), miniReimburseController.uploadAttachment);

module.exports = router;

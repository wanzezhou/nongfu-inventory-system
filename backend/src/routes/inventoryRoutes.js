const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const auth = require('../middleware/auth');
const requireAdmin = auth.requireAdmin;

// 入库记录列表（须定义在 /:productId 之前，避免被通配路由拦截）
router.get('/purchases', auth, inventoryController.getPurchaseRecords);

// 出库台账列表（须定义在 /:productId 之前）
router.get('/stock-out-records', auth, inventoryController.getStockOutRecords);

// 作废入库单（回退库存 + 原路退回）：仅管理员（S4）
router.post('/purchases/:purchaseId/void', auth, requireAdmin, inventoryController.voidPurchaseRecord);

// 获取库存列表
router.get('/', auth, inventoryController.getInventoryList);

// 入库操作
router.post('/in', auth, inventoryController.stockIn);

// 出库操作
router.post('/out', auth, inventoryController.stockOut);

// 获取单个商品库存详情
router.get('/:productId', auth, inventoryController.getInventoryByProductId);

module.exports = router;

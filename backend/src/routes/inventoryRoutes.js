const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');

// 获取库存列表
router.get('/', inventoryController.getInventoryList);

// 获取单个商品库存详情
router.get('/:productId', inventoryController.getInventoryByProductId);

// 入库操作
router.post('/in', inventoryController.stockIn);

// 出库操作
router.post('/out', inventoryController.stockOut);

module.exports = router;

const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');
const auth = require('../middleware/auth');

// 商品销售统计（需登录）
router.get('/product-sales', auth, statisticsController.getProductSales);
// 一键导出商品销售统计（需登录）
router.get('/product-sales/export', auth, statisticsController.exportProductSales);

module.exports = router;

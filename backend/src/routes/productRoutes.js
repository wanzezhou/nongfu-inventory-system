const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// 获取分类列表
router.get('/categories', productController.getCategoryList);

// 获取商品列表
router.get('/', productController.getProductList);

// 获取单个商品详情
router.get('/:id', productController.getProductById);

// 新增商品
router.post('/', productController.createProduct);

// 更新商品
router.put('/:id', productController.updateProduct);

// 删除商品（软删除）
router.delete('/:id', productController.deleteProduct);

module.exports = router;

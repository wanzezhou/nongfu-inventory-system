const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// 获取分类列表
router.get('/categories', productController.getCategoryList);

// 上传商品图片（具体路径必须注册在通配 /:id 之前，否则被吞）
router.post('/upload-image', productController.uploadProductImage, productController.handleUploadImage);

// 商品下拉选项（不分页全量；下拉/选项类数据专用，2026-09-18 代码审查 #1）
router.get('/options', productController.getProductOptions);

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

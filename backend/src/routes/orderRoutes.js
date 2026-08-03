const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// 获取订单列表
router.get('/', orderController.getOrderList);

// 获取订单详情
router.get('/:id', orderController.getOrderById);

// 创建订单
router.post('/', orderController.createOrder);

// 小程序创建订单（简化接口）
router.post('/mini', orderController.createMiniOrder);

// 小程序获取商品列表
router.get('/products/mini', orderController.getProductsForMini);

// 小程序获取员工列表（用于选择创建人）
router.get('/workers/mini', orderController.getWorkersForMini);

// 小程序获取水站列表（用于选择水站）
router.get('/stations/mini', orderController.getStationsForMini);

// 修改订单
router.put('/:id', orderController.updateOrder);

// 更新订单状态
router.put('/:id/status', orderController.updateOrderStatus);

// 取消订单（软删除）
router.delete('/:id', orderController.deleteOrder);

// 硬删除订单（物理删除）
router.delete('/:id/force', orderController.hardDeleteOrder);

module.exports = router;

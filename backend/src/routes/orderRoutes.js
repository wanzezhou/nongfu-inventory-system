const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// 获取订单列表
router.get('/', orderController.getOrderList);

// 获取订单详情
router.get('/:id', orderController.getOrderById);

// 创建订单
router.post('/', orderController.createOrder);

// 更新订单状态
router.put('/:id/status', orderController.updateOrderStatus);

// 取消订单（软删除）
router.delete('/:id', orderController.deleteOrder);

module.exports = router;

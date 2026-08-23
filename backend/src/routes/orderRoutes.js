const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// 获取订单列表
router.get('/', orderController.getOrderList);

// 获取订单详情
router.get('/:id', orderController.getOrderById);

// 创建订单
router.post('/', orderController.createOrder);

// 修改订单
router.put('/:id', orderController.updateOrder);

// 取消订单（设置 canceled_at 标志）
router.delete('/:id', orderController.deleteOrder);

// 硬删除订单（物理删除）
router.delete('/:id/force', orderController.hardDeleteOrder);

module.exports = router;

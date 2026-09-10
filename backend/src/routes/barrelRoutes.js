const express = require('express');
const router = express.Router();
const barrelController = require('../controllers/barrelController');
const auth = require('../middleware/auth');
const requireAdmin = auth.requireAdmin;

// 回桶管理（押金台账 + 桶型配置）：仅 admin

// 桶型配置
router.get('/configs', auth, requireAdmin, barrelController.listConfigs);
router.post('/configs', auth, requireAdmin, barrelController.createConfig);
router.put('/configs/:id', auth, requireAdmin, barrelController.updateConfig);
router.delete('/configs/:id', auth, requireAdmin, barrelController.deleteConfig);

// 押金流水与台账
router.get('/deposits', auth, requireAdmin, barrelController.getDepositList);
router.post('/deposits', auth, requireAdmin, barrelController.createDeposit);
// 具体路径 /summary 必须注册在通配 /deposits/:id 之前（本项目惯例）
router.get('/deposits/summary', auth, requireAdmin, barrelController.getSummary);

module.exports = router;

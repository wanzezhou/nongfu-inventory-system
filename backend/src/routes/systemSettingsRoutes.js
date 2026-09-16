const express = require('express');
const router = express.Router();
const systemSettingsController = require('../controllers/systemSettingsController');
const auth = require('../middleware/auth');

// 销售单打印店长（全系统唯一一位，打印预览「店长联系电话」用）
router.get('/print-manager', auth, systemSettingsController.getPrintManager);
router.put('/print-manager', auth, systemSettingsController.updatePrintManager);

module.exports = router;

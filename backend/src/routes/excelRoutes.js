const express = require('express');
const router = express.Router();
const excelController = require('../controllers/excelController');

// 导出数据
router.get('/:module/export', excelController.exportData);

// 下载导入模板
router.get('/:module/template', excelController.downloadTemplate);

// 导入数据
router.post('/:module/import', excelController.upload.single('file'), excelController.importData);

module.exports = router;

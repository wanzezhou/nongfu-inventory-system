const express = require('express');
const router = express.Router();
const incomeController = require('../controllers/incomeController');
const incomeIoController = require('../controllers/incomeIoController');
const auth = require('../middleware/auth');

// CRUD
// 权限与其他支出（/api/expenses）保持一致：仅需登录（auth），不额外要求管理员。
// ⚠️ 注意：具体路径（/categories、/template、/export、/import）必须定义在通配 '/:id' 之前，
//    否则会被当成 id 吃掉。
router.get('/', auth, incomeController.getIncomes);
router.get('/categories', auth, incomeController.getCategories);
router.post('/', auth, incomeController.createIncome);
router.put('/:id', auth, incomeController.updateIncome);
router.delete('/:id', auth, incomeController.deleteIncome);

// 模板 / 导入 / 导出
router.get('/template', auth, incomeIoController.downloadTemplate);
router.get('/export', auth, incomeIoController.exportIncomes);
router.post('/import', auth, incomeIoController.upload.single('file'), incomeIoController.importIncomes);

module.exports = router;

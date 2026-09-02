const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const expenseIoController = require('../controllers/expenseIoController');
const auth = require('../middleware/auth');

// CRUD
router.get('/', auth, expenseController.getExpenses);
router.get('/categories', auth, expenseController.getCategories);
router.post('/', auth, expenseController.createExpense);
router.put('/:id', auth, expenseController.updateExpense);
router.delete('/:id', auth, expenseController.deleteExpense);

// 模板 / 导入 / 导出
router.get('/template', auth, expenseIoController.downloadTemplate);
router.get('/export', auth, expenseIoController.exportExpenses);
router.post('/import', auth, expenseIoController.upload.single('file'), expenseIoController.importExpenses);

module.exports = router;

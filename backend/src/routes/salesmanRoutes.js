const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const salesmanController = require('../controllers/salesmanController');

router.get('/all', auth, salesmanController.getAllSalesmen);
router.get('/', auth, salesmanController.getSalesmanList);
router.get('/:id', auth, salesmanController.getSalesmanById);
router.post('/', auth, salesmanController.createSalesman);
router.put('/:id', auth, salesmanController.updateSalesman);
router.delete('/:id', auth, salesmanController.deleteSalesman);

module.exports = router;

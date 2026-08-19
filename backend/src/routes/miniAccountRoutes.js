const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const miniAccountController = require('../controllers/miniAccountController');

router.get('/entities', auth, miniAccountController.getEntityOptions);
router.get('/', auth, miniAccountController.getMiniAccountList);
router.post('/', auth, miniAccountController.createMiniAccount);
router.put('/:id', auth, miniAccountController.updateMiniAccount);
router.delete('/:id', auth, miniAccountController.deleteMiniAccount);
router.put('/:id/toggle', auth, miniAccountController.toggleMiniAccount);

module.exports = router;

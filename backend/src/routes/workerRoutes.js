const express = require('express');
const router = express.Router();
const workerController = require('../controllers/workerController');

router.get('/all', workerController.getAllWorkers);
router.get('/', workerController.getWorkerList);
router.get('/:id', workerController.getWorkerById);
router.post('/', workerController.createWorker);
router.put('/:id', workerController.updateWorker);
router.delete('/:id', workerController.deleteWorker);

module.exports = router;

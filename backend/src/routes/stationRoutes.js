const express = require('express');
const router = express.Router();
const stationController = require('../controllers/stationController');

// 水站下拉选项（不分页全量；须定义在通配 /:id 之前，否则被吞）
router.get('/all', stationController.getAllStations);

// 获取水站列表
router.get('/', stationController.getStationList);

// 获取单个水站详情
router.get('/:id', stationController.getStationById);

// 新增水站
router.post('/', stationController.createStation);

// 更新水站
router.put('/:id', stationController.updateStation);

// 删除水站（软删除）
router.delete('/:id', stationController.deleteStation);

module.exports = router;

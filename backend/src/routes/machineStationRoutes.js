const express = require('express');
const router = express.Router();
const machineStationController = require('../controllers/machineStationController');

// 机台下拉选项（不分页全量；须定义在通配 /:id 之前，否则被吞）
router.get('/all', machineStationController.getAllMachineStations);

// 获取机台列表（可按 ?type=1 量贩机 / ?type=2 零售机 筛选）
router.get('/', machineStationController.getMachineStationList);

// 获取单个机台详情
router.get('/:id', machineStationController.getMachineStationById);

// 新增机台
router.post('/', machineStationController.createMachineStation);

// 更新机台
router.put('/:id', machineStationController.updateMachineStation);

// 删除机台（软删除）
router.delete('/:id', machineStationController.deleteMachineStation);

module.exports = router;

const express = require('express');
const router = express.Router();
const profitController = require('../controllers/profitController');
const auth = require('../middleware/auth');

// 利润总览（全部类型横向对比）
// ⚠️ 具体路径必须在通配之前
router.get('/overview', auth, profitController.getProfitOverview);

// 单类型利润（orderType=1..6；2=直营水站拆利润1/利润2；4/6=机台）
router.get('/by-type', auth, profitController.getProfitByType);

module.exports = router;

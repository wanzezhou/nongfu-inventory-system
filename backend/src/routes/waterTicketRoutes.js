const express = require('express');
const router = express.Router();
const waterTicketController = require('../controllers/waterTicketController');
const auth = require('../middleware/auth');

// 水站返货管理（水票系统）
router.post('/issue', auth, waterTicketController.issueTickets);              // 返货清单录入/发行
router.get('/inventory', auth, waterTicketController.getTicketInventory);      // 水票库存（按水站+商品）
router.get('/list', auth, waterTicketController.getTicketList);                // 水票明细（分页）
router.post('/:id/cancel', auth, waterTicketController.cancelTicket);          // 作废水票
router.get('/issuances', auth, waterTicketController.getIssuanceList);         // 发行记录（返货清单，分页）
router.put('/issuances/:id', auth, waterTicketController.updateIssuance);       // 编辑发行记录（管理员）
router.post('/adjust-balance', auth, waterTicketController.adjustBalance);      // 水站账户调整（管理员）
router.post('/adjust-delivery-fee', auth, waterTicketController.adjustDeliveryFee); // 分销配送费余额调整（管理员）
router.post('/adjust-station-delivery-fee', auth, waterTicketController.adjustStationDeliveryFee); // 水站级分销配送费调整（管理员）
router.delete('/issuances/batch/:batchId', auth, waterTicketController.deleteIssuanceBatch);   // 删除发行批次（管理员）

module.exports = router;

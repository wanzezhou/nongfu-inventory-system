/**
 * 回桶管理控制器（仅 admin）
 * 逻辑均在 barrelService，controller 只做参数透传与响应包装
 */
const barrelService = require('../services/barrelService');

// 收取/退回押金登记
async function createDeposit(req, res) {
  const { depositType, partyType, stationId, customerName, customerPhone, barrelType, quantity, unitPrice, accountId, remark } = req.body || {};
  const operator = (req.user && (req.user.username || req.user.id)) || null;
  const result = await barrelService.createDeposit({
    depositType,
    partyType: partyType || 'station',
    stationId,
    customerName,
    customerPhone,
    barrelType,
    quantity,
    unitPrice,
    accountId,
    remark,
    operator
  });
  if (result.code !== 200) return res.status(result.code === 500 ? 500 : 400).json({ code: result.code === 500 ? 500 : 400, message: result.message, data: null });
  return res.json({ code: 200, message: result.message, data: result.data });
}

// 押金流水列表（分页）
async function getDepositList(req, res) {
  const { page, pageSize, partyType, stationId, customerName, barrelType, startDate, endDate } = req.query;
  const data = await barrelService.getDepositList({ page, pageSize, partyType, stationId, customerName, barrelType, startDate, endDate });
  return res.json({ code: 200, message: 'success', data });
}

// 押金台账汇总
async function getSummary(req, res) {
  const { partyType, stationId, customerName, barrelType } = req.query;
  const list = await barrelService.getSummary({ partyType, stationId, customerName, barrelType });
  return res.json({ code: 200, message: 'success', data: { list } });
}

// 桶型配置列表
async function listConfigs(req, res) {
  const list = await barrelService.listConfigs();
  return res.json({ code: 200, message: 'success', data: { list } });
}

// 新增桶型配置
async function createConfig(req, res) {
  const { barrelType, depositPrice, sortOrder } = req.body || {};
  const result = await barrelService.createConfig({ barrelType, depositPrice, sortOrder });
  if (result.code !== 200) return res.status(400).json({ code: 400, message: result.message, data: null });
  return res.json({ code: 200, message: result.message, data: null });
}

// 更新桶型配置
async function updateConfig(req, res) {
  const { barrelType, depositPrice, status, sortOrder } = req.body || {};
  const result = await barrelService.updateConfig(req.params.id, { barrelType, depositPrice, status, sortOrder });
  if (result.code !== 200) return res.status(result.code === 404 ? 404 : 400).json({ code: result.code === 404 ? 404 : 400, message: result.message, data: null });
  return res.json({ code: 200, message: result.message, data: null });
}

// 删除桶型配置
async function deleteConfig(req, res) {
  const result = await barrelService.deleteConfig(req.params.id);
  if (result.code !== 200) return res.status(result.code === 404 ? 404 : 400).json({ code: result.code === 404 ? 404 : 400, message: result.message, data: null });
  return res.json({ code: 200, message: result.message, data: null });
}

module.exports = {
  createDeposit,
  getDepositList,
  getSummary,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig
};

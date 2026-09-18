/**
 * 回桶管理控制器（仅 admin）
 * 逻辑均在 barrelService，controller 只做参数透传与响应包装
 */
const barrelService = require('../services/barrelService');
// R7：统一走 utils/response.js 出口，不再手拼响应信封
// （2026-09-18：原实现逐处内联 res.status(...).json({code,message,data:null})，
//   同一个「失败该返 400 还是 500」的判断被复制了 4 遍 —— 第二套响应语义的来源）
const { success, error } = require('../utils/response');

// 收取/退回押金登记
async function createDeposit(req, res) {
  const {
    depositType,
    partyType,
    stationId,
    customerName,
    customerPhone,
    barrelType,
    quantity,
    unitPrice,
    accountId,
    remark
  } = req.body || {};
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
  // hazard-allow: 服务层业务文案（设计输出，非内部错误细节）
  if (result.code !== 200) return error(res, result.message, result.code === 500 ? 500 : 400); // hazard-allow: 服务层业务文案（设计输出，非内部细节）
  return success(res, result.data, result.message);
}

// 押金流水列表（分页）
async function getDepositList(req, res) {
  const { page, pageSize, partyType, stationId, customerName, barrelType, startDate, endDate } = req.query;
  const data = await barrelService.getDepositList({
    page,
    pageSize,
    partyType,
    stationId,
    customerName,
    barrelType,
    startDate,
    endDate
  });
  return success(res, data);
}

// 押金台账汇总
async function getSummary(req, res) {
  const { partyType, stationId, customerName, barrelType } = req.query;
  const list = await barrelService.getSummary({ partyType, stationId, customerName, barrelType });
  return success(res, { list });
}

// 桶型配置列表
async function listConfigs(req, res) {
  const list = await barrelService.listConfigs();
  return success(res, { list });
}

// 新增桶型配置
async function createConfig(req, res) {
  const { barrelType, depositPrice, sortOrder } = req.body || {};
  const result = await barrelService.createConfig({ barrelType, depositPrice, sortOrder });
  // hazard-allow: 服务层业务文案（设计输出，非内部错误细节）
  if (result.code !== 200) return error(res, result.message, 400);
  return success(res, null, result.message);
}

// 更新桶型配置
async function updateConfig(req, res) {
  const { barrelType, depositPrice, status, sortOrder } = req.body || {};
  const result = await barrelService.updateConfig(req.params.id, { barrelType, depositPrice, status, sortOrder });
  // hazard-allow: 服务层业务文案（设计输出，非内部错误细节）
  if (result.code !== 200) return error(res, result.message, result.code === 404 ? 404 : 400);
  return success(res, null, result.message);
}

// 删除桶型配置
async function deleteConfig(req, res) {
  const result = await barrelService.deleteConfig(req.params.id);
  // hazard-allow: 服务层业务文案（设计输出，非内部错误细节）
  if (result.code !== 200) return error(res, result.message, result.code === 404 ? 404 : 400);
  return success(res, null, result.message);
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

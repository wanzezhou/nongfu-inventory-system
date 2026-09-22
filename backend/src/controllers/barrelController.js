/**
 * 回桶管理控制器（仅 admin）
 * 逻辑均在 barrelService，controller 只做参数透传与响应包装
 */
const { pool } = require('../config/db');
const barrelService = require('../services/barrelService');
// R7：统一走 utils/response.js 出口，不再手拼响应信封
// （2026-09-18：原实现逐处内联 res.status(...).json({code,message,data:null})，
//   同一个「失败该返 400 还是 500」的判断被复制了 4 遍 —— 第二套响应语义的来源）
const { success, error } = require('../utils/response');

// 收取/退回押金登记（资金动作）
// ⚠️ 事务边界在**控制器**：事务体在 barrelService（Web 与小程序管理端共用同一段），
//    这样调用方才能把幂等键与审计并进同一个事务（定式 ⑥「审计与业务同事务」）。
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await barrelService.createDeposit(conn, {
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
    await conn.commit();
    return success(res, data, data.message);
  } catch (e) {
    await conn.rollback();
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('createDeposit error:', e);
    return error(res, '押金登记失败', 500);
  } finally {
    conn.release();
  }
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

// 新增桶型配置（配置类写操作：同样带事务边界，便于小程序侧并进幂等/审计）
async function createConfig(req, res) {
  const { barrelType, depositPrice, sortOrder } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await barrelService.createConfig(conn, { barrelType, depositPrice, sortOrder });
    await conn.commit();
    return success(res, data, '新增成功');
  } catch (e) {
    await conn.rollback();
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('createConfig error:', e);
    return error(res, '新增失败', 500);
  } finally {
    conn.release();
  }
}

// 更新桶型配置
async function updateConfig(req, res) {
  const { barrelType, depositPrice, status, sortOrder } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await barrelService.updateConfig(conn, req.params.id, { barrelType, depositPrice, status, sortOrder });
    await conn.commit();
    return success(res, data, '更新成功');
  } catch (e) {
    await conn.rollback();
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('updateConfig error:', e);
    return error(res, '更新失败', 500);
  } finally {
    conn.release();
  }
}

// 删除桶型配置（有押金流水的不许删 —— 判据在服务层）
async function deleteConfig(req, res) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await barrelService.deleteConfig(conn, req.params.id);
    await conn.commit();
    return success(res, data, '删除成功');
  } catch (e) {
    await conn.rollback();
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('deleteConfig error:', e);
    return error(res, '删除失败', 500);
  } finally {
    conn.release();
  }
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

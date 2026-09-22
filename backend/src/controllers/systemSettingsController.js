// 系统配置接口（2026-09-16）
// 当前仅暴露「销售单打印店长」一项；后续新增配置项时按同样形式追加。
// ⚠️ 员工校验与写入都在 services/systemSettings（Web 与小程序管理端共用同一套规则）
const { success, error } = require('../utils/response');
const { resolvePrintManager, setPrintManager } = require('../services/systemSettings');

/**
 * 销售单打印店长（当前生效值 + 来源）
 * GET /api/system-settings/print-manager
 */
async function getPrintManager(req, res) {
  try {
    const manager = await resolvePrintManager();
    return success(res, manager);
  } catch (e) {
    console.error('getPrintManager error:', e);
    return error(res, '获取打印店长配置失败', 500);
  }
}

/**
 * 设置销售单打印店长
 * PUT /api/system-settings/print-manager  body: { workerId }
 *   workerId 传 null / '' 表示清空，回退为「第一位启用的店长」
 */
async function updatePrintManager(req, res) {
  try {
    const raw = req.body.workerId !== undefined ? req.body.workerId : req.body.worker_id;
    if (raw === undefined) {
      return error(res, '员工ID不能为空', 400);
    }
    const cleared = raw === null || raw === '';
    // 校验与写入都在服务层（Web 与小程序共用同一套规则，见 services/systemSettings.setPrintManager）
    const manager = await setPrintManager(cleared ? null : String(raw));
    return success(res, manager, cleared ? '已清除设置，回退为第一位启用的店长' : '销售单打印店长已更新');
  } catch (e) {
    // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    if (e.business) return error(res, e.message, e.status || 400); // hazard-allow: bizFail 业务校验文案（设计输出，非内部细节）
    console.error('updatePrintManager error:', e);
    return error(res, '保存打印店长配置失败', 500);
  }
}

module.exports = {
  getPrintManager,
  updatePrintManager
};

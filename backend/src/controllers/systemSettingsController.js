// 系统配置接口（2026-09-16）
// 当前仅暴露「销售单打印店长」一项；后续新增配置项时按同样形式追加。
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const {
  PRINT_MANAGER_KEY,
  PRINT_MANAGER_REMARK,
  setSetting,
  resolvePrintManager
} = require('../services/systemSettings');

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

    if (raw === null || raw === '') {
      await setSetting(PRINT_MANAGER_KEY, null, PRINT_MANAGER_REMARK);
      const manager = await resolvePrintManager();
      return success(res, manager, '已清除设置，回退为第一位启用的店长');
    }

    const workerId = String(raw);
    const [rows] = await pool.execute(
      'SELECT worker_id, worker_name, status FROM workers WHERE worker_id = ?',
      [workerId]
    );
    if (rows.length === 0) {
      return error(res, '员工不存在', 400);
    }
    if (Number(rows[0].status) !== 1) {
      return error(res, '该员工已离职（停用），请选择在职员工', 400);
    }

    await setSetting(PRINT_MANAGER_KEY, workerId, PRINT_MANAGER_REMARK);
    const manager = await resolvePrintManager();
    return success(res, manager, '销售单打印店长已更新');
  } catch (e) {
    console.error('updatePrintManager error:', e);
    return error(res, '保存打印店长配置失败', 500);
  }
}

module.exports = {
  getPrintManager,
  updatePrintManager
};

// 系统配置（键值对）读写 + 业务侧解析 —— 单源（2026-09-16）
// ---------------------------------------------------------------------------
// 表：system_settings(setting_key PK, setting_value, remark, updated_at)
// 设计：只存「全系统唯一」的少量业务配置，避免为每个开关建专表。
//
// 当前使用方：
//   print_manager_worker_id —— 销售单打印的「店长联系电话」使用的员工。
//     业务口径（2026-09-16 确认）：**所有订单类型都打印同一位店长的电话**，
//     与订单类型 / 水站 / 机台无关。
//     配置为空或指向的员工已不存在时，回退为「第一位启用的店长」，保证打印不空。
// ---------------------------------------------------------------------------
const { pool } = require('../config/db');

const PRINT_MANAGER_KEY = 'print_manager_worker_id';
const PRINT_MANAGER_REMARK = '销售单打印「店长联系电话」使用的员工ID；为空时回退为第一位启用的店长';

/** 读配置（无则返回 null） */
async function getSetting(key) {
  const [rows] = await pool.execute(
    'SELECT setting_value FROM system_settings WHERE setting_key = ?',
    [key]
  );
  return rows.length ? rows[0].setting_value : null;
}

/** 写配置（键不存在则插入；value 传 null 表示清空） */
async function setSetting(key, value, remark) {
  await pool.execute(
    `INSERT INTO system_settings (setting_key, setting_value, remark)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), remark = VALUES(remark)`,
    [key, value === undefined ? null : value, remark || null]
  );
}

/**
 * 解析销售单打印使用的店长
 * @returns {Promise<{workerId:string|null, workerName:string, phone:string, source:'setting'|'fallback'|'none'}>}
 *   source: setting=取自配置 / fallback=配置缺失或失效后回退 / none=系统内无可用店长
 */
async function resolvePrintManager() {
  const configured = await getSetting(PRINT_MANAGER_KEY);
  if (configured) {
    const [rows] = await pool.execute(
      'SELECT worker_id, worker_name, phone FROM workers WHERE worker_id = ?',
      [configured]
    );
    if (rows.length) {
      return {
        workerId: rows[0].worker_id,
        workerName: rows[0].worker_name || '',
        phone: rows[0].phone || '',
        source: 'setting'
      };
    }
  }

  // 回退：启用状态的第一位店长（worker_id 升序，结果稳定可预期）
  const [fallback] = await pool.execute(
    `SELECT worker_id, worker_name, phone FROM workers
     WHERE employee_type = 1 AND status = 1
     ORDER BY worker_id ASC LIMIT 1`
  );
  if (fallback.length) {
    return {
      workerId: fallback[0].worker_id,
      workerName: fallback[0].worker_name || '',
      phone: fallback[0].phone || '',
      source: 'fallback'
    };
  }

  return { workerId: null, workerName: '', phone: '', source: 'none' };
}

module.exports = {
  PRINT_MANAGER_KEY,
  PRINT_MANAGER_REMARK,
  getSetting,
  setSetting,
  resolvePrintManager
};

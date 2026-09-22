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

/** 业务校验失败（`e.business = true`）—— 项目既有约定（同 salaryLedger.bizFail） */
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

/** 读配置（无则返回 null） */
async function getSetting(key, conn = pool) {
  const [rows] = await conn.execute('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
  return rows.length ? rows[0].setting_value : null;
}

/** 写配置（键不存在则插入；value 传 null 表示清空） */
async function setSetting(key, value, remark, conn = pool) {
  await conn.execute(
    `INSERT INTO system_settings (setting_key, setting_value, remark)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), remark = VALUES(remark)`,
    [key, value === undefined ? null : value, remark || null]
  );
}

/**
 * 解析销售单打印使用的店长
 * @returns {Promise<{workerId:string|null, workerName:string, phone:string, workerStatus:number|null, source:'setting'|'fallback'|'none'}>}
 *   source: setting=取自配置 / fallback=配置缺失或失效后回退 / none=系统内无可用店长
 *   workerStatus: 该员工状态（1 在职 / 0 离职）。配置指向的员工即便已离职也照用（不静默换人），
 *                 仅把状态透出给前端提示，避免「打了离职员工的电话」这种情况悄无声息。
 */
async function resolvePrintManager(conn = pool) {
  // ⚠️ 必须支持传入事务连接：小程序侧在**同一事务内**写入后再读回当前值，
  //    若这里固定用 pool，会读不到尚未提交的那次写入 —— 表现为「设置成功但来源仍是回退」
  //    （实测踩到：断言 source 期望 setting、实得 fallback）。
  const configured = await getSetting(PRINT_MANAGER_KEY, conn);
  if (configured) {
    const [rows] = await conn.execute('SELECT worker_id, worker_name, phone, status FROM workers WHERE worker_id = ?', [
      configured
    ]);
    if (rows.length) {
      return {
        workerId: rows[0].worker_id,
        workerName: rows[0].worker_name || '',
        phone: rows[0].phone || '',
        workerStatus: Number(rows[0].status),
        source: 'setting'
      };
    }
  }

  // 回退：启用状态的第一位店长（worker_id 升序，结果稳定可预期）
  const [fallback] = await conn.execute(
    `SELECT worker_id, worker_name, phone FROM workers
     WHERE employee_type = 1 AND status = 1
     ORDER BY worker_id ASC LIMIT 1`
  );
  if (fallback.length) {
    return {
      workerId: fallback[0].worker_id,
      workerName: fallback[0].worker_name || '',
      phone: fallback[0].phone || '',
      workerStatus: 1,
      source: 'fallback'
    };
  }

  return { workerId: null, workerName: '', phone: '', workerStatus: null, source: 'none' };
}

/**
 * 设置销售单打印店长（Web 与小程序管理端**共用同一套校验**）
 * ⚠️ 校验必须单源：员工必须**存在**且**在职** —— 否则打印出来的联系电话可能是离职人员，
 *    而这种事在打印结果上完全看不出来（只会打出一个打不通的号码）。
 *    传 null / '' 表示清空 → 回退为「第一位启用的店长」。
 * @param {string|null} workerId
 * @param {object} [conn] 事务连接（小程序侧要把它并进幂等/审计同一事务）
 * @returns {Promise<object>} resolvePrintManager() 结果（当前生效值）
 */
async function setPrintManager(workerId, conn = pool) {
  if (workerId === null || workerId === undefined || workerId === '') {
    await setSetting(PRINT_MANAGER_KEY, null, PRINT_MANAGER_REMARK, conn);
    return resolvePrintManager(conn);
  }
  const id = String(workerId);
  const [rows] = await conn.execute('SELECT worker_id, worker_name, status FROM workers WHERE worker_id = ?', [id]);
  if (!rows.length) throw bizFail('员工不存在');
  if (Number(rows[0].status) !== 1) throw bizFail('该员工已离职（停用），请选择在职员工');
  await setSetting(PRINT_MANAGER_KEY, id, PRINT_MANAGER_REMARK, conn);
  return resolvePrintManager(conn);
}

module.exports = {
  PRINT_MANAGER_KEY,
  PRINT_MANAGER_REMARK,
  getSetting,
  setSetting,
  resolvePrintManager,
  setPrintManager
};

// 幂等迁移：新增系统配置表 system_settings（2026-09-16）
//
// 变更：
//   1) 建表 system_settings（键值对，与 barrels 等业务表无关，通用配置）
//   2) 预置 print_manager_worker_id = W001（销售单打印店长；已存在则不覆盖已有值）
//
// 幂等：CREATE TABLE IF NOT EXISTS + 仅当键不存在时插入（不覆盖用户已改过的值）
// 执行：cd backend && node scripts/migrate_add_system_settings.js
//
// ⚠️ 涉生产库 DDL —— 执行前应先 mysqldump 全量备份并确认体积非 0（项目规范）。
const mysql = require('mysql2/promise');
require('dotenv').config();

const DEFAULT_MANAGER = 'W001';
const REMARK = '销售单打印「店长联系电话」使用的员工ID；为空时回退为第一位启用的店长';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4'
  });

  const conn = await pool.getConnection();
  try {
    // 1) 建表
    const [before] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'system_settings'`
    );
    if (before.length) {
      console.log('[跳过] system_settings 已存在');
    } else {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`system_settings\` (
          \`setting_key\`   varchar(64)  NOT NULL COMMENT '配置键',
          \`setting_value\` varchar(500) DEFAULT NULL COMMENT '配置值（统一存字符串）',
          \`remark\`        varchar(200) DEFAULT NULL COMMENT '配置说明',
          \`updated_at\`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
          PRIMARY KEY (\`setting_key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置（键值对）'`);
      console.log('已创建 system_settings');
    }

    // 2) 预置打印店长：仅当键不存在时写入，不覆盖已有值
    const [exist] = await conn.query(
      `SELECT setting_key, setting_value FROM system_settings WHERE setting_key = 'print_manager_worker_id'`
    );
    if (exist.length) {
      console.log(`[跳过] print_manager_worker_id 已存在 = ${exist[0].setting_value}`);
    } else {
      // 默认取「启用状态的第一位店长」，取不到才落空（功能侧有回退逻辑）
      const [mgr] = await conn.query(
        `SELECT worker_id, worker_name, phone FROM workers
         WHERE employee_type = 1 AND status = 1
         ORDER BY worker_id ASC LIMIT 1`
      );
      const value = mgr.length ? mgr[0].worker_id : DEFAULT_MANAGER;
      await conn.query(
        `INSERT INTO system_settings (setting_key, setting_value, remark) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE remark = VALUES(remark)`,
        ['print_manager_worker_id', value, REMARK]
      );
      console.log(`已预置 print_manager_worker_id = ${value}${mgr.length ? `（${mgr[0].worker_name} / ${mgr[0].phone}）` : ''}`);
    }

    // 3) 核对
    const [rows] = await conn.query(
      `SELECT s.setting_key, s.setting_value, s.remark, w.worker_name, w.phone, w.employee_type, w.status
       FROM system_settings s
       LEFT JOIN workers w ON w.worker_id = s.setting_value
       WHERE s.setting_key = 'print_manager_worker_id'`
    );
    console.log('\n核对:');
    rows.forEach((r) => console.log(
      `  ${r.setting_key} = ${r.setting_value} → ${r.worker_name || '(员工不存在)'} / ${r.phone || '-'} (type=${r.employee_type ?? '-'}, status=${r.status ?? '-'})`
    ));
    const [cnt] = await conn.query(`SELECT COUNT(*) AS n FROM system_settings`);
    console.log(`  system_settings 行数 = ${cnt[0].n}`);

    const ok = rows.length === 1 && !!rows[0].worker_name;
    console.log(ok ? '\n核对通过 ✓' : '\n核对失败 ✗（配置指向的员工不存在，请手动修正）');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error('迁移失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('迁移异常: ' + e.message);
  process.exit(1);
});

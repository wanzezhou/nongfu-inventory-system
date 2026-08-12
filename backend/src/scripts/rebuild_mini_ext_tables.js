// 幂等重建 barrel_deposits / reimbursements 表为 Mini 程序所需结构
// 说明：旧表为 PC 预留结构且当前为空、无任何代码引用，直接重建以保证字段与
//       mini 控制器 / 前端页面一致（spec 设计：depositType collect/return、status 0/2/3）
const mysql = require('mysql2/promise');
require('dotenv').config();

const DDL = {
  barrel_deposits: {
    marker: 'deposit_type', // 判断旧结构的关键列
    sql: `CREATE TABLE IF NOT EXISTS barrel_deposits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      deposit_no VARCHAR(64) DEFAULT NULL,
      station_id VARCHAR(64) DEFAULT NULL,
      barrel_type VARCHAR(50) DEFAULT NULL,
      quantity INT NOT NULL DEFAULT 0,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      deposit_type VARCHAR(20) NOT NULL DEFAULT 'collect' COMMENT 'collect=收取押金, return=退回押金',
      handler_id VARCHAR(64) DEFAULT NULL,
      remark VARCHAR(500) DEFAULT NULL,
      created_at DATETIME DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL,
      KEY idx_station (station_id),
      KEY idx_handler (handler_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  },
  reimbursements: {
    marker: 'applicant_id',
    sql: `CREATE TABLE IF NOT EXISTS reimbursements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      applicant_id VARCHAR(64) DEFAULT NULL,
      type VARCHAR(50) DEFAULT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      description VARCHAR(500) DEFAULT NULL,
      remark VARCHAR(500) DEFAULT NULL,
      status TINYINT NOT NULL DEFAULT 0 COMMENT '0=待审核, 2=已通过, 3=已拒绝',
      approved_amount DECIMAL(12,2) DEFAULT NULL,
      approved_at DATETIME DEFAULT NULL,
      created_at DATETIME DEFAULT NULL,
      updated_at DATETIME DEFAULT NULL,
      KEY idx_applicant (applicant_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  }
};

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].c > 0;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    multipleStatements: true
  });

  for (const [table, cfg] of Object.entries(DDL)) {
    const exists = await tableExists(pool, table);
    if (exists) {
      const hasMarker = await columnExists(pool, table, cfg.marker);
      if (hasMarker) {
        console.log(`${table}: 已是新结构，跳过`);
        continue;
      }
      console.log(`${table}: 旧结构，重建`);
      await pool.query(`DROP TABLE IF EXISTS ${table}`);
    } else {
      console.log(`${table}: 不存在，新建`);
    }
    await pool.query(cfg.sql);
    console.log(`${table}: 已创建`);
  }

  await pool.end();
  console.log('迁移完成');
}

main().catch(e => { console.error('迁移失败: ' + e.message); process.exit(1); });

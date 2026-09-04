// 幂等迁移：workers 表新增 employee_type 列
// 1=店长 2=配送员工 3=业务员（默认 2）
const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory'
  });

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND COLUMN_NAME = 'employee_type'`
  );
  if (rows[0].c > 0) {
    console.log('workers.employee_type 已存在，跳过');
  } else {
    await pool.query(
      `ALTER TABLE workers
       ADD COLUMN employee_type TINYINT NOT NULL DEFAULT 2 COMMENT '员工类型: 1=店长 2=配送员工 3=业务员' AFTER phone`
    );
    console.log('workers.employee_type 已添加');
  }

  await pool.end();
}

main().catch(e => { console.error('迁移失败: ' + e.message); process.exit(1); });

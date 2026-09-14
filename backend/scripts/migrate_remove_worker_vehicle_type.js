// 幂等迁移：移除 workers.vehicle_type（配送车辆类型）列及 idx_vehicle_type 索引
// 背景：业务方确认不再需要「配送车辆」维度；该字段仅用于员工表单/列表/筛选与 Excel 导入模板，
//      无任何业务逻辑依赖（工资、订单、水票均不读取），数据库层无触发器/视图引用。
// 幂等：通过 information_schema 判断列/索引是否存在，可重复执行。
// 执行：cd backend && node scripts/migrate_remove_worker_vehicle_type.js
const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4'
  });

  // 1) 删除索引 idx_vehicle_type（若存在）
  const [idxRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND INDEX_NAME = 'idx_vehicle_type'`
  );
  if (idxRows[0].c > 0) {
    await pool.query('ALTER TABLE workers DROP INDEX idx_vehicle_type');
    console.log('已删除索引 idx_vehicle_type');
  } else {
    console.log('索引 idx_vehicle_type 不存在，跳过');
  }

  // 2) 删除列 vehicle_type（若存在）
  const [colRows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND COLUMN_NAME = 'vehicle_type'`
  );
  if (colRows[0].c > 0) {
    await pool.query('ALTER TABLE workers DROP COLUMN vehicle_type');
    console.log('已删除列 workers.vehicle_type');
  } else {
    console.log('列 workers.vehicle_type 不存在，跳过');
  }

  // 3) 核对
  const [check] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND COLUMN_NAME = 'vehicle_type'`
  );
  console.log('核对：workers 中 vehicle_type 剩余列数 = ' + check[0].c + (check[0].c === 0 ? ' ✓' : ' ✗'));

  // 4) 打印 workers 现有列，便于人工比对
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers'
     ORDER BY ORDINAL_POSITION`
  );
  console.log('\nworkers 现有列：');
  cols.forEach((c) => {
    console.log(`  ${c.COLUMN_NAME.padEnd(18)} ${String(c.COLUMN_TYPE).padEnd(22)} null=${c.IS_NULLABLE} default=${c.COLUMN_DEFAULT === null ? 'NULL' : c.COLUMN_DEFAULT}`);
  });

  await pool.end();
}

main().catch((e) => {
  console.error('迁移失败: ' + e.message);
  process.exit(1);
});

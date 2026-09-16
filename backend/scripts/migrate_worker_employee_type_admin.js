// 幂等迁移：员工类型新增「管理员」（2026-09-16）
//
// 变更：`workers.employee_type` 列注释更新为 1=店长 2=配送员工 3=业务员 4=管理员。
//       TINYINT 本身可存 4，本次不动类型/默认值，属「注释同步」型 DDL。
//
// 幂等：先读 information_schema 的 COLUMN_COMMENT，已含「4=管理员」则跳过。
// 执行：cd backend && node scripts/migrate_worker_employee_type_admin.js
//
// ⚠️ 涉生产库 DDL —— 执行前应先 mysqldump 全量备份并确认体积非 0（项目规范）。
const mysql = require('mysql2/promise');
require('dotenv').config();

const NEW_COMMENT = '员工类型: 1=店长 2=配送员工 3=业务员 4=管理员';

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
    // 1) 现状
    const [before] = await conn.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND COLUMN_NAME = 'employee_type'`
    );
    if (before.length === 0) {
      throw new Error('未找到 workers.employee_type —— 请确认连接的库是否正确');
    }
    console.log('迁移前:');
    console.log(`  COLUMN_TYPE   = ${before[0].COLUMN_TYPE}`);
    console.log(`  IS_NULLABLE   = ${before[0].IS_NULLABLE}`);
    console.log(`  COLUMN_DEFAULT= ${before[0].COLUMN_DEFAULT}`);
    console.log(`  COLUMN_COMMENT= ${before[0].COLUMN_COMMENT}`);

    if (String(before[0].COLUMN_COMMENT).includes('4=管理员')) {
      console.log('\n[跳过] 注释已包含「4=管理员」，判定为已迁移。');
    } else {
      await conn.query(
        `ALTER TABLE \`workers\`
           MODIFY COLUMN \`employee_type\` TINYINT NOT NULL DEFAULT 2
           COMMENT '${NEW_COMMENT}'`
      );
      console.log('\n已更新列注释。');
    }

    // 2) 迁移后核对
    const [after] = await conn.query(
      `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workers' AND COLUMN_NAME = 'employee_type'`
    );
    console.log('迁移后:');
    console.log(`  COLUMN_TYPE   = ${after[0].COLUMN_TYPE}`);
    console.log(`  IS_NULLABLE   = ${after[0].IS_NULLABLE}`);
    console.log(`  COLUMN_DEFAULT= ${after[0].COLUMN_DEFAULT}`);
    console.log(`  COLUMN_COMMENT= ${after[0].COLUMN_COMMENT}`);

    const ok = after[0].COLUMN_COMMENT === NEW_COMMENT
      && after[0].COLUMN_TYPE === before[0].COLUMN_TYPE
      && after[0].COLUMN_DEFAULT === before[0].COLUMN_DEFAULT;
    console.log(ok ? '\n核对通过 ✓（类型/默认值未变，注释已更新）' : '\n核对失败 ✗');

    // 3) 现有数据分布（不修改，仅便于判断是否已有 4）
    const [dist] = await conn.query(
      `SELECT employee_type, COUNT(*) AS cnt FROM workers GROUP BY employee_type ORDER BY employee_type`
    );
    console.log('\n当前 employee_type 分布:');
    dist.forEach((r) => console.log(`  ${r.employee_type} → ${r.cnt} 人`));

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

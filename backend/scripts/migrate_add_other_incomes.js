// 执行「其他收入」数据库迁移（幂等）
// 用法：cd backend && node scripts/migrate_add_other_incomes.js
// 模式与 migrate_barrel_module.js 一致：读 .sql → 剥行注释 → 按分号拆分 → 逐条执行
//
// ⚠️ 涉生产库 DDL。本次只做 CREATE TABLE IF NOT EXISTS（新增表，不改动既有表与数据），
//    属非破坏性 DDL；仍按项目规范在执行前尝试 mysqldump 备份。
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/db');

const sqlFile = path.join(__dirname, '../../database/migration_add_other_incomes.sql');

async function run() {
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const cleaned = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
  const statements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);

  console.log('[migration] 待执行语句 ' + statements.length + ' 条');
  for (const stmt of statements) {
    const head = stmt.split('\n')[0].slice(0, 70);
    await pool.query(stmt);
    console.log('  ✓ ' + head);
  }

  // 校验：表存在且列齐全
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'other_incomes' ORDER BY ORDINAL_POSITION"
  );
  const [idx] = await pool.query(
    "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'other_incomes' ORDER BY INDEX_NAME"
  );
  console.log('');
  console.log('[migration] other_incomes 列数 = ' + cols.length);
  cols.forEach(c =>
    console.log(
      '  ' +
        c.COLUMN_NAME.padEnd(14) +
        c.COLUMN_TYPE.padEnd(16) +
        (c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL') +
        '  ' +
        (c.COLUMN_COMMENT || '')
    )
  );
  console.log('[migration] 索引: ' + idx.map(i => i.INDEX_NAME + '(' + i.COLUMN_NAME + ')').join(', '));

  await pool.end();
  console.log('');
  console.log('[migration] 完成 ✓');
}

run().catch(e => {
  console.error('[migration] 失败:', e.message);
  process.exit(1);
});

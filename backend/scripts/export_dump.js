// 导出当前数据库为全量「结构+数据」SQL（供新环境一键初始化）
// 用法: node backend/scripts/export_dump.js [DB_PASSWORD]
// 输出: database/full_schema_data.sql
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB_PASSWORD = process.argv[2] || '';
const OUT = path.join(__dirname, '..', '..', 'database', 'full_schema_data.sql');

(async () => {
  const conn = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: DB_PASSWORD, database: 'nongfu_inventory'
  });

  const [tables] = await conn.query('SHOW TABLES');
  const all = tables.map(t => Object.values(t)[0]);
  // 排除备份表（*_bak_*）与历史残留
  const names = all.filter(n => !n.includes('_bak_'));

  const out = [];
  out.push('-- ============================================================');
  out.push('-- 农富库存管理系统 - 全量数据库（结构 + 数据）');
  out.push('-- 由 backend/scripts/export_dump.js 自动导出');
  out.push('-- 共 ' + names.length + ' 张表');
  out.push('-- ============================================================');
  out.push('CREATE DATABASE IF NOT EXISTS nongfu_inventory DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci;');
  out.push('USE nongfu_inventory;');
  out.push('SET NAMES utf8mb4;');
  out.push('SET FOREIGN_KEY_CHECKS=0;');

  for (const name of names) {
    out.push('');
    out.push('-- ----------------------------');
    out.push('-- 表结构: ' + name);
    out.push('-- ----------------------------');
    out.push('DROP TABLE IF EXISTS `' + name + '`;');
    const [ddl] = await conn.query('SHOW CREATE TABLE `' + name + '`');
    out.push(ddl[0]['Create Table'] + ';');

    const [rows] = await conn.query('SELECT * FROM `' + name + '`');
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]).map(k => '`' + k + '`').join(', ');
      for (const r of rows) {
        const vals = Object.keys(r).map(k => conn.escape(r[k])).join(', ');
        out.push('INSERT INTO `' + name + '` (' + cols + ') VALUES (' + vals + ');');
      }
      out.push('-- ' + rows.length + ' 行');
    }
  }

  out.push('');
  out.push('SET FOREIGN_KEY_CHECKS=1;');
  out.push('SELECT \'数据库初始化完成！\' AS message;');

  fs.writeFileSync(OUT, out.join('\n'), 'utf8');
  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log('[OK] 已导出 ' + names.length + ' 张表 -> ' + OUT + ' (' + sizeKB + ' KB)');
  await conn.end();
})().catch(e => { console.error('[导出失败]', e.message); process.exit(1); });

// 幂等创建报销附件表 reimburse_attachments
const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    multipleStatements: true
  });

  try {
    const createSql = `CREATE TABLE IF NOT EXISTS reimburse_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reimburse_id INT DEFAULT NULL,
      file_url VARCHAR(500) NOT NULL,
      file_name VARCHAR(200) DEFAULT NULL,
      file_size INT DEFAULT NULL COMMENT '单位：字节',
      created_at DATETIME DEFAULT NULL,
      KEY idx_reimburse (reimburse_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

    await conn.execute(createSql);
    console.log('[OK] reimburse_attachments 表已创建/已存在');

    // 检查表结构，幂等补充字段
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reimburse_attachments'`
    );
    const existCols = cols.map(c => c.COLUMN_NAME);

    const needCols = [
      { name: 'reimburse_id', def: 'INT DEFAULT NULL' },
      { name: 'file_url', def: 'VARCHAR(500) NOT NULL' },
      { name: 'file_name', def: 'VARCHAR(200) DEFAULT NULL' },
      { name: 'file_size', def: "INT DEFAULT NULL COMMENT '单位：字节'" },
      { name: 'created_at', def: 'DATETIME DEFAULT NULL' }
    ];
    for (const col of needCols) {
      if (!existCols.includes(col.name)) {
        await conn.execute(`ALTER TABLE reimburse_attachments ADD COLUMN ${col.name} ${col.def}`);
        console.log(`   + 补充字段: ${col.name}`);
      }
    }

    console.log('[DONE] 报销附件表准备完成');
  } finally {
    await conn.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });

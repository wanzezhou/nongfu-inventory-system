// 新环境数据库一键初始化（幂等：库已初始化则跳过，不覆盖已有数据）
// 用法: node backend/scripts/init_db.js [--db-password=xxx]
// 数据源: database/full_schema_data.sql（由 export_dump.js 导出）
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const pwdArg = args.find(a => a.startsWith('--db-password='));
const DB_PASSWORD = pwdArg ? pwdArg.split('=').slice(1).join('=') : '';
const SQL_FILE = path.join(__dirname, '..', '..', 'database', 'full_schema_data.sql');

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: 'localhost', port: 3306, user: 'root',
      password: DB_PASSWORD, multipleStatements: true
    });
  } catch (e) {
    console.error('[初始化失败] 无法连接 MySQL: ' + e.message);
    console.error('请确认：1) MySQL 已启动；2) root 密码正确（start.bat 顶部 DB_PASSWORD 变量可配置）');
    process.exit(1);
  }

  try {
    // 幂等检查：库中存在 orders/products 任一表视为已初始化
    const [rows] = await conn.query(
      "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema='nongfu_inventory' AND table_name IN ('orders','products')"
    );
    if (Number(rows[0].n) > 0) {
      console.log('[跳过] nongfu_inventory 已初始化，不覆盖已有数据');
      await conn.end();
      return;
    }

    if (!fs.existsSync(SQL_FILE)) {
      console.error('[初始化失败] 缺少 ' + SQL_FILE + '，请确认项目文件完整');
      process.exit(1);
    }

    console.log('[初始化] 正在创建数据库并导入结构与数据...');
    const sql = fs.readFileSync(SQL_FILE, 'utf8');
    await conn.query(sql);
    console.log('[OK] 数据库初始化完成（nongfu_inventory）');
    await conn.end();
  } catch (e) {
    console.error('[初始化失败] ' + e.message);
    process.exit(1);
  }
})();

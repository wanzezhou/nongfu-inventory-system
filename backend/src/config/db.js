const mysql = require('mysql2/promise');
require('dotenv').config();

// 创建数据库连接池
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nongfu_inventory',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// 监听连接池错误，防止未捕获的错误导致进程崩溃
pool.on('connection', (connection) => {
  connection.on('error', (err) => {
    console.error('数据库连接错误:', err.message);
  });
});

// 测试数据库连接
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('数据库连接成功');
    connection.release();
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    console.error('请确认 MySQL 服务已启动，且数据库 nongfu_inventory 已创建');
  }
}

module.exports = {
  pool,
  testConnection
};

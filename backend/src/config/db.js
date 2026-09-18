const mysql = require('mysql2/promise');
require('dotenv').config();

// ===========================================================================
// 连接池参数（2026-09-18 代码审查 #6 收敛）
//
// 为什么把 queueLimit 从 0（无界）改为有限：
//   无界排队时，服务端无法自我保护 —— 请求会一直等，最终由客户端超时决定生死。
//   叠加场景（Excel 导入长事务 + 工资批量发放 + 并发出库的 FOR UPDATE 行锁）
//   很容易吃满连接，后续全部排队；前端 10s 超时后用户重试，进一步加剧排队。
//   改为有限队列后，超出即快速失败（调用方拿到连接超时错误），而不是无限堆积。
//
// connectTimeout：建连超时，避免 DB 半死时请求长时间挂住。
// idleTimeout / maxIdle：空闲连接及时回收，避免长期占用 MySQL 侧连接数。
// ===========================================================================
const CONNECTION_LIMIT = Number(process.env.DB_CONNECTION_LIMIT || 10);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nongfu_inventory',
  waitForConnections: true,
  connectionLimit: CONNECTION_LIMIT,
  queueLimit: Number(process.env.DB_QUEUE_LIMIT || 50),
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
  idleTimeout: Number(process.env.DB_IDLE_TIMEOUT || 60000),
  maxIdle: CONNECTION_LIMIT,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// 监听连接池错误，防止未捕获的错误导致进程崩溃
pool.on('connection', (connection) => {
  connection.on('error', (err) => {
    console.error('数据库连接错误:', err.message);
  });
});

/**
 * 测试数据库连接。
 * ⚠️ 失败时**抛出**，由调用方（app.js）决定是否拒绝启动 —— 不要在这里吞掉。
 * 数据库不通却照常 listen，会让运维无法区分「服务没起来」与「服务起来了但数据库不通」，
 * 所有请求只会返回 500（2026-09-18 代码审查 #5）。
 */
async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
  return true;
}

/** 连接池运行指标（供 /health 使用）。
 * 注意：读的是 mysql2 内部字段（非公开 API）。各版本容器类型不同 ——
 *   mysql2 2.x → Array；3.x → Denque（双端队列，计数在 `length`，而 `size` 是个方法）；
 *   更早/其他 → Set。
 * 故三者都兼容；取不到时返回 null 而不是抛错 —— 健康检查绝不能因为指标缺失而失败。 */
function getPoolStats() {
  const p = pool.pool || {};
  const count = (v) => {
    if (v == null) return null;
    if (Array.isArray(v)) return v.length;
    if (typeof v.size === 'number') return v.size; // Set / Map
    if (typeof v.length === 'number') return v.length; // Denque / Array-like
    return null;
  };
  return {
    connectionLimit: CONNECTION_LIMIT,
    all: count(p._allConnections),
    free: count(p._freeConnections),
    queued: count(p._connectionQueue)
  };
}

module.exports = {
  pool,
  testConnection,
  getPoolStats
};

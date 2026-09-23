const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { pool, testConnection, getPoolStats } = require('./config/db');
const { success } = require('./utils/response');
const auth = require('./middleware/auth');
const productRoutes = require('./routes/productRoutes');
const stationRoutes = require('./routes/stationRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const workerRoutes = require('./routes/workerRoutes');
const authRoutes = require('./routes/authRoutes');
const excelRoutes = require('./routes/excelRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');
const machineStationRoutes = require('./routes/machineStationRoutes');
const financialRoutes = require('./routes/financialRoutes');
const waterTicketRoutes = require('./routes/waterTicketRoutes');
const salaryRoutes = require('./routes/salaryRoutes');
const costRoutes = require('./routes/costRoutes');
const profitRoutes = require('./routes/profitRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const incomeRoutes = require('./routes/incomeRoutes');
const financeAccountRoutes = require('./routes/financeAccountRoutes');
const barrelRoutes = require('./routes/barrelRoutes');
const systemSettingsRoutes = require('./routes/systemSettingsRoutes');
const walletRoutes = require('./routes/walletRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 安全中间件 =====
// helmet：安全响应头。CORP 保持 helmet 默认（same-origin）——**不要全局放开**，
// 否则任意第三方站点都能直连嵌套本服务的静态资源（图片防盗链与隐私隔离同时失效）。
// 商品图片需要跨源加载，改在下面挂载该路径时单独放开（2026-09-18 代码审查 #2）。
app.use(helmet());

// CORS 白名单：仅允许配置的来源（CORS_ORIGIN，逗号分隔）
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // 非浏览器请求（curl/服务间调用）无 Origin 头，放行
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false); // 不在白名单：不报错，但不带 CORS 头，浏览器侧拦截
    }
  })
);

// 登录接口限流：15 分钟内最多 10 次，防暴力破解
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '登录尝试过于频繁，请 15 分钟后再试', data: null }
});

// 常规接口限流：每 IP 每分钟最多 300 次
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试', data: null }
});

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 请求体命名归一化：蛇形键统一转驼峰（controller 内只读驼峰）
const normalizeBody = require('./middleware/normalizeBody');
app.use(normalizeBody);

// 静态文件服务 - 商品图片
// 商品图片属**公开资产**（商品照片，应用内各页都要展示），保留免鉴权，但：
//   ① 只对本路径放开 CORP，其余路径保持 helmet 默认 same-origin
//   ② 语义上明确它「只服务于图片展示」，不要往这里放任何私密文件
app.use(
  '/product_images',
  helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
  express.static(path.join(__dirname, '../../商品档案/商品图片'))
);

// 静态文件服务 - 配送照片 / 报销凭证上传目录
// ⚠️ 2026-09-18 代码审查 #2：该挂载此前是**完全开放**的（挂在全局鉴权之前，且鉴权只覆盖
// /api 前缀），任何人知道文件名即可访问；同时 CORP 被全局放开，第三方站点也能嵌套。
//
// 现状核实：全仓**没有任何代码写入该目录**（所有 multer 均为内存存储；商品图写「商品档案/
// 商品图片」），目录内仅 1 个 0.1KB 的早期测试文件 —— 即它当前是一条**无人使用的公开静态面**。
//
// 处置：默认**拒绝外部直接访问**（顶层导航/直连一律 403），仅当请求来源在 CORS 白名单内
// （即由本系统页面发起的 <img>/fetch，浏览器会带 Referer/Origin）才放行。
// 需要恢复完全公开时设 UPSERVE_UPLOADS_PUBLIC=1（不推荐，仅作应急逃生阀）。
// 后续若真的要上线配送照片/报销凭证功能，应改为「短时签名 URL」而非公开静态目录。
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const uploadsPublic = process.env.UPSERVE_UPLOADS_PUBLIC === '1';

function guardUploads(req, res, next) {
  if (uploadsPublic) return next();
  const ref = req.headers.referer || req.headers.referrer || '';
  const origin = req.headers.origin || '';
  const refOrigin = ref ? ref.split('/').slice(0, 3).join('/') : '';
  if ((refOrigin && allowedOrigins.includes(refOrigin)) || (origin && allowedOrigins.includes(origin))) {
    return next();
  }
  return res.status(403).json({ code: 403, message: '该资源不可直接访问', data: null });
}

app.use(
  '/uploads',
  guardUploads,
  helmet.crossOriginResourcePolicy({ policy: 'same-origin' }),
  express.static(UPLOADS_DIR)
);

// ===== 全局接口鉴权 =====
// 除白名单外，所有 /api 接口必须携带有效 JWT（覆盖历史遗漏 auth 的路由组）
// 注意：app.use('/api', ...) 挂载后 req.path 为相对路径（如 /auth/login）
const AUTH_WHITELIST = new Set(['/auth/login']);

// ⚠️⚠️ 小程序路由必须挂在全局 Web 鉴权**之前**（2026-09-20，文档 §22.4 / §51）
// 原因：下面的 `app.use('/api', apiLimiter, auth)` 给整个 /api 套的是 **Web** JWT 鉴权，
// 而小程序令牌用的是独立密钥 + 独立 aud/iss（middleware/miniAuth.js），
// 且 middleware/auth.js 会**显式拒绝**小程序令牌（§51.2 第 1 条要求双向拒绝）。
// 若把 /api/mini 挂在它后面，小程序请求会先被 Web 的 auth 拦成 401，
// 永远走不到 miniAuth —— 表现为「小程序全部接口 401，但令牌明明是新签的」。
// Express 按注册顺序匹配，因此这里**先挂** /api/mini，它自带限流与鉴权，不受下面影响。
const miniRoutes = require('./routes/miniRoutes');
app.use('/api/mini', miniRoutes);

app.use('/api', apiLimiter, (req, res, next) => {
  if (AUTH_WHITELIST.has(req.path)) return next();
  return auth(req, res, next);
});

// 登录接口单独限流（须在鉴权白名单判断之后、路由之前）
app.use('/api/auth/login', loginLimiter);

// 路由
app.use('/api/products', productRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/excel', excelRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/machine-stations', machineStationRoutes);
app.use('/api/finance', financialRoutes);
app.use('/api/water-tickets', waterTicketRoutes);
app.use('/api/salary', salaryRoutes);
app.use('/api/cost', costRoutes);
app.use('/api/profit', profitRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/incomes', incomeRoutes);
app.use('/api/finance-accounts', financeAccountRoutes);
app.use('/api/barrel', barrelRoutes);
app.use('/api/system-settings', systemSettingsRoutes);
// 积分钱包管理（Web 管理端）。⚠️ 与小程序端的 `/api/mini/wallet` 是**两个挂载点**：
// 后者在全局 /api 鉴权之前挂载并自带小程序令牌校验，本挂载点走 Web 令牌 + requireAdmin。
app.use('/api/wallets', walletRoutes);

// 根路由
app.get('/', (req, res) => {
  // R7：走统一出口，避免出现第二套响应语义（2026-09-18 由 eslint 拦下）
  success(res, { version: '1.0.0', timestamp: new Date().toISOString() }, '农夫山泉进销存系统API服务运行中');
});

// 健康检查（2026-09-18 代码审查 #5 新增）
// 放在 /api 之外：① 无需 JWT，便于监控/负载均衡探活；② 不会被 apiLimiter 限流干扰。
// 返回进程状态 + 数据库连通性 + 连接池指标，让运维能区分「服务没起来」与「服务起来了但 DB 不通」。
app.get('/health', async (req, res) => {
  const startedAt = Date.now();
  let db = { ok: false, latencyMs: null, error: null };
  try {
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
    db = { ok: true, latencyMs: Date.now() - startedAt, error: null };
  } catch (err) {
    db = { ok: false, latencyMs: null, error: err.code || 'DB_UNAVAILABLE' };
  }

  const body = {
    code: db.ok ? 200 : 503,
    message: db.ok ? 'ok' : '数据库不可用',
    data: {
      status: db.ok ? 'healthy' : 'degraded',
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      db,
      pool: getPoolStats()
    }
  };
  res.status(db.ok ? 200 : 503).json(body);
});

// 404处理
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: '接口不存在',
    data: null
  });
});

// 全局错误处理（不向客户端泄露内部错误细节）
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误，请稍后重试或联系管理员',
    data: null
  });
});

// ===== 进程级异常（2026-09-18 代码审查 #4）=====
// ⚠️ 只打印 err.message 会**丢失堆栈**，事后无法定位；而 uncaughtException 之后进程状态
// 已不可信（可能存在「半个事务已提交、连接已泄漏」的进程继续对外服务）。
// ⇒ 记录完整错误（含 stack）后**退出**，由 start.bat / 进程管理器重启。
process.on('unhandledRejection', reason => {
  console.error('未处理的 Promise rejection:', reason);
});

process.on('uncaughtException', err => {
  console.error('未捕获的异常，进程即将退出:', err);
  // 给日志一点落盘时间，然后交回进程管理器重启
  setTimeout(() => process.exit(1), 100).unref();
});

// 启动服务
// ⚠️ DB 连通性检查必须先于 listen：否则 DB 不通时服务会「假活着」，
// 端口在监听、监控看着正常，但所有请求只会返回 500，运维无法定位。
let server = null;

async function startServer() {
  await testConnection();
  console.log('数据库连接成功');

  server = app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

// 优雅关闭：停止接收新请求 → 关闭数据库连接池 → 退出
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，开始优雅关闭…`);
  const finish = async code => {
    try {
      await pool.end();
      console.log('数据库连接池已关闭');
    } catch (e) {
      console.error('关闭连接池出错:', e);
    }
    process.exit(code);
  };
  if (!server) return finish(0);
  server.close(err => {
    if (err) console.error('关闭 HTTP 服务出错:', err);
    return finish(err ? 1 : 0);
  });
  // 兜底：10 秒内未能正常关闭则强制退出
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch(err => {
  console.error('数据库连接失败，拒绝启动:', err.message);
  console.error('请确认 MySQL 服务已启动，且数据库已创建、.env 配置正确');
  process.exit(1);
});

module.exports = app;

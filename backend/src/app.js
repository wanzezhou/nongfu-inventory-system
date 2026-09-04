const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { testConnection } = require('./config/db');
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
const expenseRoutes = require('./routes/expenseRoutes');
const financeAccountRoutes = require('./routes/financeAccountRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 安全中间件 =====
// helmet：安全响应头。CORP 放开为 cross-origin，否则前端(5173)无法加载本服务的商品图片
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS 白名单：仅允许配置的来源（CORS_ORIGIN，逗号分隔）
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    // 非浏览器请求（curl/服务间调用）无 Origin 头，放行
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false); // 不在白名单：不报错，但不带 CORS 头，浏览器侧拦截
  }
}));

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
app.use('/product_images', express.static(path.join(__dirname, '../../商品档案/商品图片')));

// 静态文件服务 - 配送照片上传
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 测试数据库连接
testConnection();

// ===== 全局接口鉴权 =====
// 除白名单外，所有 /api 接口必须携带有效 JWT（覆盖历史遗漏 auth 的路由组）
// 注意：app.use('/api', ...) 挂载后 req.path 为相对路径（如 /auth/login）
const AUTH_WHITELIST = new Set(['/auth/login']);
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
app.use('/api/expenses', expenseRoutes);
app.use('/api/finance-accounts', financeAccountRoutes);

// 根路由
app.get('/', (req, res) => {
  res.json({
    code: 200,
    message: '农夫山泉进销存系统API服务运行中',
    data: {
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }
  });
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

// 全局未捕获异常处理，防止进程崩溃
process.on('unhandledRejection', (err) => {
  console.error('未处理的Promise rejection:', err.message);
});

process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err.message);
});

// 启动服务
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

module.exports = app;

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { testConnection } = require('./config/db');
const productRoutes = require('./routes/productRoutes');
const stationRoutes = require('./routes/stationRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const workerRoutes = require('./routes/workerRoutes');
const authRoutes = require('./routes/authRoutes');
const excelRoutes = require('./routes/excelRoutes');
const salesmanRoutes = require('./routes/salesmanRoutes');
const statisticsRoutes = require('./routes/statisticsRoutes');
const machineStationRoutes = require('./routes/machineStationRoutes');
const financialRoutes = require('./routes/financialRoutes');
const waterTicketRoutes = require('./routes/waterTicketRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务 - 商品图片
app.use('/product_images', express.static(path.join(__dirname, '../../商品档案/商品图片')));

// 静态文件服务 - 配送照片上传
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 测试数据库连接
testConnection();

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
app.use('/api/salesmen', salesmanRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/machine-stations', machineStationRoutes);
app.use('/api/finance', financialRoutes);
app.use('/api/water-tickets', waterTicketRoutes);

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

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    code: 500,
    message: '服务器内部错误: ' + err.message,
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

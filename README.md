# 农夫山泉经销商进销存管理系统

> 基于 Vue 3 + Node.js + MySQL 的现代化进销存管理系统

## 项目结构

```
系统开发V2/
├── database/                   # 数据库脚本
│   ├── init.sql                # 数据库初始化脚本（9张表）
│   ├── test_data.sql           # 测试数据
│   └── README.md               # 数据库使用说明
├── backend/                    # 后端服务（Node.js + Express）
│   ├── src/
│   │   ├── config/db.js        # 数据库连接池
│   │   ├── controllers/        # 控制器（5个模块）
│   │   ├── routes/             # 路由（5个模块）
│   │   ├── utils/response.js   # 统一响应格式
│   │   └── app.js              # 入口文件
│   ├── .env.example            # 环境变量示例
│   └── package.json
├── frontend/                   # 前端页面（Vue 3 + Element Plus）
│   ├── src/
│   │   ├── api/                # API 请求（5个模块）
│   │   ├── views/              # 页面组件（5个页面）
│   │   ├── layout/             # 主布局
│   │   ├── router/             # 路由配置
│   │   └── main.js
│   ├── dist/                   # 构建产物（已构建）
│   └── package.json
├── 商品档案/                   # 原始商品数据
└── docs/                       # 设计文档
    └── superpowers/
        ├── specs/              # 设计规格
        └── plans/              # 实现计划
```

## 功能模块

| 模块 | 功能 | 状态 |
| :--- | :--- | :---: |
| 仪表盘 | 数据概览卡片、销售趋势图、商品占比饼图 | ✅ |
| 商品管理 | 商品列表、搜索筛选、新增/编辑/删除、多价格体系 | ✅ |
| 库存管理 | 库存查看、入库操作、出库操作、库存预警 | ✅ |
| 订单管理 | 订单列表、创建订单、订单详情、订单状态管理 | ✅ |
| 水站管理 | 水站列表、信用额度、发票信息、欠款管理 | ✅ |

## 技术栈

### 前端
- **Vue 3** + Composition API
- **Element Plus** UI 组件库
- **ECharts** 图表库
- **Vue Router** 路由管理
- **Pinia** 状态管理
- **Axios** HTTP 请求
- **Vite** 构建工具

### 后端
- **Node.js** + **Express** 框架
- **mysql2** MySQL 数据库连接池
- **cors** 跨域处理
- **dotenv** 环境变量管理

### 数据库
- **MySQL 5.7+ / 8.0**
- 共9张业务表
- InnoDB 引擎，支持事务

## 快速开始

### 1. 数据库初始化

参考 [database/README.md](database/README.md)，执行以下步骤：

1. 打开 MySQL 客户端（Navicat、MySQL Workbench 等）
2. 执行 `database/init.sql` 创建数据库和表结构
3. （可选）执行 `database/test_data.sql` 插入测试数据

### 2. 启动后端服务

```bash
cd backend

# 安装依赖
npm install

# 复制环境变量配置
copy .env.example .env
# 编辑 .env 修改数据库密码等配置

# 启动服务
npm start
# 或开发模式（热重载）
npm run dev
```

后端服务运行在：http://localhost:3000

### 3. 启动前端服务

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端服务运行在：http://localhost:5173

## API 接口总览

### 商品管理 `/api/products`
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/products` | 获取商品列表（支持搜索、筛选、分页） |
| GET | `/api/products/:id` | 获取商品详情 |
| POST | `/api/products` | 新增商品 |
| PUT | `/api/products/:id` | 更新商品 |
| DELETE | `/api/products/:id` | 删除商品（软删除） |

### 水站管理 `/api/stations`
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/stations` | 获取水站列表 |
| GET | `/api/stations/:id` | 获取水站详情 |
| POST | `/api/stations` | 新增水站 |
| PUT | `/api/stations/:id` | 更新水站 |
| DELETE | `/api/stations/:id` | 删除水站（软删除） |

### 库存管理 `/api/inventory`
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/inventory` | 获取库存列表（联表查询商品信息） |
| GET | `/api/inventory/:productId` | 获取单个商品库存 |
| POST | `/api/inventory/in` | 入库操作（事务，自动创建进货记录） |
| POST | `/api/inventory/out` | 出库操作（事务，库存校验） |

### 订单管理 `/api/orders`
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/orders` | 获取订单列表（支持搜索、筛选、分页） |
| GET | `/api/orders/:id` | 获取订单详情（含商品明细） |
| POST | `/api/orders` | 创建订单（事务，扣减库存，更新欠款） |
| PUT | `/api/orders/:id/status` | 更新订单状态 |
| DELETE | `/api/orders/:id` | 取消订单（恢复库存） |

### 仪表盘 `/api/dashboard`
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/dashboard/summary` | 与时间无关的卡片：库存总金额、待配送订单 |
| GET | `/api/dashboard/metrics?range=month\|quarter\|year` | 周期指标：总销量 / 总订单数 / 总营收 / 总成本 / 工资统计 / 总利润 |
| GET | `/api/dashboard/trend` | 月销售趋势（本年度 1~12 月，按商品件数） |

## 订单类型说明

| 类型值 | 名称 | order_amount 计算 | 配送费 |
| :---: | :--- | :--- | :--- |
| 1 | 线上平台销售 | 进货价 × 数量 | 总包配送费（农夫山泉付）- 工人配送费 |
| 2 | 线下水站分销 | 批发价 × 数量 | 分销配送费 / 工人水站配送费 |
| 3 | 线下零售 | 零售价 × 数量 | 工人零售配送费 |
| 4 | 零售机供货 | 零售机供货价 × 数量 | 工人零售机配送费 |

## 部署到云端

### 后端部署
1. 准备云服务器（安装 Node.js 和 MySQL）
2. 上传 `backend/` 目录（不含 node_modules）
3. 安装依赖：`npm install --production`
4. 配置环境变量（数据库连接等）
5. 使用 PM2 进程守护：`pm2 start src/app.js --name inventory-backend`
6. 配置 Nginx 反向代理

### 前端部署
1. 构建生产版本：`npm run build`
2. 上传 `frontend/dist/` 目录到服务器
3. 配置 Nginx 静态资源服务
4. 配置 API 代理（或修改前端 API baseURL）

## 设计文档

- [数据库设计文档](docs/superpowers/specs/2026-07-09-inventory-system-database-design.md)
- [数据库实现计划](docs/superpowers/plans/2026-07-09-inventory-database-implementation.md)

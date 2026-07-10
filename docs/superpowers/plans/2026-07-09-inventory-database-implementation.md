# 农夫山泉经销商进销存系统 - 数据库实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建完整的MySQL数据库初始化SQL脚本和使用说明文档，实现农夫山泉经销商进销存系统的9张表结构。

**Architecture:** 采用单一SQL脚本文件创建所有表结构（按外键依赖顺序），辅以使用说明Markdown文档。脚本包含数据库创建、表创建、索引创建、外键约束，以及可选的测试数据。

**Tech Stack:** MySQL 5.7+ / 8.0，UTF-8编码（utf8mb4）

---

## 文件结构

| 文件 | 责任 |
| :--- | :--- |
| `database/init.sql` | 数据库初始化主脚本，创建数据库和所有表 |
| `database/test_data.sql` | 可选的测试数据脚本，用于验证表结构 |
| `database/README.md` | 使用说明文档，指导如何执行脚本 |

## 表创建顺序（按外键依赖）

由于存在外键依赖，表必须按以下顺序创建：

1. `products` - 商品信息（无外键依赖）
2. `sub_stations` - 水站信息（无外键依赖）
3. `workers` - 配送员工（无外键依赖）
4. `inventory` - 库存（依赖 products）
5. `purchase_records` - 进货记录（依赖 products）
6. `orders` - 订单主表（依赖 sub_stations, workers）
7. `order_items` - 订单明细（依赖 orders, products）
8. `delivery_fee_settlement` - 配送费结算（依赖 orders, products）
9. `financial_settlement` - 资金对账（依赖 orders, sub_stations, workers）

---

### Task 1: 创建数据库初始化主脚本（init.sql）

**Files:**
- Create: `database/init.sql`

- [ ] **Step 1: 创建 database 目录**

Run: `mkdir database`
Expected: 目录创建成功

- [ ] **Step 2: 创建 init.sql 文件头部和数据库创建语句**

创建 `database/init.sql`，写入以下内容：

```sql
-- ============================================================
-- 农夫山泉经销商进销存系统 - 数据库初始化脚本
-- 版本: 1.0
-- 日期: 2026-07-09
-- 说明: 执行此脚本将创建完整的数据库表结构
-- ============================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS nongfu_inventory
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE nongfu_inventory;

-- 删除已存在的表（按外键依赖逆序，便于重新执行）
DROP TABLE IF EXISTS financial_settlement;
DROP TABLE IF EXISTS delivery_fee_settlement;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS purchase_records;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS workers;
DROP TABLE IF EXISTS sub_stations;
DROP TABLE IF EXISTS products;
```

- [ ] **Step 3: 添加 products 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 1. 商品信息表
-- ============================================================
CREATE TABLE products (
    product_id              VARCHAR(50)     NOT NULL COMMENT '商品ID，主键',
    product_code            VARCHAR(50)     NOT NULL COMMENT '商品编码（如SPBM001）',
    product_name            VARCHAR(200)    NOT NULL COMMENT '商品名称（如农夫山泉550ml）',
    specification           VARCHAR(100)    DEFAULT NULL COMMENT '规格（如550ml*24瓶）',
    unit                    VARCHAR(20)     DEFAULT NULL COMMENT '计量单位（如箱）',
    purchase_price          DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '进货价（从农夫山泉进货的价格）',
    wholesale_price         DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '批发价（卖给下级水站的价格）',
    retail_price            DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '零售价（线下零售价格）',
    machine_price           DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '零售机供货价（配送给零售机的价格）',
    total_delivery_fee      DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '总包配送费（农夫山泉结算给经销商）',
    distribution_delivery_fee DECIMAL(8,2)  NOT NULL DEFAULT 0.00 COMMENT '分销配送费（经销商结算给水站）',
    worker_retail_delivery_fee    DECIMAL(8,2) NOT NULL DEFAULT 0.00 COMMENT '工人零售配送费（终端零售客户配送）',
    worker_wholesale_delivery_fee DECIMAL(8,2) NOT NULL DEFAULT 0.00 COMMENT '工人水站配送费（面包车配送给水站）',
    worker_machine_delivery_fee   DECIMAL(8,2) NOT NULL DEFAULT 0.00 COMMENT '工人零售机配送费（面包车配送给零售机）',
    category                VARCHAR(50)     DEFAULT NULL COMMENT '商品分类（如矿泉水、饮料）',
    image_url               VARCHAR(500)    DEFAULT NULL COMMENT '商品图片URL',
    status                  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (product_id),
    UNIQUE KEY uk_product_code (product_code),
    KEY idx_category (category),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品信息表';
```

- [ ] **Step 4: 添加 sub_stations 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 2. 下级水站信息表
-- ============================================================
CREATE TABLE sub_stations (
    station_id              VARCHAR(50)     NOT NULL COMMENT '水站ID，主键',
    station_name            VARCHAR(100)    NOT NULL COMMENT '水站名称',
    contact_name            VARCHAR(50)     DEFAULT NULL COMMENT '联系人姓名',
    phone                   VARCHAR(20)     DEFAULT NULL COMMENT '联系电话',
    address                 VARCHAR(500)    DEFAULT NULL COMMENT '水站地址',
    area                    VARCHAR(50)     DEFAULT NULL COMMENT '覆盖区域（如南京鼓楼区）',
    credit_limit            DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '信用额度（允许的最大欠款金额）',
    current_debt            DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '当前欠款余额',
    payment_type            TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '付款方式：1-先付款后拿货，2-先拿货后付款',
    bank_name               VARCHAR(100)    DEFAULT NULL COMMENT '付款银行',
    bank_account            VARCHAR(50)     DEFAULT NULL COMMENT '付款账户',
    account_name            VARCHAR(100)    DEFAULT NULL COMMENT '账户户名',
    invoice_title           VARCHAR(200)    DEFAULT NULL COMMENT '发票抬头',
    tax_number              VARCHAR(50)     DEFAULT NULL COMMENT '纳税人识别号',
    invoice_address         VARCHAR(500)    DEFAULT NULL COMMENT '发票地址',
    invoice_phone           VARCHAR(20)     DEFAULT NULL COMMENT '发票电话',
    status                  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '状态：0-停用，1-启用',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (station_id),
    KEY idx_area (area),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='下级水站信息表';
```

- [ ] **Step 5: 添加 workers 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 3. 配送员工表
-- ============================================================
CREATE TABLE workers (
    worker_id               VARCHAR(50)     NOT NULL COMMENT '员工ID，主键',
    worker_name             VARCHAR(50)     NOT NULL COMMENT '员工姓名',
    phone                   VARCHAR(20)     DEFAULT NULL COMMENT '联系电话',
    vehicle_type            TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '配送车辆类型：1-电动车（终端零售），2-面包车（批量配送）',
    bank_name               VARCHAR(100)    DEFAULT NULL COMMENT '收款银行',
    bank_account            VARCHAR(50)     DEFAULT NULL COMMENT '收款账户',
    status                  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '状态：0-离职，1-在职',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (worker_id),
    KEY idx_vehicle_type (vehicle_type),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='配送员工表';
```

- [ ] **Step 6: 添加 inventory 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 4. 总仓库库存表
-- ============================================================
CREATE TABLE inventory (
    inventory_id            INT             NOT NULL AUTO_INCREMENT COMMENT '库存ID，主键，自增',
    product_id              VARCHAR(50)     NOT NULL COMMENT '商品ID，外键关联products表',
    quantity                INT             NOT NULL DEFAULT 0 COMMENT '库存数量',
    last_in_time            DATETIME        DEFAULT NULL COMMENT '最后入库时间',
    last_out_time           DATETIME        DEFAULT NULL COMMENT '最后出库时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (inventory_id),
    UNIQUE KEY uk_product (product_id),
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='总仓库库存表';
```

- [ ] **Step 7: 添加 purchase_records 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 5. 进货记录表
-- ============================================================
CREATE TABLE purchase_records (
    purchase_id             VARCHAR(50)     NOT NULL COMMENT '进货单号，主键',
    product_id              VARCHAR(50)     NOT NULL COMMENT '商品ID，外键关联products表',
    quantity                INT             NOT NULL COMMENT '进货数量',
    unit_price              DECIMAL(10,2)   NOT NULL COMMENT '进货单价（实际结算价格）',
    total_amount            DECIMAL(12,2)   NOT NULL COMMENT '总金额',
    payment_status          TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '付款状态：0-未付款，1-已付款',
    payment_date            DATETIME        DEFAULT NULL COMMENT '付款日期',
    supplier                VARCHAR(100)    DEFAULT '农夫山泉' COMMENT '供应商（如农夫山泉）',
    remark                  VARCHAR(500)    DEFAULT NULL COMMENT '备注',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (purchase_id),
    KEY idx_product (product_id),
    KEY idx_payment_status (payment_status),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_purchase_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='进货记录表';
```

- [ ] **Step 8: 添加 orders 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 6. 订单主表
-- ============================================================
CREATE TABLE orders (
    order_id                VARCHAR(50)     NOT NULL COMMENT '订单ID，主键',
    order_type              TINYINT(1)      NOT NULL COMMENT '订单类型：1-线上平台销售，2-线下水站分销，3-线下零售，4-零售机供货',
    platform_type           VARCHAR(50)     DEFAULT NULL COMMENT '平台类型（订单类型=1时填写，如美团、饿了么）',
    platform_order_no       VARCHAR(100)    DEFAULT NULL COMMENT '平台订单号（订单类型=1时填写）',
    station_id              VARCHAR(50)     DEFAULT NULL COMMENT '水站ID（订单类型=2时填写，外键关联sub_stations表）',
    customer_name           VARCHAR(100)    DEFAULT NULL COMMENT '客户姓名',
    customer_phone          VARCHAR(20)     DEFAULT NULL COMMENT '客户电话',
    customer_address        VARCHAR(500)    DEFAULT NULL COMMENT '客户地址',
    order_amount            DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '订单总金额（线上=进货价总和，分销=批发价总和，零售=零售价总和，零售机=零售机供货价总和）',
    delivery_fee            DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '配送费金额',
    total_receivable        DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '应收总金额（订单金额+配送费）',
    delivery_type           TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '配送方式：1-自有员工配送，2-水站配送，3-无需配送',
    worker_id               VARCHAR(50)     DEFAULT NULL COMMENT '配送员工ID（配送方式=1时填写，外键关联workers表）',
    payment_status          TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '付款状态：0-未付款，1-已付款，2-部分付款',
    paid_amount             DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '已付款金额',
    order_status            TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '订单状态：0-待处理，1-已发货，2-已完成，3-已取消',
    remark                  VARCHAR(500)    DEFAULT NULL COMMENT '备注',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (order_id),
    KEY idx_order_type (order_type),
    KEY idx_station (station_id),
    KEY idx_worker (worker_id),
    KEY idx_order_status (order_status),
    KEY idx_payment_status (payment_status),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_order_station FOREIGN KEY (station_id) REFERENCES sub_stations(station_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_order_worker FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单主表';
```

- [ ] **Step 9: 添加 order_items 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 7. 订单商品明细表
-- ============================================================
CREATE TABLE order_items (
    item_id                         INT             NOT NULL AUTO_INCREMENT COMMENT '明细ID，主键，自增',
    order_id                        VARCHAR(50)     NOT NULL COMMENT '订单ID，外键关联orders表',
    product_id                      VARCHAR(50)     NOT NULL COMMENT '商品ID，外键关联products表',
    quantity                        INT             NOT NULL COMMENT '商品数量',
    purchase_price                  DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '进货价（线上销售时用于计算应收农夫山泉的货款）',
    wholesale_price                 DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '批发价（线下分销时用于计算水站应付款）',
    retail_price                    DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '零售价（线下零售时用于计算实际销售额）',
    machine_price                   DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '零售机供货价（零售机供货时用于计算销售额）',
    total_delivery_fee              DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '总包配送费（农夫山泉结算给经销商）',
    distribution_delivery_fee       DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '分销配送费（经销商结算给水站）',
    worker_retail_delivery_fee      DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '工人零售配送费（终端零售客户配送）',
    worker_wholesale_delivery_fee   DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '工人水站配送费（面包车配送给水站）',
    worker_machine_delivery_fee     DECIMAL(8,2)    NOT NULL DEFAULT 0.00 COMMENT '工人零售机配送费（面包车配送给零售机）',
    subtotal                        DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '明细小计（根据订单类型：线上=进货价*数量，分销=批发价*数量，零售=零售价*数量，零售机=零售机供货价*数量）',
    PRIMARY KEY (item_id),
    KEY idx_order (order_id),
    KEY idx_product (product_id),
    CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单商品明细表';
```

- [ ] **Step 10: 添加 delivery_fee_settlement 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 8. 配送费结算表
-- ============================================================
CREATE TABLE delivery_fee_settlement (
    settlement_id           VARCHAR(50)     NOT NULL COMMENT '结算ID，主键',
    order_id                VARCHAR(50)     NOT NULL COMMENT '订单ID，外键关联orders表',
    product_id              VARCHAR(50)     NOT NULL COMMENT '商品ID，外键关联products表',
    quantity                INT             NOT NULL COMMENT '商品数量',
    settlement_type         TINYINT(1)      NOT NULL COMMENT '配送费类型：1-总包配送费（农夫山泉→经销商），2-分销配送费（经销商→水站），3-工人零售配送费，4-工人水站配送费，5-工人零售机配送费',
    fee_amount              DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '配送费金额（根据类型取对应配送费*数量）',
    delivery_fee_diff       DECIMAL(10,2)   DEFAULT NULL COMMENT '配送费差价（经销商实际赚取的配送费差价：水站配送时=总包配送费-分销配送费，自有员工配送时=总包配送费-工人配送费）',
    payee_type              TINYINT(1)      NOT NULL COMMENT '收款方类型：1-经销商（农夫山泉结算），2-水站，3-自有员工',
    payee_id                VARCHAR(50)     DEFAULT NULL COMMENT '收款方ID（水站ID或员工ID）',
    settlement_status       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '结算状态：0-未结算，1-已结算',
    settlement_date         DATETIME        DEFAULT NULL COMMENT '实际结算日期',
    remark                  VARCHAR(500)    DEFAULT NULL COMMENT '备注',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (settlement_id),
    KEY idx_order (order_id),
    KEY idx_product (product_id),
    KEY idx_settlement_type (settlement_type),
    KEY idx_settlement_status (settlement_status),
    CONSTRAINT fk_delivery_settlement_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_delivery_settlement_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='配送费结算表';
```

- [ ] **Step 11: 添加 financial_settlement 表创建语句**

在 `database/init.sql` 中追加：

```sql
-- ============================================================
-- 9. 资金结算对账表
-- ============================================================
CREATE TABLE financial_settlement (
    settlement_id           VARCHAR(50)     NOT NULL COMMENT '结算ID，主键',
    settlement_type         TINYINT(1)      NOT NULL COMMENT '结算类型：1-线上平台货款结算（农夫山泉→经销商），2-线上配送费结算（农夫山泉→经销商），3-线下水站货款结算（水站→经销商），4-分销配送费结算（经销商→水站），5-工人零售配送费结算（经销商→员工），6-工人水站配送费结算（经销商→员工），7-工人零售机配送费结算（经销商→员工），8-线下零售收入，9-零售机供货收入',
    order_id                VARCHAR(50)     DEFAULT NULL COMMENT '关联订单ID',
    station_id              VARCHAR(50)     DEFAULT NULL COMMENT '关联水站ID（结算类型=3、4时填写）',
    worker_id               VARCHAR(50)     DEFAULT NULL COMMENT '关联员工ID（结算类型=5、6、7时填写）',
    platform_type           VARCHAR(50)     DEFAULT NULL COMMENT '平台类型（结算类型=1、2时填写）',
    settlement_period       VARCHAR(20)     DEFAULT NULL COMMENT '结算周期（如2026-07）',
    amount                  DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT '结算金额',
    settlement_status       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '结算状态：0-待结算，1-已结算，2-有争议',
    settlement_date         DATETIME        DEFAULT NULL COMMENT '实际结算日期',
    bank_account            VARCHAR(100)    DEFAULT NULL COMMENT '收款/付款账户',
    transaction_no          VARCHAR(100)    DEFAULT NULL COMMENT '银行交易号',
    remark                  VARCHAR(500)    DEFAULT NULL COMMENT '备注',
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (settlement_id),
    KEY idx_settlement_type (settlement_type),
    KEY idx_order (order_id),
    KEY idx_station (station_id),
    KEY idx_worker (worker_id),
    KEY idx_settlement_period (settlement_period),
    KEY idx_settlement_status (settlement_status),
    CONSTRAINT fk_financial_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_financial_station FOREIGN KEY (station_id) REFERENCES sub_stations(station_id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_financial_worker FOREIGN KEY (worker_id) REFERENCES workers(worker_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资金结算对账表';

-- ============================================================
-- 脚本执行完毕
-- ============================================================
SELECT '数据库初始化完成！共创建9张表。' AS message;
```

- [ ] **Step 12: 验证 init.sql 语法**

Run: 检查文件是否完整，确认9张表的CREATE TABLE语句都存在
Expected: 文件包含9个CREATE TABLE语句

---

### Task 2: 创建测试数据脚本（test_data.sql）

**Files:**
- Create: `database/test_data.sql`

- [ ] **Step 1: 创建 test_data.sql 文件**

创建 `database/test_data.sql`，写入以下内容：

```sql
-- ============================================================
-- 农夫山泉经销商进销存系统 - 测试数据脚本
-- 说明: 执行此脚本将插入测试数据，用于验证表结构
-- 注意: 请先执行 init.sql 创建表结构
-- ============================================================

USE nongfu_inventory;

-- ============================================================
-- 1. 商品信息（3个测试商品）
-- ============================================================
INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, category) VALUES
('P001', 'SPBM001', '农夫山泉饮用天然水550ml', '550ml*24瓶', '箱', 24.00, 28.00, 35.00, 30.00, 5.00, 3.00, 2.00, 1.50, 1.20, '矿泉水'),
('P002', 'SPBM002', '农夫山泉茶π500ml', '500ml*24瓶', '箱', 36.00, 42.00, 48.00, 44.00, 5.00, 3.00, 2.00, 1.50, 1.20, '茶饮料'),
('P003', 'SPBM003', '农夫果园30%混合果蔬450ml', '450ml*24瓶', '箱', 30.00, 35.00, 40.00, 37.00, 5.00, 3.00, 2.00, 1.50, 1.20, '果汁');

-- ============================================================
-- 2. 下级水站信息（2个测试水站）
-- ============================================================
INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, area, credit_limit, current_debt, payment_type, bank_name, bank_account, account_name, invoice_title, tax_number, invoice_address, invoice_phone) VALUES
('S001', '鼓楼区便民水站', '张三', '13800001111', '南京市鼓楼区中山路100号', '鼓楼区', 5000.00, 1200.00, 2, '中国工商银行', '6222021234567890123', '张三', '鼓楼区便民水站', '91320100MA12345678', '南京市鼓楼区中山路100号', '025-83331111'),
('S002', '玄武区天天水站', '李四', '13800002222', '南京市玄武区珠江路200号', '玄武区', 8000.00, 0.00, 1, '中国建设银行', '6227001234567890123', '李四', '玄武区天天水站', '91320100MA87654321', '南京市玄武区珠江路200号', '025-84442222');

-- ============================================================
-- 3. 配送员工（2个测试员工）
-- ============================================================
INSERT INTO workers (worker_id, worker_name, phone, vehicle_type, bank_name, bank_account) VALUES
('W001', '王五', '13900005555', 1, '中国农业银行', '6228481234567890123'),
('W002', '赵六', '13900006666', 2, '中国银行', '6217001234567890123');

-- ============================================================
-- 4. 库存（对应3个商品）
-- ============================================================
INSERT INTO inventory (product_id, quantity, last_in_time) VALUES
('P001', 500, '2026-07-01 10:00:00'),
('P002', 300, '2026-07-01 10:00:00'),
('P003', 200, '2026-07-01 10:00:00');

-- ============================================================
-- 5. 进货记录（2笔测试进货）
-- ============================================================
INSERT INTO purchase_records (purchase_id, product_id, quantity, unit_price, total_amount, payment_status, payment_date, supplier) VALUES
('PR20260701001', 'P001', 500, 24.00, 12000.00, 1, '2026-07-01 09:00:00', '农夫山泉'),
('PR20260701002', 'P002', 300, 36.00, 10800.00, 1, '2026-07-01 09:30:00', '农夫山泉');

-- ============================================================
-- 6. 订单（4种类型各1笔）
-- ============================================================
-- 线上平台销售订单
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, order_status) VALUES
('OD20260709001', 1, '美团', 'MT20260709001', '客户甲', '13700001234', '南京市秦淮区夫子庙', 48.00, 5.00, 53.00, 1, 'W001', 0, 0.00, 1);

-- 线下水站分销订单（水站配送）
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, payment_status, paid_amount, order_status) VALUES
('OD20260709002', 2, 'S001', '张三', '13800001111', '南京市鼓楼区中山路100号', 280.00, 30.00, 310.00, 2, 2, 0.00, 2);

-- 线下零售订单
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, order_status) VALUES
('OD20260709003', 3, '客户乙', '13700005678', '南京市建邺区河西大街', 70.00, 4.00, 74.00, 1, 'W001', 1, 74.00, 2);

-- 零售机供货订单
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, order_status) VALUES
('OD20260709004', 4, '零售机-河西001', '无', '南京市建邺区河西大街88号', 600.00, 24.00, 624.00, 1, 'W002', 1, 624.00, 2);

-- ============================================================
-- 7. 订单商品明细
-- ============================================================
-- 线上订单明细（按进货价计算）
INSERT INTO order_items (order_id, product_id, quantity, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('OD20260709001', 'P001', 2, 24.00, 28.00, 35.00, 30.00, 5.00, 3.00, 2.00, 1.50, 1.20, 48.00);

-- 水站分销订单明细（按批发价计算，10箱）
INSERT INTO order_items (order_id, product_id, quantity, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('OD20260709002', 'P001', 10, 24.00, 28.00, 35.00, 30.00, 5.00, 3.00, 2.00, 1.50, 1.20, 280.00);

-- 线下零售订单明细（按零售价计算，2箱）
INSERT INTO order_items (order_id, product_id, quantity, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('OD20260709003', 'P001', 2, 24.00, 28.00, 35.00, 30.00, 5.00, 3.00, 2.00, 1.50, 1.20, 70.00);

-- 零售机供货订单明细（按零售机供货价计算，20箱）
INSERT INTO order_items (order_id, product_id, quantity, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('OD20260709004', 'P002', 20, 36.00, 42.00, 48.00, 44.00, 5.00, 3.00, 2.00, 1.50, 1.20, 600.00);

-- ============================================================
-- 8. 配送费结算（示例）
-- ============================================================
-- 线上订单：农夫山泉结算总包配送费给经销商
INSERT INTO delivery_fee_settlement (settlement_id, order_id, product_id, quantity, settlement_type, fee_amount, delivery_fee_diff, payee_type, payee_id, settlement_status) VALUES
('DS20260709001', 'OD20260709001', 'P001', 2, 1, 10.00, NULL, 1, NULL, 0);

-- 线上订单：经销商付工人零售配送费
INSERT INTO delivery_fee_settlement (settlement_id, order_id, product_id, quantity, settlement_type, fee_amount, delivery_fee_diff, payee_type, payee_id, settlement_status) VALUES
('DS20260709002', 'OD20260709001', 'P001', 2, 3, 4.00, 6.00, 3, 'W001', 0);

-- 水站分销订单：农夫山泉结算总包配送费给经销商
INSERT INTO delivery_fee_settlement (settlement_id, order_id, product_id, quantity, settlement_type, fee_amount, delivery_fee_diff, payee_type, payee_id, settlement_status) VALUES
('DS20260709003', 'OD20260709002', 'P001', 10, 1, 50.00, NULL, 1, NULL, 0);

-- 水站分销订单：经销商结算分销配送费给水站
INSERT INTO delivery_fee_settlement (settlement_id, order_id, product_id, quantity, settlement_type, fee_amount, delivery_fee_diff, payee_type, payee_id, settlement_status) VALUES
('DS20260709004', 'OD20260709002', 'P001', 10, 2, 30.00, 20.00, 2, 'S001', 0);

-- ============================================================
-- 9. 资金结算对账（示例）
-- ============================================================
INSERT INTO financial_settlement (settlement_id, settlement_type, order_id, station_id, worker_id, platform_type, settlement_period, amount, settlement_status) VALUES
('FS202607001', 1, 'OD20260709001', NULL, NULL, '美团', '2026-07', 48.00, 0),
('FS202607002', 2, 'OD20260709001', NULL, NULL, '美团', '2026-07', 10.00, 0),
('FS202607003', 5, 'OD20260709001', NULL, 'W001', NULL, '2026-07', 4.00, 0),
('FS202607004', 3, 'OD20260709002', 'S001', NULL, NULL, '2026-07', 280.00, 0),
('FS202607005', 4, 'OD20260709002', 'S001', NULL, NULL, '2026-07', 30.00, 0),
('FS202607006', 8, 'OD20260709003', NULL, NULL, NULL, '2026-07', 74.00, 1),
('FS202607007', 5, 'OD20260709003', NULL, 'W001', NULL, '2026-07', 4.00, 1),
('FS202607008', 9, 'OD20260709004', NULL, NULL, NULL, '2026-07', 624.00, 1),
('FS202607009', 7, 'OD20260709004', NULL, 'W002', NULL, '2026-07', 24.00, 1);

-- ============================================================
-- 测试数据插入完毕
-- ============================================================
SELECT '测试数据插入完成！' AS message;
SELECT CONCAT('商品: ', COUNT(*), ' 条') AS info FROM products
UNION ALL
SELECT CONCAT('水站: ', COUNT(*), ' 条') FROM sub_stations
UNION ALL
SELECT CONCAT('员工: ', COUNT(*), ' 条') FROM workers
UNION ALL
SELECT CONCAT('订单: ', COUNT(*), ' 条') FROM orders
UNION ALL
SELECT CONCAT('订单明细: ', COUNT(*), ' 条') FROM order_items
UNION ALL
SELECT CONCAT('配送费结算: ', COUNT(*), ' 条') FROM delivery_fee_settlement
UNION ALL
SELECT CONCAT('资金对账: ', COUNT(*), ' 条') FROM financial_settlement;
```

---

### Task 3: 创建使用说明文档（README.md）

**Files:**
- Create: `database/README.md`

- [ ] **Step 1: 创建 README.md 文件**

创建 `database/README.md`，写入以下内容：

````markdown
# 农夫山泉经销商进销存系统 - 数据库使用说明

## 环境要求

- MySQL 5.7 或更高版本（推荐 MySQL 8.0）
- 任意 MySQL 客户端工具（如 Navicat、MySQL Workbench、DBeaver、命令行）

## 文件说明

| 文件 | 说明 |
| :--- | :--- |
| `init.sql` | 数据库初始化脚本，创建数据库和所有9张表 |
| `test_data.sql` | 测试数据脚本，插入示例数据用于验证 |
| `README.md` | 本使用说明文件 |

## 安装步骤

### 方式一：使用 Navicat 等图形化工具（推荐）

1. 打开 Navicat，连接到你的 MySQL 服务器
2. 右键连接 → "新建查询"
3. 打开 `init.sql` 文件，复制全部内容粘贴到查询窗口
4. 点击"运行"按钮执行脚本
5. 刷新数据库列表，应能看到 `nongfu_inventory` 数据库
6. （可选）打开 `test_data.sql`，复制内容到新查询窗口执行，插入测试数据

### 方式二：使用 MySQL 命令行

1. 打开命令提示符（CMD）或终端
2. 登录 MySQL：
   ```
   mysql -u root -p
   ```
3. 输入密码后执行初始化脚本：
   ```
   source C:/路径/database/init.sql
   ```
4. （可选）执行测试数据脚本：
   ```
   source C:/路径/database/test_data.sql
   ```
5. 输入 `exit` 退出

### 方式三：使用 MySQL Workbench

1. 打开 MySQL Workbench，连接到 MySQL 服务器
2. 菜单栏 → File → Open SQL Script → 选择 `init.sql`
3. 点击闪电图标（Execute）运行脚本
4. （可选）重复步骤2-3执行 `test_data.sql`

## 数据库结构概览

数据库名称：`nongfu_inventory`

共9张表，按业务功能分为4类：

### 基础信息（3张）
1. **products** - 商品信息表（含4种价格和5种配送费）
2. **sub_stations** - 下级水站信息表（含发票付款信息）
3. **workers** - 配送员工表

### 库存与进货（2张）
4. **inventory** - 总仓库库存表
5. **purchase_records** - 进货记录表

### 订单管理（2张）
6. **orders** - 订单主表（4种订单类型）
7. **order_items** - 订单商品明细表

### 资金结算（2张）
8. **delivery_fee_settlement** - 配送费结算表
9. **financial_settlement** - 资金结算对账表

## 订单类型说明

| 类型 | 名称 | order_amount 计算 | 配送费付给 |
| :--- | :--- | :--- | :--- |
| 1 | 线上平台销售 | 进货价总和 | 农夫山泉→经销商，经销商→员工 |
| 2 | 线下水站分销 | 批发价总和 | 农夫山泉→经销商，经销商→水站/员工 |
| 3 | 线下零售 | 零售价总和 | 经销商→员工 |
| 4 | 零售机供货 | 零售机供货价总和 | 经销商→员工 |

## 常用查询示例

### 查看当前库存
```sql
SELECT p.product_code, p.product_name, p.unit, i.quantity, i.last_in_time
FROM inventory i
JOIN products p ON i.product_id = p.product_id
ORDER BY i.quantity DESC;
```

### 查看水站欠款
```sql
SELECT station_name, contact_name, phone, current_debt, credit_limit
FROM sub_stations
WHERE current_debt > 0
ORDER BY current_debt DESC;
```

### 按订单类型统计销售
```sql
SELECT 
    CASE order_type 
        WHEN 1 THEN '线上平台销售'
        WHEN 2 THEN '线下水站分销'
        WHEN 3 THEN '线下零售'
        WHEN 4 THEN '零售机供货'
    END AS order_type_name,
    COUNT(*) AS order_count,
    SUM(order_amount) AS total_amount,
    SUM(delivery_fee) AS total_delivery_fee
FROM orders
WHERE order_status = 2
GROUP BY order_type;
```

### 查看待结算资金
```sql
SELECT 
    settlement_id,
    CASE settlement_type
        WHEN 1 THEN '线上平台货款'
        WHEN 2 THEN '线上配送费'
        WHEN 3 THEN '水站货款'
        WHEN 4 THEN '分销配送费'
        WHEN 5 THEN '工人零售配送费'
        WHEN 6 THEN '工人水站配送费'
        WHEN 7 THEN '工人零售机配送费'
        WHEN 8 THEN '线下零售收入'
        WHEN 9 THEN '零售机供货收入'
    END AS type_name,
    amount,
    settlement_period
FROM financial_settlement
WHERE settlement_status = 0
ORDER BY settlement_period;
```

## 重新初始化

如需重新创建数据库（会删除所有数据），直接重新执行 `init.sql` 即可，脚本开头会自动删除已存在的表。
````

---

### Task 4: 验证脚本完整性

**Files:**
- 验证: `database/init.sql`, `database/test_data.sql`, `database/README.md`

- [ ] **Step 1: 验证 init.sql 包含9张表**

Run: 在 init.sql 中搜索 "CREATE TABLE"
Expected: 找到9个匹配：products, sub_stations, workers, inventory, purchase_records, orders, order_items, delivery_fee_settlement, financial_settlement

- [ ] **Step 2: 验证 test_data.sql 包含测试数据**

Run: 在 test_data.sql 中搜索 "INSERT INTO"
Expected: 找到9个匹配（对应9张表的测试数据）

- [ ] **Step 3: 验证 README.md 包含使用说明**

Run: 检查 README.md 是否包含"安装步骤"和"常用查询示例"
Expected: 文档完整，包含3种安装方式和4个查询示例

- [ ] **Step 4: 确认所有文件已创建**

Run: 列出 database 目录
Expected: 包含 init.sql, test_data.sql, README.md 三个文件

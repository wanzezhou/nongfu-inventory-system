# 农夫山泉经销商进销存系统 - 数据库文档

## 1. 环境要求

### 1.1 MySQL 版本要求
- **MySQL 5.7+** 或 **MySQL 8.0+**
- 推荐使用 MySQL 8.0 或更高版本
- 数据库字符集：`utf8mb4`
- 数据库排序规则：`utf8mb4_unicode_ci`

### 1.2 客户端工具（任选其一）
- **Navicat for MySQL** - 图形化管理工具，推荐用于可视化操作
- **MySQL Workbench** - 官方图形化工具，免费开源
- **MySQL 命令行客户端** - 原生命令行工具，适合服务器环境

---

## 2. 文件说明

| 文件名 | 说明 |
|--------|------|
| `init.sql` | 数据库初始化脚本，创建完整的数据库表结构（9张表） |
| `test_data.sql` | 测试数据脚本，插入示例数据用于系统测试和演示 |
| `backup.bat` | 一键备份脚本，双击即可备份当前数据库 |
| `restore.bat` | 一键恢复脚本，双击即可从备份恢复数据库 |
| `backup/` | 备份文件目录，存放所有备份的 SQL 文件 |
| `README.md` | 数据库说明文档（本文档） |

### 文件执行顺序
1. 首先执行 `init.sql` 创建表结构
2. 然后执行 `test_data.sql` 插入测试数据

---

## 3. 安装步骤

### 3.1 方式一：Navicat 图形化工具

1. **打开 Navicat**，连接到 MySQL 服务器
2. 在左侧面板中，右键点击连接名，选择 **"新建数据库"**
3. 数据库名填写：`nongfu_inventory`，字符集选择：`utf8mb4`，排序规则选择：`utf8mb4_unicode_ci`
4. 点击 **"确定"** 创建数据库
5. 在左侧面板中，右键点击 `nongfu_inventory` 数据库，选择 **"运行 SQL 文件..."**
6. 在弹出的对话框中，点击 **"..."** 按钮，选择 `init.sql` 文件
7. 点击 **"开始"** 执行脚本
8. 重复步骤 5-7，执行 `test_data.sql` 文件

### 3.2 方式二：MySQL 命令行

1. **打开命令行终端**，登录 MySQL：
   ```bash
   mysql -u root -p
   ```
   输入密码后进入 MySQL 命令行。

2. **创建数据库**：
   ```sql
   CREATE DATABASE IF NOT EXISTS nongfu_inventory
       DEFAULT CHARACTER SET utf8mb4
       DEFAULT COLLATE utf8mb4_unicode_ci;
   ```

3. **使用数据库**：
   ```sql
   USE nongfu_inventory;
   ```

4. **执行初始化脚本**：
   ```bash
   source /path/to/init.sql
   ```
   （将 `/path/to/` 替换为实际文件路径）

5. **执行测试数据脚本**：
   ```bash
   source /path/to/test_data.sql
   ```

### 3.3 方式三：MySQL Workbench

1. **打开 MySQL Workbench**，连接到 MySQL 服务器
2. 在左侧面板中，右键点击连接名，选择 **"Create Schema..."**
3. Schema Name 填写：`nongfu_inventory`，Default Character Set 选择：`utf8mb4`，Default Collation 选择：`utf8mb4_unicode_ci`
4. 点击 **"Apply"** 创建数据库
5. 在顶部菜单栏中，选择 **"File" > "Open SQL Script..."**
6. 选择 `init.sql` 文件，点击 **"Open"**
7. 点击工具栏中的 **"Execute"** 按钮（闪电图标）执行脚本
8. 重复步骤 5-7，执行 `test_data.sql` 文件

---

## 4. 数据库结构概览

系统共包含 **9 张表**，分为以下几类：

### 4.1 基础信息表

| 表名 | 说明 | 主键 |
|------|------|------|
| `products` | 商品信息表，存储商品的基本信息和各类价格 | `product_id` |
| `sub_stations` | 下级水站信息表，存储水站的基本信息和财务数据 | `station_id` |
| `workers` | 配送员工表，存储员工的基本信息和银行账户 | `worker_id` |

### 4.2 库存与进货表

| 表名 | 说明 | 主键 |
|------|------|------|
| `inventory` | 总仓库库存表，记录各商品的当前库存数量 | `inventory_id`（自增） |
| `purchase_records` | 进货记录表，记录从农夫山泉进货的明细 | `purchase_id` |

### 4.3 订单表

| 表名 | 说明 | 主键 |
|------|------|------|
| `orders` | 订单主表，记录订单的基本信息和状态 | `order_id` |
| `order_items` | 订单商品明细表，记录订单中的商品明细和各类价格 | `item_id`（自增） |

### 4.4 结算表

| 表名 | 说明 | 主键 |
|------|------|------|
| `delivery_fee_settlement` | 配送费结算表，记录配送费的结算明细 | `settlement_id` |
| `financial_settlement` | 资金结算对账表，记录各类资金的结算对账 | `settlement_id` |

---

## 5. 订单类型说明

系统支持 **4 种订单类型**，每种类型的金额计算和配送费流向不同：

### 5.1 订单类型一览

| 类型编号 | 类型名称 | 订单金额计算方式 | 配送费来源 |
|----------|----------|------------------|------------|
| 1 | 线上平台销售 | 进货价总和 | 农夫山泉结算（总包配送费） |
| 2 | 线下水站分销 | 批发价总和 | 农夫山泉结算（总包配送费） |
| 3 | 线下零售 | 零售价总和 | 农夫山泉结算（总包配送费） |
| 4 | 零售机供货 | 零售机供货价总和 | 农夫山泉结算（总包配送费） |

### 5.2 详细说明

#### 5.2.1 线上平台销售（类型1）
- **金额计算**：订单金额 = 商品进货价 × 数量
- **配送费流向**：
  - 农夫山泉结算总包配送费给经销商
  - 经销商结算工人零售配送费给配送员工
  - 经销商赚取差价 = 总包配送费 - 工人零售配送费

#### 5.2.2 线下水站分销（类型2）
- **金额计算**：订单金额 = 商品批发价 × 数量
- **配送费流向**：
  - 农夫山泉结算总包配送费给经销商
  - 经销商结算分销配送费给水站
  - 经销商赚取差价 = 总包配送费 - 分销配送费

#### 5.2.3 线下零售（类型3）
- **金额计算**：订单金额 = 商品零售价 × 数量
- **配送费流向**：
  - 农夫山泉结算总包配送费给经销商
  - 经销商结算工人零售配送费给配送员工
  - 经销商赚取差价 = 总包配送费 - 工人零售配送费

#### 5.2.4 零售机供货（类型4）
- **金额计算**：订单金额 = 商品零售机供货价 × 数量
- **配送费流向**：
  - 农夫山泉结算总包配送费给经销商
  - 经销商结算工人零售机配送费给配送员工
  - 经销商赚取差价 = 总包配送费 - 工人零售机配送费

---

## 6. 常用查询示例

### 6.1 库存查询

查询当前库存数量大于 0 的商品：
```sql
SELECT p.product_name, p.specification, p.unit, i.quantity, i.last_in_time, i.last_out_time
FROM inventory i
JOIN products p ON i.product_id = p.product_id
WHERE i.quantity > 0
ORDER BY i.quantity DESC;
```

### 6.2 水站欠款查询

查询所有水站的欠款情况：
```sql
SELECT station_name, contact_name, phone, area, credit_limit, current_debt,
    (credit_limit - current_debt) AS available_credit
FROM sub_stations
WHERE status = 1
ORDER BY current_debt DESC;
```

查询欠款超过信用额度 80% 的水站：
```sql
SELECT station_name, current_debt, credit_limit,
    (current_debt / credit_limit * 100) AS debt_ratio
FROM sub_stations
WHERE status = 1 AND current_debt > credit_limit * 0.8;
```

### 6.3 订单统计

按订单类型统计订单数量和总金额：
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
    SUM(delivery_fee) AS total_delivery_fee,
    SUM(total_receivable) AS total_receivable
FROM orders
WHERE canceled_at IS NULL
GROUP BY order_type
ORDER BY order_type;
```

统计待配送订单数量（自有员工配送且未分配配送员、未取消）——注：仪表盘该卡片已于 2026-09-16 下线，此 SQL 仅作通用查询示例：
```sql
SELECT COUNT(*) AS pending_count
FROM orders
WHERE delivery_type = 1 AND worker_id IS NULL AND canceled_at IS NULL;
```

### 6.4 待结算资金查询

查询待结算的配送费：
```sql
SELECT 
    CASE settlement_type 
        WHEN 1 THEN '总包配送费（农夫山泉→经销商）'
        WHEN 2 THEN '分销配送费（经销商→水站）'
        WHEN 3 THEN '工人零售配送费'
        WHEN 4 THEN '工人水站配送费'
        WHEN 5 THEN '工人零售机配送费'
    END AS settlement_type_name,
    COUNT(*) AS settlement_count,
    SUM(fee_amount) AS total_amount
FROM delivery_fee_settlement
WHERE settlement_status = 0
GROUP BY settlement_type
ORDER BY settlement_type;
```

查询待结算的资金：
```sql
SELECT 
    CASE settlement_type 
        WHEN 1 THEN '线上平台货款结算'
        WHEN 2 THEN '线上配送费结算'
        WHEN 3 THEN '线下水站货款结算'
        WHEN 4 THEN '分销配送费结算'
        WHEN 5 THEN '工人零售配送费结算'
        WHEN 6 THEN '工人水站配送费结算'
        WHEN 7 THEN '工人零售机配送费结算'
        WHEN 8 THEN '线下零售收入'
        WHEN 9 THEN '零售机供货收入'
    END AS settlement_type_name,
    COUNT(*) AS settlement_count,
    SUM(amount) AS total_amount
FROM financial_settlement
WHERE settlement_status = 0
GROUP BY settlement_type
ORDER BY settlement_type;
```

---

## 7. 数据库备份与恢复

### 7.1 一键备份（推荐）

直接双击 `database/backup.bat` 文件，即可自动备份当前数据库。

备份文件会保存在 `database/backup/` 目录下，文件名格式：
```
nongfu_inventory_YYYYMMDD_HHMM.sql
```

例如：`nongfu_inventory_20260710_2323.sql`

### 7.2 一键恢复

直接双击 `database/restore.bat` 文件，按提示操作：
1. 输入 `yes` 确认恢复
2. 输入要恢复的备份文件名（如 `nongfu_inventory_20260710_2323.sql`）
3. 等待恢复完成

⚠️ **注意**：恢复操作会覆盖当前数据库的所有数据，请确认后再操作。

### 7.3 命令行备份

```bash
mysqldump -u root nongfu_inventory > backup.sql
```

### 7.4 命令行恢复

```bash
mysql -u root nongfu_inventory < backup.sql
```

### 7.5 MySQL Workbench 备份

1. 菜单 **Server** → **Data Export**
2. 选择 `nongfu_inventory` 数据库
3. 选择导出路径和文件名
4. 点击 **Start Export**

### 7.6 MySQL Workbench 恢复

1. 菜单 **Server** → **Data Import**
2. 选择备份的 SQL 文件
3. 选择目标数据库
4. 点击 **Start Import**

---

## 8. 重新初始化说明

如需重新初始化数据库（清除所有数据并重建表结构），请按以下步骤操作：

### 8.1 注意事项
- **此操作将清除所有数据**，请确保已备份重要数据
- 脚本已包含 `DROP TABLE IF EXISTS` 语句，会按外键依赖逆序删除表

### 8.2 操作步骤

1. **关闭所有连接**到 `nongfu_inventory` 数据库的应用程序
2. **执行初始化脚本**：
   ```bash
   source /path/to/init.sql
   ```
3. **执行测试数据脚本**（如需）：
   ```bash
   source /path/to/test_data.sql
   ```

### 8.3 表删除顺序

脚本按照以下顺序删除表（外键依赖逆序）：
1. `financial_settlement`
2. `delivery_fee_settlement`
3. `order_items`
4. `orders`
5. `purchase_records`
6. `inventory`
7. `workers`
8. `sub_stations`
9. `products`

---

## 附录：表结构详细说明

### A.1 products（商品信息表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `product_id` | VARCHAR(50) | 商品ID，主键 |
| `product_code` | VARCHAR(50) | 商品编码 |
| `product_name` | VARCHAR(200) | 商品名称 |
| `specification` | VARCHAR(100) | 规格 |
| `unit` | VARCHAR(20) | 计量单位 |
| `purchase_price` | DECIMAL(10,2) | 进货价 |
| `wholesale_price` | DECIMAL(10,2) | 批发价 |
| `retail_price` | DECIMAL(10,2) | 零售价 |
| `machine_price` | DECIMAL(10,2) | 零售机供货价 |
| `total_delivery_fee` | DECIMAL(8,2) | 总包配送费 |
| `distribution_delivery_fee` | DECIMAL(8,2) | 分销配送费 |
| `worker_retail_delivery_fee` | DECIMAL(8,2) | 工人零售配送费 |
| `worker_wholesale_delivery_fee` | DECIMAL(8,2) | 工人水站配送费 |
| `worker_machine_delivery_fee` | DECIMAL(8,2) | 工人零售机配送费 |

### A.2 orders（订单主表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `order_id` | VARCHAR(50) | 订单ID，主键 |
| `order_type` | TINYINT(1) | 订单类型：1-线上平台销售，2-线下水站分销，3-线下零售，4-零售机供货 |
| `platform_type` | VARCHAR(50) | 平台类型（线上订单时填写） |
| `platform_order_no` | VARCHAR(100) | 平台订单号 |
| `station_id` | VARCHAR(50) | 水站ID（分销订单时填写） |
| `order_amount` | DECIMAL(12,2) | 订单总金额 |
| `delivery_fee` | DECIMAL(10,2) | 配送费金额 |
| `total_receivable` | DECIMAL(12,2) | 应收总金额 |
| `delivery_type` | TINYINT(1) | 配送方式：1-自有员工配送，2-水站配送，3-无需配送 |
| `worker_id` | VARCHAR(50) | 配送员工ID |
| `payment_status` | TINYINT(1) | 付款状态：0-未付款，1-已付款，2-部分付款 |
| `canceled_at` | DATETIME | 取消时间；非空表示该订单已取消（替代原 order_status=3） |

---

*文档版本：1.0*  
*创建日期：2026-07-09*  
*所属系统：农夫山泉经销商进销存系统*

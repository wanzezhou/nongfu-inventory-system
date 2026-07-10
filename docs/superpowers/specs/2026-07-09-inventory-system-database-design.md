# 农夫山泉经销商进销存系统 - 数据库设计文档

> 日期：2026-07-09
> 状态：已确认，待实现

## 1. 业务背景

本系统为农夫山泉南京本地经销商的进销存管理系统，覆盖以下业务模式：

- **账户预存**：向农夫山泉官方账户打款作为进货货款。
- **线上平台销售**：美团/饿了么等平台客户下单，经销商配送。客户钱打给农夫山泉，农夫山泉在下个账期按"进货价+配送费"结算给经销商。经销商只记录应收农夫山泉的货款和配送费，不记录客户实付金额。
- **线下水站分销**：经销商把货以批发价卖给下级水站，赚取差价。水站负责配送时，农夫山泉把配送费结给经销商，经销商再按更低的价格结给水站，赚取配送费差价。
- **线下零售**：经销商直接向终端零售客户销售，由自有配送员工配送。
- **零售机供货**：经销商大批量向分散在区域各处的零售机器配送供货。

### 工人配送费三种价格体系

| 配送场景 | 适用订单类型 | 配送车辆 | 特点 |
| :--- | :--- | :--- | :--- |
| 终端零售客户配送 | 3-线下零售 | 电动车 | 小批量、单件配送，可能有上楼需求 |
| 大批量配送给水站 | 2-线下水站分销（自有员工配送时） | 面包车 | 大批量整箱配送 |
| 大批量配送给零售机 | 4-零售机供货 | 面包车 | 大批量配送至各区域零售机 |

## 2. 数据库表结构设计

本设计采用"主表+明细表"模式，共9张表。

### 2.1 商品信息表（products）

存储所有商品的基本信息和价格体系。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `product_id` | VARCHAR(50) | 商品ID，主键 |
| `product_code` | VARCHAR(50) | 商品编码（如SPBM001） |
| `product_name` | VARCHAR(200) | 商品名称（如农夫山泉550ml） |
| `specification` | VARCHAR(100) | 规格（如550ml*24瓶） |
| `unit` | VARCHAR(20) | 计量单位（如箱） |
| `purchase_price` | DECIMAL(10,2) | 进货价（从农夫山泉进货的价格） |
| `wholesale_price` | DECIMAL(10,2) | 批发价（卖给下级水站的价格） |
| `retail_price` | DECIMAL(10,2) | 零售价（线下零售价格） |
| `machine_price` | DECIMAL(10,2) | 零售机供货价（配送给零售机的价格） |
| `total_delivery_fee` | DECIMAL(8,2) | 总包配送费（农夫山泉结算给经销商） |
| `distribution_delivery_fee` | DECIMAL(8,2) | 分销配送费（经销商结算给水站） |
| `worker_retail_delivery_fee` | DECIMAL(8,2) | 工人零售配送费（终端零售客户配送） |
| `worker_wholesale_delivery_fee` | DECIMAL(8,2) | 工人水站配送费（面包车配送给水站） |
| `worker_machine_delivery_fee` | DECIMAL(8,2) | 工人零售机配送费（面包车配送给零售机） |
| `category` | VARCHAR(50) | 商品分类（如矿泉水、饮料） |
| `image_url` | VARCHAR(500) | 商品图片URL |
| `status` | TINYINT(1) | 状态：0-停用，1-启用 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 2.2 总仓库库存表（inventory）

记录总仓库中各商品的实时库存数量。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `inventory_id` | INT | 库存ID，主键，自增 |
| `product_id` | VARCHAR(50) | 商品ID，外键关联products表 |
| `quantity` | INT | 库存数量 |
| `last_in_time` | DATETIME | 最后入库时间 |
| `last_out_time` | DATETIME | 最后出库时间 |
| `updated_at` | DATETIME | 更新时间 |

### 2.3 下级水站信息表（sub_stations）

记录下级水站的基本信息、信用额度和发票付款信息。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `station_id` | VARCHAR(50) | 水站ID，主键 |
| `station_name` | VARCHAR(100) | 水站名称 |
| `contact_name` | VARCHAR(50) | 联系人姓名 |
| `phone` | VARCHAR(20) | 联系电话 |
| `address` | VARCHAR(500) | 水站地址 |
| `area` | VARCHAR(50) | 覆盖区域（如南京鼓楼区） |
| `credit_limit` | DECIMAL(12,2) | 信用额度（允许的最大欠款金额） |
| `current_debt` | DECIMAL(12,2) | 当前欠款余额 |
| `payment_type` | TINYINT(1) | 付款方式：1-先付款后拿货，2-先拿货后付款 |
| `bank_name` | VARCHAR(100) | 付款银行 |
| `bank_account` | VARCHAR(50) | 付款账户 |
| `account_name` | VARCHAR(100) | 账户户名 |
| `invoice_title` | VARCHAR(200) | 发票抬头 |
| `tax_number` | VARCHAR(50) | 纳税人识别号 |
| `invoice_address` | VARCHAR(500) | 发票地址 |
| `invoice_phone` | VARCHAR(20) | 发票电话 |
| `status` | TINYINT(1) | 状态：0-停用，1-启用 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 2.4 进货记录表（purchase_records）

记录从农夫山泉进货的每一笔记录。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `purchase_id` | VARCHAR(50) | 进货单号，主键 |
| `product_id` | VARCHAR(50) | 商品ID，外键关联products表 |
| `quantity` | INT | 进货数量 |
| `unit_price` | DECIMAL(10,2) | 进货单价（实际结算价格） |
| `total_amount` | DECIMAL(12,2) | 总金额 |
| `payment_status` | TINYINT(1) | 付款状态：0-未付款，1-已付款 |
| `payment_date` | DATETIME | 付款日期 |
| `supplier` | VARCHAR(100) | 供应商（如农夫山泉） |
| `remark` | VARCHAR(500) | 备注 |
| `created_at` | DATETIME | 创建时间 |

### 2.5 订单主表（orders）

记录所有订单的基本信息，通过 `order_type` 区分四种业务场景。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `order_id` | VARCHAR(50) | 订单ID，主键 |
| `order_type` | TINYINT(1) | 订单类型：1-线上平台销售，2-线下水站分销，3-线下零售，4-零售机供货 |
| `platform_type` | VARCHAR(50) | 平台类型（订单类型=1时填写，如美团、饿了么） |
| `platform_order_no` | VARCHAR(100) | 平台订单号（订单类型=1时填写） |
| `station_id` | VARCHAR(50) | 水站ID（订单类型=2时填写，外键关联sub_stations表） |
| `customer_name` | VARCHAR(100) | 客户姓名 |
| `customer_phone` | VARCHAR(20) | 客户电话 |
| `customer_address` | VARCHAR(500) | 客户地址 |
| `order_amount` | DECIMAL(12,2) | 订单总金额（线上=进货价总和，分销=批发价总和，零售=零售价总和，零售机=零售机供货价总和） |
| `delivery_fee` | DECIMAL(10,2) | 配送费金额 |
| `total_receivable` | DECIMAL(12,2) | 应收总金额（订单金额+配送费） |
| `delivery_type` | TINYINT(1) | 配送方式：1-自有员工配送，2-水站配送，3-无需配送 |
| `worker_id` | VARCHAR(50) | 配送员工ID（配送方式=1时填写，外键关联workers表） |
| `payment_status` | TINYINT(1) | 付款状态：0-未付款，1-已付款，2-部分付款 |
| `paid_amount` | DECIMAL(12,2) | 已付款金额 |
| `order_status` | TINYINT(1) | 订单状态：0-待处理，1-已发货，2-已完成，3-已取消 |
| `remark` | VARCHAR(500) | 备注 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 2.6 订单商品明细表（order_items）

记录每个订单中的商品明细，价格字段根据订单类型取用。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `item_id` | INT | 明细ID，主键，自增 |
| `order_id` | VARCHAR(50) | 订单ID，外键关联orders表 |
| `product_id` | VARCHAR(50) | 商品ID，外键关联products表 |
| `quantity` | INT | 商品数量 |
| `purchase_price` | DECIMAL(10,2) | 进货价（线上销售时用于计算应收农夫山泉的货款） |
| `wholesale_price` | DECIMAL(10,2) | 批发价（线下分销时用于计算水站应付款） |
| `retail_price` | DECIMAL(10,2) | 零售价（线下零售时用于计算实际销售额） |
| `machine_price` | DECIMAL(10,2) | 零售机供货价（零售机供货时用于计算销售额） |
| `total_delivery_fee` | DECIMAL(8,2) | 总包配送费（农夫山泉结算给经销商） |
| `distribution_delivery_fee` | DECIMAL(8,2) | 分销配送费（经销商结算给水站） |
| `worker_retail_delivery_fee` | DECIMAL(8,2) | 工人零售配送费（终端零售客户配送） |
| `worker_wholesale_delivery_fee` | DECIMAL(8,2) | 工人水站配送费（面包车配送给水站） |
| `worker_machine_delivery_fee` | DECIMAL(8,2) | 工人零售机配送费（面包车配送给零售机） |
| `subtotal` | DECIMAL(12,2) | 明细小计（根据订单类型：线上=进货价*数量，分销=批发价*数量，零售=零售价*数量，零售机=零售机供货价*数量） |

### 2.7 配送员工表（workers）

记录自有配送员工的基本信息和收款账户。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `worker_id` | VARCHAR(50) | 员工ID，主键 |
| `worker_name` | VARCHAR(50) | 员工姓名 |
| `phone` | VARCHAR(20) | 联系电话 |
| `vehicle_type` | TINYINT(1) | 配送车辆类型：1-电动车（终端零售），2-面包车（批量配送） |
| `bank_name` | VARCHAR(100) | 收款银行 |
| `bank_account` | VARCHAR(50) | 收款账户 |
| `status` | TINYINT(1) | 状态：0-离职，1-在职 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

### 2.8 配送费结算表（delivery_fee_settlement）

单独记录每笔订单的配送费结算明细，支持五种配送费类型。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `settlement_id` | VARCHAR(50) | 结算ID，主键 |
| `order_id` | VARCHAR(50) | 订单ID，外键关联orders表 |
| `product_id` | VARCHAR(50) | 商品ID，外键关联products表 |
| `quantity` | INT | 商品数量 |
| `settlement_type` | TINYINT(1) | 配送费类型：1-总包配送费（农夫山泉→经销商），2-分销配送费（经销商→水站），3-工人零售配送费，4-工人水站配送费，5-工人零售机配送费 |
| `fee_amount` | DECIMAL(10,2) | 配送费金额（根据类型取对应配送费*数量） |
| `delivery_fee_diff` | DECIMAL(10,2) | 配送费差价（经销商实际赚取的配送费差价：水站配送时=总包配送费-分销配送费，自有员工配送时=总包配送费-工人配送费） |
| `payee_type` | TINYINT(1) | 收款方类型：1-经销商（农夫山泉结算），2-水站，3-自有员工 |
| `payee_id` | VARCHAR(50) | 收款方ID（水站ID或员工ID） |
| `settlement_status` | TINYINT(1) | 结算状态：0-未结算，1-已结算 |
| `settlement_date` | DATETIME | 实际结算日期 |
| `remark` | VARCHAR(500) | 备注 |
| `created_at` | DATETIME | 创建时间 |

### 2.9 资金结算对账表（financial_settlement）

记录所有资金往来（货款和配送费）的对账信息，支持九种结算类型。

| 字段名 | 类型 | 注释 |
| :--- | :--- | :--- |
| `settlement_id` | VARCHAR(50) | 结算ID，主键 |
| `settlement_type` | TINYINT(1) | 结算类型：1-线上平台货款结算（农夫山泉→经销商），2-线上配送费结算（农夫山泉→经销商），3-线下水站货款结算（水站→经销商），4-分销配送费结算（经销商→水站），5-工人零售配送费结算（经销商→员工），6-工人水站配送费结算（经销商→员工），7-工人零售机配送费结算（经销商→员工），8-线下零售收入，9-零售机供货收入 |
| `order_id` | VARCHAR(50) | 关联订单ID |
| `station_id` | VARCHAR(50) | 关联水站ID（结算类型=3、4时填写） |
| `worker_id` | VARCHAR(50) | 关联员工ID（结算类型=5、6、7时填写） |
| `platform_type` | VARCHAR(50) | 平台类型（结算类型=1、2时填写） |
| `settlement_period` | VARCHAR(20) | 结算周期（如2026-07） |
| `amount` | DECIMAL(12,2) | 结算金额 |
| `settlement_status` | TINYINT(1) | 结算状态：0-待结算，1-已结算，2-有争议 |
| `settlement_date` | DATETIME | 实际结算日期 |
| `bank_account` | VARCHAR(100) | 收款/付款账户 |
| `transaction_no` | VARCHAR(100) | 银行交易号 |
| `remark` | VARCHAR(500) | 备注 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

## 3. 业务流程与金额计算逻辑

### 3.1 四种订单类型对照表

| 订单类型 | order_amount 计算 | 配送费来源 | 配送费付给谁 | 经销商利润来源 |
| :--- | :--- | :--- | :--- | :--- |
| 1-线上平台销售 | 进货价总和 | total_delivery_fee（总包，农夫山泉付）+ worker_retail_delivery_fee（工人零售，经销商付） | 农夫山泉结算给经销商，经销商付给自有员工 | 货款按进货价结算+（总包配送费-工人零售配送费） |
| 2-线下水站分销 | 批发价总和 | distribution_delivery_fee（分销，水站配送时）或 worker_wholesale_delivery_fee（工人配送时） | 水站配送时经销商结算给水站；自有员工配送时经销商付给员工 | 批发差价+（总包配送费-分销配送费/工人水站配送费） |
| 3-线下零售 | 零售价总和 | worker_retail_delivery_fee（工人零售） | 经销商付给自有员工 | 零售差价-工人零售配送费 |
| 4-零售机供货 | 零售机供货价总和 | worker_machine_delivery_fee（工人零售机） | 经销商付给自有员工 | 供货差价-工人零售机配送费 |

### 3.2 线上平台销售流程（order_type=1）

1. 客户下单 → 创建订单主表（order_type=1，记录客户信息和平台信息，delivery_type=1 自有员工配送）
2. 记录订单商品明细（purchase_price 用于计算应收货款，total_delivery_fee 用于计算应收配送费，worker_retail_delivery_fee 用于计算应付员工配送费）
3. 库存扣减（inventory 表 quantity 减少）
4. 经销商付给配送员工 → 创建配送费结算记录（settlement_type=3 工人零售配送费），创建资金结算对账记录（settlement_type=5）
5. 农夫山泉结算时 → 创建资金结算对账记录（settlement_type=1 货款，settlement_type=2 配送费）
6. order_amount = 进货价总和，应收农夫山泉 = order_amount + total_delivery_fee，经销商配送费利润 = total_delivery_fee - worker_retail_delivery_fee

### 3.3 线下水站分销流程（order_type=2）

**场景A：水站负责配送（delivery_type=2）**
1. 水站下单 → 创建订单主表（order_type=2，关联 station_id）
2. 记录订单商品明细（wholesale_price 用于计算水站应付款，distribution_delivery_fee 用于结算给水站）
3. 库存扣减
4. 更新水站欠款（sub_stations.current_debt 变化）
5. 农夫山泉结算配送费 → 创建配送费结算记录（settlement_type=1，delivery_fee_diff=总包-分销）
6. 经销商结算配送费给水站 → 创建资金结算对账记录（settlement_type=4）
7. 水站付款 → 创建资金结算对账记录（settlement_type=3）
8. order_amount = 批发价总和，经销商利润 = 批发差价 +（总包配送费-分销配送费）

**场景B：自有员工配送（delivery_type=1）**
1. 同上步骤1-4
2. 配送费使用 worker_wholesale_delivery_fee（工人水站配送费）
3. 经销商付给员工 → 创建资金结算对账记录（settlement_type=6）
4. 农夫山泉仍按 total_delivery_fee 结算给经销商
5. 经销商利润 = 批发差价 +（总包配送费-工人水站配送费）

### 3.4 线下零售流程（order_type=3）

1. 客户下单 → 创建订单主表（order_type=3，记录客户信息）
2. 记录订单商品明细（retail_price 用于计算销售额，worker_retail_delivery_fee 用于结算给员工）
3. 库存扣减
4. 经销商付给配送员工 → 创建资金结算对账记录（settlement_type=5）
5. 客户付款 → 创建资金结算对账记录（settlement_type=8）
6. order_amount = 零售价总和，经销商利润 = 零售差价 - 工人零售配送费

### 3.5 零售机供货流程（order_type=4）

1. 创建订单主表（order_type=4，记录零售机位置等信息）
2. 记录订单商品明细（machine_price 用于计算销售额，worker_machine_delivery_fee 用于结算给员工）
3. 库存扣减
4. 经销商付给配送员工 → 创建资金结算对账记录（settlement_type=7）
5. 零售机结算 → 创建资金结算对账记录（settlement_type=9）
6. order_amount = 零售机供货价总和，经销商利润 = 供货差价 - 工人零售机配送费

### 3.6 进货入库流程

1. 向农夫山泉打款（预存） → 记录预存金额
2. 进货到货 → 创建进货记录（purchase_records），记录商品、数量、单价
3. 库存增加（inventory 表 quantity 增加，last_in_time 更新）

## 4. 表关系说明

```
products (商品信息)
  ├── inventory (库存) - product_id
  ├── purchase_records (进货记录) - product_id
  └── order_items (订单明细) - product_id

sub_stations (水站信息)
  └── orders (订单) - station_id

orders (订单主表)
  ├── order_items (订单明细) - order_id
  ├── delivery_fee_settlement (配送费结算) - order_id
  └── financial_settlement (资金对账) - order_id

workers (配送员工)
  └── orders (订单) - worker_id
```

## 5. 关键设计决策

1. **主表+明细表模式**：订单主表记录订单基本信息，订单商品明细表记录每个订单的商品明细，支持一个订单包含多个商品。

2. **配送费单独记录**：配送费结算表独立于订单表，单独记录每笔配送费的结算状态，符合"配送费单独记录"的业务需求。

3. **价格快照存入明细表**：订单商品明细表中保存了所有价格字段（进货价、批发价、零售价、各配送费），即使商品表价格日后调整，历史订单的金额不受影响。

4. **工人配送费三档定价**：针对终端零售、水站配送、零售机配送三种场景，分别设置不同的配送费价格，反映实际业务中不同配送场景的成本差异。

5. **水站发票信息完整**：水站信息表包含银行账户、发票抬头、税号等完整发票信息，便于财务开票和对账。

6. **订单金额语义自适应**：order_amount 字段根据订单类型取不同的价格体系，线上销售按进货价、线下分销按批发价、零售按零售价、零售机按供货价。

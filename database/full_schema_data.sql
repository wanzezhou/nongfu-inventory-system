-- ============================================================
-- 农富库存管理系统 - 全量数据库（结构 + 数据）
-- 由 backend/scripts/export_dump.js 自动导出
-- 共 29 张表
-- ============================================================
CREATE DATABASE IF NOT EXISTS nongfu_inventory DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci;
USE nongfu_inventory;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- ----------------------------
-- 表结构: barrel_deposits
-- ----------------------------
DROP TABLE IF EXISTS `barrel_deposits`;
CREATE TABLE `barrel_deposits` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deposit_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `station_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `barrel_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `quantity` int NOT NULL DEFAULT '0',
  `unit_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `deposit_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'collect' COMMENT 'collect=收取押金, return=退回押金',
  `handler_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_station` (`station_id`),
  KEY `idx_handler` (`handler_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 表结构: delivery_fee_settlement
-- ----------------------------
DROP TABLE IF EXISTS `delivery_fee_settlement`;
CREATE TABLE `delivery_fee_settlement` (
  `settlement_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算ID，主键',
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单ID，外键关联orders表',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `quantity` int NOT NULL COMMENT '商品数量',
  `settlement_type` tinyint(1) NOT NULL COMMENT '配送费类型：1-总包配送费（农夫山泉→经销商），2-分销配送费（经销商→水站），3-工人零售配送费，4-工人水站配送费，5-工人零售机配送费',
  `fee_amount` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '配送费金额（根据类型取对应配送费*数量）',
  `delivery_fee_diff` decimal(10,2) DEFAULT NULL COMMENT '配送费差价（经销商实际赚取的配送费差价：水站配送时=总包配送费-分销配送费，自有员工配送时=总包配送费-工人配送费）',
  `payee_type` tinyint(1) NOT NULL COMMENT '收款方类型：1-经销商（农夫山泉结算），2-水站，3-自有员工',
  `payee_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款方ID（水站ID或员工ID）',
  `settlement_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '结算状态：0-未结算，1-已结算',
  `settlement_date` datetime DEFAULT NULL COMMENT '实际结算日期',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`settlement_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_settlement_type` (`settlement_type`),
  KEY `idx_settlement_status` (`settlement_status`),
  CONSTRAINT `fk_delivery_settlement_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_delivery_settlement_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='配送费结算表';

-- ----------------------------
-- 表结构: finance_accounts
-- ----------------------------
DROP TABLE IF EXISTS `finance_accounts`;
CREATE TABLE `finance_accounts` (
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账户ID',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账户名称',
  `account_type` tinyint NOT NULL DEFAULT '1' COMMENT '账户类型:1现金 2银行 3微信 4支付宝 5其他',
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '开户银行',
  `bank_account` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '银行账号',
  `initial_balance` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '初始余额',
  `current_balance` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '当前余额',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态:1启用 0停用',
  `created_at` datetime DEFAULT NULL COMMENT '创建时间',
  `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`account_id`),
  KEY `idx_account_name` (`account_name`),
  KEY `idx_account_type` (`account_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户管理表';
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_CREDIT', '可上单信用余额', 5, '', '', '0.00', '0.00', '普通账户（相互独立，无业务语义）', 1, '2026-09-02 21:09:28.000', '2026-09-02 21:10:23.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_DISCOUNT', '可上单折扣余额', 6, '', '', '0.00', '0.00', '普通账户（相互独立，无业务语义）', 1, '2026-09-02 21:09:28.000', '2026-09-02 21:09:28.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_FEE', '自有费用余额', 7, '', '', '0.00', '0.00', '普通账户（相互独立，无业务语义）', 1, '2026-09-02 21:09:28.000', '2026-09-02 21:09:28.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_OTHER', '其他', 4, '', '', '0.00', '0.00', '预置账户', 1, '2026-09-02 20:50:03.000', '2026-09-02 20:55:37.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_SGS', '水公社公户', 2, '', '', '0.00', '0.00', '预置账户', 1, '2026-09-02 20:50:03.000', '2026-09-02 20:50:03.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_SZX', '晟之溪公户', 1, '', '', '0.00', '0.00', '预置账户', 1, '2026-09-02 20:50:03.000', '2026-09-02 22:00:25.000');
INSERT INTO `finance_accounts` (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`) VALUES ('ACCOUNT_WX', '微信', 3, NULL, NULL, '0.00', '0.00', NULL, 1, '2026-09-02 20:50:03.000', '2026-09-02 21:10:23.000');
-- 7 行

-- ----------------------------
-- 表结构: finance_transactions
-- ----------------------------
DROP TABLE IF EXISTS `finance_transactions`;
CREATE TABLE `finance_transactions` (
  `tx_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水ID',
  `tx_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '流水号',
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账户ID',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户名称',
  `tx_type` tinyint NOT NULL COMMENT '交易类型:1收入 2支出 3转账',
  `tx_category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '交易分类(押金/工资/报销/等等)',
  `amount` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '金额(正数)',
  `balance_before` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '变动前余额',
  `balance_after` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '变动后余额',
  `related_module` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联模块(订单/押金/工资/报销)',
  `related_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联记录ID',
  `tx_date` date DEFAULT NULL COMMENT '交易日期',
  `handler` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '经手人',
  `counterparty` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对方户名/来源',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime DEFAULT NULL COMMENT '创建时间',
  PRIMARY KEY (`tx_id`),
  KEY `idx_account_id` (`account_id`),
  KEY `idx_tx_type` (`tx_type`),
  KEY `idx_tx_date` (`tx_date`),
  KEY `idx_related` (`related_module`,`related_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户资金流水表';

-- ----------------------------
-- 表结构: financial_settlement
-- ----------------------------
DROP TABLE IF EXISTS `financial_settlement`;
CREATE TABLE `financial_settlement` (
  `settlement_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算ID，主键',
  `settlement_type` tinyint(1) NOT NULL COMMENT '结算类型：1-线上平台货款结算（农夫山泉→经销商），2-线上配送费结算（农夫山泉→经销商），3-线下水站货款结算（水站→经销商），4-分销配送费结算（经销商→水站），5-工人零售配送费结算（经销商→员工），6-工人水站配送费结算（经销商→员工），7-工人零售机配送费结算（经销商→员工），8-线下零售收入，9-零售机供货收入',
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联订单ID',
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联水站ID（结算类型=3、4时填写）',
  `worker_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联员工ID（结算类型=5、6、7时填写）',
  `platform_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台类型（结算类型=1、2时填写）',
  `settlement_period` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '结算周期（如2026-07）',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '结算金额',
  `settlement_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '结算状态：0-待结算，1-已结算，2-有争议',
  `settlement_date` datetime DEFAULT NULL COMMENT '实际结算日期',
  `bank_account` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款/付款账户',
  `transaction_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '银行交易号',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`settlement_id`),
  KEY `idx_settlement_type` (`settlement_type`),
  KEY `idx_order` (`order_id`),
  KEY `idx_station` (`station_id`),
  KEY `idx_worker` (`worker_id`),
  KEY `idx_settlement_period` (`settlement_period`),
  KEY `idx_settlement_status` (`settlement_status`),
  CONSTRAINT `fk_financial_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_financial_station` FOREIGN KEY (`station_id`) REFERENCES `sub_stations` (`station_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_financial_worker` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`worker_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资金结算对账表';

-- ----------------------------
-- 表结构: fixed_expenses
-- ----------------------------
DROP TABLE IF EXISTS `fixed_expenses`;
CREATE TABLE `fixed_expenses` (
  `expense_id` varchar(50) NOT NULL COMMENT '支出ID',
  `expense_type` varchar(50) NOT NULL COMMENT '支出类型（房租/水电/物业/人工工资/物流运输/设备维护/其他，可自定义）',
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '金额（元）',
  `expense_date` date NOT NULL COMMENT '发生日期',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) DEFAULT NULL COMMENT '录入人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`expense_id`),
  KEY `idx_type` (`expense_type`),
  KEY `idx_date` (`expense_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='固定支出记录';
INSERT INTO `fixed_expenses` (`expense_id`, `expense_type`, `amount`, `expense_date`, `remark`, `created_by`, `created_at`, `updated_at`) VALUES ('FE1787583766734188', '房租', '700.01', '2026-08-24 00:00:00.000', NULL, 'admin', NULL, '2026-08-26 21:11:15.000');
-- 1 行

-- ----------------------------
-- 表结构: inventory
-- ----------------------------
DROP TABLE IF EXISTS `inventory`;
CREATE TABLE `inventory` (
  `inventory_id` int NOT NULL AUTO_INCREMENT COMMENT '库存ID，主键，自增',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `quantity` int NOT NULL DEFAULT '0' COMMENT '库存数量',
  `last_in_time` datetime DEFAULT NULL COMMENT '最后入库时间',
  `last_out_time` datetime DEFAULT NULL COMMENT '最后出库时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`inventory_id`),
  UNIQUE KEY `uk_product` (`product_id`),
  CONSTRAINT `fk_inventory_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=160 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='总仓库库存表';
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (1, 'Pmrf3fgpqDNVO8Q', 10, '2026-07-12 22:56:36.000', '2026-08-28 21:41:43.000', '2026-08-28 21:41:57.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (2, 'Pmrf3fgpzF5XO8D', 40, '2026-07-29 22:02:33.000', '2026-08-27 21:40:12.000', '2026-08-27 22:47:17.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (3, 'Pmrf3fgq30J6ZV3', 60, '2026-07-29 22:02:33.000', '2026-07-29 21:54:05.000', '2026-08-11 20:41:48.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (4, 'Pmrf3fgq6AASZ1I', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (5, 'Pmrf3fgq9BHXTAD', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (6, 'Pmrf3fgqcNJWXRR', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (7, 'Pmrf3fgqf67LVTO', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (8, 'Pmrf3fgqi2LYPGX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (9, 'Pmrf3fgqn59URJB', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (10, 'Pmrf3fgqq1UZJ5U', 0, NULL, '2026-08-11 21:11:59.000', '2026-08-24 21:42:00.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (11, 'Pmrf3fgqtHVAMLA', 0, NULL, '2026-08-11 21:11:59.000', '2026-08-24 21:42:00.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (12, 'Pmrf3fgqwV7DUMC', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (13, 'Pmrf3fgqz35VV7K', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (14, 'Pmrf3fgr3L5N0DS', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (15, 'Pmrf3fgr5ZOCBNO', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (16, 'Pmrf3fgr9L94MT3', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (17, 'Pmrf3fgrb6X78QH', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (18, 'Pmrf3fgrfHNMVHX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (19, 'Pmrf3fgri33JOBK', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (20, 'Pmrf3fgrlDC3904', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (21, 'Pmrf3fgroW98BC8', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (22, 'Pmrf3fgrr3IKNCC', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (23, 'Pmrf3fgru8HKA78', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (24, 'Pmrf3fgrxRCQ9ZL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (25, 'Pmrf3fgs1I09NOV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (26, 'Pmrf3fgs4WHII1H', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (27, 'Pmrf3fgs7RURCVZ', 0, NULL, '2026-08-11 22:18:46.000', '2026-08-24 21:41:59.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (28, 'Pmrf3fgsa7XQQ3I', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (29, 'Pmrf3fgsdIP7CJC', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (30, 'Pmrf3fgshUZANXO', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (31, 'Pmrf3fgsk5QKYNK', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (32, 'Pmrf3fgsn5RUYLV', 0, NULL, '2026-08-11 22:19:17.000', '2026-08-24 21:41:57.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (33, 'Pmrf3fgsrYGBDZV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (34, 'Pmrf3fgsu8G94B6', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (35, 'Pmrf3fgsx4DGNXO', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (36, 'Pmrf3fgt0UKV7YQ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (37, 'Pmrf3fgt4EP56EF', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (38, 'Pmrf3fgt7Z3E7E9', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (39, 'Pmrf3fgtbWU28QX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (40, 'Pmrf3fgteHHV9KX', 27, '2026-08-25 23:45:51.000', '2026-08-28 21:41:43.000', '2026-08-28 21:41:57.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (41, 'Pmrf3fgthXVMNN9', 0, '2026-08-24 21:19:19.000', NULL, '2026-08-24 21:41:55.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (42, 'Pmrf3fgtlPZCO9R', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (43, 'Pmrf3fgtoQJZ3RM', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (44, 'Pmrf3fgtrO9S5YP', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (45, 'Pmrf3fgtuAEVZUT', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (46, 'Pmrf3fgtx1TWDB6', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (47, 'Pmrf3fgu12D4C3A', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (48, 'Pmrf3fgu4CUXXCN', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (49, 'Pmrf3fgu7UPH881', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (50, 'Pmrf3fgubMO3YK0', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (51, 'Pmrf3fgueMXCW0N', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (52, 'Pmrf3fguiCQZ9DE', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (53, 'Pmrf3fgulFXO092', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (54, 'Pmrf3fgupBCR9ZL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (55, 'Pmrf3fgusA3RI05', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (56, 'Pmrf3fguw5HC2HM', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (57, 'Pmrf3fguzZ66OQO', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (58, 'Pmrf3fgv2J8QQ9M', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (59, 'Pmrf3fgv6WLNAGW', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (60, 'Pmrf3fgv9TJULLV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (61, 'Pmrf3fgvc6786BF', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (62, 'Pmrf3fgvfPYDHUV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (63, 'Pmrf3fgviAQ8S5I', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (64, 'Pmrf3fgvmE2E3BI', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (65, 'Pmrf3fgvpQ6BCP6', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (66, 'Pmrf3fgvsDXXUQG', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (67, 'Pmrf3fgvvPCBXGR', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (68, 'Pmrf3fgvzYA9DDR', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (69, 'Pmrf3fgw26W0509', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (70, 'Pmrf3fgw6RC4OBX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (71, 'Pmrf3fgw9CQSGRB', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (72, 'Pmrf3fgwcHFCSEE', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (73, 'Pmrf3fgwgDR9ULT', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (74, 'Pmrf3fgwjCL6WHV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (75, 'Pmrf3fgwnD53T14', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (76, 'Pmrf3fgwqDHZCUF', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (77, 'Pmrf3fgwtL4LFAS', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (78, 'Pmrf3fgwwF94DE9', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (79, 'Pmrf3fgx0EXIV86', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (80, 'Pmrf3fgx3DKE6S2', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (81, 'Pmrf3fgx6ALPNT7', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (82, 'Pmrf3fgxaW8MTHQ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (83, 'Pmrf3fgxd3W75H2', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (84, 'Pmrf3fgxmH1BFLY', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (85, 'Pmrf3fgxrRVMBQY', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (86, 'Pmrf3fgxv6M9063', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (87, 'Pmrf3fgxyGEG2ZU', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (88, 'Pmrf3fgy2FCWOUD', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (89, 'Pmrf3fgy59TEN21', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (90, 'Pmrf3fgy8NKM8RE', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (91, 'Pmrf3fgybRKQ1Q0', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (92, 'Pmrf3fgyeO5S2QL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (93, 'Pmrf3fgyhUHD26T', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (94, 'Pmrf3fgykF6DE9M', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (95, 'Pmrf3fgynRIP6MD', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (96, 'Pmrf3fgyq7UK9YE', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (97, 'Pmrf3fgyuLJUERC', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (98, 'Pmrf3fgywI9MPPQ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (99, 'Pmrf3fgz07UHAQV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (100, 'Pmrf3fgz35YY3IL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (101, 'Pmrf3fgz6D43IJ1', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (102, 'Pmrf3fgz9PEUZFI', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (103, 'Pmrf3fgzc0AGJH1', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (104, 'Pmrf3fgzf3VR20I', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (105, 'Pmrf3fgzjT41NIX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (106, 'Pmrf3fgzmLY9E04', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (107, 'Pmrf3fgzq0YNMXB', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (108, 'Pmrf3fgztGVZXAZ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (109, 'Pmrf3fgzwW3S05J', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (110, 'Pmrf3fgzzGNUWM2', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (111, 'Pmrf3fh02NJTUQK', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (112, 'Pmrf3fh05KNEHI7', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (113, 'Pmrf3fh08RYTVI2', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (114, 'Pmrf3fh0c3IFSA1', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (115, 'Pmrf3fh0fYP6DE0', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (116, 'Pmrf3fh0iXPU5AV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (117, 'Pmrf3fh0mJKSU53', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (118, 'Pmrf3fh0p9NW1JN', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (119, 'Pmrf3fh0tG6NTN2', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (120, 'Pmrf3fh0wTGLHON', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (121, 'Pmrf3fh10YVWWH4', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (122, 'Pmrf3fh13IC4AUL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (123, 'Pmrf3fh176PS8OU', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (124, 'Pmrf3fh1aHQPMZL', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (125, 'Pmrf3fh1dDMFCPI', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (126, 'Pmrf3fh1hCH9X69', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (127, 'Pmrf3fh1kAM2DYT', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (128, 'Pmrf3fh1o39JNF9', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (129, 'Pmrf3fh1uL22ROY', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (130, 'Pmrf3fh1yMC9BWB', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (131, 'Pmrf3fh253W4Y97', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (132, 'Pmrf3fh2aQWYUEV', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (133, 'Pmrf3fh2fY9ZWU5', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (134, 'Pmrf3fh2kCUJW57', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (135, 'Pmrf3fh2pVEJF19', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (136, 'Pmrf3fh2vMTTLB6', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (137, 'Pmrf3fh3007NHVS', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (138, 'Pmrf3fh34ADFJ8K', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (139, 'Pmrf3fh38CR1O0K', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (140, 'Pmrf3fh3cR3HAGA', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (141, 'Pmrf3fh3g3OK62F', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (142, 'Pmrf3fh3kMFO9GC', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (143, 'Pmrf3fh3nQOB25H', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (144, 'Pmrf3fh3rGKZA3A', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (145, 'Pmrf3fh3uG4O3XD', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (146, 'Pmrf3fh3xKRX8Z6', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (147, 'Pmrf3fh40RKWMSE', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (148, 'Pmrf3fh43AJ3PKH', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (149, 'Pmrf3fh47C5LBLZ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (150, 'Pmrf3fh4aVLHBVW', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (151, 'Pmrf3fh4dWXS4RG', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (152, 'Pmrf3fh4gQM7QE5', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (153, 'Pmrf3fh4kG3WFAB', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (154, 'Pmrf3fh4oHN309B', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (155, 'Pmrf3fh4s31SDP8', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (156, 'Pmrf3fh4vBMGW4T', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (157, 'Pmrf3fh4z9BWNLX', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (158, 'Pmrf3fh52CP50GZ', 0, NULL, NULL, '2026-07-10 23:31:26.000');
INSERT INTO `inventory` (`inventory_id`, `product_id`, `quantity`, `last_in_time`, `last_out_time`, `updated_at`) VALUES (159, 'Pmrf3fh56M5489U', 0, NULL, NULL, '2026-07-10 23:31:26.000');
-- 159 行

-- ----------------------------
-- 表结构: machine_sales
-- ----------------------------
DROP TABLE IF EXISTS `machine_sales`;
CREATE TABLE `machine_sales` (
  `sale_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '销量记录ID，主键',
  `machine_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '机台ID，外键关联machine_stations表',
  `machine_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '机台类型：1-量贩机，2-零售机（冗余，便于按类型统计）',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `quantity` int NOT NULL DEFAULT '0' COMMENT '销量（该机台该商品售出数量）',
  `sale_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '售价（机台上设定的售价，录入时自动带出可修改）',
  `sale_date` date NOT NULL COMMENT '销售日期（按日记录，可按月/日汇总）',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '录入人',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`sale_id`),
  KEY `idx_machine` (`machine_id`),
  KEY `idx_machine_type` (`machine_type`),
  KEY `idx_product` (`product_id`),
  KEY `idx_sale_date` (`sale_date`),
  CONSTRAINT `fk_machine_sales_machine` FOREIGN KEY (`machine_id`) REFERENCES `machine_stations` (`machine_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_machine_sales_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台销量记录表（量贩机/零售机营收，手动录入）';

-- ----------------------------
-- 表结构: machine_stations
-- ----------------------------
DROP TABLE IF EXISTS `machine_stations`;
CREATE TABLE `machine_stations` (
  `machine_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '机台ID，主键',
  `machine_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '机台类型：1-量贩机，2-零售机',
  `station_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '站点名称',
  `address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '站点地址',
  `manager` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人',
  `manager_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '负责人联系方式',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态：1-启用，0-停用（软删除）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`machine_id`),
  KEY `idx_machine_type` (`machine_type`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台管理表（量贩机/零售机）';
INSERT INTO `machine_stations` (`machine_id`, `machine_type`, `station_name`, `address`, `manager`, `manager_phone`, `status`, `created_at`, `updated_at`) VALUES ('M001', 1, '量贩机-万达广场店', '南京市建邺区万达广场1F', '张店长', '13700000001', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `machine_stations` (`machine_id`, `machine_type`, `station_name`, `address`, `manager`, `manager_phone`, `status`, `created_at`, `updated_at`) VALUES ('M002', 1, '量贩机-中央商场店', '南京市秦淮区新街口中央商场3F', '李店长', '13700000002', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `machine_stations` (`machine_id`, `machine_type`, `station_name`, `address`, `manager`, `manager_phone`, `status`, `created_at`, `updated_at`) VALUES ('R001', 2, '零售机-地铁大行宫站', '南京市玄武区地铁2号线大行宫站内', '王站长', '13700000003', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `machine_stations` (`machine_id`, `machine_type`, `station_name`, `address`, `manager`, `manager_phone`, `status`, `created_at`, `updated_at`) VALUES ('R002', 2, '零售机-南大鼓楼校区', '南京市鼓楼区南京大学鼓楼校区', '赵管理员', '13700000004', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
-- 4 行

-- ----------------------------
-- 表结构: mini_accounts
-- ----------------------------
DROP TABLE IF EXISTS `mini_accounts`;
CREATE TABLE `mini_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `openid` varchar(64) NOT NULL COMMENT '微信openid',
  `union_id` varchar(64) DEFAULT NULL COMMENT '微信unionid(可选)',
  `phone` varchar(20) DEFAULT NULL COMMENT '手机号',
  `username` varchar(50) DEFAULT NULL COMMENT '登录账号',
  `password_hash` varchar(255) DEFAULT NULL COMMENT 'bcrypt密码哈希',
  `role` enum('admin','worker','station','salesman') NOT NULL COMMENT '角色',
  `target_id` varchar(50) DEFAULT NULL COMMENT '关联实体ID',
  `nickname` varchar(50) DEFAULT NULL COMMENT '微信昵称',
  `avatar_url` varchar(500) DEFAULT NULL COMMENT '微信头像URL',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1启用 0禁用',
  `last_login_at` datetime DEFAULT NULL COMMENT '最后登录时间',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `openid` (`openid`),
  UNIQUE KEY `idx_username` (`username`),
  KEY `idx_openid` (`openid`),
  KEY `idx_phone` (`phone`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='小程序账号绑定表';
INSERT INTO `mini_accounts` (`id`, `openid`, `union_id`, `phone`, `username`, `password_hash`, `role`, `target_id`, `nickname`, `avatar_url`, `status`, `last_login_at`, `created_at`, `updated_at`) VALUES (18, 'seed_admin', NULL, '13900000001', 'admin', '$2b$10$B/m0kOtU2CSDwdCjlq92OO3KeoV0G08IQbOZGkqx0MaIrad80SMSu', 'admin', '1', NULL, NULL, 1, '2026-08-12 21:49:22.000', '2026-08-12 21:10:56.000', '2026-08-12 21:49:22.000');
INSERT INTO `mini_accounts` (`id`, `openid`, `union_id`, `phone`, `username`, `password_hash`, `role`, `target_id`, `nickname`, `avatar_url`, `status`, `last_login_at`, `created_at`, `updated_at`) VALUES (19, 'seed_worker', NULL, '111111111', 'worker', '$2b$10$B/m0kOtU2CSDwdCjlq92OO3KeoV0G08IQbOZGkqx0MaIrad80SMSu', 'worker', 'W17851563703197234', NULL, NULL, 1, '2026-08-12 21:11:21.000', '2026-08-12 21:10:56.000', '2026-08-12 21:11:21.000');
INSERT INTO `mini_accounts` (`id`, `openid`, `union_id`, `phone`, `username`, `password_hash`, `role`, `target_id`, `nickname`, `avatar_url`, `status`, `last_login_at`, `created_at`, `updated_at`) VALUES (20, 'seed_station', NULL, '1234567890', 'station', '$2b$10$B/m0kOtU2CSDwdCjlq92OO3KeoV0G08IQbOZGkqx0MaIrad80SMSu', 'station', 'S17853284880312262', NULL, NULL, 1, '2026-08-12 21:11:21.000', '2026-08-12 21:10:56.000', '2026-08-12 21:11:21.000');
INSERT INTO `mini_accounts` (`id`, `openid`, `union_id`, `phone`, `username`, `password_hash`, `role`, `target_id`, `nickname`, `avatar_url`, `status`, `last_login_at`, `created_at`, `updated_at`) VALUES (21, 'seed_salesman', NULL, '13900000004', 'salesman', '$2b$10$B/m0kOtU2CSDwdCjlq92OO3KeoV0G08IQbOZGkqx0MaIrad80SMSu', 'salesman', 'SM1786540256880', NULL, NULL, 1, '2026-08-12 22:21:57.000', '2026-08-12 21:10:56.000', '2026-08-12 22:21:57.000');
-- 4 行

-- ----------------------------
-- 表结构: order_items
-- ----------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `item_id` int NOT NULL AUTO_INCREMENT COMMENT '明细ID，主键，自增',
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单ID，外键关联orders表',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `quantity` int NOT NULL COMMENT '商品数量',
  `unit_price` decimal(10,2) DEFAULT NULL,
  `purchase_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '进货价（线上销售时用于计算应收农夫山泉的货款）',
  `wholesale_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '批发价（线下分销时用于计算水站应付款）',
  `retail_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售价（线下零售时用于计算实际销售额）',
  `machine_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售机供货价（零售机供货时用于计算销售额）',
  `total_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '总包配送费（农夫山泉结算给经销商）',
  `distribution_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '分销配送费（经销商结算给水站）',
  `worker_retail_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售配送费（终端零售客户配送）',
  `worker_wholesale_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人水站配送费（面包车配送给水站）',
  `worker_machine_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售机配送费（面包车配送给零售机）',
  `pricing_type` tinyint NOT NULL DEFAULT '1' COMMENT '计价方式 1-分销价 2-水票抵扣',
  `ticket_qty` int NOT NULL DEFAULT '0' COMMENT '水票抵扣件数（直营水站销售行级；≤quantity，0=不抵扣）',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '明细小计（根据订单类型：线上=进货价*数量，分销=批发价*数量，零售=零售价*数量，零售机=零售机供货价*数量）',
  PRIMARY KEY (`item_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_product` (`product_id`),
  CONSTRAINT `fk_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单商品明细表';
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (1, 'SZX202608200001', 'Pmrf3fgpqDNVO8Q', 10, '15.00', '15.00', '18.00', '24.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 1, 0, '150.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (2, 'SZX202608180002', 'Pmrf3fgq6AASZ1I', 6, '19.00', '19.00', '21.00', '26.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '114.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (3, 'SZX202608160003', 'Pmrf3fgq6AASZ1I', 20, '21.00', '19.00', '21.00', '26.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '420.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (4, 'SZX202608140004', 'Pmrf3fgpqDNVO8Q', 30, '18.00', '15.00', '18.00', '24.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 1, 0, '540.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (5, 'SZX202608140004', 'Pmrf3fgqtHVAMLA', 10, '22.00', '21.00', '22.00', '28.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '220.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (6, 'SZX202608120005', 'Pmrf3fgqtHVAMLA', 5, '28.00', '21.00', '22.00', '28.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '140.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (7, 'SZX202608100006', 'Pmrf3fgq30J6ZV3', 8, '26.00', '19.00', '21.00', '26.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '208.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (8, 'SZX202608100006', 'Pmrf3fgqq1UZJ5U', 6, '26.00', '20.00', '21.00', '26.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '156.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (9, 'SZX202608080007', 'Pmrf3fgpqDNVO8Q', 40, '0.00', '15.00', '18.00', '24.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 1, 0, '0.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (10, 'SZX202608040009', 'Pmrf3fgqtHVAMLA', 20, '0.00', '21.00', '22.00', '28.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '0.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (11, 'SZX202607250010', 'Pmrf3fgq6AASZ1I', 8, '19.00', '19.00', '21.00', '26.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', 1, 0, '152.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (12, 'SZX202607200011', 'Pmrf3fgpqDNVO8Q', 15, '18.00', '15.00', '18.00', '24.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 1, 0, '270.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (13, 'SZX202607180012', 'Pmrf3fgpqDNVO8Q', 3, '24.00', '15.00', '18.00', '24.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 1, 0, '72.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (28, 'SZX2026082700002', 'Pmrf3fgteHHV9KX', 2, '15.00', '15.00', '18.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '0.00', 1, 0, '30.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (37, 'SZX2026082800001', 'Pmrf3fgteHHV9KX', 1, '18.00', '15.00', '18.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '0.00', 1, 0, '18.00');
INSERT INTO `order_items` (`item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `pricing_type`, `ticket_qty`, `subtotal`) VALUES (38, 'SZX2026082800001', 'Pmrf3fgpqDNVO8Q', 2, '18.00', '15.00', '18.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', 2, 2, '0.00');
-- 16 行

-- ----------------------------
-- 表结构: orders
-- ----------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单ID，主键',
  `order_type` tinyint(1) NOT NULL COMMENT '订单类型：1-线上平台销售，2-线下水站分销，3-线下零售，4-零售机供货',
  `platform_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台类型（订单类型=1时填写，如美团、饿了么）',
  `platform_order_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台订单号（订单类型=1时填写）',
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '水站ID（订单类型=2时填写，外键关联sub_stations表）',
  `machine_station_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '机台ID（订单类型=4量贩机供货/6零售机供货时填写，关联machine_stations表）',
  `customer_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户姓名',
  `customer_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户电话',
  `customer_address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户地址',
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `order_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '订单总金额（线上=进货价总和，分销=批发价总和，零售=零售价总和，零售机=零售机供货价总和）',
  `delivery_fee` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '配送费金额',
  `total_receivable` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '应收总金额（订单金额+配送费）',
  `delivery_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '配送方式：1-自有员工配送，2-水站配送，3-无需配送',
  `worker_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '配送员工ID（配送方式=1时填写，外键关联workers表）',
  `payment_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '付款状态：0-未付款，1-已付款，2-部分付款',
  `paid_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '已付款金额',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人ID，外键关联workers表',
  `canceled_at` datetime DEFAULT NULL COMMENT '取消时间；非空表示该订单已取消（替代原 order_status=3）',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_order_type` (`order_type`),
  KEY `idx_station` (`station_id`),
  KEY `idx_worker` (`worker_id`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_canceled_at` (`canceled_at`),
  CONSTRAINT `fk_order_creator` FOREIGN KEY (`created_by`) REFERENCES `workers` (`worker_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_order_station` FOREIGN KEY (`station_id`) REFERENCES `sub_stations` (`station_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_order_worker` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`worker_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单主表';
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202607180012', 3, NULL, NULL, NULL, NULL, '周涛', '13911110006', '南京市栖霞区文枢东路1号', '周涛', '72.00', '0.00', '72.00', 3, NULL, 1, '72.00', 'W005', NULL, NULL, '2026-07-18 17:20:00.000', '2026-07-18 17:20:00.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202607200011', 2, NULL, NULL, 'ST004', NULL, '玄武水站', '13900000004', '南京市玄武区锁金村', '冯老板', '270.00', '0.00', '270.00', 1, 'W004', 0, '0.00', 'W005', NULL, NULL, '2026-07-20 13:30:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202607250010', 1, '美团', 'MT20260725010', NULL, NULL, '孙悦', '13911110005', '南京市雨花台区软件大道18号', NULL, '152.00', '0.00', '152.00', 1, 'W003', 1, '184.00', 'W005', NULL, NULL, '2026-07-25 12:00:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608040009', 6, NULL, NULL, NULL, 'R001', '零售机-地铁大行宫站', '13700000003', '南京市玄武区地铁2号线大行宫站内', '王站长', '0.00', '0.00', '0.00', 2, 'W002', 1, '420.00', 'W005', NULL, NULL, '2026-08-04 08:40:00.000', '2026-08-27 22:38:00.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608080007', 4, NULL, NULL, NULL, 'M001', '量贩机-万达广场店', '13700000001', '南京市建邺区万达广场1F', '张店长', '0.00', '0.00', '0.00', 2, 'W001', 1, '600.00', 'W005', NULL, NULL, '2026-08-08 09:00:00.000', '2026-08-27 22:38:00.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608100006', 3, NULL, NULL, NULL, NULL, '赵芳', '13911110004', '南京市玄武区北京东路55号', '赵芳', '364.00', '0.00', '364.00', 1, 'W004', 0, '100.00', 'W005', NULL, NULL, '2026-08-10 16:30:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608120005', 3, NULL, NULL, NULL, NULL, '王强', '13911110003', '南京市鼓楼区湖南路88号', '王强', '140.00', '0.00', '140.00', 3, NULL, 1, '140.00', 'W005', NULL, NULL, '2026-08-12 15:45:00.000', '2026-08-12 15:45:00.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608140004', 2, NULL, NULL, 'ST002', NULL, '秦淮水站', '13900000002', '南京市秦淮区大光路', '吴老板', '760.00', '0.00', '760.00', 1, 'W003', 1, '782.50', 'W005', NULL, NULL, '2026-08-14 11:00:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608160003', 2, NULL, NULL, 'ST001', NULL, '江宁水站', '13900000001', '南京市江宁区东山街道', '周老板', '420.00', '0.00', '420.00', 1, 'W001', 0, '0.00', 'W005', NULL, NULL, '2026-08-16 09:10:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608180002', 1, '京东', 'JD20260818002', NULL, NULL, '李娜', '13911110002', '南京市建邺区江东中路98号', NULL, '114.00', '0.00', '114.00', 1, 'W002', 1, '138.00', 'W005', NULL, NULL, '2026-08-18 14:20:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX202608200001', 1, '美团', 'MT20260820001', NULL, NULL, '张伟', '13911110001', '南京市秦淮区瑞金路12号', NULL, '150.00', '0.00', '150.00', 1, 'W001', 1, '170.00', 'W005', NULL, NULL, '2026-08-20 10:30:00.000', '2026-08-27 22:25:53.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX2026082700002', 1, '4', NULL, NULL, NULL, '11', '11', '11', NULL, '30.00', '0.00', '30.00', 1, 'W004', 0, '0.00', 'W004', NULL, NULL, '2026-08-27 22:14:29.000', '2026-08-27 22:14:29.000');
INSERT INTO `orders` (`order_id`, `order_type`, `platform_type`, `platform_order_no`, `station_id`, `machine_station_id`, `customer_name`, `customer_phone`, `customer_address`, `contact_name`, `order_amount`, `delivery_fee`, `total_receivable`, `delivery_type`, `worker_id`, `payment_status`, `paid_amount`, `created_by`, `canceled_at`, `remark`, `created_at`, `updated_at`) VALUES ('SZX2026082800001', 2, NULL, NULL, 'ST001', NULL, '江宁水站', '13900000001', '南京市江宁区东山街道', '周老板', '18.00', '0.00', '18.00', 2, 'W004', 0, '0.00', 'W004', NULL, NULL, '2026-08-28 21:41:43.000', '2026-08-28 21:41:43.000');
-- 13 行

-- ----------------------------
-- 表结构: other_expenses
-- ----------------------------
DROP TABLE IF EXISTS `other_expenses`;
CREATE TABLE `other_expenses` (
  `expense_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '支出ID',
  `expense_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '支出名称',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '支出类别',
  `amount` decimal(12,2) NOT NULL COMMENT '支出金额（>0）',
  `expense_date` date NOT NULL COMMENT '支出日期',
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支出账户',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户快照',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '录入人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`expense_id`),
  KEY `idx_expense_date` (`expense_date`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='其他支出（手动录入，纳入成本汇总）';

-- ----------------------------
-- 表结构: products
-- ----------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，主键',
  `product_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品编码（如SPBM001）',
  `product_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品名称（如农夫山泉550ml）',
  `specification` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '规格（如550ml*24瓶）',
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '计量单位（如箱）',
  `purchase_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '进货价（从农夫山泉进货的价格）',
  `wholesale_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '批发价（卖给下级水站的价格）',
  `retail_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售价（线下零售价格）',
  `machine_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售机供货价（配送给零售机的价格）',
  `total_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '总包配送费（农夫山泉结算给经销商）',
  `distribution_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '分销配送费（经销商结算给水站）',
  `worker_retail_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售配送费（终端零售客户配送）',
  `worker_wholesale_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人水站配送费（面包车配送给水站）',
  `worker_machine_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售机配送费（面包车配送给零售机）',
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品分类（如矿泉水、饮料）',
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品图片URL',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态：0-停用，1-启用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`product_id`),
  UNIQUE KEY `uk_product_code` (`product_code`),
  KEY `idx_category` (`category`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商品信息表';
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgpqDNVO8Q', 'SPBM001', '380mL天然矿泉水15入纸箱', '380ml*15', '箱', '15.00', '18.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '饮用水', 'http://localhost:3000/product_images/SPBM001_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgpzF5XO8D', 'SPBM002', '380mL天然水12入彩膜', '380ml*12', '箱', '9.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '饮用水', '/product_images/SPBM002_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgq30J6ZV3', 'SPBM003', '380mL天然水24入纸箱学习强国', '380ml*24', '箱', '19.00', '21.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM003_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgq6AASZ1I', 'SPBM004', '380mL天然水24入纸箱', '380ml*24', '箱', '19.00', '21.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM004_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgq9BHXTAD', 'SPBM005', '380mL天然水24入白膜', '380ml*24', '箱', '18.00', '20.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM005_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqcNJWXRR', 'SPBM006', '550mL天然水12入彩膜马年CNY装', '550ml*12', '箱', '10.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqf67LVTO', 'SPBM007', '550mL天然水24入白膜马年CNY装', '550ml*24', '箱', '20.00', '21.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqi2LYPGX', 'SPBM008', '550mL天然水12入彩膜马年CNY-提带装', '550ml*12', '箱', '10.00', '10.50', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqn59URJB', 'SPBM009', '550mL天然水15入彩膜', '550ml*15', '箱', '13.30', '16.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '饮用水', '/product_images/SPBM009_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqq1UZJ5U', 'SPBM010', '550mL天然水24入白膜', '550ml*24', '箱', '20.00', '21.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM010_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqtHVAMLA', 'SPBM011', '550mL天然水24入纸箱', '550ml*24', '箱', '21.00', '22.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM011_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqwV7DUMC', 'SPBM012', '550mL天然水12入彩膜非KA', '550ml*12', '箱', '10.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '1.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgqz35VV7K', 'SPBM013', '550mL天然水12入彩膜KA版', '550mL*12', '箱', '10.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '1.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgr3L5N0DS', 'SPBM014', '550mL天然水12入彩膜量贩提带装KA版', '550ml*12', '箱', '10.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '饮用水', '/product_images/SPBM014_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgr5ZOCBNO', 'SPBM015', '550mL天然水12入彩膜量贩提带装非KA版', '550ml*12', '箱', '10.00', '10.50', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgr9L94MT3', 'SPBM016', '1.5L天然水12入白膜', '1.5L*12', '箱', '20.00', '23.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM016_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgrb6X78QH', 'SPBM017', '1.5L天然水12入纸箱', '1.5L*12', '箱', '21.00', '24.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM017_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgrfHNMVHX', 'SPBM018', '2.1L天然水8入白膜', '2.1L*8', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '饮用水', '/product_images/SPBM018_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgri33JOBK', 'SPBM019', '3L天然水6入纸箱', '3L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgrlDC3904', 'SPBM020', '4L天然水4入纸箱PET新4L', '4L*4', '箱', '19.00', '22.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM020_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgroW98BC8', 'SPBM021', '4L水4入纸箱HDPE老', '4L*4', '箱', '19.00', '22.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgrr3IKNCC', 'SPBM022', '4L天然水4入纸箱把手瓶', '4L*4', '箱', '0.00', '0.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgru8HKA78', 'SPBM023', '4L天然水6入纸箱', '4L*6', '箱', '28.50', '32.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM023_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgrxRCQ9ZL', 'SPBM024', '5L天然水4入白膜', '5L*4', '箱', '21.00', '24.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM024_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgs1I09NOV', 'SPBM025', '5L天然水4入纸箱', '5L*4', '箱', '23.00', '26.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '1.20', '饮用水', '/product_images/SPBM025_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgs4WHII1H', 'SPBM026', '6L天然水4入白膜', '6L*4', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '饮用水', '/product_images/SPBM026_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgs7RURCVZ', 'SPBM027', '550mL纯净水24入白膜', '550ml*24', '箱', '15.00', '18.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM027_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsa7XQQ3I', 'SPBM028', '550mL纯净水12入彩膜非KA版', '550mL*12', '箱', '7.50', '9.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsdIP7CJC', 'SPBM029', '550mL纯净水12入彩膜KA版', '550mL*12', '箱', '7.50', '9.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '其他', '/product_images/SPBM029_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgshUZANXO', 'SPBM030', '350mL长白雪24入纸箱', '350mL*24', '箱', '32.00', '35.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM030_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsk5QKYNK', 'SPBM031', '350mL长白雪4*6纸箱', '350mL*24', '箱', '32.00', '35.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsn5RUYLV', 'SPBM032', '535mL长白雪24入纸箱彩虎版', '535mL*24', '箱', '36.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsrYGBDZV', 'SPBM033', '1L婴儿水12入纸箱', '1L*12', '箱', '67.00', '70.00', '0.00', '0.00', '9.00', '6.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM033_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsu8G94B6', 'SPBM034', '1L婴儿水12入纸箱迪士尼', '1L*12', '箱', '67.00', '70.00', '0.00', '0.00', '9.00', '6.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgsx4DGNXO', 'SPBM035', '1L婴儿水12入纸箱生肖限定', '1L*12', '箱', '67.00', '70.00', '0.00', '0.00', '9.00', '6.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgt0UKV7YQ', 'SPBM036', '1L婴儿水12入纸箱线条小狗', '1L*12', '箱', '67.00', '70.00', '0.00', '0.00', '9.00', '6.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgt4EP56EF', 'SPBM037', '4L泡茶水4入纸箱', '4L*4', '箱', '35.00', '38.00', '0.00', '0.00', '9.00', '6.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM037_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgt7Z3E7E9', 'SPBM038', '12L桶装水1入单桶', '12L*1', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtbWU28QX', 'SPBM039', '12.9L桶装水1入单桶', '12.9L*1', '箱', '12.00', '13.00', '0.00', '0.00', '8.50', '3.00', '4.00', '0.90', '1.50', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgteHHV9KX', 'SPBM040', '19L桶装水1入单桶PET', '19L*1', '箱', '15.00', '18.00', '0.00', '0.00', '10.00', '7.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgthXVMNN9', 'SPBM041', '19L桶装水1入单桶', '19L*1', '箱', '10.00', '14.00', '0.00', '0.00', '11.00', '7.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM041_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtlPZCO9R', 'SPBM042', '400mL运动水24入纸箱', '400mL*24', '箱', '37.50', '41.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM042_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtoQJZ3RM', 'SPBM043', '535mL运动水运动盖24入纸箱', '535mL*24', '箱', '52.00', '55.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM043_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtrO9S5YP', 'SPBM044', '1.25L冰茶6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtuAEVZUT', 'SPBM045', '600mL冰茶冰柠檬15入纸箱', '600mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgtx1TWDB6', 'SPBM046', '450mL农夫果园30%橙苹果樱桃李15入纸箱', '450ml*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '水果', '/product_images/SPBM046_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgu12D4C3A', 'SPBM047', '450mL农夫果园30%凤梨苹果芒果15入纸箱', '450mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM047_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgu4CUXXCN', 'SPBM048', '450mL农夫果园30%葡萄苹果蓝莓15入纸箱', '450ml*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM048_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgu7UPH881', 'SPBM049', '450mL农夫果园30%桃苹果芭乐15入纸箱', '450ml*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM049_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgubMO3YK0', 'SPBM050', '450mL农夫果园30%山楂苹果乌梅15入纸箱', '450ml*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM050_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgueMXCW0N', 'SPBM051', '1.25L农夫果园30%橙苹果樱桃李6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '水果', '/product_images/SPBM051_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fguiCQZ9DE', 'SPBM052', '1.25L农夫果园30%凤梨苹果芒果6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM052_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgulFXO092', 'SPBM053', '1.25L农夫果园30%葡萄苹果蓝莓6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM053_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgupBCR9ZL', 'SPBM054', '1.25L农夫果园30%桃苹果芭乐6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM054_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgusA3RI05', 'SPBM055', '1.25L农夫果园30%山楂苹果乌梅6入纸箱', '1.25L*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '其他', '/product_images/SPBM055_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fguw5HC2HM', 'SPBM056', '550mL尖叫乳钙型柑橘味15入纸箱', '550mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM056_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fguzZ66OQO', 'SPBM057', '550mL尖叫茶氨酸型黄金桃味15入纸箱', '550ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM057_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgv2J8QQ9M', 'SPBM058', '550mL尖叫多肽型西柚味15入纸箱', '550ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM058_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgv6WLNAGW', 'SPBM059', '550mL尖叫纤维型柠檬味15入纸箱', '550ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM059_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgv9TJULLV', 'SPBM060', '550mL尖叫等渗型海盐柚子味15入纸箱运动盖', '550ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvc6786BF', 'SPBM061', '550mL尖叫等渗型海盐青橘味15入纸箱运动盖', '550ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvfPYDHUV', 'SPBM062', '250mL水溶C100西柚味12入彩膜', '250ml*12', '箱', '23.00', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '其他', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgviAQ8S5I', 'SPBM063', '250mL水溶C100柠檬味12入彩膜', '250ml*12', '箱', '23.00', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '其他', '/product_images/SPBM063_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvmE2E3BI', 'SPBM064', '445mL水溶C100血橙味15入纸箱', '445ml*15', '箱', '48.00', '53.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '水果', '/product_images/SPBM064_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvpQ6BCP6', 'SPBM065', '445mL水溶C100柠檬味15入纸箱', '445ml*15', '箱', '48.00', '53.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM065_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvsDXXUQG', 'SPBM066', '445mL水溶C100青皮桔味15入纸箱', '445ml*15', '箱', '48.00', '53.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM066_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvvPCBXGR', 'SPBM067', '445mL水溶C100西柚味15入纸箱', '445ml*15', '箱', '48.00', '53.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '其他', '/product_images/SPBM067_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgvzYA9DDR', 'SPBM068', '250mL维他命水柠檬风味12入彩膜', '250mL*12', '箱', '23.00', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '功能饮料', '/product_images/SPBM068_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgw26W0509', 'SPBM069', '250mL维他命水柑橘风味12入彩膜', '250mL*12', '箱', '23.00', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '功能饮料', '/product_images/SPBM069_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgw6RC4OBX', 'SPBM070', '500mL维他命水柠檬风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM070_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgw9CQSGRB', 'SPBM071', '500mL维他命水柑橘风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM071_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwcHFCSEE', 'SPBM072', '500mL维他命水热带水果风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM072_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwgDR9ULT', 'SPBM073', '500mL维他命水石榴蓝莓风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM073_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwjCL6WHV', 'SPBM074', '500mL维他命水蓝莓树莓风味15入纸箱', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM074_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwnD53T14', 'SPBM075', '500mL维他命水西梅桃子风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM075_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwqDHZCUF', 'SPBM076', '500mL维他命水柚子复合风味15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '功能饮料', '/product_images/SPBM076_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwtL4LFAS', 'SPBM077', '335mL东方树叶桂花乌龙4*6纸箱', '335mL*24', '箱', '49.00', '54.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM077_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgwwF94DE9', 'SPBM078', '335mL东方树叶乌龙茶4*6纸箱', '335ml*24', '箱', '49.00', '54.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM078_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgx0EXIV86', 'SPBM079', '335mL东方树叶茉莉花茶4*6纸箱', '335mL*4*6', '箱', '49.00', '54.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM079_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgx3DKE6S2', 'SPBM080', '335mL东方树叶青柑普洱茶4*6纸箱', '335ml*24', '箱', '49.00', '54.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM080_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgx6ALPNT7', 'SPBM081', '335mL东方树叶桂花乌龙15入纸箱', '335ml*15', '箱', '35.00', '40.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM081_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxaW8MTHQ', 'SPBM082', '335mL东方树叶青柑普洱茶15入纸箱', '335mL*15', '箱', '35.00', '40.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM082_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxd3W75H2', 'SPBM083', '335mL东方树叶乌龙茶15入纸箱', '335mL*15', '箱', '35.00', '40.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM083_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxmH1BFLY', 'SPBM084', '335mL东方树叶茉莉花茶15入纸箱', '335mL*15', '箱', '35.00', '40.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM084_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxrRVMBQY', 'SPBM085', '335mL东方树叶红茶15入纸箱', '335ml*15', '箱', '35.00', '40.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM085_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxv6M9063', 'SPBM086', '500mL东方树叶陈皮白茶15入纸箱普通装', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM086_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgxyGEG2ZU', 'SPBM087', '500mL东方树叶陈皮白茶15入纸箱开盖活动装', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgy2FCWOUD', 'SPBM088', '500mL东方树叶黑乌龙茶15入纸箱', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM088_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgy59TEN21', 'SPBM089', '500mL东方树叶青柑普洱茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM089_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgy8NKM8RE', 'SPBM090', '500mL东方树叶红茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM090_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgybRKQ1Q0', 'SPBM091', '500mL东方树叶乌龙茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM091_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgyeO5S2QL', 'SPBM092', '500mL东方树叶茉莉花茶15入纸箱', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM092_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgyhUHD26T', 'SPBM093', '500mL东方树叶茉莉花茶15入纸箱开盖活动装', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgykF6DE9M', 'SPBM094', '500mL东方树叶青柑普洱15入纸箱开盖活动装', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgynRIP6MD', 'SPBM095', '500mL东方树叶乌龙茶15入纸箱开盖活动装', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgyq7UK9YE', 'SPBM096', '500mL东方树叶绿茶15入纸箱开盖活动装', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgyuLJUERC', 'SPBM097', '500mL东方树叶红茶15入纸箱开盖活动装', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgywI9MPPQ', 'SPBM098', '500mL东方树叶绿茶15入纸箱', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM098_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgz07UHAQV', 'SPBM099', '900mL东方树叶红茶12入纸箱', '900mL*12', '箱', '53.00', '56.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgz35YY3IL', 'SPBM100', '900mL东方树叶乌龙茶12入纸箱', '900mL*12', '箱', '53.00', '56.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM100_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgz6D43IJ1', 'SPBM101', '900mL东方树叶茉莉花茶12入纸箱', '900mL*12', '箱', '53.00', '56.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM101_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgz9PEUZFI', 'SPBM102', '900mL东方树叶青柑普洱茶12入纸箱', '900mL*12', '箱', '53.00', '56.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM102_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzc0AGJH1', 'SPBM103', '900mL东方树叶黑乌龙茶12入纸箱', '900mL*12', '箱', '53.00', '56.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM103_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzf3VR20I', 'SPBM104', '1.5L东方树叶茉莉花茶6入纸箱', '1.5L*6', '箱', '42.00', '46.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM104_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzjT41NIX', 'SPBM105', '1.5L东方树叶乌龙茶6入纸箱', '1.5L*6', '箱', '42.00', '46.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM105_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzmLY9E04', 'SPBM106', '1.5L东方树叶青柑普洱茶6入纸箱', '1.5L*6', '箱', '42.00', '46.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM106_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzq0YNMXB', 'SPBM107', '250mL茶π西柚茉莉花茶12入彩膜', '250ml*12', '箱', '22.50', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '茶饮料', '/product_images/SPBM107_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgztGVZXAZ', 'SPBM108', '250mL茶π青提乌龙茶12入彩膜', '250ml*12', '箱', '22.50', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '茶饮料', '/product_images/SPBM108_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzwW3S05J', 'SPBM109', '250mL茶π柠檬红茶12入彩膜', '250ml*12', '箱', '22.50', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '茶饮料', '/product_images/SPBM109_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fgzzGNUWM2', 'SPBM110', '250mL茶π蜜桃乌龙茶12入彩膜', '250mL*12', '箱', '22.50', '25.00', '0.00', '0.00', '4.00', '2.50', '2.00', '0.45', '0.00', '茶饮料', '/product_images/SPBM110_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh02NJTUQK', 'SPBM111', '500mL茶π茉莉花柠檬茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM111_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh05KNEHI7', 'SPBM112', '500mL茶π柑普柠檬茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh08RYTVI2', 'SPBM113', '500mL茶π青提乌龙茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM113_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0c3IFSA1', 'SPBM114', '500mL茶π柠檬红茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM114_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0fYP6DE0', 'SPBM115', '500mL茶π蜜桃乌龙茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM115_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0iXPU5AV', 'SPBM116', '500mL茶π柚子绿茶15入纸箱', '500mL*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM116_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0mJKSU53', 'SPBM117', '500mL茶π西柚茉莉花茶15入纸箱', '500ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM117_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0p9NW1JN', 'SPBM118', '900mL茶π西柚茉莉花茶12入纸箱', '900mL*12', '箱', '50.00', '55.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM118_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0tG6NTN2', 'SPBM119', '900mL茶π柚子绿茶12入纸箱', '900mL*12', '箱', '50.00', '55.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM119_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh0wTGLHON', 'SPBM120', '900mL茶π柠檬红茶12入纸箱', '900mL*12', '箱', '50.00', '55.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM120_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh10YVWWH4', 'SPBM121', '900mL茶π蜜桃乌龙茶12入纸箱', '900mL*12', '箱', '50.00', '55.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '茶饮料', '/product_images/SPBM121_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh13IC4AUL', 'SPBM122', '300mL常温型NFC100%番石榴混合汁3*10纸箱', '300mL*3*10', '箱', '153.00', '160.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '果汁饮料', '/product_images/SPBM122_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh176PS8OU', 'SPBM123', '300mL常温型NFC100%芒果混合汁3*10纸箱', '300ml*10', '箱', '153.00', '160.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '果汁饮料', '/product_images/SPBM123_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1aHQPMZL', 'SPBM124', '300mL常温型NFC100%橙汁24入纸箱', '300ml*24', '箱', '120.00', '125.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM124_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1dDMFCPI', 'SPBM125', '300mL常温型NFC100%橙汁3*10纸箱', '300mL*3*10', '箱', '153.00', '160.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '果汁饮料', '/product_images/SPBM125_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1hCH9X69', 'SPBM126', '300mL常温型NFC100%芒果混合汁24入纸箱', '300mL*24', '箱', '120.00', '125.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM126_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1kAM2DYT', 'SPBM127', '300mL常温型NFC100%番石榴混合汁24入纸箱', '300ml*24', '箱', '120.00', '125.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM127_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1o39JNF9', 'SPBM128', '300mL常温型NFC100%苹果香蕉汁24入纸箱', '300ml*24', '箱', '120.00', '125.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM128_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1uL22ROY', 'SPBM129', '300mL常温型NFC100%苹果香蕉汁3*10纸箱', '300ml*30', '箱', '153.00', '160.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '果汁饮料', '/product_images/SPBM129_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh1yMC9BWB', 'SPBM130', '900mL常温型NFC100%番石榴混合汁12入纸箱', '900mL*12', '箱', '165.00', '170.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh253W4Y97', 'SPBM131', '900mL常温型NFC100%橙汁12入纸箱', '900mL*12', '箱', '165.00', '170.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM131_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh2aQWYUEV', 'SPBM132', '900mL常温型NFC100%芒果混合汁12入纸箱', '900mL*12', '箱', '165.00', '170.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '果汁饮料', '/product_images/SPBM132_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh2fY9ZWU5', 'SPBM133', '300mL打奶茶乌龙奶茶15入纸箱', '300mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', '/product_images/SPBM133_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh2kCUJW57', 'SPBM134', '300mL打奶茶红茶奶茶15入纸箱', '300mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', '/product_images/SPBM134_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh2pVEJF19', 'SPBM135', '300mL打奶茶茉莉奶绿15入纸箱', '300mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', '/product_images/SPBM135_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh2vMTTLB6', 'SPBM136', '300mL打奶茶铁观音奶茶15入纸箱', '300mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '茶饮料', '/product_images/SPBM136_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3007NHVS', 'SPBM137', '250mLPET咖啡无糖美式16入纸箱', '250ml*16', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', '/product_images/SPBM137_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh34ADFJ8K', 'SPBM138', '250mLPET咖啡醇香拿铁16入纸箱', '250ml*16', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', '/product_images/SPBM138_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh38CR1O0K', 'SPBM139', '400mLPET咖啡经典黑咖15入纸箱', '400ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3cR3HAGA', 'SPBM140', '400mLPET咖啡经典拿铁15入纸箱', '400ml*15', '箱', '46.00', '51.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3g3OK62F', 'SPBM141', '410mL苏打天然水柑橘味15入纸箱', '410mL*15', '箱', '34.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3kMFO9GC', 'SPBM142', '410mL苏打天然水原味15入纸箱', '410ml*15', '箱', '34.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM142_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3nQOB25H', 'SPBM143', '410mL苏打天然水白桃风味15入纸箱', '410ml*15', '箱', '34.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM143_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3rGKZA3A', 'SPBM144', '410mL苏打天然水柠檬风味15入纸箱', '410mL*15', '箱', '34.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', '/product_images/SPBM144_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3uG4O3XD', 'SPBM145', '410mL苏打天然水白桃风味4*6纸箱', '410ml*24', '箱', '54.50', '60.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh3xKRX8Z6', 'SPBM146', '410mL苏打天然水柠檬风味4*6纸箱', '410mL*24', '箱', '54.50', '60.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh40RKWMSE', 'SPBM147', '410mL苏打天然水日向夏橘风味4*6纸箱', '410ml*24', '箱', '54.50', '60.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh43AJ3PKH', 'SPBM148', '410mL苏打天然水日向夏橘风味15入纸箱', '410ml*15', '箱', '34.00', '39.00', '0.00', '0.00', '8.00', '5.00', '4.00', '0.90', '0.00', '饮用水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh47C5LBLZ', 'SPBM149', '500mL苏打气泡水知夏桃桃15入纸箱', '500mL*15', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '气泡水', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4aVLHBVW', 'SPBM150', '270mL铝罐咖啡拿铁15入纸箱', '270ml*15', '箱', '95.00', '100.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', '/product_images/SPBM150_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4dWXS4RG', 'SPBM151', '270mL铝罐咖啡无糖黑咖15入纸箱', '270ml*15', '箱', '95.00', '100.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', '/product_images/SPBM151_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4gQM7QE5', 'SPBM152', '270mL铝罐咖啡低糖拿铁15入纸箱', '270ml*15', '箱', '95.00', '100.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '咖啡饮料', '/product_images/SPBM152_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4kG3WFAB', 'SPBM153', '3KG农夫鲜果脐橙1入纸箱通用', '3KG*1', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '水果', '/product_images/SPBM153_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4oHN309B', 'SPBM154', '0.5KG东北香米吉宏六号4*8纸箱礼盒', '0.5KG*1', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4s31SDP8', 'SPBM155', '0.75KG东北香米吉宏六号22入纸箱三边袋', '0.75KG*22', '箱', '134.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4vBMGW4T', 'SPBM156', '1KG东北香米吉宏六号16入纸箱三边袋', '1000g*16', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh4z9BWNLX', 'SPBM157', '1.5KG东北香米吉宏六号10入纸箱', '1.5KG*10', '箱', '143.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', '/product_images/SPBM157_image.png', 1, '2026-07-10 23:31:26.000', '2026-07-30 22:06:31.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh52CP50GZ', 'SPBM158', '2.5KG东北香米吉宏六号6入纸箱', '2.5KG*6', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
INSERT INTO `products` (`product_id`, `product_code`, `product_name`, `specification`, `unit`, `purchase_price`, `wholesale_price`, `retail_price`, `machine_price`, `total_delivery_fee`, `distribution_delivery_fee`, `worker_retail_delivery_fee`, `worker_wholesale_delivery_fee`, `worker_machine_delivery_fee`, `category`, `image_url`, `status`, `created_at`, `updated_at`) VALUES ('Pmrf3fh56M5489U', 'SPBM159', '5KG东北香米吉宏六号5入纸箱', '5KG*5', '箱', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '粮食', NULL, 1, '2026-07-10 23:31:26.000', '2026-07-10 23:31:26.000');
-- 159 行

-- ----------------------------
-- 表结构: purchase_records
-- ----------------------------
DROP TABLE IF EXISTS `purchase_records`;
CREATE TABLE `purchase_records` (
  `purchase_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '进货单号，主键',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `supplier_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '供应商ID，外键关联suppliers表',
  `quantity` int NOT NULL COMMENT '进货数量',
  `unit_price` decimal(10,2) NOT NULL COMMENT '进货单价（实际结算价格）',
  `total_amount` decimal(12,2) NOT NULL COMMENT '总金额',
  `payment_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '付款状态：0-未付款，1-已付款',
  `payment_date` datetime DEFAULT NULL COMMENT '付款日期',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`purchase_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_supplier` (`supplier_id`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_purchase_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='进货记录表';
INSERT INTO `purchase_records` (`purchase_id`, `product_id`, `supplier_id`, `quantity`, `unit_price`, `total_amount`, `payment_status`, `payment_date`, `remark`, `created_at`) VALUES ('PR17838681960791626', 'Pmrf3fgpqDNVO8Q', NULL, 10, '0.50', '5.00', 0, NULL, NULL, '2026-07-12 22:56:36.000');
INSERT INTO `purchase_records` (`purchase_id`, `product_id`, `supplier_id`, `quantity`, `unit_price`, `total_amount`, `payment_status`, `payment_date`, `remark`, `created_at`) VALUES ('PR17841202674530279', 'Pmrf3fgpzF5XO8D', NULL, 40, '0.00', '0.00', 0, NULL, '盘库增加: 其他原因，', '2026-07-15 20:57:47.000');
INSERT INTO `purchase_records` (`purchase_id`, `product_id`, `supplier_id`, `quantity`, `unit_price`, `total_amount`, `payment_status`, `payment_date`, `remark`, `created_at`) VALUES ('PR17853297486786992', 'Pmrf3fgq30J6ZV3', NULL, 60, '0.00', '0.00', 0, NULL, '盘库增加: 盘点差异，', '2026-07-29 20:55:49.000');
INSERT INTO `purchase_records` (`purchase_id`, `product_id`, `supplier_id`, `quantity`, `unit_price`, `total_amount`, `payment_status`, `payment_date`, `remark`, `created_at`) VALUES ('PR17876727510008777', 'Pmrf3fgteHHV9KX', NULL, 30, '0.00', '0.00', 0, NULL, '盘库增加: 盘点差异，', '2026-08-25 23:45:51.000');
-- 4 行

-- ----------------------------
-- 表结构: reimburse_attachments
-- ----------------------------
DROP TABLE IF EXISTS `reimburse_attachments`;
CREATE TABLE `reimburse_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `reimburse_id` int DEFAULT NULL,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_size` int DEFAULT NULL COMMENT '单位：字节',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reimburse` (`reimburse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 表结构: reimbursements
-- ----------------------------
DROP TABLE IF EXISTS `reimbursements`;
CREATE TABLE `reimbursements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `applicant_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '0' COMMENT '0=待审核, 2=已通过, 3=已拒绝',
  `approved_amount` decimal(12,2) DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_applicant` (`applicant_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 表结构: salary_payments
-- ----------------------------
DROP TABLE IF EXISTS `salary_payments`;
CREATE TABLE `salary_payments` (
  `payment_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发放ID',
  `worker_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工ID',
  `worker_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工姓名快照',
  `salary_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工资归属月份 YYYY-MM',
  `amount` decimal(12,2) NOT NULL COMMENT '发放金额（当月配送费快照）',
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发放账户',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发放账户快照',
  `paid_at` datetime DEFAULT NULL COMMENT '发放时间',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uk_worker_month` (`worker_id`,`salary_month`),
  KEY `idx_month` (`salary_month`),
  KEY `idx_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资发放记录（员工+月份唯一）';

-- ----------------------------
-- 表结构: salesmen
-- ----------------------------
DROP TABLE IF EXISTS `salesmen`;
CREATE TABLE `salesmen` (
  `salesman_id` varchar(50) NOT NULL COMMENT '业务员ID',
  `salesman_name` varchar(50) NOT NULL COMMENT '姓名',
  `phone` varchar(20) DEFAULT NULL COMMENT '手机号',
  `commission_rate` decimal(5,2) DEFAULT '0.00' COMMENT '提成比例(%)',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1在职 0离职',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`salesman_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='业务员表';
INSERT INTO `salesmen` (`salesman_id`, `salesman_name`, `phone`, `commission_rate`, `status`, `created_at`, `updated_at`) VALUES ('SM001', '赵敏', '13600000001', '3.00', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `salesmen` (`salesman_id`, `salesman_name`, `phone`, `commission_rate`, `status`, `created_at`, `updated_at`) VALUES ('SM002', '钱进', '13600000002', '2.50', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `salesmen` (`salesman_id`, `salesman_name`, `phone`, `commission_rate`, `status`, `created_at`, `updated_at`) VALUES ('SM003', '孙丽', '13600000003', '3.50', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `salesmen` (`salesman_id`, `salesman_name`, `phone`, `commission_rate`, `status`, `created_at`, `updated_at`) VALUES ('SM004', '李强', '13600000004', '2.00', 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
-- 4 行

-- ----------------------------
-- 表结构: sms_codes
-- ----------------------------
DROP TABLE IF EXISTS `sms_codes`;
CREATE TABLE `sms_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) NOT NULL COMMENT '手机号',
  `code` varchar(6) NOT NULL COMMENT '验证码',
  `type` varchar(20) DEFAULT 'login' COMMENT 'login=登录 change_phone=换绑',
  `expires_at` datetime NOT NULL COMMENT '过期时间(默认5分钟)',
  `used` tinyint DEFAULT '0' COMMENT '0未使用 1已使用',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='短信验证码表';
INSERT INTO `sms_codes` (`id`, `phone`, `code`, `type`, `expires_at`, `used`, `created_at`) VALUES (1, '13800138000', '195367', 'login', '2026-08-12 00:37:05.000', 0, '2026-08-12 00:32:05.000');
-- 1 行

-- ----------------------------
-- 表结构: staff_salaries
-- ----------------------------
DROP TABLE IF EXISTS `staff_salaries`;
CREATE TABLE `staff_salaries` (
  `salary_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工资记录ID',
  `salary_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '工资单号',
  `worker_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '员工ID',
  `worker_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工姓名',
  `worker_phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '员工电话',
  `salary_month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工资月份(YYYY-MM)',
  `base_salary` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '基本工资',
  `performance` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '绩效工资',
  `bonus` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '奖金',
  `allowance` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '津贴/补贴',
  `overtime_pay` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '加班费',
  `delivery_fee_total` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '配送提成',
  `deduction` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '扣款',
  `social_insurance` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '社保个人部分',
  `tax` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '个人所得税',
  `total_salary` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '应发合计',
  `net_salary` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '实发工资',
  `payment_status` tinyint NOT NULL DEFAULT '1' COMMENT '发放状态:1待发放 2已发放 3部分发放',
  `payment_date` date DEFAULT NULL COMMENT '发放日期',
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发放账户ID',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户名称',
  `work_days` int DEFAULT NULL COMMENT '出勤天数',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime DEFAULT NULL COMMENT '创建时间',
  `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`salary_id`),
  KEY `idx_worker_id` (`worker_id`),
  KEY `idx_salary_month` (`salary_month`),
  KEY `idx_payment_status` (`payment_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员工资表';

-- ----------------------------
-- 表结构: station_return_items
-- ----------------------------
DROP TABLE IF EXISTS `station_return_items`;
CREATE TABLE `station_return_items` (
  `item_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '明细ID',
  `return_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '返货ID',
  `product_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品ID',
  `product_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品编码',
  `product_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品名称',
  `specification` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '规格',
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '单位',
  `quantity` int NOT NULL DEFAULT '0' COMMENT '数量',
  `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '单价(进货价)',
  `subtotal` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '小计',
  `remark` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime DEFAULT NULL COMMENT '创建时间',
  PRIMARY KEY (`item_id`),
  KEY `idx_return_id` (`return_id`),
  KEY `idx_product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水站返货商品明细表';

-- ----------------------------
-- 表结构: station_returns
-- ----------------------------
DROP TABLE IF EXISTS `station_returns`;
CREATE TABLE `station_returns` (
  `return_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '返货ID',
  `return_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '返货单号',
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联订单ID',
  `station_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '水站ID',
  `station_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '水站名称',
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人',
  `contact_phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `total_amount` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '返货总金额(应退款)',
  `settlement_amount` decimal(15,2) NOT NULL DEFAULT '0.00' COMMENT '实际结算金额',
  `settlement_status` tinyint NOT NULL DEFAULT '1' COMMENT '结算状态:1待结算 2已结算 3部分结算',
  `settlement_type` tinyint DEFAULT NULL COMMENT '结算方式:1冲抵货款 2现金退款 3银行转账',
  `account_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '退款账户ID',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户名称',
  `return_date` date DEFAULT NULL COMMENT '返货日期',
  `settlement_date` date DEFAULT NULL COMMENT '结算日期',
  `item_count` int NOT NULL DEFAULT '0' COMMENT '商品行数',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `handler` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '经手人',
  `created_at` datetime DEFAULT NULL COMMENT '创建时间',
  `updated_at` datetime DEFAULT NULL COMMENT '更新时间',
  PRIMARY KEY (`return_id`),
  KEY `idx_station_id` (`station_id`),
  KEY `idx_settlement_status` (`settlement_status`),
  KEY `idx_return_date` (`return_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水站返货管理表';

-- ----------------------------
-- 表结构: sub_stations
-- ----------------------------
DROP TABLE IF EXISTS `sub_stations`;
CREATE TABLE `sub_stations` (
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '水站ID，主键',
  `station_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '水站名称',
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人姓名',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '水站地址',
  `area` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '覆盖区域（如南京鼓楼区）',
  `credit_limit` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '信用额度（允许的最大欠款金额）',
  `current_debt` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '当前欠款余额',
  `payment_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '付款方式：1-先付款后拿货，2-先拿货后付款',
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '付款银行',
  `bank_account` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '付款账户',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户户名',
  `invoice_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发票抬头',
  `tax_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '纳税人识别号',
  `invoice_address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发票地址',
  `invoice_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发票电话',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态：0-停用，1-启用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`station_id`),
  KEY `idx_area` (`area`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='下级水站信息表';
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST001', '江宁水站', '周老板', '13900000001', '南京市江宁区东山街道', '江宁区', '50000.00', '18.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-28 21:41:57.000');
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST002', '秦淮水站', '吴老板', '13900000002', '南京市秦淮区大光路', '秦淮区', '30000.00', '0.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST003', '鼓楼水站', '郑老板', '13900000003', '南京市鼓楼区中山北路', '鼓楼区', '40000.00', '0.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST004', '玄武水站', '冯老板', '13900000004', '南京市玄武区锁金村', '玄武区', '35000.00', '0.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST005', '建邺水站', '褚老板', '13900000005', '南京市建邺区兴隆大街', '建邺区', '28000.00', '0.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `sub_stations` (`station_id`, `station_name`, `contact_name`, `phone`, `address`, `area`, `credit_limit`, `current_debt`, `payment_type`, `bank_name`, `bank_account`, `account_name`, `invoice_title`, `tax_number`, `invoice_address`, `invoice_phone`, `status`, `created_at`, `updated_at`) VALUES ('ST006', '栖霞水站', '卫老板', '13900000006', '南京市栖霞区仙林', '栖霞区', '32000.00', '0.00', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
-- 6 行

-- ----------------------------
-- 表结构: suppliers
-- ----------------------------
DROP TABLE IF EXISTS `suppliers`;
CREATE TABLE `suppliers` (
  `supplier_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商ID，主键',
  `supplier_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商名称',
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人姓名',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '供应商地址',
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '开户银行',
  `bank_account` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '银行账号',
  `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账户户名',
  `tax_number` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '纳税人识别号',
  `invoice_title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发票抬头',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态：0-停用，1-启用',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`supplier_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商信息表';
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_name`, `phone`, `address`, `bank_name`, `bank_account`, `account_name`, `tax_number`, `invoice_title`, `status`, `remark`, `created_at`, `updated_at`) VALUES ('SUP001', '农夫山泉（南京）有限公司', '王经理', '025-88880001', '南京市江宁区空港物流园', NULL, NULL, NULL, NULL, NULL, 1, '农夫山泉官方供货', '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_name`, `phone`, `address`, `bank_name`, `bank_account`, `account_name`, `tax_number`, `invoice_title`, `status`, `remark`, `created_at`, `updated_at`) VALUES ('SUP002', '南京鑫达饮品批发部', '刘老板', '025-88880002', '南京市栖霞区尧化门', NULL, NULL, NULL, NULL, NULL, 1, NULL, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_name`, `phone`, `address`, `bank_name`, `bank_account`, `account_name`, `tax_number`, `invoice_title`, `status`, `remark`, `created_at`, `updated_at`) VALUES ('SUP003', '华东水业配送中心', '陈经理', '025-88880003', '南京市雨花台区铁心桥', NULL, NULL, NULL, NULL, NULL, 1, NULL, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_name`, `phone`, `address`, `bank_name`, `bank_account`, `account_name`, `tax_number`, `invoice_title`, `status`, `remark`, `created_at`, `updated_at`) VALUES ('SUP004', '玄武湖贸易有限公司', '赵总', '025-88880004', '南京市玄武区珠江路', NULL, NULL, NULL, NULL, NULL, 1, NULL, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `suppliers` (`supplier_id`, `supplier_name`, `contact_name`, `phone`, `address`, `bank_name`, `bank_account`, `account_name`, `tax_number`, `invoice_title`, `status`, `remark`, `created_at`, `updated_at`) VALUES ('SUP005', '苏南食品供应链', '孙经理', '025-88880005', '南京市建邺区奥体大街', NULL, NULL, NULL, NULL, NULL, 1, NULL, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
-- 5 行

-- ----------------------------
-- 表结构: users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL COMMENT '用户名',
  `password` varchar(255) NOT NULL COMMENT '密码(bcrypt加密)',
  `display_name` varchar(50) NOT NULL COMMENT '显示名称',
  `phone` varchar(20) DEFAULT NULL COMMENT '手机号',
  `role` varchar(20) NOT NULL DEFAULT 'admin' COMMENT '角色',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_phone` (`phone`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统用户表';
INSERT INTO `users` (`id`, `username`, `password`, `display_name`, `phone`, `role`, `created_at`, `updated_at`) VALUES (1, 'admin', '$2b$10$7fAfAOoH6DqE4r4dgrllNOP93BjZo3Z0YaZp713lH8CceH9GJRnqe', '管理员', '13900000001', 'admin', '2026-08-04 21:14:39.000', '2026-08-12 00:34:15.000');
-- 1 行

-- ----------------------------
-- 表结构: water_ticket_issuance
-- ----------------------------
DROP TABLE IF EXISTS `water_ticket_issuance`;
CREATE TABLE `water_ticket_issuance` (
  `issuance_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发行记录ID，主键',
  `batch_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发行批次号（同一次录入共享）',
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '水站ID',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID',
  `quantity` int NOT NULL COMMENT '返货/发行数量（生成等量水票）',
  `distribution_delivery_fee` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '分销配送费（自动带出商品档案 distribution_delivery_fee，可改）',
  `month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属月份（如 2026-08）',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '录入人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`issuance_id`),
  KEY `idx_station` (`station_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_month` (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水票发行记录（每月返货清单：水站+商品+数量+返货配送费，生成等量水票）';
INSERT INTO `water_ticket_issuance` (`issuance_id`, `batch_id`, `station_id`, `product_id`, `quantity`, `distribution_delivery_fee`, `month`, `remark`, `created_by`, `created_at`) VALUES ('WTI1787751617987369', 'WTB178775161798645', 'ST004', 'Pmrf3fgpqDNVO8Q', 3, '7.50', '2026-08', NULL, 'admin', '2026-08-26 21:40:17.000');
INSERT INTO `water_ticket_issuance` (`issuance_id`, `batch_id`, `station_id`, `product_id`, `quantity`, `distribution_delivery_fee`, `month`, `remark`, `created_by`, `created_at`) VALUES ('WTI1787751617989788', 'WTB178775161798645', 'ST004', 'Pmrf3fgq30J6ZV3', 6, '30.00', '2026-08', NULL, 'admin', '2026-08-26 21:40:17.000');
INSERT INTO `water_ticket_issuance` (`issuance_id`, `batch_id`, `station_id`, `product_id`, `quantity`, `distribution_delivery_fee`, `month`, `remark`, `created_by`, `created_at`) VALUES ('WTI1787925949494275', 'WTB178792594949370', 'ST001', 'Pmrf3fgpqDNVO8Q', 3, '7.50', '2026-08', NULL, 'admin', '2026-08-28 22:05:49.000');
INSERT INTO `water_ticket_issuance` (`issuance_id`, `batch_id`, `station_id`, `product_id`, `quantity`, `distribution_delivery_fee`, `month`, `remark`, `created_by`, `created_at`) VALUES ('WTI20260825000001', 'WTB20260825000001', 'ST001', 'Pmrf3fgpqDNVO8Q', 5, '25.00', '2026-08', '8月返货清单', 'seed', '2026-08-25 10:00:00.000');
INSERT INTO `water_ticket_issuance` (`issuance_id`, `batch_id`, `station_id`, `product_id`, `quantity`, `distribution_delivery_fee`, `month`, `remark`, `created_by`, `created_at`) VALUES ('WTI20260825000002', 'WTB20260825000001', 'ST001', 'Pmrf3fgteHHV9KX', 2, '14.00', '2026-08', '8月返货清单', 'seed', '2026-08-25 10:00:00.000');
-- 5 行

-- ----------------------------
-- 表结构: water_tickets
-- ----------------------------
DROP TABLE IF EXISTS `water_tickets`;
CREATE TABLE `water_tickets` (
  `ticket_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '水票编号，主键',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对应商品ID（一张票=一件对应商品）',
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '持有水站ID',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态 1-未用 2-已核销 3-作废',
  `month` varchar(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属月份（返货清单月份，如 2026-08）',
  `issuance_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源返货清单/发行记录ID',
  `issued_at` datetime DEFAULT NULL COMMENT '发行时间',
  `issued_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '发行操作人',
  `used_at` datetime DEFAULT NULL COMMENT '核销时间',
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '核销关联订单ID',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`ticket_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_station` (`station_id`),
  KEY `idx_status` (`status`),
  KEY `idx_month` (`month`),
  KEY `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水票表（一张水票=一件对应商品，价值=进货价，经销商按返货清单获取）';
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617988123710', 'Pmrf3fgpqDNVO8Q', 'ST004', 1, '2026-08', 'WTI1787751617987369', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617988839745', 'Pmrf3fgpqDNVO8Q', 'ST004', 1, '2026-08', 'WTI1787751617987369', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617988925136', 'Pmrf3fgpqDNVO8Q', 'ST004', 1, '2026-08', 'WTI1787751617987369', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989136832', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989206820', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989399597', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989417401', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989758435', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787751617989777533', 'Pmrf3fgq30J6ZV3', 'ST004', 1, '2026-08', 'WTI1787751617989788', '2026-08-26 21:40:18.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787925949495219093', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI1787925949494275', '2026-08-28 22:05:49.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787925949495607003', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI1787925949494275', '2026-08-28 22:05:49.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT1787925949495758890', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI1787925949494275', '2026-08-28 22:05:49.000', 'admin', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000001', 'Pmrf3fgpqDNVO8Q', 'ST001', 2, '2026-08', 'WTI20260825000001', '2026-08-25 23:40:29.000', 'seed', '2026-08-28 21:41:43.000', 'SZX2026082800001', NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000002', 'Pmrf3fgpqDNVO8Q', 'ST001', 2, '2026-08', 'WTI20260825000001', '2026-08-25 23:40:29.000', 'seed', '2026-08-28 21:41:43.000', 'SZX2026082800001', NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000003', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI20260825000001', '2026-08-25 23:40:29.000', 'seed', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000004', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI20260825000001', '2026-08-25 23:40:29.000', 'seed', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000005', 'Pmrf3fgpqDNVO8Q', 'ST001', 1, '2026-08', 'WTI20260825000001', '2026-08-25 23:40:29.000', 'seed', NULL, NULL, NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000009', 'Pmrf3fgteHHV9KX', 'ST001', 2, '2026-08', 'WTI20260825000002', '2026-08-25 23:40:29.000', 'seed', '2026-08-27 21:40:12.000', 'SZX2026082700001', NULL);
INSERT INTO `water_tickets` (`ticket_id`, `product_id`, `station_id`, `status`, `month`, `issuance_id`, `issued_at`, `issued_by`, `used_at`, `order_id`, `remark`) VALUES ('WT20260825000010', 'Pmrf3fgteHHV9KX', 'ST001', 2, '2026-08', 'WTI20260825000002', '2026-08-25 23:40:29.000', 'seed', '2026-08-27 22:47:55.000', 'SZX2026082700003', NULL);
-- 19 行

-- ----------------------------
-- 表结构: workers
-- ----------------------------
DROP TABLE IF EXISTS `workers`;
CREATE TABLE `workers` (
  `worker_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工ID，主键',
  `worker_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工姓名',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `employee_type` tinyint NOT NULL DEFAULT '2' COMMENT '员工类型: 1=店长 2=配送员工 3=业务员',
  `vehicle_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '配送车辆类型：1-电动车（终端零售），2-面包车（批量配送）',
  `bank_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款银行',
  `bank_account` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款账户',
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '状态：0-离职，1-在职',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`worker_id`),
  KEY `idx_vehicle_type` (`vehicle_type`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='配送员工表';
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `bank_name`, `bank_account`, `status`, `created_at`, `updated_at`) VALUES ('W001', '张师傅', '13800000001', 1, 1, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `bank_name`, `bank_account`, `status`, `created_at`, `updated_at`) VALUES ('W002', '李师傅', '13800000002', 1, 1, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `bank_name`, `bank_account`, `status`, `created_at`, `updated_at`) VALUES ('W003', '王师傅', '13800000003', 1, 2, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `bank_name`, `bank_account`, `status`, `created_at`, `updated_at`) VALUES ('W004', '刘师傅', '13800000004', 1, 2, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `bank_name`, `bank_account`, `status`, `created_at`, `updated_at`) VALUES ('W005', '陈师傅', '13800000005', 2, 1, NULL, NULL, 1, '2026-08-25 23:40:29.000', '2026-08-25 23:40:29.000');
-- 5 行

SET FOREIGN_KEY_CHECKS=1;
SELECT '数据库初始化完成！' AS message;
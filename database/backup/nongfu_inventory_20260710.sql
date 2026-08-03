-- MySQL dump 10.13  Distrib 8.4.9, for Win64 (x86_64)
--
-- Host: localhost    Database: nongfu_inventory
-- ------------------------------------------------------
-- Server version	8.4.9

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `delivery_fee_settlement`
--

DROP TABLE IF EXISTS `delivery_fee_settlement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `delivery_fee_settlement`
--

LOCK TABLES `delivery_fee_settlement` WRITE;
/*!40000 ALTER TABLE `delivery_fee_settlement` DISABLE KEYS */;
/*!40000 ALTER TABLE `delivery_fee_settlement` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `financial_settlement`
--

DROP TABLE IF EXISTS `financial_settlement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `financial_settlement`
--

LOCK TABLES `financial_settlement` WRITE;
/*!40000 ALTER TABLE `financial_settlement` DISABLE KEYS */;
/*!40000 ALTER TABLE `financial_settlement` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inventory`
--

DROP TABLE IF EXISTS `inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='总仓库库存表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventory`
--

LOCK TABLES `inventory` WRITE;
/*!40000 ALTER TABLE `inventory` DISABLE KEYS */;
/*!40000 ALTER TABLE `inventory` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `order_items`
--

DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `item_id` int NOT NULL AUTO_INCREMENT COMMENT '明细ID，主键，自增',
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单ID，外键关联orders表',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID，外键关联products表',
  `quantity` int NOT NULL COMMENT '商品数量',
  `purchase_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '进货价（线上销售时用于计算应收农夫山泉的货款）',
  `wholesale_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '批发价（线下分销时用于计算水站应付款）',
  `retail_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售价（线下零售时用于计算实际销售额）',
  `machine_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '零售机供货价（零售机供货时用于计算销售额）',
  `total_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '总包配送费（农夫山泉结算给经销商）',
  `distribution_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '分销配送费（经销商结算给水站）',
  `worker_retail_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售配送费（终端零售客户配送）',
  `worker_wholesale_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人水站配送费（面包车配送给水站）',
  `worker_machine_delivery_fee` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '工人零售机配送费（面包车配送给零售机）',
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '明细小计（根据订单类型：线上=进货价*数量，分销=批发价*数量，零售=零售价*数量，零售机=零售机供货价*数量）',
  PRIMARY KEY (`item_id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_product` (`product_id`),
  CONSTRAINT `fk_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单商品明细表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `order_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单ID，主键',
  `order_type` tinyint(1) NOT NULL COMMENT '订单类型：1-线上平台销售，2-线下水站分销，3-线下零售，4-零售机供货',
  `platform_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台类型（订单类型=1时填写，如美团、饿了么）',
  `platform_order_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台订单号（订单类型=1时填写）',
  `station_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '水站ID（订单类型=2时填写，外键关联sub_stations表）',
  `customer_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户姓名',
  `customer_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户电话',
  `customer_address` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户地址',
  `order_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '订单总金额（线上=进货价总和，分销=批发价总和，零售=零售价总和，零售机=零售机供货价总和）',
  `delivery_fee` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '配送费金额',
  `total_receivable` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '应收总金额（订单金额+配送费）',
  `delivery_type` tinyint(1) NOT NULL DEFAULT '1' COMMENT '配送方式：1-自有员工配送，2-水站配送，3-无需配送',
  `worker_id` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '配送员工ID（配送方式=1时填写，外键关联workers表）',
  `payment_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '付款状态：0-未付款，1-已付款，2-部分付款',
  `paid_amount` decimal(12,2) NOT NULL DEFAULT '0.00' COMMENT '已付款金额',
  `order_status` tinyint(1) NOT NULL DEFAULT '0' COMMENT '订单状态：0-待处理，1-已发货，2-已完成，3-已取消',
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_order_type` (`order_type`),
  KEY `idx_station` (`station_id`),
  KEY `idx_worker` (`worker_id`),
  KEY `idx_order_status` (`order_status`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_order_station` FOREIGN KEY (`station_id`) REFERENCES `sub_stations` (`station_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_order_worker` FOREIGN KEY (`worker_id`) REFERENCES `workers` (`worker_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_records`
--

DROP TABLE IF EXISTS `purchase_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_records`
--

LOCK TABLES `purchase_records` WRITE;
/*!40000 ALTER TABLE `purchase_records` DISABLE KEYS */;
/*!40000 ALTER TABLE `purchase_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sub_stations`
--

DROP TABLE IF EXISTS `sub_stations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sub_stations`
--

LOCK TABLES `sub_stations` WRITE;
/*!40000 ALTER TABLE `sub_stations` DISABLE KEYS */;
/*!40000 ALTER TABLE `sub_stations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `suppliers`
--

DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `suppliers`
--

LOCK TABLES `suppliers` WRITE;
/*!40000 ALTER TABLE `suppliers` DISABLE KEYS */;
/*!40000 ALTER TABLE `suppliers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `workers`
--

DROP TABLE IF EXISTS `workers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `workers` (
  `worker_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工ID，主键',
  `worker_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '员工姓名',
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
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
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `workers`
--

LOCK TABLES `workers` WRITE;
/*!40000 ALTER TABLE `workers` DISABLE KEYS */;
/*!40000 ALTER TABLE `workers` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-07-10 23:23:07

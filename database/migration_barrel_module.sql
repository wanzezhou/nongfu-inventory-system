-- ============================================================================
-- 回桶管理模块：barrel_config 新表 + barrel_deposits 扩展字段（幂等）
-- 执行：node -e "require('dotenv').config();require('./src/config/db').pool.query(fs.readFileSync(...))" 见后端惯例
-- 或由迁移脚本直接执行；完成后重导 full_schema_data.sql
-- ============================================================================

-- 1. 桶型配置表
CREATE TABLE IF NOT EXISTS `barrel_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `barrel_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '桶型（唯一），如 19L桶/12L桶/4L桶/7.5L桶',
  `deposit_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '押金单价',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1启用 0停用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_barrel_type` (`barrel_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='桶型押金配置';

-- 2. 预置常见桶型（已存在则不覆盖，单价可由 admin 后续调整）
INSERT IGNORE INTO `barrel_config` (`barrel_type`, `deposit_price`, `status`, `sort_order`, `created_at`, `updated_at`) VALUES
('19L桶', 30.00, 1, 1, NOW(), NOW()),
('12L桶', 25.00, 1, 2, NOW(), NOW()),
('4L桶', 15.00, 1, 3, NOW(), NOW()),
('7.5L桶', 20.00, 1, 4, NOW(), NOW());

-- 3. barrel_deposits 扩展：记账对象 + 财务账户（列已存在时报 1060，由迁移脚本幂等跳过）
ALTER TABLE `barrel_deposits`
  ADD COLUMN `party_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'station' COMMENT 'station=水站, customer=零售客户' AFTER `station_id`,
  ADD COLUMN `customer_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '零售客户姓名（水站对象为空）' AFTER `party_type`,
  ADD COLUMN `customer_phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '零售客户电话（水站对象为空）' AFTER `customer_name`,
  ADD COLUMN `account_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '财务账户ID：collect=押金入账账户，return=押金支出账户' AFTER `unit_price`,
  ADD COLUMN `account_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '财务账户名称冗余' AFTER `account_id`,
  ADD COLUMN `refunded_at` datetime DEFAULT NULL COMMENT '退回完成时间（仅 return 记录）' AFTER `remark`;

-- 4. 索引（重复执行时由迁移脚本按 1061 幂等跳过）
CREATE INDEX idx_deposit_type ON `barrel_deposits` (`deposit_type`);
CREATE INDEX idx_deposit_created ON `barrel_deposits` (`created_at`);
CREATE INDEX idx_party_type ON `barrel_deposits` (`party_type`);

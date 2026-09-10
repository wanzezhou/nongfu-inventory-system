-- =====================================================================
-- 迁移：员工固定月薪 + 工资预支（2026-09-07）
-- 背景：
--   1. 店长(employee_type=1)/业务员(employee_type=3) 工资为手动固定月薪，
--      workers 表新增 monthly_salary 列（仅 1/3 使用，配送员工恒 NULL）。
--   2. 工资预支：全部员工可预支（公司账户支出 + 员工挂账），发工资时从
--      应发中抵扣；应发不足时实发记为负数（挂账下月继续扣）。
--      预支逐笔记录于 salary_advances；发工资时逐笔抵扣，抵扣明细存
--      salary_payment_advances（撤销发放时反向还原）。
-- 幂等：可重复执行（information_schema 判存 / CREATE TABLE IF NOT EXISTS）。
-- 执行方式：node + mysql2（charset utf8mb4），勿用 mysql.exe（Windows 中文乱码）。
-- =====================================================================

-- 1) workers 新增固定月薪列（幂等）
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workers'
    AND COLUMN_NAME = 'monthly_salary'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `workers` ADD COLUMN `monthly_salary` DECIMAL(12,2) DEFAULT NULL COMMENT ''固定月薪(元)，仅店长(employee_type=1)/业务员(employee_type=3)使用'' AFTER `commission_rate`',
  'SELECT ''workers.monthly_salary 已存在，跳过'' AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 工资预支记录表
CREATE TABLE IF NOT EXISTS `salary_advances` (
  `advance_id` varchar(64) NOT NULL COMMENT '预支ID',
  `worker_id` varchar(64) NOT NULL COMMENT '员工ID',
  `worker_name` varchar(100) NOT NULL COMMENT '员工姓名快照',
  `amount` decimal(12,2) NOT NULL COMMENT '预支全额',
  `advance_date` date NOT NULL COMMENT '预支日期',
  `account_id` varchar(64) DEFAULT NULL COMMENT '付款账户',
  `account_name` varchar(100) DEFAULT NULL COMMENT '付款账户快照',
  `deducted_amount` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT '已由工资发放抵扣金额',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '0=未结清 1=已结清(被工资全部抵扣)',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) DEFAULT NULL COMMENT '操作人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`advance_id`),
  KEY `idx_worker` (`worker_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资预支记录（发工资时从应发中抵扣，结清前挂账下月继续扣）';

-- 3) 工资发放-预支抵扣明细表（撤销发放时反向还原预支）
CREATE TABLE IF NOT EXISTS `salary_payment_advances` (
  `payment_id` varchar(64) NOT NULL COMMENT '发放ID',
  `advance_id` varchar(64) NOT NULL COMMENT '预支ID',
  `deducted_amount` decimal(12,2) NOT NULL COMMENT '本次发放抵扣金额',
  PRIMARY KEY (`payment_id`, `advance_id`),
  KEY `idx_advance` (`advance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工资发放-预支抵扣明细（撤销发放时反向还原预支挂账）';

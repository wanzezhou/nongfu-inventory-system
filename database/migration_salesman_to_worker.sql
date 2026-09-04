-- =====================================================================
-- 迁移：业务员管理模块并入员工管理（2026-09-04）
-- 背景：删除「基础信息管理-业务员管理」模块（salesmanController/routes、
--       前端 SalesmanList），业务员作为员工类型（employee_type=3）统一在
--       员工管理（workers 表）维护。
-- 策略：
--   1. workers 表新增 commission_rate 列（承接业务员提成比例）。
--   2. salesmen 数据 1:1 迁入 workers：worker_id 沿用原 salesman_id
--      （SM 前缀），保证 mini_accounts.target_id 等历史引用可解析。
--   3. salesmen 原表保留为只读归档（代码层已全部下线，无业务表引用），
--      不 DROP，作为迁移兜底与历史存档。
-- 幂等：可重复执行；已迁移的行不会重复插入。
-- 执行方式：node + mysql2（charset utf8mb4），勿用 mysql.exe（Windows 中文乱码）。
-- =====================================================================

-- 1) workers 新增提成比例列（幂等）
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'workers'
    AND COLUMN_NAME = 'commission_rate'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `workers` ADD COLUMN `commission_rate` DECIMAL(5,2) DEFAULT NULL COMMENT ''提成比例(%)，仅业务员(employee_type=3)使用'' AFTER `vehicle_type`',
  'SELECT ''workers.commission_rate 已存在，跳过'' AS info');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 业务员数据迁入 workers（幂等：跳过已存在的 worker_id）
INSERT INTO `workers` (`worker_id`, `worker_name`, `phone`, `employee_type`, `vehicle_type`, `commission_rate`, `status`, `created_at`, `updated_at`)
SELECT
  s.`salesman_id`,
  s.`salesman_name`,
  s.`phone`,
  3,                       -- 员工类型：业务员
  1,                       -- 配送车辆默认电动车（业务员无车辆信息，列 NOT NULL）
  s.`commission_rate`,
  s.`status`,
  s.`created_at`,
  s.`updated_at`
FROM `salesmen` s
WHERE NOT EXISTS (SELECT 1 FROM `workers` w WHERE w.`worker_id` = s.`salesman_id` COLLATE utf8mb4_unicode_ci);

-- 3) 核对迁移结果（执行后人工/脚本确认数量一致）
SELECT
  (SELECT COUNT(*) FROM `salesmen`)  AS salesmen_total,
  (SELECT COUNT(*) FROM `workers` WHERE `worker_id` LIKE 'SM%') AS migrated_into_workers,
  (SELECT COUNT(*) FROM `salesmen` s WHERE NOT EXISTS
     (SELECT 1 FROM `workers` w WHERE w.`worker_id` = s.`salesman_id` COLLATE utf8mb4_unicode_ci)) AS not_yet_migrated;

-- 4) 归档注释（表 COMMENT 标记，幂等）
ALTER TABLE `salesmen` COMMENT = '业务员表（已归档 2026-09-04：模块删除，数据已迁入 workers.employee_type=3，本表只读保留）';

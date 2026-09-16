-- ============================================================================
-- 迁移：新增系统配置表 system_settings（键值对，2026-09-16）
-- ----------------------------------------------------------------------------
-- 用途：存放少量「全系统唯一」的业务配置。首个使用方：销售单打印的店长
--       （print_manager_worker_id）。此前无任何通用配置表，避免为此再建专表。
-- 幂等：CREATE TABLE IF NOT EXISTS + INSERT ... ON DUPLICATE KEY UPDATE 空值不覆盖
-- 回滚：database/rollback_add_system_settings.sql
-- 执行：优先用 backend/scripts/migrate_add_system_settings.js
-- ============================================================================

CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key`   varchar(64)  NOT NULL COMMENT '配置键',
  `setting_value` varchar(500) DEFAULT NULL COMMENT '配置值（统一存字符串）',
  `remark`        varchar(200) DEFAULT NULL COMMENT '配置说明',
  `updated_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置（键值对）';

-- 预置：销售单打印使用的店长（默认取启用状态的第一位店长 W001 张师傅）
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `remark`)
VALUES ('print_manager_worker_id', 'W001', '销售单打印「店长联系电话」使用的员工ID；为空时回退为第一位启用的店长')
ON DUPLICATE KEY UPDATE `remark` = VALUES(`remark`);

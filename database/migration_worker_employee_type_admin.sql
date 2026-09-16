-- ============================================================================
-- 迁移：员工类型新增「管理员」（2026-09-16）
-- ----------------------------------------------------------------------------
-- 变更内容：仅更新 `workers.employee_type` 的列注释，纳入 4=管理员。
--   TINYINT 本身即可存放 4，无需改类型/默认值，故本次为「注释同步」型 DDL。
-- 幂等：MODIFY COLUMN 重复执行结果一致。
-- 回滚：database/rollback_worker_employee_type_admin.sql
-- 执行：优先用 backend/scripts/migrate_worker_employee_type_admin.js（含存在性判断与核对）
-- ============================================================================

ALTER TABLE `workers`
  MODIFY COLUMN `employee_type` TINYINT NOT NULL DEFAULT 2
  COMMENT '员工类型: 1=店长 2=配送员工 3=业务员 4=管理员';

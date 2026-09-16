-- ============================================================================
-- 回滚：员工类型「管理员」（撤销 2026-09-16 的 migration_worker_employee_type_admin.sql）
-- ----------------------------------------------------------------------------
-- 效果：把 `workers.employee_type` 的列注释还原为旧的 3 类说明。
-- ⚠️ 回滚只改注释，**不会**把已存的 employee_type=4 改回 2。
--    若确有 4 的数据，请先自行把数据迁移回 1/2/3，否则注释与数据将不一致。
--    查询受影响数据：
--      SELECT worker_id, worker_name, employee_type FROM workers WHERE employee_type = 4;
-- 幂等：MODIFY COLUMN 重复执行结果一致。
-- ============================================================================

ALTER TABLE `workers`
  MODIFY COLUMN `employee_type` TINYINT NOT NULL DEFAULT 2
  COMMENT '员工类型: 1=店长 2=配送员工 3=业务员';

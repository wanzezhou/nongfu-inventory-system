-- ============================================================
-- 迁移：移除 workers.vehicle_type（配送车辆类型）
-- 日期：2026-09-14
-- 说明：业务方确认不再需要「配送车辆」维度。该字段此前仅用于员工表单/列表/筛选
--       与 Excel 导入模板，无任何业务逻辑依赖（工资、订单、水票均不读取），
--       数据库层无触发器/视图引用，可安全移除。
-- 幂等：通过 information_schema 判断列与索引是否存在，可重复执行。
-- 执行：cd backend && node scripts/migrate_remove_worker_vehicle_type.js
--       （该 .js 内联同样逻辑，用 mysql2 执行；勿用 mysql.exe，Windows 下中文注释会乱码）
-- 本 .sql 保留作存档/人工审阅，逻辑与 .js 一致。
-- ============================================================

SET @db := DATABASE();

-- 1) 删除索引 idx_vehicle_type（若存在）
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'workers' AND index_name = 'idx_vehicle_type'
);
SET @sql_drop_idx := IF(@idx_exists > 0,
  'ALTER TABLE workers DROP INDEX idx_vehicle_type',
  'SELECT ''索引 idx_vehicle_type 不存在，跳过'' AS msg');
PREPARE stmt FROM @sql_drop_idx; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 删除列 vehicle_type（若存在）
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'workers' AND column_name = 'vehicle_type'
);
SET @sql_drop_col := IF(@col_exists > 0,
  'ALTER TABLE workers DROP COLUMN vehicle_type',
  'SELECT ''列 vehicle_type 不存在，跳过'' AS msg');
PREPARE stmt FROM @sql_drop_col; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) 结果核对
SELECT COUNT(*) AS remaining_vehicle_type_cols
FROM information_schema.columns
WHERE table_schema = @db AND table_name = 'workers' AND column_name = 'vehicle_type';

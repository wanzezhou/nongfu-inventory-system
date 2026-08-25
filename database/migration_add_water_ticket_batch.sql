-- ============================================================
-- 水站返货管理：发行记录增加批次号（batch_id）
-- 同一次「录入并发行」的多条发行记录共享一个批次号，
-- 用于发行记录列表按批次合并展示（水站/配送费合并求和）
-- 2026-08-25
-- ============================================================

SET NAMES utf8mb4;

-- 幂等：列不存在才添加
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_ticket_issuance' AND COLUMN_NAME = 'batch_id'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE water_ticket_issuance ADD COLUMN batch_id VARCHAR(32) NULL DEFAULT NULL COMMENT ''发行批次号（同一次录入共享）'' AFTER issuance_id',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 存量数据回填：按单条生成独立批次（保证可分组）
-- 注意：created_at 可能为 NULL（列无默认值），不能依赖时间，直接用 issuance_id 后缀
UPDATE water_ticket_issuance
SET batch_id = CONCAT('WTB', SUBSTRING(issuance_id, 4))
WHERE batch_id IS NULL OR batch_id = '';

-- created_at 无默认值导致排序失效：补默认值 + 回填存量（WTI+13位毫秒时间戳）
SET @col_default := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_ticket_issuance'
    AND COLUMN_NAME = 'created_at' AND COLUMN_DEFAULT IS NULL
);
SET @ddl2 := IF(@col_default > 0,
  'ALTER TABLE water_ticket_issuance MODIFY COLUMN created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP',
  'SELECT 1');
PREPARE stmt2 FROM @ddl2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

UPDATE water_ticket_issuance
SET created_at = FROM_UNIXTIME(CAST(LEFT(SUBSTRING(issuance_id, 4), 13) AS UNSIGNED) / 1000)
WHERE created_at IS NULL AND SUBSTRING(issuance_id, 4) REGEXP '^[0-9]{15,16}$';

SELECT 'batch_id + created_at 默认值迁移完成' AS message;

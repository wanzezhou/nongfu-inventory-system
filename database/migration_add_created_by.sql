-- ============================================================
-- 迁移脚本：为 orders 表添加 created_by 字段
-- 日期: 2026-07-27
-- 说明: 用于已存在的数据库，添加创建人字段并关联 workers 表
-- ============================================================

USE nongfu_inventory;

-- 检查并添加 created_by 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'nongfu_inventory' AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'created_by');

SET @sql = IF(@col_exists = 0,
    'ALTER TABLE orders ADD COLUMN created_by VARCHAR(50) DEFAULT NULL COMMENT ''创建人ID，外键关联workers表'' AFTER order_status',
    'SELECT ''created_by 字段已存在'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加索引
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = 'nongfu_inventory' AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_created_by');

SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE orders ADD KEY idx_created_by (created_by)',
    'SELECT ''idx_created_by 索引已存在'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 添加外键约束
SET @fk_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = 'nongfu_inventory' AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_order_creator');

SET @sql = IF(@fk_exists = 0,
    'ALTER TABLE orders ADD CONSTRAINT fk_order_creator FOREIGN KEY (created_by) REFERENCES workers(worker_id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT ''fk_order_creator 外键已存在'' AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'orders 表 created_by 字段迁移完成！' AS message;

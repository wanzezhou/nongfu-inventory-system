-- ============================================================
-- 入库单关联公司账户（2026-09-03）
-- 语义：入库必选付款账户，事务内扣款并记支出流水（related_module=purchase）；
--       作废时反向回补库存 + 原路退回账户 + 记收入流水（related_module=purchase_void）
-- 执行方式：本文件用于已初始化数据库的增量升级（手动执行一次即可，幂等）
-- ============================================================
USE nongfu_inventory;

-- 1. 付款账户
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'account_id');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN account_id varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''付款账户ID'' AFTER supplier_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'account_name');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN account_name varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''付款账户名称（快照）'' AFTER account_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. 实付金额（= 入库合计，快照留存，便于对账）
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'paid_amount');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN paid_amount decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT ''实际扣款金额'' AFTER total_amount',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. 作废字段
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'status');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN status tinyint(1) NOT NULL DEFAULT 1 COMMENT ''状态：1-正常 2-已作废'' AFTER payment_status',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'void_at');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN void_at datetime DEFAULT NULL COMMENT ''作废时间'' AFTER status',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'void_by');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN void_by varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''作废操作人'' AFTER void_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'void_reason');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN void_reason varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''作废原因'' AFTER void_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. 操作人（入库经手人，用于流水 handler）
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND COLUMN_NAME = 'handler');
SET @sql := IF(@exist = 0,
  'ALTER TABLE purchase_records ADD COLUMN handler varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''经手人'' AFTER created_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. 索引
SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND INDEX_NAME = 'idx_purchase_account');
SET @sql := IF(@exist = 0, 'ALTER TABLE purchase_records ADD KEY idx_purchase_account (account_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exist := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_records' AND INDEX_NAME = 'idx_purchase_status');
SET @sql := IF(@exist = 0, 'ALTER TABLE purchase_records ADD KEY idx_purchase_status (status)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

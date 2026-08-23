-- ============================================================
-- 迁移脚本：删除 orders.order_status 列，新增 canceled_at 标志
-- 日期: 2026-08-23
-- 说明: 订单状态字段整体移除；"取消订单"改为设置 canceled_at 时间戳
--       （保留库存/欠款回滚与审计）；统计/仪表盘排除口径由
--       order_status<>3 改为 canceled_at IS NULL。幂等，可重复执行。
-- ============================================================

USE nongfu_inventory;

-- 1) 删除旧索引 idx_order_status
SET @idx1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA='nongfu_inventory' AND TABLE_NAME='orders' AND INDEX_NAME='idx_order_status');
SET @s = IF(@idx1>0, 'ALTER TABLE orders DROP INDEX idx_order_status', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2) 保留历史已取消订单：order_status=3 -> canceled_at（仅当 order_status 列尚存时执行）
SET @c1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='nongfu_inventory' AND TABLE_NAME='orders' AND COLUMN_NAME='order_status');
SET @s = IF(@c1>0, 'UPDATE orders SET canceled_at = updated_at WHERE order_status = 3', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3) 删除 order_status 列
SET @s = IF(@c1>0, 'ALTER TABLE orders DROP COLUMN order_status', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 4) 新增 canceled_at 列（替代 order_status=3）
SET @c2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='nongfu_inventory' AND TABLE_NAME='orders' AND COLUMN_NAME='canceled_at');
SET @s = IF(@c2=0, 'ALTER TABLE orders ADD COLUMN canceled_at DATETIME DEFAULT NULL COMMENT ''取消时间；非空表示该订单已取消（替代原 order_status=3）'' AFTER created_by', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 5) 新增 canceled_at 索引
SET @idx2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA='nongfu_inventory' AND TABLE_NAME='orders' AND INDEX_NAME='idx_canceled_at');
SET @s = IF(@idx2=0, 'ALTER TABLE orders ADD KEY idx_canceled_at (canceled_at)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SELECT 'orders 表 order_status -> canceled_at 迁移完成' AS message;

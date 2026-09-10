-- ============================================================
-- 迁移脚本：清理历史临时备份表（技术债清理）
-- 日期: 2026-09-07
-- 说明: inventory_bak_20260824 / products_bak_20260824 为 2026-08-24
--       库存调整时的临时备份，代码零引用、未纳入 full_schema_data.sql，
--       与库内正式表（inventory/products）内容不一致，直接丢弃。
--       幂等，可重复执行。
-- ============================================================

USE nongfu_inventory;

DROP TABLE IF EXISTS inventory_bak_20260824;
DROP TABLE IF EXISTS products_bak_20260824;

SELECT '临时备份表 inventory_bak_20260824 / products_bak_20260824 已清理' AS message;

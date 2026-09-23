-- ============================================================================
-- 回滚：积分钱包「双积分」拆分（migration_wallet_points_split.sql 的逆操作）
-- ----------------------------------------------------------------------------
-- ⚠️ 警告：回滚会**永久丢失**分类信息 —— points_type / points_month 两列及其数据
--    被删除后不可恢复；若已产生混合扣款流水，总余额仍正确（balance 未被本迁移修改），
--    但无法再区分「充值积分 / 配送费积分」。确认无用后再执行。
--
-- 幂等：DROP COLUMN 对不存在的列会报错，请通过
--       backend/scripts/migrate_wallet_points_split.js --rollback 执行（含存在性判断）。
-- ============================================================================

ALTER TABLE `wallet_transactions`
  DROP COLUMN `points_month`,
  DROP COLUMN `points_type`;

ALTER TABLE `wallet_accounts`
  DROP COLUMN `delivery_fee_balance`,
  DROP COLUMN `recharge_balance`;

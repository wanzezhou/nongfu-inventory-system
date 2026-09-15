-- ============================================================================
-- 迁移：财务管理 V2 —— 账户体系重构（2026-09-15）
-- ----------------------------------------------------------------------------
-- 背景（需求 2）：
--   将原 5「可上单信用余额」、6「可上单折扣余额」、7「自有费用余额」三账户
--   合并为「农夫上单账户」；并新增「量贩机账户」「零售机账户」。
-- 方案（用户确认）：
--   新建账户 + 停用旧三个（不删除，历史流水完整保留可追溯）
--   新账户余额 = 三者 current_balance 直接相加（含负数亦照加）
-- 账户类型编号扩展：
--   1 晟之溪公户  2 水公社公户  3 微信  4 其他（原有）
--   5 可上单信用余额 6 可上单折扣余额 7 自有费用余额（停用）
--   8 农夫上单账户  9 量贩机账户  10 零售机账户（新增）
-- 幂等：所有语句按 account_id 判存在性，可重复执行。
-- 回滚：见 database/rollback_finance_v2.sql
-- ============================================================================

-- 1) 新建「农夫上单账户」（类型 8），余额 = 5+6+7 之和
INSERT INTO `finance_accounts`
  (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`,
   `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`)
SELECT
  'ACCOUNT_NFSD', '农夫上单账户', 8, NULL, NULL,
  ROUND(COALESCE(SUM(current_balance), 0), 2),
  ROUND(COALESCE(SUM(current_balance), 0), 2),
  '由「可上单信用余额/可上单折扣余额/自有费用余额」合并（2026-09-15）', 1, NOW(), NOW()
FROM `finance_accounts`
WHERE `account_id` IN ('ACCOUNT_CREDIT', 'ACCOUNT_DISCOUNT', 'ACCOUNT_FEE')
  AND NOT EXISTS (SELECT 1 FROM `finance_accounts` x WHERE x.account_id = 'ACCOUNT_NFSD');

-- 2) 新建「量贩机账户」（类型 9）
INSERT INTO `finance_accounts`
  (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`,
   `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`)
SELECT 'ACCOUNT_BULK_MACHINE', '量贩机账户', 9, NULL, NULL, 0.00, 0.00,
       '量贩机营收归集账户（2026-09-15）', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `finance_accounts` x WHERE x.account_id = 'ACCOUNT_BULK_MACHINE');

-- 3) 新建「零售机账户」（类型 10）
INSERT INTO `finance_accounts`
  (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`,
   `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`)
SELECT 'ACCOUNT_RETAIL_MACHINE', '零售机账户', 10, NULL, NULL, 0.00, 0.00,
       '零售机营收归集账户（2026-09-15）', 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM `finance_accounts` x WHERE x.account_id = 'ACCOUNT_RETAIL_MACHINE');

-- 4) 停用旧三账户，并将余额清零
--    余额已迁出至农夫上单账户；必须置 0，否则「余额 = 期初 + 流水净额」恒等式失效。
--    记录与流水一律保留，账户名称不变，可完整追溯历史。
UPDATE `finance_accounts`
SET `status` = 0,
    `current_balance` = 0.00,
    `remark` = CONCAT(COALESCE(`remark`, ''), ' [已合并至农夫上单账户 2026-09-15]'),
    `updated_at` = NOW()
WHERE `account_id` IN ('ACCOUNT_CREDIT', 'ACCOUNT_DISCOUNT', 'ACCOUNT_FEE');

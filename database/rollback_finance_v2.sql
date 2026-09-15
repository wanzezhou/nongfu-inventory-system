-- ============================================================================
-- 回滚：财务管理 V2 —— 账户体系重构（2026-09-15）
-- 对应迁移：database/migration_finance_v2.sql
-- ----------------------------------------------------------------------------
-- 回滚内容：
--   1) 删除新增的 8 农夫上单账户 / 9 量贩机账户 / 10 零售机账户
--   2) 恢复 5/6/7 三账户的 status = 1
--
-- ⚠️ 前提条件（务必先确认，否则会丢账）：
--   - 三个新账户的 current_balance 必须为 0（余额已花掉/转走则不能回滚）
--   - 三个新账户不得存在 finance_transactions 流水（否则删除会丢失流水）
--   - 若已产生流水：先导出 finance_transactions 相关行备份，再决定是否清理
--
-- 自查语句（先跑这些，确认无误再执行回滚）：
--   SELECT account_id, account_name, current_balance FROM finance_accounts
--    WHERE account_id IN ('ACCOUNT_NFSD','ACCOUNT_BULK_MACHINE','ACCOUNT_RETAIL_MACHINE');
--   SELECT account_id, COUNT(*) n FROM finance_transactions
--    WHERE account_id IN ('ACCOUNT_NFSD','ACCOUNT_BULK_MACHINE','ACCOUNT_RETAIL_MACHINE')
--    GROUP BY account_id;
--
-- 注意：旧三账户的余额在迁移时已被清零，本回滚**不会**把它们加回去
--       —— 若有需要，请手工按其历史流水净额重算后 UPDATE 恢复。
-- ============================================================================

-- 1) 删除新增账户（仅在无流水且余额为 0 时）. 
-- 若以下语句报 ER_ROW_IS_REFERENCED 或影响行数为 0，说明仍有流水/余额，回滚中止。
DELETE FROM `finance_accounts`
WHERE `account_id` IN ('ACCOUNT_NFSD', 'ACCOUNT_BULK_MACHINE', 'ACCOUNT_RETAIL_MACHINE')
  AND ABS(`current_balance`) < 0.01
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT DISTINCT account_id FROM `finance_transactions`) t
    WHERE t.account_id = `finance_accounts`.`account_id`
  );

-- 2) 恢复旧三账户为启用状态（余额不自动还原，见上文说明）
UPDATE `finance_accounts`
SET `status` = 1,
    `remark` = REPLACE(COALESCE(`remark`, ''), ' [已合并至农夫上单账户 2026-09-15]', ''),
    `updated_at` = NOW()
WHERE `account_id` IN ('ACCOUNT_CREDIT', 'ACCOUNT_DISCOUNT', 'ACCOUNT_FEE');

-- 3) 回滚后核对
-- SELECT account_id, account_name, account_type, current_balance, status
--   FROM finance_accounts ORDER BY account_type, account_id;

-- ============================================================
-- 公司账户管理：新增三类普通账户（2026-09-02）
-- 语义：三类账户相互独立、无业务含义的普通账户（仅名称不同）
-- account_type：1晟之溪公户 2水公社公户 3微信 4其他
--              5可上单信用余额 6可上单折扣余额 7自有费用余额
-- 执行方式：已初始化数据库增量升级执行一次即可（幂等）
-- ============================================================

-- 预置三类新账户（幂等：仅当不存在时插入）
INSERT INTO `finance_accounts`
  (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`)
SELECT t.account_id, t.account_name, t.account_type, '', '', 0, 0, t.remark, 1, NOW(), NOW()
FROM (
  SELECT 'ACCOUNT_CREDIT' AS account_id, '可上单信用余额' AS account_name, 5 AS account_type, '普通账户（相互独立，无业务语义）' AS remark
  UNION ALL SELECT 'ACCOUNT_DISCOUNT', '可上单折扣余额', 6, '普通账户（相互独立，无业务语义）'
  UNION ALL SELECT 'ACCOUNT_FEE', '自有费用余额', 7, '普通账户（相互独立，无业务语义）'
) t
WHERE NOT EXISTS (SELECT 1 FROM `finance_accounts` f WHERE f.account_id = t.account_id);

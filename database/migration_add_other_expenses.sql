-- ============================================================
-- 其他支出表 + 预置默认账户（2026-09-02）
-- 执行方式：node backend/scripts/init_db.js 会从 full_schema_data.sql 全量导入；
-- 本文件用于已初始化数据库的增量升级（手动执行一次即可，幂等）
-- ============================================================

CREATE TABLE IF NOT EXISTS `other_expenses` (
  `expense_id` varchar(64) NOT NULL COMMENT '支出ID',
  `expense_name` varchar(200) NOT NULL COMMENT '支出名称',
  `category` varchar(50) NOT NULL COMMENT '支出类别',
  `amount` decimal(12,2) NOT NULL COMMENT '支出金额（>0）',
  `expense_date` date NOT NULL COMMENT '支出日期',
  `account_id` varchar(64) DEFAULT NULL COMMENT '支出账户',
  `account_name` varchar(100) DEFAULT NULL COMMENT '账户快照',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) DEFAULT NULL COMMENT '录入人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`expense_id`),
  KEY `idx_expense_date` (`expense_date`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='其他支出（手动录入，纳入成本汇总）';

-- 预置 4 类默认账户（幂等：仅当账户名为空/不存在时插入）
INSERT INTO `finance_accounts`
  (`account_id`, `account_name`, `account_type`, `bank_name`, `bank_account`, `initial_balance`, `current_balance`, `remark`, `status`, `created_at`, `updated_at`)
SELECT t.account_id, t.account_name, t.account_type, '', '', 0, 0, '预置账户', 1, NOW(), NOW()
FROM (
  SELECT 'ACCOUNT_SZX' AS account_id, '晟之溪公户' AS account_name, 1 AS account_type
  UNION ALL SELECT 'ACCOUNT_SGS', '水公社公户', 2
  UNION ALL SELECT 'ACCOUNT_WX', '微信', 3
  UNION ALL SELECT 'ACCOUNT_OTHER', '其他', 4
) t
WHERE NOT EXISTS (SELECT 1 FROM `finance_accounts` f WHERE f.account_id = t.account_id);

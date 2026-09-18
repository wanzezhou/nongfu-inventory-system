-- ============================================================================
-- 其他收入（手动录入，纳入总营收 / 总利润）
-- ============================================================================
-- 幂等：可重复执行。
-- 对应页面：营收统计 ? 其他收入（前端 views/finance/OtherIncomes.vue）
-- 结构刻意与 other_expenses（其他支出）保持一致，便于两侧维护时对照。
--
-- 口径（2026-09-18 业务方确认）：
--   总营收 = 订单类营收(1/2/3/5) + 机台营收(4/6, machine_sales) + 其他收入
--   总利润 = 总营收 − 总成本
--   其他收入**不进入**「按订单类型」的 6 行列表（那是订单维度，塞非订单行会破坏
--   维度语义）；它只体现在总额上，并以独立字段 otherIncome 返回，由界面单独成行展示。
--
-- 资金记账（与「其他支出」对称）：
--   选了账户 → 余额 +amount、写 finance_transactions（tx_type=1 收入、
--   tx_category='其他收入'、related_module='other_income'、related_id=income_id）；
--   编辑/删除 → 撤销原流水并回补（余额 −amount），与业务记录同一事务。
--
-- 注意：不需要预置账户 —— other_incomes 上线时 finance_accounts 已存在
--       （其他支出的迁移当初代为预置过 4 个账户）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS `other_incomes` (
  `income_id` varchar(64) NOT NULL COMMENT '收入ID',
  `income_name` varchar(200) NOT NULL COMMENT '收入名称',
  `category` varchar(50) NOT NULL COMMENT '收入类别',
  `amount` decimal(12,2) NOT NULL COMMENT '收入金额（>0）',
  `income_date` date NOT NULL COMMENT '收入日期',
  `account_id` varchar(64) DEFAULT NULL COMMENT '收入账户',
  `account_name` varchar(100) DEFAULT NULL COMMENT '账户快照',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) DEFAULT NULL COMMENT '录入人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`income_id`),
  KEY `idx_income_date` (`income_date`),
  KEY `idx_income_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='其他收入（手动录入，纳入总营收）';

-- 回滚（如需）：
-- DROP TABLE IF EXISTS `other_incomes`;

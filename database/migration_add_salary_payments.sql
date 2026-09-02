-- ============================================================
-- 员工工资发放记录表（2026-09-02）
-- 语义：员工 + 月份 唯一发放；发放时在公司账户记一笔支出（tx_category=工资发放）
-- 已发放状态 = 该表存在记录；撤销发放 = 删除记录并回补账户
-- ============================================================

CREATE TABLE IF NOT EXISTS `salary_payments` (
  `payment_id` varchar(64) NOT NULL COMMENT '发放ID',
  `worker_id` varchar(64) NOT NULL COMMENT '员工ID',
  `worker_name` varchar(100) NOT NULL COMMENT '员工姓名快照',
  `salary_month` varchar(7) NOT NULL COMMENT '工资归属月份 YYYY-MM',
  `amount` decimal(12,2) NOT NULL COMMENT '发放金额（当月配送费快照）',
  `account_id` varchar(64) DEFAULT NULL COMMENT '发放账户',
  `account_name` varchar(100) DEFAULT NULL COMMENT '发放账户快照',
  `paid_at` datetime DEFAULT NULL COMMENT '发放时间',
  `remark` varchar(500) DEFAULT NULL COMMENT '备注',
  `created_by` varchar(50) DEFAULT NULL COMMENT '操作人',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uk_worker_month` (`worker_id`, `salary_month`),
  KEY `idx_month` (`salary_month`),
  KEY `idx_account` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工工资发放记录（员工+月份唯一）';

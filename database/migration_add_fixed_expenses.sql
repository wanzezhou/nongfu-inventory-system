-- ============================================================
-- 成本统计模块：固定支出表（2026-08-24）
-- 幂等：表已存在则跳过
-- ============================================================
CREATE TABLE IF NOT EXISTS fixed_expenses (
  expense_id   VARCHAR(50)  NOT NULL COMMENT '支出ID',
  expense_type VARCHAR(50)  NOT NULL COMMENT '支出类型（房租/水电/物业/人工工资/物流运输/设备维护/其他，可自定义）',
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '金额（元）',
  expense_date DATE         NOT NULL COMMENT '发生日期',
  remark       VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by   VARCHAR(50)  DEFAULT NULL COMMENT '录入人',
  created_at   DATETIME     DEFAULT NULL,
  updated_at   DATETIME     DEFAULT NULL,
  PRIMARY KEY (expense_id),
  KEY idx_type (expense_type),
  KEY idx_date (expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='固定支出记录';

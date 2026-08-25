-- ============================================================
-- 水站返货管理（水票系统）迁移（2026-08-25）
-- 1) water_tickets 水票表
-- 2) water_ticket_issuance 返货清单/发行记录表（含返货配送费）
-- 3) order_items 增加 pricing_type（1-分销价 2-水票抵扣）
-- 幂等：全部可重复执行
-- ============================================================

CREATE TABLE IF NOT EXISTS water_tickets (
  ticket_id    VARCHAR(50)  NOT NULL COMMENT '水票编号，主键',
  product_id   VARCHAR(50)  NOT NULL COMMENT '对应商品ID（一张票=一件对应商品）',
  station_id   VARCHAR(50)  NOT NULL COMMENT '持有水站ID',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '状态 1-未用 2-已核销 3-作废',
  month        VARCHAR(7)   NOT NULL COMMENT '所属月份（返货清单月份，如 2026-08）',
  issuance_id  VARCHAR(50)  DEFAULT NULL COMMENT '来源返货清单/发行记录ID',
  issued_at    DATETIME     DEFAULT NULL COMMENT '发行时间',
  issued_by    VARCHAR(50)  DEFAULT NULL COMMENT '发行操作人',
  used_at      DATETIME     DEFAULT NULL COMMENT '核销时间',
  order_id     VARCHAR(50)  DEFAULT NULL COMMENT '核销关联订单ID',
  remark       VARCHAR(255) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (ticket_id),
  KEY idx_product (product_id),
  KEY idx_station (station_id),
  KEY idx_status (status),
  KEY idx_month (month),
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水票表（一张水票=一件对应商品，价值=进货价，经销商按返货清单获取）';

CREATE TABLE IF NOT EXISTS water_ticket_issuance (
  issuance_id          VARCHAR(50)   NOT NULL COMMENT '发行记录ID，主键',
  station_id           VARCHAR(50)   NOT NULL COMMENT '水站ID',
  product_id           VARCHAR(50)   NOT NULL COMMENT '商品ID',
  quantity             INT           NOT NULL COMMENT '返货/发行数量（生成等量水票）',
  return_delivery_fee  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '返货配送费（本月返货清单配送费）',
  month                VARCHAR(7)    NOT NULL COMMENT '所属月份（如 2026-08）',
  remark               VARCHAR(255)  DEFAULT NULL COMMENT '备注',
  created_by           VARCHAR(50)   DEFAULT NULL COMMENT '录入人',
  created_at           DATETIME      DEFAULT NULL,
  PRIMARY KEY (issuance_id),
  KEY idx_station (station_id),
  KEY idx_product (product_id),
  KEY idx_month (month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='水票发行记录（每月返货清单：水站+商品+数量+返货配送费，生成等量水票）';

-- order_items 增加计价方式列（幂等）
SET @col_exists := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'pricing_type');
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE order_items ADD COLUMN pricing_type TINYINT NOT NULL DEFAULT 1 COMMENT ''计价方式 1-分销价 2-水票抵扣'' AFTER worker_machine_delivery_fee',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

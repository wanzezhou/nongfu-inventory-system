-- ============================================================
-- 机台管理模块迁移：量贩机管理 / 零售机管理
-- machine_type: 1-量贩机, 2-零售机
-- ============================================================

CREATE TABLE IF NOT EXISTS machine_stations (
  machine_id      VARCHAR(50)     NOT NULL COMMENT '机台ID，主键',
  machine_type    TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '机台类型：1-量贩机，2-零售机',
  station_name    VARCHAR(100)    NOT NULL COMMENT '站点名称',
  address         VARCHAR(500)    DEFAULT NULL COMMENT '站点地址',
  manager         VARCHAR(50)     DEFAULT NULL COMMENT '负责人',
  manager_phone   VARCHAR(20)     DEFAULT NULL COMMENT '负责人联系方式',
  status          TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '状态：1-启用，0-停用（软删除）',
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (machine_id),
  KEY idx_machine_type (machine_type),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台管理表（量贩机/零售机）';

-- 订单表新增机台关联字段，用于量贩机供货(4)/零售机供货(6)关联对应机台
ALTER TABLE orders
  ADD COLUMN machine_station_id VARCHAR(50) DEFAULT NULL
  COMMENT '机台ID（订单类型=4量贩机供货/6零售机供货时填写，关联machine_stations表）'
  AFTER station_id;

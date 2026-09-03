-- 迁移：出库台账记录表（P1-F4）
-- 幂等：表不存在时才创建
USE nongfu_inventory;

CREATE TABLE IF NOT EXISTS `stock_out_records` (
  `record_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '出库记录ID，主键',
  `product_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID',
  `product_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品名称快照',
  `product_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品编码快照',
  `quantity` int NOT NULL COMMENT '出库数量',
  `out_type` tinyint NOT NULL DEFAULT 1 COMMENT '出库类型 1-销售出库 2-调拨出库 3-其他',
  `stock_after` int DEFAULT NULL COMMENT '出库后库存',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `handler` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '经手人',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '出库时间',
  PRIMARY KEY (`record_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='出库台账记录表';

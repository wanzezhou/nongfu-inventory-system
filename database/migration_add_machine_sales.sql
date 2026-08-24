-- ============================================================
-- 幂等迁移：新建 machine_sales 机台销量记录表（量贩机/零售机营收统计）
-- 执行方式：mysql -u root nongfu_inventory < migration_add_machine_sales.sql
-- 可重复执行（CREATE TABLE IF NOT EXISTS）
-- ============================================================

CREATE TABLE IF NOT EXISTS machine_sales (
    sale_id             VARCHAR(50)     NOT NULL COMMENT '销量记录ID，主键',
    machine_id          VARCHAR(50)     NOT NULL COMMENT '机台ID，外键关联machine_stations表',
    machine_type        TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '机台类型：1-量贩机，2-零售机（冗余，便于按类型统计）',
    product_id          VARCHAR(50)     NOT NULL COMMENT '商品ID，外键关联products表',
    quantity            INT             NOT NULL DEFAULT 0 COMMENT '销量（该机台该商品售出数量）',
    sale_price          DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '售价（机台上设定的售价，录入时自动带出可修改）',
    sale_date           DATE            NOT NULL COMMENT '销售日期（按日记录，可按月/日汇总）',
    remark              VARCHAR(255)    DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50)     DEFAULT NULL COMMENT '录入人',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (sale_id),
    KEY idx_machine (machine_id),
    KEY idx_machine_type (machine_type),
    KEY idx_product (product_id),
    KEY idx_sale_date (sale_date),
    CONSTRAINT fk_machine_sales_machine FOREIGN KEY (machine_id) REFERENCES machine_stations(machine_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_machine_sales_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台销量记录表（量贩机/零售机营收，手动录入）';

SELECT 'machine_sales 表已就绪（幂等脚本可重复执行）' AS message;

-- ============================================================
-- 2026-08-27 直营水站销售行级水票抵扣
-- order_items 增加 ticket_qty：行级水票抵扣件数
--   ticket_qty = 0      -> 整行按分销价计价（pricing_type=1）
--   ticket_qty > 0      -> 该行 ticket_qty 件按进货价抵扣，剩余 (quantity-ticket_qty) 件按分销价（pricing_type=2）
-- 兼容旧数据：无列时默认 0，旧水票抵扣订单（pricing_type=2）按全量抵扣语义处理由财务口径 SQL 兼容
-- ============================================================
ALTER TABLE order_items
  ADD COLUMN ticket_qty INT NOT NULL DEFAULT 0
  COMMENT '水票抵扣件数（直营水站销售行级；≤quantity，0=不抵扣）' AFTER pricing_type;

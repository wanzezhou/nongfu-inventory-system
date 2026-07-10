-- ============================================================
-- 农夫山泉经销商进销存系统 - 测试数据脚本
-- 版本: 1.0
-- 日期: 2026-07-09
-- 说明: 执行此脚本将插入完整的测试数据
-- ============================================================

USE nongfu_inventory;

-- ============================================================
-- 1. 商品信息表 - 3个商品
-- ============================================================
INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, category, image_url, status) VALUES
('P001', 'SPBM001', '农夫山泉550ml', '550ml*24瓶', '箱', 18.00, 22.00, 28.00, 24.00, 2.00, 1.50, 1.00, 1.20, 1.30, '矿泉水', NULL, 1),
('P002', 'SPBM002', '农夫山泉1.5L', '1.5L*12瓶', '箱', 28.00, 34.00, 42.00, 36.00, 2.50, 1.80, 1.20, 1.50, 1.60, '矿泉水', NULL, 1),
('P003', 'SPBM003', '农夫山泉4L', '4L*4桶', '箱', 24.00, 29.00, 36.00, 31.00, 2.20, 1.60, 1.10, 1.30, 1.40, '矿泉水', NULL, 1);

-- ============================================================
-- 2. 下级水站信息表 - 2个水站
-- ============================================================
INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, area, credit_limit, current_debt, payment_type, bank_name, bank_account, account_name, invoice_title, tax_number, invoice_address, invoice_phone, status) VALUES
('S001', '鼓楼区第一水站', '张经理', '13800138001', '南京市鼓楼区中山路100号', '南京鼓楼区', 50000.00, 12000.00, 2, '工商银行', '6222021234567890123', '张三', '鼓楼区第一水站', '91320106MA1MB00000', '南京市鼓楼区中山路100号', '025-88881111', 1),
('S002', '玄武区便民水站', '李老板', '13800138002', '南京市玄武区珠江路200号', '南京玄武区', 30000.00, 0.00, 1, '建设银行', '6227001234567890123', '李四', '玄武区便民水站', '91320102MA1MC00000', '南京市玄武区珠江路200号', '025-88882222', 1);

-- ============================================================
-- 3. 配送员工表 - 2个员工
-- ============================================================
INSERT INTO workers (worker_id, worker_name, phone, vehicle_type, bank_name, bank_account, status) VALUES
('W001', '王五', '13900139001', 1, '农业银行', '6228481234567890123', 1),
('W002', '赵六', '13900139002', 2, '中国银行', '6216611234567890123', 1);

-- ============================================================
-- 4. 总仓库库存表 - 库存数据
-- ============================================================
INSERT INTO inventory (product_id, quantity, last_in_time, last_out_time) VALUES
('P001', 500, '2026-07-08 10:00:00', '2026-07-09 09:00:00'),
('P002', 300, '2026-07-08 10:00:00', '2026-07-09 08:30:00'),
('P003', 200, '2026-07-08 10:00:00', '2026-07-09 08:00:00');

-- ============================================================
-- 5. 进货记录表 - 2笔进货
-- ============================================================
INSERT INTO purchase_records (purchase_id, product_id, quantity, unit_price, total_amount, payment_status, payment_date, supplier, remark) VALUES
('PR001', 'P001', 200, 18.00, 3600.00, 1, '2026-07-08 14:00:00', '农夫山泉', '批量进货'),
('PR002', 'P002', 100, 28.00, 2800.00, 0, NULL, '农夫山泉', '待付款');

-- ============================================================
-- 6. 订单主表 - 4种类型各1笔
-- ============================================================
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, station_id, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, order_status, remark) VALUES
('ORD001', 1, '美团', 'MT202607090001', NULL, '陈先生', '13700137001', '南京市建邺区奥体中心1号', 18.00, 2.00, 20.00, 1, 'W001', 1, 20.00, 2, '线上平台销售订单'),
('ORD002', 2, NULL, NULL, 'S001', NULL, NULL, NULL, 88.00, 6.00, 94.00, 2, NULL, 0, 0.00, 1, '线下水站分销订单'),
('ORD003', 3, NULL, NULL, NULL, '周女士', '13700137002', '南京市雨花台区软件大道8号', 56.00, 2.00, 58.00, 1, 'W001', 1, 58.00, 2, '线下零售订单'),
('ORD004', 4, NULL, NULL, NULL, '自动售货机-A01', NULL, '南京市江宁区大学城', 48.00, 2.60, 50.60, 1, 'W002', 1, 50.60, 2, '零售机供货订单');

-- ============================================================
-- 7. 订单商品明细表 - 对应4个订单的商品明细
-- ============================================================
INSERT INTO order_items (order_id, product_id, quantity, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('ORD001', 'P001', 1, 18.00, 22.00, 28.00, 24.00, 2.00, 1.50, 1.00, 1.20, 1.30, 18.00),
('ORD002', 'P001', 4, 18.00, 22.00, 28.00, 24.00, 2.00, 1.50, 1.00, 1.20, 1.30, 88.00),
('ORD003', 'P001', 2, 18.00, 22.00, 28.00, 24.00, 2.00, 1.50, 1.00, 1.20, 1.30, 56.00),
('ORD004', 'P001', 2, 18.00, 22.00, 28.00, 24.00, 2.00, 1.50, 1.00, 1.20, 1.30, 48.00);

-- ============================================================
-- 8. 配送费结算表 - 配送费结算示例
-- ============================================================
INSERT INTO delivery_fee_settlement (settlement_id, order_id, product_id, quantity, settlement_type, fee_amount, delivery_fee_diff, payee_type, payee_id, settlement_status, settlement_date, remark) VALUES
('DFS001', 'ORD001', 'P001', 1, 1, 2.00, NULL, 1, NULL, 0, NULL, '农夫山泉结算总包配送费'),
('DFS002', 'ORD001', 'P001', 1, 3, 1.00, 1.00, 3, 'W001', 0, NULL, '经销商结算工人零售配送费'),
('DFS003', 'ORD002', 'P001', 4, 1, 8.00, NULL, 1, NULL, 0, NULL, '农夫山泉结算总包配送费'),
('DFS004', 'ORD002', 'P001', 4, 2, 6.00, 2.00, 2, 'S001', 0, NULL, '经销商结算分销配送费'),
('DFS005', 'ORD003', 'P001', 2, 1, 4.00, NULL, 1, NULL, 0, NULL, '农夫山泉结算总包配送费'),
('DFS006', 'ORD003', 'P001', 2, 3, 2.00, 2.00, 3, 'W001', 0, NULL, '经销商结算工人零售配送费'),
('DFS007', 'ORD004', 'P001', 2, 1, 4.00, NULL, 1, NULL, 0, NULL, '农夫山泉结算总包配送费'),
('DFS008', 'ORD004', 'P001', 2, 5, 2.60, 1.40, 3, 'W002', 0, NULL, '经销商结算工人零售机配送费');

-- ============================================================
-- 9. 资金结算对账表 - 资金结算对账示例
-- ============================================================
INSERT INTO financial_settlement (settlement_id, settlement_type, order_id, station_id, worker_id, platform_type, settlement_period, amount, settlement_status, settlement_date, bank_account, transaction_no, remark) VALUES
('FS001', 1, 'ORD001', NULL, NULL, '美团', '2026-07', 18.00, 0, NULL, NULL, NULL, '线上平台货款结算'),
('FS002', 2, 'ORD001', NULL, NULL, '美团', '2026-07', 2.00, 0, NULL, NULL, NULL, '线上配送费结算'),
('FS003', 3, 'ORD002', 'S001', NULL, NULL, '2026-07', 88.00, 0, NULL, NULL, NULL, '线下水站货款结算'),
('FS004', 4, 'ORD002', 'S001', NULL, NULL, '2026-07', 6.00, 0, NULL, NULL, NULL, '分销配送费结算'),
('FS005', 5, 'ORD003', NULL, 'W001', NULL, '2026-07', 2.00, 0, NULL, NULL, NULL, '工人零售配送费结算'),
('FS006', 7, 'ORD004', NULL, 'W002', NULL, '2026-07', 2.60, 0, NULL, NULL, NULL, '工人零售机配送费结算'),
('FS007', 8, 'ORD003', NULL, NULL, NULL, '2026-07', 56.00, 1, '2026-07-09 12:00:00', '6222021234567890000', 'TRX202607090001', '线下零售收入'),
('FS008', 9, 'ORD004', NULL, NULL, NULL, '2026-07', 48.00, 1, '2026-07-09 11:00:00', '6222021234567890000', 'TRX202607090002', '零售机供货收入');

-- ============================================================
-- 脚本执行完毕
-- ============================================================
SELECT '测试数据插入完成！' AS message;
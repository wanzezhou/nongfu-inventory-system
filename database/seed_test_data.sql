-- ============================================================
-- 测试数据种子脚本（幂等：先清空再重建）【2026-08-24 修订】
-- 说明：商品(products)/库存(inventory) 为真实档案，**不清理、不动**；
--       仅重建 基础信息其他模块 + 订单测试数据。
-- 订单商品引用原商品 ID（Pmrf3fgpqDNVO8Q 等），明细价格为下单快照（手填合理值）。
-- 执行方式：mysql -u root nongfu_inventory < seed_test_data.sql
-- ============================================================

-- ---------- 1. 清空已有数据（不含 products/inventory） ----------
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE machine_sales;
TRUNCATE TABLE sub_stations;
TRUNCATE TABLE machine_stations;
TRUNCATE TABLE suppliers;
TRUNCATE TABLE workers;
TRUNCATE TABLE salesmen;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------- 2. 供应商（5） ----------
INSERT INTO suppliers (supplier_id, supplier_name, contact_name, phone, address, status, remark, created_at, updated_at) VALUES
('SUP001', '农夫山泉（南京）有限公司', '王经理', '025-88880001', '南京市江宁区空港物流园', 1, '农夫山泉官方供货', NOW(), NOW()),
('SUP002', '南京鑫达饮品批发部', '刘老板', '025-88880002', '南京市栖霞区尧化门', 1, NULL, NOW(), NOW()),
('SUP003', '华东水业配送中心', '陈经理', '025-88880003', '南京市雨花台区铁心桥', 1, NULL, NOW(), NOW()),
('SUP004', '玄武湖贸易有限公司', '赵总', '025-88880004', '南京市玄武区珠江路', 1, NULL, NOW(), NOW()),
('SUP005', '苏南食品供应链', '孙经理', '025-88880005', '南京市建邺区奥体大街', 1, NULL, NOW(), NOW());

-- ---------- 3. 水站（6） ----------
INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, area, credit_limit, current_debt, payment_type, status, created_at, updated_at) VALUES
('ST001', '江宁水站', '周老板', '13900000001', '南京市江宁区东山街道', '江宁区', 50000.00, 0.00, 0, 1, NOW(), NOW()),
('ST002', '秦淮水站', '吴老板', '13900000002', '南京市秦淮区大光路', '秦淮区', 30000.00, 0.00, 0, 1, NOW(), NOW()),
('ST003', '鼓楼水站', '郑老板', '13900000003', '南京市鼓楼区中山北路', '鼓楼区', 40000.00, 0.00, 0, 1, NOW(), NOW()),
('ST004', '玄武水站', '冯老板', '13900000004', '南京市玄武区锁金村', '玄武区', 35000.00, 0.00, 0, 1, NOW(), NOW()),
('ST005', '建邺水站', '褚老板', '13900000005', '南京市建邺区兴隆大街', '建邺区', 28000.00, 0.00, 0, 1, NOW(), NOW()),
('ST006', '栖霞水站', '卫老板', '13900000006', '南京市栖霞区仙林', '栖霞区', 32000.00, 0.00, 0, 1, NOW(), NOW());

-- ---------- 4. 量贩机/零售机（4） ----------
INSERT INTO machine_stations (machine_id, machine_type, station_name, address, manager, manager_phone, status, created_at, updated_at) VALUES
('M001', 1, '量贩机-万达广场店', '南京市建邺区万达广场1F', '张店长', '13700000001', 1, NOW(), NOW()),
('M002', 1, '量贩机-中央商场店', '南京市秦淮区新街口中央商场3F', '李店长', '13700000002', 1, NOW(), NOW()),
('R001', 2, '零售机-地铁大行宫站', '南京市玄武区地铁2号线大行宫站内', '王站长', '13700000003', 1, NOW(), NOW()),
('R002', 2, '零售机-南大鼓楼校区', '南京市鼓楼区南京大学鼓楼校区', '赵管理员', '13700000004', 1, NOW(), NOW());

-- ---------- 5. 员工（5） ----------
INSERT INTO workers (worker_id, worker_name, phone, employee_type, vehicle_type, status, created_at, updated_at) VALUES
('W001', '张师傅', '13800000001', 1, 1, 1, NOW(), NOW()),
('W002', '李师傅', '13800000002', 1, 1, 1, NOW(), NOW()),
('W003', '王师傅', '13800000003', 1, 2, 1, NOW(), NOW()),
('W004', '刘师傅', '13800000004', 1, 2, 1, NOW(), NOW()),
('W005', '陈师傅', '13800000005', 2, 1, 1, NOW(), NOW());

-- ---------- 6. 业务员（4） ----------
INSERT INTO salesmen (salesman_id, salesman_name, phone, commission_rate, status, created_at, updated_at) VALUES
('SM001', '赵敏', '13600000001', 3.00, 1, NOW(), NOW()),
('SM002', '钱进', '13600000002', 2.50, 1, NOW(), NOW()),
('SM003', '孙丽', '13600000003', 3.50, 1, NOW(), NOW()),
('SM004', '李强', '13600000004', 2.00, 1, NOW(), NOW());

-- ============================================================
-- 订单测试数据（13 笔，覆盖 6 种订单类型；订单号 SZX+日期+序号）
-- 订单商品使用原商品档案 ID（A-E 5 个，均存在于 products 表）
--    A=Pmrf3fgpqDNVO8Q 380mL矿泉15入纸箱 进15/批18/零24/机20 总包4/分销2.5/工零2/工批0.45/工机1
--    B=Pmrf3fgq6AASZ1I 380mL天然水24入纸箱 进19/批21/零26/机22 总包8/分销5/工零4/工批0.9/工机1.2
--    C=Pmrf3fgqtHVAMLA 550mL天然水24入纸箱 进21/批22/零28/机24 总包8/分销5/工零4/工批0.9/工机1.2
--    D=Pmrf3fgq30J6ZV3 380mL天然水24入纸箱学习强国 进19/批21/零26/机22 总包8/分销5/工零4/工批0.9/工机1.2
--    E=Pmrf3fgqq1UZJ5U 550mL天然水24入白膜 进20/批21/零26/机22 总包8/分销5/工零4/工批0.9/工机1.2
-- 金额口径：order_amount=Σ(unit_price×qty)；delivery_fee=Σ(配送费×qty)；total=二者之和
-- ============================================================

-- ① 线上平台销售（type=1）2026-08-20：A×10（unit=进货价15）
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608200001', 1, '美团', 'MT20260820001', '张伟', '13911110001', '南京市秦淮区瑞金路12号', NULL, 150.00, 20.00, 170.00, 1, 'W001', 1, 170.00, 'W005', '2026-08-20 10:30:00', '2026-08-20 10:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608200001', 'Pmrf3fgpqDNVO8Q', 10, 15.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 150.00);

-- ② 线上平台销售（type=1）2026-08-18：B×6（unit=进货价19）
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608180002', 1, '京东', 'JD20260818002', '李娜', '13911110002', '南京市建邺区江东中路98号', NULL, 114.00, 24.00, 138.00, 1, 'W002', 1, 138.00, 'W005', '2026-08-18 14:20:00', '2026-08-18 14:20:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608180002', 'Pmrf3fgq6AASZ1I', 6, 19.00, 19.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 114.00);

-- ③ 线下水站分销（type=2）2026-08-16：B×20（unit=批发价21，配送=工批0.9）
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608160003', 2, 'ST001', '江宁水站', '13900000001', '南京市江宁区东山街道', '周老板', 420.00, 18.00, 438.00, 1, 'W001', 0, 0.00, 'W005', '2026-08-16 09:10:00', '2026-08-16 09:10:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608160003', 'Pmrf3fgq6AASZ1I', 20, 21.00, 19.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 420.00);

-- ④ 线下水站分销（type=2）2026-08-14：A×30 + C×10
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608140004', 2, 'ST002', '秦淮水站', '13900000002', '南京市秦淮区大光路', '吴老板', 760.00, 22.50, 782.50, 1, 'W003', 1, 782.50, 'W005', '2026-08-14 11:00:00', '2026-08-14 11:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608140004', 'Pmrf3fgpqDNVO8Q', 30, 18.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 540.00),
('SZX202608140004', 'Pmrf3fgqtHVAMLA', 10, 22.00, 21.00, 22.00, 28.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 220.00);

-- ⑤ 线下零售（type=3）2026-08-12：C×5（无需配送，unit=零售28）
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608120005', 3, '王强', '13911110003', '南京市鼓楼区湖南路88号', '王强', 140.00, 0.00, 140.00, 3, NULL, 1, 140.00, 'W005', '2026-08-12 15:45:00', '2026-08-12 15:45:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608120005', 'Pmrf3fgqtHVAMLA', 5, 28.00, 21.00, 22.00, 28.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 140.00);

-- ⑥ 线下零售（type=3）2026-08-10：D×8 + E×6（自有员工配送）
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608100006', 3, '赵芳', '13911110004', '南京市玄武区北京东路55号', '赵芳', 364.00, 56.00, 420.00, 1, 'W004', 0, 100.00, 'W005', '2026-08-10 16:30:00', '2026-08-10 16:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608100006', 'Pmrf3fgq30J6ZV3', 8, 26.00, 19.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 208.00),
('SZX202608100006', 'Pmrf3fgqq1UZJ5U', 6, 26.00, 20.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 156.00);

-- ⑦ 量贩机供货（type=4）2026-08-08：A×40（unit=进货价15，配送=工机1）
INSERT INTO orders (order_id, order_type, machine_station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608080007', 4, 'M001', '量贩机-万达广场店', '13700000001', '南京市建邺区万达广场1F', '张店长', 600.00, 0.00, 600.00, 2, 'W001', 1, 600.00, 'W005', '2026-08-08 09:00:00', '2026-08-08 09:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608080007', 'Pmrf3fgpqDNVO8Q', 40, 15.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 600.00);

-- ⑧ 线下水站返货（type=5）2026-08-06：D×12（unit=进货价19，配送=0）
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608060008', 5, 'ST003', '鼓楼水站', '13900000003', '南京市鼓楼区中山北路', '郑老板', 228.00, 0.00, 228.00, 3, NULL, 1, 228.00, 'W005', '2026-08-06 10:15:00', '2026-08-06 10:15:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608060008', 'Pmrf3fgq30J6ZV3', 12, 19.00, 19.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 228.00);

-- ⑨ 零售机供货（type=6）2026-08-04：C×20（unit=进货价21，配送=工机1.2）
INSERT INTO orders (order_id, order_type, machine_station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608040009', 6, 'R001', '零售机-地铁大行宫站', '13700000003', '南京市玄武区地铁2号线大行宫站内', '王站长', 420.00, 0.00, 420.00, 2, 'W002', 1, 420.00, 'W005', '2026-08-04 08:40:00', '2026-08-04 08:40:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608040009', 'Pmrf3fgqtHVAMLA', 20, 21.00, 21.00, 22.00, 28.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 420.00);

-- ⑩ 线上平台销售（type=1）2026-07-25（历史月）：B×8
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607250010', 1, '美团', 'MT20260725010', '孙悦', '13911110005', '南京市雨花台区软件大道18号', NULL, 152.00, 32.00, 184.00, 1, 'W003', 1, 184.00, 'W005', '2026-07-25 12:00:00', '2026-07-25 12:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607250010', 'Pmrf3fgq6AASZ1I', 8, 19.00, 19.00, 21.00, 26.00, 0.00, 8.00, 5.00, 4.00, 0.90, 0.00, 152.00);

-- ⑪ 线下水站分销（type=2）2026-07-20（历史月）：A×15
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607200011', 2, 'ST004', '玄武水站', '13900000004', '南京市玄武区锁金村', '冯老板', 270.00, 6.75, 276.75, 1, 'W004', 0, 0.00, 'W005', '2026-07-20 13:30:00', '2026-07-20 13:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607200011', 'Pmrf3fgpqDNVO8Q', 15, 18.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 270.00);

-- ⑫ 线下零售（type=3）2026-07-18（历史月）：A×3（无需配送）
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607180012', 3, '周涛', '13911110006', '南京市栖霞区文枢东路1号', '周涛', 72.00, 0.00, 72.00, 3, NULL, 1, 72.00, 'W005', '2026-07-18 17:20:00', '2026-07-18 17:20:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607180012', 'Pmrf3fgpqDNVO8Q', 3, 24.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 72.00);

-- ⑬ 线下水站返货（type=5）2026-07-12（历史月）：A×12
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607120013', 5, 'ST005', '建邺水站', '13900000005', '南京市建邺区兴隆大街', '褚老板', 180.00, 0.00, 180.00, 3, NULL, 1, 180.00, 'W005', '2026-07-12 09:50:00', '2026-07-12 09:50:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607120013', 'Pmrf3fgpqDNVO8Q', 12, 15.00, 15.00, 18.00, 24.00, 0.00, 4.00, 2.50, 2.00, 0.45, 0.00, 180.00);

SELECT '测试数据已重建（商品/库存未动）：基础信息 6 模块 + 订单 13 笔（覆盖 6 种订单类型）' AS message;

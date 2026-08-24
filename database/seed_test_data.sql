-- ============================================================
-- 测试数据种子脚本（幂等：先清空再重建）
-- 覆盖：基础信息管理 7 模块 + 库存 + 6 种订单类型
-- 执行方式：mysql -u root nongfu_inventory < seed_test_data.sql
-- 注：users（登录账号）/押金/报销等不在清空范围
-- ============================================================

-- ---------- 1. 清空已有数据 ----------
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE order_items;
TRUNCATE TABLE orders;
TRUNCATE TABLE machine_sales;
TRUNCATE TABLE inventory;
TRUNCATE TABLE products;
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

-- ---------- 3. 商品（12） ----------
INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, category, status, created_at, updated_at) VALUES
('P01', 'SPBM001', '农夫山泉550ml天然水24瓶', '550ml*24', '箱', 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, '饮用水', 1, NOW(), NOW()),
('P02', 'SPBM002', '农夫山泉1.5L天然水12瓶', '1.5L*12', '箱', 20.00, 25.00, 30.00, 26.00, 5.00, 2.50, 2.50, 0.60, 1.20, '饮用水', 1, NOW(), NOW()),
('P03', 'SPBM003', '农夫山泉4L天然水4桶', '4L*4', '箱', 28.00, 34.00, 40.00, 36.00, 6.00, 3.00, 3.00, 0.80, 1.50, '饮用水', 1, NOW(), NOW()),
('P04', 'SPBM004', '东方树叶500ml绿茶15瓶', '500ml*15', '箱', 22.00, 28.00, 35.00, 30.00, 5.00, 2.50, 2.20, 0.55, 1.10, '茶饮料', 1, NOW(), NOW()),
('P05', 'SPBM005', '茶π500ml蜜桃乌龙15瓶', '500ml*15', '箱', 24.00, 30.00, 38.00, 32.00, 5.50, 2.80, 2.50, 0.60, 1.30, '茶饮料', 1, NOW(), NOW()),
('P06', 'SPBM006', '维他命水500ml柠檬味15瓶', '500ml*15', '箱', 20.00, 25.00, 32.00, 27.00, 4.50, 2.20, 2.00, 0.50, 1.00, '功能饮料', 1, NOW(), NOW()),
('P07', 'SPBM007', '尖叫运动饮料550ml纤维型12瓶', '550ml*12', '箱', 26.00, 32.00, 40.00, 34.00, 5.00, 2.50, 2.30, 0.55, 1.20, '功能饮料', 1, NOW(), NOW()),
('P08', 'SPBM008', 'NFC果汁300ml橙汁12瓶', '300ml*12', '箱', 38.00, 46.00, 56.00, 50.00, 6.00, 3.00, 2.80, 0.70, 1.50, '果汁', 1, NOW(), NOW()),
('P09', 'SPBM009', '农夫山泉5L天然水3桶', '5L*3', '箱', 30.00, 36.00, 44.00, 38.00, 6.50, 3.20, 3.20, 0.90, 1.60, '饮用水', 1, NOW(), NOW()),
('P10', 'SPBM010', '水溶C100柠檬味500ml15瓶', '500ml*15', '箱', 22.00, 28.00, 35.00, 30.00, 5.00, 2.40, 2.10, 0.50, 1.10, '果汁', 1, NOW(), NOW()),
('P11', 'SPBM011', '东方树叶茉莉花茶500ml15瓶', '500ml*15', '箱', 22.00, 28.00, 35.00, 30.00, 5.00, 2.50, 2.20, 0.55, 1.10, '茶饮料', 1, NOW(), NOW()),
('P12', 'SPBM012', '农夫山泉19L桶装水', '19L', '桶', 12.00, 15.00, 18.00, 16.00, 2.00, 1.00, 1.50, 0.30, 0.80, '饮用水', 1, NOW(), NOW());

-- ---------- 4. 水站（6） ----------
INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, area, credit_limit, current_debt, payment_type, status, created_at, updated_at) VALUES
('ST001', '江宁水站', '周老板', '13900000001', '南京市江宁区东山街道', '江宁区', 50000.00, 0.00, 0, 1, NOW(), NOW()),
('ST002', '秦淮水站', '吴老板', '13900000002', '南京市秦淮区大光路', '秦淮区', 30000.00, 0.00, 0, 1, NOW(), NOW()),
('ST003', '鼓楼水站', '郑老板', '13900000003', '南京市鼓楼区中山北路', '鼓楼区', 40000.00, 0.00, 0, 1, NOW(), NOW()),
('ST004', '玄武水站', '冯老板', '13900000004', '南京市玄武区锁金村', '玄武区', 35000.00, 0.00, 0, 1, NOW(), NOW()),
('ST005', '建邺水站', '褚老板', '13900000005', '南京市建邺区兴隆大街', '建邺区', 28000.00, 0.00, 0, 1, NOW(), NOW()),
('ST006', '栖霞水站', '卫老板', '13900000006', '南京市栖霞区仙林', '栖霞区', 32000.00, 0.00, 0, 1, NOW(), NOW());

-- ---------- 5. 量贩机/零售机（4） ----------
INSERT INTO machine_stations (machine_id, machine_type, station_name, address, manager, manager_phone, status, created_at, updated_at) VALUES
('M001', 1, '量贩机-万达广场店', '南京市建邺区万达广场1F', '张店长', '13700000001', 1, NOW(), NOW()),
('M002', 1, '量贩机-中央商场店', '南京市秦淮区新街口中央商场3F', '李店长', '13700000002', 1, NOW(), NOW()),
('R001', 2, '零售机-地铁大行宫站', '南京市玄武区地铁2号线大行宫站内', '王站长', '13700000003', 1, NOW(), NOW()),
('R002', 2, '零售机-南大鼓楼校区', '南京市鼓楼区南京大学鼓楼校区', '赵管理员', '13700000004', 1, NOW(), NOW());

-- ---------- 6. 员工（5） ----------
INSERT INTO workers (worker_id, worker_name, phone, employee_type, vehicle_type, status, created_at, updated_at) VALUES
('W001', '张师傅', '13800000001', 1, 1, 1, NOW(), NOW()),
('W002', '李师傅', '13800000002', 1, 1, 1, NOW(), NOW()),
('W003', '王师傅', '13800000003', 1, 2, 1, NOW(), NOW()),
('W004', '刘师傅', '13800000004', 1, 2, 1, NOW(), NOW()),
('W005', '陈师傅', '13800000005', 2, 1, 1, NOW(), NOW());

-- ---------- 7. 业务员（4） ----------
INSERT INTO salesmen (salesman_id, salesman_name, phone, commission_rate, status, created_at, updated_at) VALUES
('SM001', '赵敏', '13600000001', 3.00, 1, NOW(), NOW()),
('SM002', '钱进', '13600000002', 2.50, 1, NOW(), NOW()),
('SM003', '孙丽', '13600000003', 3.50, 1, NOW(), NOW()),
('SM004', '李强', '13600000004', 2.00, 1, NOW(), NOW());

-- ---------- 8. 库存（12） ----------
INSERT INTO inventory (product_id, quantity, last_in_time, last_out_time, updated_at) VALUES
('P01', 500, NOW(), NULL, NOW()),
('P02', 400, NOW(), NULL, NOW()),
('P03', 300, NOW(), NULL, NOW()),
('P04', 350, NOW(), NULL, NOW()),
('P05', 320, NOW(), NULL, NOW()),
('P06', 280, NOW(), NULL, NOW()),
('P07', 260, NOW(), NULL, NOW()),
('P08', 150, NOW(), NULL, NOW()),
('P09', 200, NOW(), NULL, NOW()),
('P10', 240, NOW(), NULL, NOW()),
('P11', 310, NOW(), NULL, NOW()),
('P12', 800, NOW(), NULL, NOW());

-- ============================================================
-- 订单测试数据（覆盖 6 种订单类型；订单号 SZX+日期+序号）
-- 金额口径：order_amount=Σ(unit_price×qty)；delivery_fee=Σ(配送费×qty)；total=二者之和
-- ============================================================

-- ① 线上平台销售（type=1）2026-08-20：P01×10
--    金额=15×10=150 配送=工人零售配送2×10=20 应收=170
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608200001', 1, '美团', 'MT20260820001', '张伟', '13911110001', '南京市秦淮区瑞金路12号', NULL, 150.00, 20.00, 170.00, 1, 'W001', 1, 170.00, 'W005', '2026-08-20 10:30:00', '2026-08-20 10:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608200001', 'P01', 10, 15.00, 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, 150.00);

-- ② 线上平台销售（type=1）2026-08-18：P03×6
--    金额=28×6=168 配送=3×6=18 应收=186
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608180002', 1, '京东', 'JD20260818002', '李娜', '13911110002', '南京市建邺区江东中路98号', NULL, 168.00, 18.00, 186.00, 1, 'W002', 1, 186.00, 'W005', '2026-08-18 14:20:00', '2026-08-18 14:20:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608180002', 'P03', 6, 28.00, 28.00, 34.00, 40.00, 36.00, 6.00, 3.00, 3.00, 0.80, 1.50, 168.00);

-- ③ 线下水站分销（type=2）2026-08-16：P02×20
--    金额=分销价25×20=500 配送=工人水站配送0.6×20=12 应收=512
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608160003', 2, 'ST001', '江宁水站', '13900000001', '南京市江宁区东山街道', '周老板', 500.00, 12.00, 512.00, 1, 'W001', 0, 0.00, 'W005', '2026-08-16 09:10:00', '2026-08-16 09:10:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608160003', 'P02', 20, 25.00, 20.00, 25.00, 30.00, 26.00, 5.00, 2.50, 2.50, 0.60, 1.20, 500.00);

-- ④ 线下水站分销（type=2）2026-08-14：P01×30 + P04×10
--    金额=19×30+28×10=570+280=850 配送=0.5×30+0.55×10=15+5.5=20.5 应收=870.5
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608140004', 2, 'ST002', '秦淮水站', '13900000002', '南京市秦淮区大光路', '吴老板', 850.00, 20.50, 870.50, 1, 'W003', 1, 870.50, 'W005', '2026-08-14 11:00:00', '2026-08-14 11:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608140004', 'P01', 30, 19.00, 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, 570.00),
('SZX202608140004', 'P04', 10, 28.00, 22.00, 28.00, 35.00, 30.00, 5.00, 2.50, 2.20, 0.55, 1.10, 280.00);

-- ⑤ 线下零售（type=3）2026-08-12：P03×5（无需配送）
--    金额=零售价40×5=200 配送=0 应收=200
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608120005', 3, '王强', '13911110003', '南京市鼓楼区湖南路88号', '王强', 200.00, 0.00, 200.00, 3, NULL, 1, 200.00, 'W005', '2026-08-12 15:45:00', '2026-08-12 15:45:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608120005', 'P03', 5, 40.00, 28.00, 34.00, 40.00, 36.00, 6.00, 3.00, 3.00, 0.80, 1.50, 200.00);

-- ⑥ 线下零售（type=3）2026-08-10：P05×8 + P06×6（自有员工配送）
--    金额=38×8+32×6=304+192=496 配送=2.5×8+2×6=20+12=32 应收=528
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608100006', 3, '赵芳', '13911110004', '南京市玄武区北京东路55号', '赵芳', 496.00, 32.00, 528.00, 1, 'W004', 0, 100.00, 'W005', '2026-08-10 16:30:00', '2026-08-10 16:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608100006', 'P05', 8, 38.00, 24.00, 30.00, 38.00, 32.00, 5.50, 2.80, 2.50, 0.60, 1.30, 304.00),
('SZX202608100006', 'P06', 6, 32.00, 20.00, 25.00, 32.00, 27.00, 4.50, 2.20, 2.00, 0.50, 1.00, 192.00);

-- ⑦ 量贩机供货（type=4）2026-08-08：P01×40
--    金额=进货价15×40=600 配送=工人零售机配送1×40=40 应收=640
INSERT INTO orders (order_id, order_type, machine_station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608080007', 4, 'M001', '量贩机-万达广场店', '13700000001', '南京市建邺区万达广场1F', '张店长', 600.00, 40.00, 640.00, 2, 'W001', 1, 640.00, 'W005', '2026-08-08 09:00:00', '2026-08-08 09:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608080007', 'P01', 40, 15.00, 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, 600.00);

-- ⑧ 线下水站返货（type=5）2026-08-06：P04×12
--    金额=进货价22×12=264 配送=0 应收=264
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608060008', 5, 'ST003', '鼓楼水站', '13900000003', '南京市鼓楼区中山北路', '郑老板', 264.00, 0.00, 264.00, 3, NULL, 1, 264.00, 'W005', '2026-08-06 10:15:00', '2026-08-06 10:15:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608060008', 'P04', 12, 22.00, 22.00, 28.00, 35.00, 30.00, 5.00, 2.50, 2.20, 0.55, 1.10, 264.00);

-- ⑨ 零售机供货（type=6）2026-08-04：P07×20
--    金额=进货价26×20=520 配送=1.2×20=24 应收=544
INSERT INTO orders (order_id, order_type, machine_station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202608040009', 6, 'R001', '零售机-地铁大行宫站', '13700000003', '南京市玄武区地铁2号线大行宫站内', '王站长', 520.00, 24.00, 544.00, 2, 'W002', 1, 544.00, 'W005', '2026-08-04 08:40:00', '2026-08-04 08:40:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202608040009', 'P07', 20, 26.00, 26.00, 32.00, 40.00, 34.00, 5.00, 2.50, 2.30, 0.55, 1.20, 520.00);

-- ⑩ 线上平台销售（type=1）2026-07-25（历史月）：P02×8
--    金额=20×8=160 配送=2.5×8=20 应收=180
INSERT INTO orders (order_id, order_type, platform_type, platform_order_no, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607250010', 1, '美团', 'MT20260725010', '孙悦', '13911110005', '南京市雨花台区软件大道18号', NULL, 160.00, 20.00, 180.00, 1, 'W003', 1, 180.00, 'W005', '2026-07-25 12:00:00', '2026-07-25 12:00:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607250010', 'P02', 8, 20.00, 20.00, 25.00, 30.00, 26.00, 5.00, 2.50, 2.50, 0.60, 1.20, 160.00);

-- ⑪ 线下水站分销（type=2）2026-07-20（历史月）：P01×15
--    金额=19×15=285 配送=0.5×15=7.5 应收=292.5
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607200011', 2, 'ST004', '玄武水站', '13900000004', '南京市玄武区锁金村', '冯老板', 285.00, 7.50, 292.50, 1, 'W004', 0, 0.00, 'W005', '2026-07-20 13:30:00', '2026-07-20 13:30:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607200011', 'P01', 15, 19.00, 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, 285.00);

-- ⑫ 线下零售（type=3）2026-07-18（历史月）：P02×3（无需配送）
--    金额=30×3=90 配送=0 应收=90
INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607180012', 3, '周涛', '13911110006', '南京市栖霞区文枢东路1号', '周涛', 90.00, 0.00, 90.00, 3, NULL, 1, 90.00, 'W005', '2026-07-18 17:20:00', '2026-07-18 17:20:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607180012', 'P02', 3, 30.00, 20.00, 25.00, 30.00, 26.00, 5.00, 2.50, 2.50, 0.60, 1.20, 90.00);

-- ⑬ 线下水站返货（type=5）2026-07-12（历史月）：P01×12
--    金额=15×12=180 配送=0 应收=180
INSERT INTO orders (order_id, order_type, station_id, customer_name, customer_phone, customer_address, contact_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, created_at, updated_at) VALUES
('SZX202607120013', 5, 'ST005', '建邺水站', '13900000005', '南京市建邺区兴隆大街', '褚老板', 180.00, 0.00, 180.00, 3, NULL, 1, 180.00, 'W005', '2026-07-12 09:50:00', '2026-07-12 09:50:00');
INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal) VALUES
('SZX202607120013', 'P01', 12, 15.00, 15.00, 19.00, 24.00, 20.00, 4.00, 2.00, 2.00, 0.50, 1.00, 180.00);

SELECT '测试数据已重建完成：基础信息 7 模块 + 库存 12 条 + 订单 13 笔（覆盖 6 种订单类型）' AS message;

// 临时脚本：插入营收测试数据（12 笔订单覆盖 6 类型 + 1 台量贩机机台）
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB = process.env.DB_NAME || 'nongfu_inventory';
const WORKER = 'W17851563703197234'; // 万万万
const STATION = 'S17853284880312262'; // 秣陵水站
const MACHINE_RETAIL = 'M17871455631838076'; // 测试零售机A (type2)

// 商品（价格快照）
const P = {
  p1: { id: 'Pmrf3fgpqDNVO8Q', purchase: 15, wholesale: 18, retail: 22, totalFee: 4, distFee: 2.5, wRetail: 2, wWholesale: 0.45 },
  p2: { id: 'Pmrf3fgpzF5XO8D', purchase: 9, wholesale: 10.5, retail: 14, totalFee: 4, distFee: 2.5, wRetail: 2, wWholesale: 0.45 },
  p3: { id: 'Pmrf3fgq30J6ZV3', purchase: 19, wholesale: 21, retail: 26, totalFee: 8, distFee: 5, wRetail: 4, wWholesale: 0.9 },
  p4: { id: 'Pmrf3fgq6AASZ1I', purchase: 19, wholesale: 21, retail: 26, totalFee: 8, distFee: 5, wRetail: 4, wWholesale: 0.9 }
};

function item(p, qty, unitPrice) {
  const pp = P[p];
  return {
    product_id: pp.id, quantity: qty, unit_price: unitPrice,
    purchase_price: pp.purchase, wholesale_price: pp.wholesale, retail_price: pp.retail,
    machine_price: 0, total_delivery_fee: pp.totalFee, distribution_delivery_fee: pp.distFee,
    worker_retail_delivery_fee: pp.wRetail, worker_wholesale_delivery_fee: pp.wWholesale,
    worker_machine_delivery_fee: 0, subtotal: Math.round(unitPrice * qty * 100) / 100
  };
}

// 订单构造器：type, date, customer, items, deliveryType, deliveryFee, stationId, machineId
const orders = [
  { id: 'SZX202608200001', type: 1, date: '2026-08-20 10:30:00', customer: '京东线上客户A', phone: '13800000001', address: '南京市江宁区线上仓', items: [item('p1', 10, 15), item('p3', 5, 19)], dt: 1, feePer: (i) => i.purchase * i.quantity * 0 + i.worker_retail_delivery_fee * i.quantity, pay: 2, remark: '营收测试数据-线上平台' },
  { id: 'SZX202608220002', type: 1, date: '2026-08-22 09:00:00', customer: '淘宝线上客户B', phone: '13800000002', address: '南京市雨花台区', items: [item('p2', 20, 9)], dt: 1, feePer: (i) => i.worker_retail_delivery_fee * i.quantity, pay: 1, remark: '营收测试数据-线上平台' },
  { id: 'SZX202608200003', type: 2, date: '2026-08-20 14:20:00', customer: '秣陵水站', phone: '13800000003', address: '秣陵街道', stationId: STATION, items: [item('p1', 30, 18)], dt: 1, feePer: (i) => i.worker_wholesale_delivery_fee * i.quantity, pay: 0, remark: '营收测试数据-分销' },
  { id: 'SZX202608230004', type: 2, date: '2026-08-23 11:00:00', customer: '秣陵水站', phone: '13800000003', address: '秣陵街道', stationId: STATION, items: [item('p3', 12, 21), item('p4', 8, 21)], dt: 1, feePer: (i) => i.worker_wholesale_delivery_fee * i.quantity, pay: 2, remark: '营收测试数据-分销' },
  { id: 'SZX202608210005', type: 3, date: '2026-08-21 15:10:00', customer: '张先生(零售)', phone: '13800000004', address: '东山街道XX小区', items: [item('p1', 5, 22)], dt: 3, feePer: () => 0, pay: 2, remark: '营收测试数据-零售' },
  { id: 'SZX202608240006', type: 3, date: '2026-08-24 10:05:00', customer: '李女士(零售)', phone: '13800000005', address: '江宁万达广场', items: [item('p2', 8, 14)], dt: 1, feePer: (i) => i.worker_retail_delivery_fee * i.quantity, pay: 2, remark: '营收测试数据-零售' },
  { id: 'SZX202608210007', type: 4, date: '2026-08-21 09:30:00', customer: '测试量贩机A(供货)', phone: '13800000006', address: '大学城商圈', machineId: 'M17875780000000001', items: [item('p1', 15, 15), item('p2', 15, 9)], dt: 2, feePer: () => 0, pay: 2, remark: '营收测试数据-量贩机供货' },
  { id: 'SZX202608240008', type: 4, date: '2026-08-24 16:40:00', customer: '测试量贩机A(供货)', phone: '13800000006', address: '大学城商圈', machineId: 'M17875780000000001', items: [item('p3', 10, 19)], dt: 2, feePer: () => 0, pay: 1, remark: '营收测试数据-量贩机供货' },
  { id: 'SZX202608220009', type: 5, date: '2026-08-22 13:00:00', customer: '秣陵水站(返货)', phone: '13800000003', address: '秣陵街道', stationId: STATION, items: [item('p1', 8, 15)], dt: 3, feePer: () => 0, pay: 0, remark: '营收测试数据-返货' },
  { id: 'SZX202608240010', type: 5, date: '2026-08-24 17:20:00', customer: '秣陵水站(返货)', phone: '13800000003', address: '秣陵街道', stationId: STATION, items: [item('p2', 6, 9), item('p3', 4, 19)], dt: 3, feePer: () => 0, pay: 1, remark: '营收测试数据-返货' },
  { id: 'SZX202608200011', type: 6, date: '2026-08-20 08:50:00', customer: '测试零售机A(供货)', phone: '13800000007', address: '软件园', machineId: MACHINE_RETAIL, items: [item('p1', 10, 15)], dt: 2, feePer: () => 0, pay: 2, remark: '营收测试数据-零售机供货' },
  { id: 'SZX202608230012', type: 6, date: '2026-08-23 09:10:00', customer: '测试零售机A(供货)', phone: '13800000007', address: '软件园', machineId: MACHINE_RETAIL, items: [item('p2', 12, 9), item('p4', 6, 19)], dt: 2, feePer: () => 0, pay: 0, remark: '营收测试数据-零售机供货' }
];

(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: DB, multipleStatements: false });
  await conn.beginTransaction();
  try {
    // 1) 补量贩机机台（若不存在）
    const [mm] = await conn.query('SELECT COUNT(*) c FROM machine_stations WHERE machine_id = ?', ['M17875780000000001']);
    if (mm[0].c === 0) {
      await conn.query(
        "INSERT INTO machine_stations (machine_id, machine_type, station_name, address, manager, manager_phone, status) VALUES (?, 1, '测试量贩机A', '大学城商圈', '测试', '13800000006', 1)",
        ['M17875780000000001']
      );
      console.log('✅ 新增量贩机机台 测试量贩机A');
    }

    // 2) 插入订单 + 明细
    for (const o of orders) {
      const orderAmount = Math.round(o.items.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;
      const deliveryFee = Math.round(o.items.reduce((s, i) => s + o.feePer(i), 0) * 100) / 100;
      const totalReceivable = Math.round((orderAmount + deliveryFee) * 100) / 100;
      const paidAmount = o.pay === 2 ? totalReceivable : (o.pay === 1 ? Math.round(totalReceivable * 0.5 * 100) / 100 : 0);

      await conn.query(
        `INSERT INTO orders (order_id, order_type, station_id, machine_station_id, customer_name, customer_phone, customer_address, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, payment_status, paid_amount, created_by, canceled_at, remark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [o.id, o.type, o.stationId || null, o.machineId || null, o.customer, o.phone, o.address, orderAmount, deliveryFee, totalReceivable, o.dt, WORKER, o.pay, paidAmount, WORKER, o.remark, o.date, o.date]
      );

      for (const it of o.items) {
        await conn.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [o.id, it.product_id, it.quantity, it.unit_price, it.purchase_price, it.wholesale_price, it.retail_price, it.machine_price, it.total_delivery_fee, it.distribution_delivery_fee, it.worker_retail_delivery_fee, it.worker_wholesale_delivery_fee, it.worker_machine_delivery_fee, it.subtotal]
        );
      }
      console.log(`✅ 订单 ${o.id} 类型${o.type} 金额=${orderAmount} 配送费=${deliveryFee} 应收=${totalReceivable}`);
    }
    await conn.commit();
    console.log('🎉 全部测试数据插入完成');
  } catch (e) {
    await conn.rollback();
    console.error('❌ 失败已回滚:', e.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
})();

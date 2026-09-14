/**
 * 集成测试（T1）：订单定价口径全分支
 * 覆盖：类型1(进价)/3(零售价·手填)/2(水站·行级水票抵扣·欠款)/4(机台0元) 的
 *      单价与小计、快照价、水票核销与还原、欠款联动、库存扣减、校验拦截。
 * 用途：orderPricingService（D1）重构前建立安全网；重构后回归。
 * 运行：node scripts/smoke_order_pricing.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json().catch(() => ({}));
}

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  const { pool } = require('../src/config/db');
  const cleanupIds = { orders: [], productIds: [], ticketIds: [] };
  let stationId = null, machineId = null, stationDebt0 = null;

  try {
    // ---------- 前置：临时商品（进价10/分销15/零售20/机台5）+ 库存 1000 ----------
    const pid = `P${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
    cleanupIds.productIds.push(pid);
    await pool.query(
      "INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
      [pid, `TEST${pid}`, 'T1定价测试商品', '550ml', '箱', 10, 15, 20, 5, 0, 0, 0, 0, 0]
    );
    await pool.query(
      "INSERT INTO inventory (product_id, quantity, last_in_time) VALUES (?, 1000, NOW())",
      [pid]
    );
    const invQty = async () => {
      const [[r]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [pid]);
      return r.quantity;
    };

    // 水站 + 初始欠款
    const [[st]] = await pool.query("SELECT station_id, current_debt FROM sub_stations ORDER BY station_id LIMIT 1");
    stationId = st.station_id;
    stationDebt0 = Number(st.current_debt);

    // 临时水票 2 张（类型2 抵扣用）
    for (let i = 0; i < 2; i++) {
      const tid = `WTT1${Date.now()}${i}`;
      cleanupIds.ticketIds.push(tid);
      await pool.query(
        "INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark) VALUES (?,?,?,1,?,NOW(),'t1','T1定价测试')",
        [tid, pid, stationId, new Date().toISOString().slice(0, 7)]
      );
    }
    const availTickets = async () => {
      const [[r]] = await pool.query(
        'SELECT COUNT(*) c FROM water_tickets WHERE station_id=? AND product_id=? AND status=1',
        [stationId, pid]);
      return r.c;
    };
    const usedTickets = async () => {
      const [[r]] = await pool.query(
        'SELECT COUNT(*) c FROM water_tickets WHERE station_id=? AND product_id=? AND status=2',
        [stationId, pid]);
      return r.c;
    };
    const stationDebt = async () => {
      const [[r]] = await pool.query('SELECT current_debt FROM sub_stations WHERE station_id = ?', [stationId]);
      return Number(r.current_debt);
    };
    const itemOf = async (orderId) => {
      const [rows] = await pool.query('SELECT * FROM order_items WHERE order_id = ? LIMIT 1', [orderId]);
      return rows[0];
    };

    // ---------- 用例1：类型1 送水到府 → 进货价 ----------
    let r = await call('POST', '/orders', {
      orderType: 1, customerName: 'T1-平台', customerPhone: '13800000001',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型1创建成功');
    const o1 = r.data.id;
    cleanupIds.orders.push(o1);
    let it = await itemOf(o1);
    assert(approx(it.unit_price, 10), '类型1单价=进货价10');
    assert(approx(it.subtotal, 30), '类型1小计=30');
    assert(approx(r.data.orderAmount, 30) && approx(r.data.totalAmount, 30), '类型1订单金额/应收=30');
    assert(approx(r.data.deliveryFee, 0), '类型1配送费=0');
    assert(approx(await invQty(), 997), '类型1库存扣减 1000→997');

    // ---------- 用例2：类型3 线下零售·手填价 25 ----------
    r = await call('POST', '/orders', {
      orderType: 3, customerName: 'T1-零售', customerPhone: '13800000002',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3, unitPrice: 25 }]
    }, token);
    assert(r.code === 200, '类型3创建成功（手填价25）');
    const o3 = r.data.id;
    cleanupIds.orders.push(o3);
    it = await itemOf(o3);
    assert(approx(it.unit_price, 25) && approx(it.subtotal, 75), '类型3单价/小计用手填价 25/75');
    assert(approx(it.retail_price, 25), '类型3快照retail_price=成交价25');
    assert(approx(it.wholesale_price, 15), '类型3快照wholesale_price=档案价15');

    // ---------- 用例3：类型2 水站·无抵扣·手填分销价16 ----------
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'T1-水站A', customerPhone: '13800000003',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3, unitPrice: 16 }]
    }, token);
    assert(r.code === 200, '类型2创建成功（无抵扣）');
    const o2a = r.data.id;
    cleanupIds.orders.push(o2a);
    it = await itemOf(o2a);
    assert(approx(it.unit_price, 16) && approx(it.subtotal, 48), '类型2无抵扣小计=16×3=48');
    assert(Number(it.pricing_type) === 1 && Number(it.ticket_qty) === 0, '类型2无抵扣 pricing_type=1/ticket_qty=0');
    assert(approx(it.wholesale_price, 16), '类型2快照wholesale_price=手填16');
    assert(approx(await stationDebt(), stationDebt0 + 48), '类型2欠款 += 48');

    // ---------- 用例4：类型2 抵扣2张：2件按进价(不计金额) + 3件按16 ----------
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'T1-水站B', customerPhone: '13800000004',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 5, unitPrice: 16, useTicket: true, ticketQty: 2 }]
    }, token);
    assert(r.code === 200, '类型2创建成功（抵扣2张）');
    const o2b = r.data.id;
    cleanupIds.orders.push(o2b);
    it = await itemOf(o2b);
    assert(approx(it.subtotal, 16 * 3), '类型2抵扣小计=16×(5-2)=48');
    assert(Number(it.pricing_type) === 2 && Number(it.ticket_qty) === 2, '类型2 pricing_type=2/ticket_qty=2');
    assert(approx(await usedTickets(), 2) && approx(await availTickets(), 0), '水票核销2张（可用0/已用2）');
    assert(approx(await stationDebt(), stationDebt0 + 96), '欠款累计 += 48（两单合计96）');
    assert(approx(await invQty(), 997 - 3 - 3 - 5 + 0), '库存累计扣减正确（991-5=986）');

    // ---------- 用例5：票不足 → 400 且无副作用（rollback） ----------
    const debtBefore = await stationDebt();
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'T1-票不足', customerPhone: '13800000005',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 1, unitPrice: 16, useTicket: true, ticketQty: 1 }]
    }, token);
    assert(r.code === 400, '类型2票不足被拦截(400)');
    const [[oc]] = await pool.query("SELECT COUNT(*) c FROM orders WHERE customer_name='T1-票不足'");
    assert(oc.c === 0, '票不足订单未落库（事务回滚）');
    assert(approx(await stationDebt(), debtBefore), '票不足欠款不变');
    assert(approx(await availTickets(), 0), '票不足可用票不变');

    // ---------- 用例6：ticket_qty > quantity → 400 ----------
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'T1-超量', customerPhone: '13800000006',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 1, useTicket: true, ticketQty: 2 }]
    }, token);
    assert(r.code === 400, '抵扣张数>数量被拦截(400)');

    // ---------- 用例7：类型4 机台供货 → 0元；无机台 → 400 ----------
    const [[mm]] = await pool.query('SELECT machine_id FROM machine_stations LIMIT 1');
    machineId = mm.machine_id;
    r = await call('POST', '/orders', {
      orderType: 4, customerName: 'T1-机台', machineStationId: machineId,
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3 }]
    }, token);
    assert(r.code === 200, '类型4创建成功');
    const o4 = r.data.id;
    cleanupIds.orders.push(o4);
    it = await itemOf(o4);
    assert(approx(it.unit_price, 0) && approx(it.subtotal, 0) && approx(r.data.orderAmount, 0), '类型4单价/小计/金额=0');
    r = await call('POST', '/orders', {
      orderType: 4, customerName: 'T1-无机台', deliveryMethod: 1,
      items: [{ productId: pid, quantity: 1 }]
    }, token);
    assert(r.code === 400, '类型4无机台被拦截(400)');

    // ---------- 用例8：类型5 水公社（2026-09-14 新增）→ 与线下零售同口径 ----------
    // 8a：不传单价 → 回退商品档案零售价（测试商品零售价=20）
    r = await call('POST', '/orders', {
      orderType: 5, customerName: 'T1-水公社A', customerPhone: '13800000007',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2 }]
    }, token);
    assert(r.code === 200, '类型5创建成功（不传单价）');
    const o5a = r.data.id;
    cleanupIds.orders.push(o5a);
    it = await itemOf(o5a);
    assert(approx(it.unit_price, 20) && approx(it.subtotal, 40), '类型5不传单价 → 回退零售价 20/40');
    assert(approx(it.retail_price, 20), '类型5快照retail_price=零售价20');

    // 8b：手填单价 33 → 以手填价成交，快照=手填价
    r = await call('POST', '/orders', {
      orderType: 5, customerName: 'T1-水公社B', customerPhone: '13800000008',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2, unitPrice: 33 }]
    }, token);
    assert(r.code === 200, '类型5创建成功（手填单价33）');
    const o5b = r.data.id;
    cleanupIds.orders.push(o5b);
    it = await itemOf(o5b);
    assert(approx(it.unit_price, 33) && approx(it.subtotal, 66), '类型5手填价 33/66');
    assert(approx(it.retail_price, 33), '类型5快照retail_price=手填成交价33');

    // 8c：不支持水票抵扣 → 传 useTicket 应被忽略（pricing_type=1/ticket_qty=0，金额按全量）
    r = await call('POST', '/orders', {
      orderType: 5, customerName: 'T1-水公社C', customerPhone: '13800000009',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2, useTicket: true, ticketQty: 2 }]
    }, token);
    assert(r.code === 200, '类型5创建成功（传水票参数）');
    const o5c = r.data.id;
    cleanupIds.orders.push(o5c);
    it = await itemOf(o5c);
    assert(Number(it.pricing_type) === 1 && Number(it.ticket_qty) === 0, '类型5不支持水票抵扣（pricing_type=1/ticket_qty=0）');
    assert(approx(it.subtotal, 40), '类型5水票参数被忽略，小计仍按全量零售价=40');

    // ---------- 用例9：改单（类型2 抵扣单 改为 qty3/抵扣1） ----------
    r = await call('PUT', `/orders/${o2b}`, {
      orderType: 2, stationId, customerName: 'T1-水站B', customerPhone: '13800000004',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3, unitPrice: 16, useTicket: true, ticketQty: 1 }]
    }, token);
    assert(r.code === 200, '改单成功（5张抵2 → 3张抵1）');
    it = await itemOf(o2b);
    assert(approx(it.subtotal, 32) && Number(it.ticket_qty) === 1, '改单后小计=16×2=32、ticket_qty=1');
    assert(approx(await usedTickets(), 1) && approx(await availTickets(), 1), '改单后重新核销1张（释放2核销1）');
    const [[ord2b]] = await pool.query('SELECT order_amount FROM orders WHERE order_id = ?', [o2b]);
    assert(approx(ord2b.order_amount, 32), '改单后订单金额重算=32');
    assert(approx(await stationDebt(), stationDebt0 + 48 + 32), '改单后欠款=A单48+B单32');

    // ---------- 用例10：取消 B 单 → 欠款/库存/水票全部还原 ----------
    const invBeforeCancel = await invQty();
    r = await call('DELETE', `/orders/${o2b}`, null, token);
    assert(r.code === 200, '取消B单成功');
    assert(approx(await stationDebt(), stationDebt0 + 48), '取消后欠款回退（仅剩A单48）');
    assert(approx(await invQty(), invBeforeCancel + 3), '取消后库存恢复+3');
    assert(approx(await availTickets(), 2) && approx(await usedTickets(), 0), '取消后水票全部还原（可用2/已用0）');
  } finally {
    // ---------- 清理还原（直接 DB 清理，测试数据无外部关联） ----------
    let cleanupOk = true;
    try {
      if (cleanupIds.orders.length) {
        const ph = cleanupIds.orders.map(() => '?').join(',');
        await pool.query(`DELETE FROM order_items WHERE order_id IN (${ph})`, cleanupIds.orders);
        await pool.query(`DELETE FROM delivery_fee_settlement WHERE order_id IN (${ph})`, cleanupIds.orders);
        await pool.query(`DELETE FROM orders WHERE order_id IN (${ph})`, cleanupIds.orders);
      }
      if (stationId !== null && stationDebt0 !== null) {
        await pool.query('UPDATE sub_stations SET current_debt = ? WHERE station_id = ?', [stationDebt0, stationId]);
      }
      if (cleanupIds.ticketIds.length) {
        await pool.query('DELETE FROM water_tickets WHERE ticket_id IN (?)', [cleanupIds.ticketIds]);
      }
      // 删商品前必须清空所有以 product_id 外键引用 products 的表（一律 ON DELETE RESTRICT），
      // 否则 DELETE FROM products 会被 fk_item_product 等挡下抛 ER_ROW_IS_REFERENCED_2。
      // 2026-09-14 教训：旧版只删了 inventory，改单产生的 order_items 孤儿明细残留 → 商品删不掉。
      for (const p of cleanupIds.productIds) {
        await pool.query('DELETE FROM order_items WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM delivery_fee_settlement WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM machine_sales WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM stock_out_records WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM water_tickets WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM water_ticket_issuance WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM inventory WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM products WHERE product_id = ?', [p]);
      }
    } catch (e) {
      cleanupOk = false;
      console.log('  ⚠️ 清理异常（测试数据可能残留）: ' + e.message);
    }
    console.log(cleanupOk
      ? '清理完成（测试商品/订单/水票已删除，水站欠款已还原）'
      : '⚠️ 清理未完成，请检查上方异常');
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();

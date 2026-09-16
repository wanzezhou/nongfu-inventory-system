/**
 * 冒烟（A6）：营收口径唯一归后端
 * 覆盖：订单详情接口 /orders/:id 返回 revenue 与 deliveryFeePart（后端 itemRevenueExpr 计算）；
 *      类型1/2(无抵扣·行内抵扣)/3/5(水公社)/4 各分支数值断言；与财务营收明细列表（同口径）交叉验证。
 * 运行：node scripts/smoke_a6_revenue.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';
const { revertOrderRevenueBySql } = require('./lib/smokeCleanup');

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
function assert(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  const { pool } = require('../src/config/db');
  const cleanupIds = { orders: [], productIds: [], ticketIds: [] };
  let stationId = null, stationDebt0 = null;

  try {
    // ---------- 前置：临时商品（进价10 / 总包配送费2 / 分销15 / 零售20）+ 库存 ----------
    const pid = `P${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
    cleanupIds.productIds.push(pid);
    await pool.query(
      "INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
      [pid, `TEST${pid}`, 'A6营收口径测试商品', '550ml', '箱', 10, 15, 20, 5, 2, 0, 0, 0, 0]
    );
    await pool.query("INSERT INTO inventory (product_id, quantity, last_in_time) VALUES (?, 100, NOW())", [pid]);

    // 自建冒烟水站（⚠️ 禁止取真实水站）
    // 旧版 `SELECT station_id, current_debt FROM sub_stations ORDER BY station_id LIMIT 1`
    // 取到的是真实 ST001：建单经 addStationDebt 直接累加真实 current_debt，
    // 而清理靠「跑前快照回写」，脚本异常退出或两脚本交叉执行时虚高会被固化下来。
    stationId = `SMKST${Date.now()}`;
    await pool.query(
      'INSERT INTO sub_stations (station_id, station_name, current_debt, status) VALUES (?, ?, 0, 1)',
      [stationId, '冒烟水站(营收测试)']
    );
    stationDebt0 = 0;

    // 临时水票 2 张（类型2 行内抵扣用）
    for (let i = 0; i < 2; i++) {
      const tid = `WTA6${Date.now()}${i}`;
      cleanupIds.ticketIds.push(tid);
      await pool.query(
        "INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark) VALUES (?,?,?,1,?,NOW(),'a6','A6营收口径测试')",
        [tid, pid, stationId, new Date().toISOString().slice(0, 7)]
      );
    }

    // 详情营收断言辅助
    const detailOf = async (orderId) => {
      const r = await call('GET', `/orders/${orderId}`, null, token);
      assert(r.code === 200 && r.data, `详情接口返回成功（${orderId}）`, JSON.stringify(r));
      return r.data;
    };

    // ---------- 用例1：类型1 送水到府 → 营收=(10+2)×3=36，配送费拆分=6 ----------
    console.log('\n[类型1] 送水到府');
    let r = await call('POST', '/orders', {
      orderType: 1, customerName: 'A6-平台', customerPhone: '13900000001',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型1创建成功');
    const o1 = r.data.id;
    cleanupIds.orders.push(o1);
    let d = await detailOf(o1);
    assert(approx(d.orderAmount, 30), '类型1 orderAmount=30（进货价×3）', String(d.orderAmount));
    assert(approx(d.revenue, 36), '类型1 revenue=36（(10+2)×3）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 6), '类型1 deliveryFeePart=6（总包配送费2×3）', String(d.deliveryFeePart));

    // ---------- 用例2：类型3 线下零售·手填价 25 → 营收=25×2=50 ----------
    console.log('\n[类型3] 线下零售');
    r = await call('POST', '/orders', {
      orderType: 3, customerName: 'A6-零售', customerPhone: '13900000002',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2, unitPrice: 25 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型3创建成功');
    const o3 = r.data.id;
    cleanupIds.orders.push(o3);
    d = await detailOf(o3);
    assert(approx(d.orderAmount, 50), '类型3 orderAmount=50', String(d.orderAmount));
    assert(approx(d.revenue, 50), '类型3 revenue=50（零售价×2）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 0), '类型3 deliveryFeePart=0', String(d.deliveryFeePart));

    // ---------- 用例2b：类型5 水公社（2026-09-14 新增）→ 与线下零售同口径，营收=零售价×数量 ----------
    // 2b-1 不传单价 → 回退档案零售价（测试商品零售价=20）→ 营收=20×2=40
    console.log('\n[类型5] 水公社·回退零售价');
    r = await call('POST', '/orders', {
      orderType: 5, customerName: 'A6-水公社A', customerPhone: '13900000005',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型5创建成功（不传单价）');
    const o5a = r.data.id;
    cleanupIds.orders.push(o5a);
    d = await detailOf(o5a);
    assert(approx(d.orderAmount, 40), '类型5 orderAmount=40（零售价20×2）', String(d.orderAmount));
    assert(approx(d.revenue, 40), '类型5 revenue=40（与线下零售同口径）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 0), '类型5 deliveryFeePart=0', String(d.deliveryFeePart));

    // 2b-2 手填单价 25 → 营收=25×2=50（成交价优先）
    console.log('\n[类型5] 水公社·手填价25');
    r = await call('POST', '/orders', {
      orderType: 5, customerName: 'A6-水公社B', customerPhone: '13900000006',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 2, unitPrice: 25 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型5创建成功（手填25）');
    const o5b = r.data.id;
    cleanupIds.orders.push(o5b);
    d = await detailOf(o5b);
    assert(approx(d.orderAmount, 50), '类型5手填 orderAmount=50', String(d.orderAmount));
    assert(approx(d.revenue, 50), '类型5手填 revenue=50（手填价25×2）', String(d.revenue));

    // ---------- 用例3：类型2 水站·无抵扣 → 营收=16×3=48 ----------
    console.log('\n[类型2] 无抵扣');
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'A6-水站A', customerPhone: '13900000003',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3, unitPrice: 16 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型2无抵扣创建成功');
    const o2a = r.data.id;
    cleanupIds.orders.push(o2a);
    d = await detailOf(o2a);
    assert(approx(d.orderAmount, 48), '类型2无抵扣 orderAmount=48', String(d.orderAmount));
    assert(approx(d.revenue, 48), '类型2无抵扣 revenue=48（分销价×3）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 0), '类型2无抵扣 deliveryFeePart=0', String(d.deliveryFeePart));

    // ---------- 用例4：类型2 行内抵扣2张 → 营收=(10+2)×2 + 16×3=72，拆分=24 ----------
    console.log('\n[类型2] 行内水票抵扣');
    r = await call('POST', '/orders', {
      orderType: 2, stationId, customerName: 'A6-水站B', customerPhone: '13900000004',
      deliveryMethod: 1, items: [{ productId: pid, quantity: 5, unitPrice: 16, useTicket: true, ticketQty: 2 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型2抵扣创建成功');
    const o2b = r.data.id;
    cleanupIds.orders.push(o2b);
    d = await detailOf(o2b);
    assert(approx(d.orderAmount, 48), '类型2抵扣 orderAmount=48（16×3非抵扣件）', String(d.orderAmount));
    assert(approx(d.revenue, 72), '类型2抵扣 revenue=72（(10+2)×2抵扣 + 16×3分销）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 24), '类型2抵扣 deliveryFeePart=24（revenue-orderAmount）', String(d.deliveryFeePart));

    // ---------- 用例5：类型4 机台供货 → 商品明细营收=0（营收走 machine_sales） ----------
    console.log('\n[类型4] 机台供货');
    const [[mm]] = await pool.query('SELECT machine_id FROM machine_stations LIMIT 1');
    r = await call('POST', '/orders', {
      orderType: 4, customerName: 'A6-机台', machineStationId: mm.machine_id,
      deliveryMethod: 1, items: [{ productId: pid, quantity: 3 }]
    }, token);
    assert(r.code === 200 && r.data?.id, '类型4创建成功');
    const o4 = r.data.id;
    cleanupIds.orders.push(o4);
    d = await detailOf(o4);
    assert(approx(d.revenue, 0), '类型4 detail revenue=0（营收按机台销量统计）', String(d.revenue));
    assert(approx(d.deliveryFeePart, 0), '类型4 deliveryFeePart=0', String(d.deliveryFeePart));

    // ---------- 用例6：与财务营收明细列表交叉验证（同口径唯一来源） ----------
    console.log('\n[交叉] 财务营收明细列表');
    r = await call('GET', '/finance/orders?range=all&pageSize=100', null, token);
    assert(r.code === 200 && Array.isArray(r.data?.list), '财务列表查询成功');
    const rowOf = (id) => (r.data.list || []).find((x) => String(x.orderId) === String(id));
    for (const [oid, want, tag] of [[o1, 36, '类型1'], [o2a, 48, '类型2无抵扣'], [o2b, 72, '类型2抵扣'], [o3, 50, '类型3'], [o5a, 40, '类型5回退'], [o5b, 50, '类型5手填']]) {
      const row = rowOf(oid);
      assert(row && approx(row.revenue, want), `${tag} 财务列表营收=详情营收=${want}`, row ? String(row.revenue) : '未找到该行');
    }
    // 详情与列表数值一致性（同一订单）
    const d1 = await detailOf(o1);
    assert(approx(d1.revenue, rowOf(o1).revenue), '详情 revenue === 列表 revenue（口径无漂移）');
  } finally {
    // ---------- 清理还原 ----------
    let cleanupOk = true;
    try {
      if (cleanupIds.orders.length) {
        const ph = cleanupIds.orders.map(() => '?').join(',');
        // 需求 5：订单创建即营收入账。此处走原生 SQL 直删订单，绕过 DELETE /orders 的回冲，
        // 必须先手动回冲 order_revenue 流水 + 还原余额，否则留下悬挂流水并抬高账户余额。
        await revertOrderRevenueBySql(pool, cleanupIds.orders);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (${ph})`, cleanupIds.orders);
        await pool.query(`DELETE FROM delivery_fee_settlement WHERE order_id IN (${ph})`, cleanupIds.orders);
        await pool.query(`DELETE FROM orders WHERE order_id IN (${ph})`, cleanupIds.orders);
      }
      // 自建冒烟水站整体删除（不再用「快照回写」：该模式在多脚本交叉执行/异常退出时会固化虚高值）
      if (stationId) {
        await pool.query('DELETE FROM water_tickets WHERE station_id = ?', [stationId]);
        await pool.query('DELETE FROM water_ticket_issuance WHERE station_id = ?', [stationId]);
        await pool.query('DELETE FROM financial_settlement WHERE station_id = ?', [stationId]);
        await pool.query('DELETE FROM sub_stations WHERE station_id = ?', [stationId]);
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
      ? '\n清理完成（测试商品/订单/水票/水站已删除）'
      : '\n⚠️ 清理未完成，请检查上方异常');
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();

/**
 * 冒烟测试：P1-F3 水票核销还原
 * 链路：造水票 → 建水站订单(水票抵扣) → 断言票已核销 → 取消订单 → 断言票还原
 *      → 重建订单 → 改单(去掉抵扣) → 断言票还原 → 改单(恢复抵扣) → 断言重新核销 → 清理
 * 运行：node scripts/smoke_ticket_restore.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';
const { pool } = require('../src/config/db');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return json;
}

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

(async () => {
  // 登录
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  // 自建测试对象（不依赖真实数据）：临时商品 + 临时水站 + 3 张 SMK 水票
  // 历史教训：旧版在「库里恰好没有可用水票」时会走 else 分支去 SELECT products WHERE pricing_type ...
  // —— pricing_type 是早已删除的列，该分支一旦执行必然 ER_BAD_FIELD_ERROR。
  // 平时因库里有真实水票而被掩盖，水票被清空 / 全新部署时立刻暴露。这里统一改为自建，恒不依赖真实数据。
  const productId = 'SMK' + Date.now();
  const stationIdTmp = 'SMKST' + Date.now();
  const nowIso = new Date().toISOString();
  const monthStr = nowIso.slice(0, 7);

  await pool.query(
    `INSERT INTO products (product_id, product_name, product_code, category, purchase_price, wholesale_price,
       retail_price, machine_price, status, created_at, updated_at)
     VALUES (?, '冒烟-水票还原测试商品', ?, '冒烟', 10, 12, 15, 10, 1, NOW(), NOW())`,
    [productId, productId]
  );
  await pool.query(
    `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, created_at, updated_at)
     VALUES (?, '冒烟-水票还原测试水站', '冒烟', '13800000000', 1, NOW(), NOW())`,
    [stationIdTmp]
  );
  await pool.query(
    'INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 100, NOW()) ' +
    'ON DUPLICATE KEY UPDATE quantity = quantity + 100',
    [productId]
  );
  const stationId = stationIdTmp;
  for (let i = 0; i < 3; i++) {
    const tid = `WTSMK${Date.now()}${i}${Math.floor(Math.random() * 900 + 100)}`;
    await pool.query(
      "INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark) VALUES (?,?,?,1,?,NOW(),'smoke','冒烟-水票还原测试')",
      [tid, productId, stationId, monthStr]
    );
  }
  console.log(`测试对象（自建）：水站 ${stationId} / 商品 ${productId}`);

  const countTickets = async (status) => {
    const [[r]] = await pool.query(
      "SELECT COUNT(*) c FROM water_tickets WHERE station_id=? AND product_id=? AND status=?",
      [stationId, productId, status]
    );
    return r.c;
  };
  const available0 = await countTickets(1);
  assert(available0 >= 2, `准备至少 2 张可用水票（当前 ${available0}）`);

  // 建水站订单：数量 3，水票抵扣 2
  const created = await call('POST', '/orders', {
    order_type: 2, station_id: stationId, customer_name: '冒烟-水票还原', customer_phone: '13800000001',
    delivery_type: 3,
    items: [{ product_id: productId, quantity: 3, use_ticket: true, ticket_qty: 2 }]
  }, token);
  assert(created.code === 200, `创建水站订单（抵扣 2 张）: ${created.code === 200 ? 'OK' : created.message}`);
  const orderId = created.data?.id || created.data?.orderId || created.data?.order_id;

  let availAfterCreate = await countTickets(1);
  let usedAfterCreate = await countTickets(2);
  assert(availAfterCreate === available0 - 2, `下单后可用票 -2（${available0}→${availAfterCreate}）`);
  const usedSnapshot = usedAfterCreate;

  // 取消订单（DELETE /orders/:id）→ 票应还原
  const cancel2 = await call('DELETE', `/orders/${orderId}`, {}, token);
  assert((cancel2 || {}).code === 200, `取消订单: ${(cancel2 || {}).message || ''}`);
  const availAfterCancel = await countTickets(1);
  assert(availAfterCancel === available0, `取消后水票还原（${availAfterCancel} === ${available0}）`);

  // 重建订单 → 改单去掉抵扣 → 票应还原
  const created2 = await call('POST', '/orders', {
    order_type: 2, station_id: stationId, customer_name: '冒烟-水票还原2', customer_phone: '13800000002',
    delivery_type: 3,
    items: [{ product_id: productId, quantity: 3, use_ticket: true, ticket_qty: 2 }]
  }, token);
  assert(created2.code === 200, `重建订单: ${created2.message || ''}`);
  const orderId2 = created2.data?.id || created2.data?.orderId || created2.data?.order_id;
  assert((await countTickets(1)) === available0 - 2, '重建后再次核销 2 张');

  const updated = await call('PUT', `/orders/${orderId2}`, {
    order_type: 2, station_id: stationId, customer_name: '冒烟-水票还原2', customer_phone: '13800000002',
    delivery_type: 3,
    items: [{ product_id: productId, quantity: 3, use_ticket: false, ticket_qty: 0 }]
  }, token);
  assert(updated.code === 200, `改单去掉水票抵扣: ${updated.message || ''}`);
  assert((await countTickets(1)) === available0, `改单后水票还原（${await countTickets(1)} === ${available0}）`);

  // 改单恢复抵扣 → 重新核销
  const updated2 = await call('PUT', `/orders/${orderId2}`, {
    order_type: 2, station_id: stationId, customer_name: '冒烟-水票还原2', customer_phone: '13800000002',
    delivery_type: 3,
    items: [{ product_id: productId, quantity: 3, use_ticket: true, ticket_qty: 1 }]
  }, token);
  assert(updated2.code === 200, `改单恢复抵扣 1 张: ${updated2.message || ''}`);
  assert((await countTickets(1)) === available0 - 1, `重新核销 1 张（可用 ${available0 - 1}）`);

  // 清理：取消并硬删测试订单（DELETE /orders/:id/force）
  await call('DELETE', `/orders/${orderId2}`, {}, token);
  await call('DELETE', `/orders/${orderId2}/force`, {}, token);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
})()
  .catch(e => { console.error('冒烟异常:', e); fail++; })
  .finally(async () => {
    // 兜底：取消/改单中途失败时测试订单会残留（订单取消 ≠ 删除），统一物理清除
    await cleanupSmokeResidue(pool);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

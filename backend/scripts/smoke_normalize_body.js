// 冒烟：D7 请求体命名归一化中间件（蛇形键 → 驼峰）
// 覆盖：middleware 单元行为 + product 蛇形创建/驼峰更新 + inventory 蛇形入库/作废
//      + waterTicket 蛇形发行 + machineSales 蛇形明细
// 用法：先启动后端（node src/app.js），再 node backend/scripts/smoke_normalize_body.js
const BASE = 'http://localhost:3000/api';
const mysql = require('mysql2/promise');
require('dotenv').config();

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---- 中间件单元行为 ----
const normalizeValue = (() => {
  const mw = require('../src/middleware/normalizeBody');
  return (input) => {
    const req = { body: JSON.parse(JSON.stringify(input)) };
    let called = false;
    mw(req, {}, () => { called = true; });
    return called ? req.body : null;
  };
})();

function unitTests() {
  console.log('\n[单元] normalizeBody 中间件');
  const out = normalizeValue({
    product_id: 'P1', unit_price: 1.5,
    items: [{ product_id: 'P2', distribution_delivery_fee: 3 }],
    nested: { worker_retail_delivery_fee: 4 },
    camelAlready: 1, spec: 'x', keep: null, arr: [1, 'a']
  });
  check('顶层蛇形转驼峰', out.productId === 'P1' && out.unitPrice === 1.5);
  check('数组内对象转换', out.items[0].productId === 'P2' && out.items[0].distributionDeliveryFee === 3);
  check('深层嵌套对象转换', out.nested.workerRetailDeliveryFee === 4);
  check('无下划线键不动', out.camelAlready === 1 && out.spec === 'x');
  check('原蛇形键删除', !('product_id' in out) && !('items' in out ? false : out.items[0].product_id !== undefined));
  const dup = normalizeValue({ product_id: 'snake', productId: 'camel' });
  check('驼峰键已存在时不覆盖', dup.productId === 'camel' && !('product_id' in dup));
}

async function main() {
  const pool = await db();

  // 登录
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then(r => r.json());
  if (lr.code !== 200) throw new Error('登录失败：' + lr.message);
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lr.data.token };
  const call = (path, opt = {}) => fetch(`${BASE}${path}`, { headers: H, ...opt }).then(r => r.json());

  // 准备：启用账户
  const accRes = await call('/finance-accounts');
  const acc = (accRes.data?.list || []).find(a => a.status);
  if (!acc) throw new Error('无启用账户');
  const balanceOf = async (id) => {
    const [[r]] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [id]);
    return Number(r.current_balance);
  };
  const balBefore = await balanceOf(acc.accountId);

  // ===== 1. product：蛇形创建 =====
  console.log('\n[接口] 商品 — 蛇形创建 / 驼峰短别名更新');
  const suffix = Date.now().toString().slice(-8);
  const created = await call('/products', {
    method: 'POST',
    body: JSON.stringify({
      product_code: 'SMK' + suffix,
      product_name: '冒烟归一化商品',
      specification: '550ml',
      unit: '箱',
      purchase_price: 10.5,
      wholesale_price: 12,
      retail_price: 15,
      machine_price: 16,
      total_delivery_fee: 2,
      distribution_delivery_fee: 1.5,
      worker_retail_delivery_fee: 1,
      worker_wholesale_delivery_fee: 0.8,
      worker_machine_delivery_fee: 0.6,
      status: 1
    })
  });
  check('蛇形 body 创建商品成功', created.code === 200, JSON.stringify(created));
  const pid = created.data?.id;
  const [[prow]] = await pool.query(
    'SELECT purchase_price, machine_price, distribution_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee FROM products WHERE product_id = ?',
    [pid]
  );
  check('蛇形值正确落库（purchase_price=10.5）', Number(prow.purchase_price) === 10.5, String(prow.purchase_price));
  check('蛇形值正确落库（machine_price=16）', Number(prow.machine_price) === 16, String(prow.machine_price));
  check('蛇形值正确落库（distribution_delivery_fee=1.5）', Number(prow.distribution_delivery_fee) === 1.5, String(prow.distribution_delivery_fee));
  check('蛇形值正确落库（worker_wholesale_delivery_fee=0.8）', Number(prow.worker_wholesale_delivery_fee) === 0.8, String(prow.worker_wholesale_delivery_fee));
  check('蛇形值正确落库（worker_machine_delivery_fee=0.6）', Number(prow.worker_machine_delivery_fee) === 0.6, String(prow.worker_machine_delivery_fee));

  // 驼峰 + 短别名更新（vendingPrice→machine_price、workerStationDeliveryFee→worker_wholesale_delivery_fee）
  const updated = await call(`/products/${pid}`, {
    method: 'PUT',
    body: JSON.stringify({ vendingPrice: 99, workerStationDeliveryFee: 88, purchasePrice: 11 })
  });
  check('驼峰/短别名更新成功', updated.code === 200, JSON.stringify(updated));
  const [[prow2]] = await pool.query('SELECT purchase_price, machine_price, worker_wholesale_delivery_fee FROM products WHERE product_id = ?', [pid]);
  check('purchasePrice 落库=11', Number(prow2.purchase_price) === 11, String(prow2.purchase_price));
  check('vendingPrice 别名落库 machine_price=99', Number(prow2.machine_price) === 99, String(prow2.machine_price));
  check('workerStationDeliveryFee 别名落库=88', Number(prow2.worker_wholesale_delivery_fee) === 88, String(prow2.worker_wholesale_delivery_fee));

  // ===== 2. inventory：蛇形入库 → 驼峰作废 =====
  console.log('\n[接口] 库存 — 蛇形入库 / 驼峰作废');
  const balAfterIn = balBefore - 41.5;
  const inRes = await call('/inventory/in', {
    method: 'POST',
    body: JSON.stringify({
      product_id: pid,
      quantity: 5,
      unit_price: 8.3,
      supplier_id: null,
      account_id: acc.accountId,
      remark: 'D7冒烟蛇形入库'
    })
  });
  check('蛇形 body 入库成功', inRes.code === 200, JSON.stringify(inRes));
  check('蛇形 account_id 正确扣款 41.5', Math.abs((await balanceOf(acc.accountId)) - balAfterIn) < 0.001,
    `期望 ${balAfterIn}，实际 ${await balanceOf(acc.accountId)}`);
  const [[lastPurchase]] = await pool.query(
    'SELECT purchase_id, total_amount FROM purchase_records WHERE product_id = ? ORDER BY created_at DESC LIMIT 1', [pid]);
  check('unit_price=8.3 计入入库单 41.5', Number(lastPurchase.total_amount) === 41.5, String(lastPurchase.total_amount));

  const stockBeforeVoid = await (async () => {
    const [[r]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [pid]);
    return Number(r.quantity);
  })();
  const voidRes = await call(`/inventory/purchases/${lastPurchase.purchase_id}/void`, {
    method: 'POST',
    body: JSON.stringify({ voidReason: 'D7冒烟作废' })
  });
  check('驼峰 voidReason 作废成功', voidRes.code === 200, JSON.stringify(voidRes));
  const [[invAfter]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [pid]);
  check('作废后库存回退', Number(invAfter.quantity) === stockBeforeVoid - 5, `${stockBeforeVoid} → ${invAfter.quantity}`);
  const balRestored = await balanceOf(acc.accountId);
  check('余额退回到账（回到入库前）', Math.abs(balRestored - balBefore) < 0.001, `期望 ${balBefore}，实际 ${balRestored}`);

  // ===== 3. waterTicket：蛇形发行 =====
  console.log('\n[接口] 水票 — 蛇形发行');
  const [stations] = await pool.query('SELECT station_id FROM sub_stations LIMIT 1');
  if (stations.length) {
    const sid = stations[0].station_id;
    const issueRes = await call('/water-tickets/issue', {
      method: 'POST',
      body: JSON.stringify({
        station_id: sid,
        month: '2099-01',
        items: [{ product_id: pid, quantity: 3, distribution_delivery_fee: 2.5 }]
      })
    });
    check('蛇形 body 发行成功', issueRes.code === 200, JSON.stringify(issueRes));
    const [rows] = await pool.query(
      'SELECT quantity, distribution_delivery_fee FROM water_ticket_issuance WHERE station_id = ? AND product_id = ? AND month = ?',
      [sid, pid, '2099-01']);
    check('蛇形 items 正确落库（qty=3, fee=2.5）',
      rows.length === 1 && Number(rows[0].quantity) === 3 && Number(rows[0].distribution_delivery_fee) === 2.5,
      JSON.stringify(rows));
  } else {
    console.log('  ⚠️ 无水站数据，跳过水票发行断言');
  }

  // ===== 4. machineSales：蛇形明细 =====
  console.log('\n[接口] 机台销量 — 蛇形明细');
  const [machines] = await pool.query('SELECT machine_id FROM machine_stations LIMIT 1');
  if (machines.length) {
    const msRes = await call('/finance/machine-sales', {
      method: 'POST',
      body: JSON.stringify({
        machineId: machines[0].machine_id,
        saleDate: '2099-01-01',
        items: [{ product_id: pid, quantity: 2, sale_price: 7.7 }]
      })
    });
    check('蛇形明细录入成功', msRes.code === 200, JSON.stringify(msRes));
    const [[ms]] = await pool.query(
      'SELECT quantity, sale_price FROM machine_sales WHERE product_id = ? AND sale_date = ? ORDER BY created_at DESC LIMIT 1', [pid, '2099-01-01']);
    check('蛇形 sale_price 正确落库=7.7', ms && Number(ms.sale_price) === 7.7 && Number(ms.quantity) === 2, JSON.stringify(ms));
  } else {
    console.log('  ⚠️ 无机台数据，跳过机台销量断言');
  }

  // ===== 清理 =====
  console.log('\n[清理] 测试数据');
  try {
    await pool.query('DELETE FROM machine_sales WHERE product_id = ? AND sale_date = ?', [pid, '2099-01-01']);
    await pool.query('DELETE FROM water_ticket_issuance WHERE product_id = ? AND month = ?', [pid, '2099-01']);
    await pool.query('DELETE FROM stock_out_records WHERE product_id = ?', [pid]).catch(() => {});
    await pool.query('DELETE FROM finance_transactions WHERE related_id = ?', [lastPurchase.purchase_id]);
    await pool.query('DELETE FROM purchase_records WHERE product_id = ?', [pid]);
    await pool.query('DELETE FROM inventory WHERE product_id = ?', [pid]);
    await pool.query('DELETE FROM products WHERE product_id = ?', [pid]);
    console.log('  ✅ 已清理临时商品及关联记录');
  } catch (e) {
    console.log('  ⚠️ 清理部分失败（不影响断言）：' + e.message);
  }

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

async function db() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory'
  });
}

unitTests();
main().catch((e) => { console.error('冒烟执行失败:', e); process.exitCode = 1; });

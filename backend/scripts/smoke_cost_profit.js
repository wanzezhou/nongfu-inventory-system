// 端到端验证：成本统计（需求 4）+ 利润统计（需求 6）
// 覆盖：成本 by-type / overview / machine / order-lines；利润 by-type / overview / 机台；
//       类型2 拆利润1/2；机台口径；非法类型 400；未鉴权 401。
// 自建临时数据（SMK* 商品 / SMKST* 水站），收尾由 cleanupSmokeResidue 统一清理。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = 'http://127.0.0.1:3000/api';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra)?.slice(0, 300) : '')); }
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function req(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload = null;
    if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let s = '';
      res.on('data', (c) => s += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(s); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function waitHealth(retries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      req('GET', '/orders?page=1&pageSize=1')
        .then((r) => { if (r.status === 200 || r.json?.code === 401) resolve(); else throw new Error('not ready'); })
        .catch(() => { if (++n >= retries) return reject(new Error('后端未就绪')); setTimeout(tick, 500); });
    };
    tick();
  });
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4'
  });

  const suffix = Date.now().toString().slice(-6);
  const PROD_ID = 'SMKP' + suffix;
  const PROD_CODE = 'SMKCP' + suffix;
  const STATION_ID = 'SMKST' + suffix;
  const ORDER_TAG = '冒烟成本利润';
  let server = null;

  try {
    // —— 自建商品 + 水站（避免依赖真实数据）——
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, total_delivery_fee, status, created_at, updated_at)
       VALUES (?, ?, ?, '550ml', '瓶', 1.20, 8.00, 20.00, 0.50, 1, NOW(), NOW())`,
      [PROD_ID, PROD_CODE, '冒烟成本利润测试商品' + suffix]
    );
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, status, created_at, updated_at)
       VALUES (?, ?, '冒烟', '13900000000', '冒烟地址', 1, NOW(), NOW())`,
      [STATION_ID, '冒烟成本利润测试水站' + suffix]
    );
    // —— 自建库存（建单要求商品有库存记录，否则报「商品库存不存在」）——
    await pool.query(
      `INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 1000, NOW())`,
      [PROD_ID]
    );

    const [workers] = await pool.query('SELECT worker_id FROM workers WHERE status=1 LIMIT 1');
    const worker = workers[0];
    if (!worker) throw new Error('库内无可用员工，无法建单');

    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'app.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});
    await waitHealth();

    const login = await req('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
    const token = login.json?.data?.token || login.json?.data?.accessToken;
    ok('管理员登录成功并取得 token', !!token, JSON.stringify(login.json).slice(0, 160));
    if (!token) throw new Error('无法登录，后续用例跳过');

    // —— 建一张类型1 订单：营收=(进货价+总包配送费)×qty；成本=(进货价+工人零售配送费)×qty ——
    const qty = 3;
    const c1 = await req('POST', '/orders', { token, body: {
      orderType: 1, customerName: ORDER_TAG + '客户', customerPhone: '13911112222',
      customerAddress: '冒烟地址', deliveryMethod: 1, deliveryStaffId: worker.worker_id,
      items: [{ productId: PROD_ID, quantity: qty }]
    } });
    ok('创建类型1 订单 code=200', c1.json?.code === 200, c1.json);
    const oid = c1.json?.data?.id || c1.json?.data?.orderNo;
    if (!oid) throw new Error('未取得订单号，后续用例跳过');

    const [it] = await pool.query('SELECT purchase_price, worker_retail_delivery_fee FROM order_items WHERE order_id=?', [oid]);
    const expectCost = round2((Number(it[0].purchase_price) + Number(it[0].worker_retail_delivery_fee)) * qty);
    const expectRev = round2((1.20 + 0.50) * qty);

    // —— 成本 by-type ——
    const cost1 = await req('GET', '/cost/by-type?orderType=1&range=month', { token });
    ok('成本 by-type code=200', cost1.json?.code === 200, cost1.json);
    ok(`成本 by-type 汇总 ≥ 本单成本 ${expectCost}`, cost1.json?.code === 200 && Number(cost1.json.data.summary.costTotal) >= expectCost, cost1.json?.data?.summary);
    const row1 = cost1.json?.data?.list?.find((x) => x.orderId === oid);
    ok('成本明细含本单且金额正确', row1 && Number(row1.costTotal) === expectCost, row1);

    // —— 成本 overview ——
    const ov = await req('GET', '/cost/overview?range=month', { token });
    ok('成本 overview code=200', ov.json?.code === 200, ov.json);
    ok('overview 含 6 个订单类型', ov.json?.data?.list?.length === 6, ov.json?.data?.list?.length);
    ok('overview 订单成本合计 > 0', Number(ov.json?.data?.orderCostTotal) > 0, ov.json?.data?.orderCostTotal);

    // —— 机台成本 ——
    const mc = await req('GET', '/cost/machine?machineType=1&range=month', { token });
    ok('机台成本(量贩机) code=200', mc.json?.code === 200, mc.json);
    ok('机台成本返回口径说明 label', !!mc.json?.data?.label?.main, mc.json?.data?.label);

    // —— 成本明细行（展开行按订单懒加载）——
    const lines = await req('GET', '/cost/order-lines?orderId=' + oid, { token });
    ok('成本明细行 code=200', lines.json?.code === 200, lines.json);
    ok('明细行成本正确', Number(lines.json?.data?.list?.[0]?.costTotal) === expectCost, lines.json?.data?.list);

    // —— 利润 by-type（类型1）——
    const p1 = await req('GET', '/profit/by-type?orderType=1&range=month', { token });
    ok('利润 by-type code=200', p1.json?.code === 200, p1.json);
    const prow = p1.json?.data?.list?.find((x) => x.orderId === oid);
    ok(`利润明细 营收=${expectRev} 成本=${expectCost} 利润=${round2(expectRev - expectCost)}`,
      prow && Number(prow.revenue) === expectRev && Number(prow.costTotal) === expectCost && Number(prow.profitTotal) === round2(expectRev - expectCost), prow);

    // —— 利润 overview ——
    const po = await req('GET', '/profit/overview?range=month', { token });
    ok('利润 overview code=200', po.json?.code === 200, po.json);
    ok('利润 overview 含 6 个订单类型', po.json?.data?.list?.length === 6, po.json?.data?.list?.length);
    ok('overall.profit = revenue - costTotal',
      po.json?.data?.overall && round2(po.json.data.overall.revenue - po.json.data.overall.costTotal) === round2(po.json.data.overall.profit),
      po.json?.data?.overall);
    const t2row = po.json?.data?.list?.find((x) => Number(x.orderType) === 2);
    ok('类型2 含 profit1/profit2 拆分字段', t2row && 'profit1' in t2row && 'profit2' in t2row, t2row);

    // —— 利润 by-type 机台（整体差额，无订单明细）——
    const p4 = await req('GET', '/profit/by-type?orderType=4&range=month', { token });
    ok('利润 by-type 机台(4) code=200', p4.json?.code === 200, p4.json);
    ok('机台利润 profit = revenue - costTotal',
      p4.json?.data?.summary && round2(p4.json.data.summary.revenue - p4.json.data.summary.costTotal) === round2(p4.json.data.summary.profit),
      p4.json?.data?.summary);

    // —— 非法类型被拦 ——
    const bad = await req('GET', '/cost/by-type?orderType=99&range=month', { token });
    ok('非法订单类型返回 400', bad.json?.code === 400, bad.json);

    // —— 未鉴权被拦 ——
    const noAuth = await req('GET', '/profit/overview?range=month');
    ok('未鉴权请求被拦（code=401）', noAuth.json?.code === 401, noAuth.json);

  } catch (err) {
    console.error('!! 用例执行异常：' + (err && err.stack || err));
    fail++;
  } finally {
    try {
      const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
      await cleanupSmokeResidue(pool);
    } catch (e) {
      console.error('!! 统一清理异常：' + e.message);
    }
    let cleanupOk = true;
    try {
      // 营收入账流水先回冲，再删单
      const [txs] = await pool.query("SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module='order_revenue'");
      for (const t of txs) {
        await pool.query('UPDATE finance_accounts SET current_balance = current_balance - ? WHERE account_id = ?', [Number(t.amount), t.account_id]);
        await pool.query('DELETE FROM finance_transactions WHERE tx_id = ?', [t.tx_id]);
      }
      const [ords] = await pool.query(`SELECT order_id FROM orders WHERE customer_name LIKE '${ORDER_TAG}%'`);
      for (const o of ords) {
        await pool.query('DELETE FROM order_items WHERE order_id = ?', [o.order_id]);
        await pool.query('DELETE FROM orders WHERE order_id = ?', [o.order_id]);
      }
      await pool.query('DELETE FROM order_items WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM inventory WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM products WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM sub_stations WHERE station_id = ?', [STATION_ID]);
      console.log(`  清理：回冲流水 ${txs.length} 条 / 订单 ${ords.length} 张`);
    } catch (e) {
      cleanupOk = false;
      console.error('!! 清理失败：' + e.message);
    }
    const [residue] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM products WHERE product_id=?) pd,
              (SELECT COUNT(*) FROM sub_stations WHERE station_id=?) ss,
              (SELECT COUNT(*) FROM orders WHERE customer_name LIKE '${ORDER_TAG}%') od,
              (SELECT COUNT(*) FROM finance_transactions WHERE related_module='order_revenue') tx`,
      [PROD_ID, STATION_ID]
    );
    const left = Object.values(residue[0]).reduce((s, v) => s + Number(v), 0);
    if (left === 0 && cleanupOk) console.log('\n清理完成：无残留 ✓');
    else console.log('!! 清理异常：残留 ' + left + ' 条，请人工核查');

    if (server) { try { server.kill('SIGKILL'); } catch (e) { /* ignore */ } }
    await pool.end();

    console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('脚本异常：' + e.message);
  process.exit(1);
});

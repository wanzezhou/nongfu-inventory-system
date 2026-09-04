// 验证小程序订单接口链路：detail 结构 + create 校验（无副作用）
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const http = require('http');

function httpReq(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ statusCode: res.statusCode, raw: chunks }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const TEST_USER = 'smoke_flow_admin';
  const TEST_PASS = 'admin123';
  try {
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    const passwordHash = await bcrypt.hash(TEST_PASS, 10);
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES (CONCAT('smoke_flow_', UNIX_TIMESTAMP(NOW())), '13900000007', 'admin', '1', 1, ?, ?, NOW())`, [TEST_USER, passwordHash]);

    const login = await httpReq('/mini/auth/password-login', 'POST', { username: TEST_USER, password: TEST_PASS });
    const token = login.body && login.body.data && login.body.data.token;
    console.log('login:', login.body && login.body.code, token ? 'token OK' : 'NO TOKEN');
    if (!token) process.exit(1);

    // 1) 商品列表（create 选择商品用）
    const pr = await httpReq('/mini/orders/products', 'GET', null, token);
    const products = pr.body && pr.body.data || [];
    console.log('products: code=', pr.body.code, 'count=', products.length);
    if (products.length > 0) {
      const p = products[0];
      console.log('product 字段:', JSON.stringify({ id: p.id, name: p.name, retailPrice: p.retailPrice, stock: p.stock, workerRetailDeliveryFee: p.workerRetailDeliveryFee }));
    }

    // 2) 水站列表
    const st = await httpReq('/mini/orders/stations', 'GET', null, token);
    console.log('stations: code=', st.body.code, 'count=', (st.body.data || []).length);

    // 3) 员工列表
    const wk = await httpReq('/mini/orders/workers', 'GET', null, token);
    console.log('workers: code=', wk.body.code, 'count=', (wk.body.data || []).length);

    // 4) create 参数校验（空 body 应 400）
    const bad = await httpReq('/mini/orders', 'POST', {}, token);
    console.log('create 空body: code=', bad.body && bad.body.code, 'msg=', bad.body && bad.body.message, bad.body.code === 400 ? '✅' : '❌');

    // 5) create 越权校验（worker 不允许 type=2，用 admin 全角色反而允许，改测缺参：无订单类型）
    const bad2 = await httpReq('/mini/orders', 'POST', { customerName: '测试', items: [{ productId: 'xxx', quantity: 1 }] }, token);
    console.log('create 缺订单类型: code=', bad2.body && bad2.body.code, 'msg=', bad2.body && bad2.body.message, bad2.body.code === 400 ? '✅' : '❌');

    // 6) detail（使用现有订单验证结构）
    const d = await httpReq('/mini/orders/SZX2026081100005', 'GET', null, token);
    const od = d.body && d.body.data;
    console.log('detail: code=', d.body && d.body.code, 'orderNo=', od && od.orderNo);
    if (od) {
      console.log('detail 字段: orderTypeText=', od.orderTypeText, '| totalAmount=', od.totalAmount, '| items=', (od.items || []).length);
      if (od.items && od.items.length > 0) {
        const it = od.items[0];
        const hasAll = it.productId && it.productName && it.quantity !== undefined && it.unitPrice !== undefined && it.subtotal !== undefined && it.workerWholesaleDeliveryFee !== undefined;
        console.log('item 字段完整:', hasAll ? '✅' : '❌', JSON.stringify(it));
      }
    }

    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    console.log('已清理');

    const ok = pr.body.code === 200 && st.body.code === 200 && wk.body.code === 200
      && bad.body.code === 400 && bad2.body.code === 400 && d.body.code === 200;
    console.log('最终结论:', ok ? '✅ 订单接口链路正常' : '❌ 异常');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('异常:', e.message);
    process.exit(1);
  }
}

main();

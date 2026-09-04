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
  const TEST_USER = 'smoke_order_admin';
  const TEST_PASS = 'admin123';
  try {
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    const passwordHash = await bcrypt.hash(TEST_PASS, 10);
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES (CONCAT('smoke_order_', UNIX_TIMESTAMP(NOW())), '13900000006', 'admin', '1', 1, ?, ?, NOW())`, [TEST_USER, passwordHash]);

    const login = await httpReq('/mini/auth/password-login', 'POST', { username: TEST_USER, password: TEST_PASS });
    const token = login.body && login.body.data && login.body.data.token;
    console.log('login:', login.body && login.body.code, token ? 'token OK' : 'NO TOKEN');
    if (!token) process.exit(1);

    // 1) 列表不带 status
    const r1 = await httpReq('/mini/orders?page=1&pageSize=5', 'GET', null, token);
    console.log('GET /mini/orders:', r1.statusCode, 'code=', r1.body && r1.body.code, 'total=', r1.body && r1.body.data && r1.body.data.total);

    // 2) 列表带 status=0
    const r2 = await httpReq('/mini/orders?page=1&pageSize=5&status=0', 'GET', null, token);
    const list2 = r2.body && r2.body.data && r2.body.data.list || [];
    const allZero = list2.every(o => o.orderStatus === 0);
    console.log('GET /mini/orders?status=0: code=', r2.body && r2.body.code, 'count=', list2.length, '全部status=0?', allZero ? '✅' : '❌');

    // 3) 列表带 status=2
    const r3 = await httpReq('/mini/orders?page=1&pageSize=5&status=2', 'GET', null, token);
    const list3 = r3.body && r3.body.data && r3.body.data.list || [];
    const allTwo = list3.every(o => o.orderStatus === 2);
    console.log('GET /mini/orders?status=2: code=', r3.body && r3.body.code, 'count=', list3.length, '全部status=2?', allTwo ? '✅' : '❌');

    // 4) 检查列表项字段
    if (list2.length > 0) {
      const f = list2[0];
      console.log('列表项字段示例:', JSON.stringify({ orderNo: f.orderNo, orderTypeText: f.orderTypeText, customerName: f.customerName, totalAmount: f.totalAmount, createdAt: f.createdAt }));
    }

    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    console.log('已清理');

    const ok = r1.body.code === 200 && r2.body.code === 200 && allZero && allTwo;
    console.log('最终结论:', ok ? '✅ status 筛选正常' : '❌ 异常');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('异常:', e && e.message ? e.message : JSON.stringify(e));
    if (e && e.stack) console.error('STACK:', e.stack.split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }
}

main();

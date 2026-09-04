require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const http = require('http');

function httpReq(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
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
  const TEST_USER = 'smoke_dash_admin';
  const TEST_PASS = 'admin123';
  try {
    console.log('=== Step A: 准备 admin 测试账号 ===');
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    const passwordHash = await bcrypt.hash(TEST_PASS, 10);
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES (CONCAT('smoke_dash_', UNIX_TIMESTAMP(NOW())), '13900000005', 'admin', '1', 1, ?, ?, NOW())`, [TEST_USER, passwordHash]);
    console.log('测试账号已插入');

    console.log('');
    console.log('=== Step B: password-login 获取 token ===');
    const login = await httpReq('/mini/auth/password-login', 'POST', { username: TEST_USER, password: TEST_PASS });
    console.log('login code:', login.body && login.body.code, 'message:', login.body && login.body.message);
    const token = login.body && login.body.data && login.body.data.token;
    if (!token) { console.log('❌ 获取 token 失败'); process.exit(1); }
    console.log('token 获取成功:', token.slice(0, 30) + '...');

    console.log('');
    console.log('=== Step C: GET /mini/dashboard (admin) ===');
    const dash = await httpReq('/mini/dashboard', 'GET', null, token);
    console.log('HTTP Status:', dash.statusCode);
    console.log('code:', dash.body && dash.body.code);
    const data = dash.body && dash.body.data || {};
    console.log('role:', data.role);
    console.log('todayOrders:', data.todayOrders, '| todaySales:', data.todaySales);
    console.log('pendingDelivery:', data.pendingDelivery, '| pendingApprovals:', data.pendingApprovals);
    console.log('recentOrders 数量:', Array.isArray(data.recentOrders) ? data.recentOrders.length : 0);
    if (Array.isArray(data.recentOrders) && data.recentOrders.length > 0) {
      const first = data.recentOrders[0];
      console.log('recentOrders[0] 字段:', JSON.stringify(first, null, 2));
      const hasOrderNo = first.orderNo !== undefined && first.orderNo !== null && first.orderNo !== '';
      console.log('orderNo 字段验证:', hasOrderNo ? '✅ PASS' : '❌ FAIL');
    } else {
      console.log('orderNo 字段验证: ⚠️ 无最近订单（无法验证，接口本身正常）');
    }

    console.log('');
    console.log('=== Step D: 清理 ===');
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    console.log('测试数据已清理');

    const apiOK = dash.statusCode === 200 && dash.body.code === 200 && data.role === 'admin';
    console.log('');
    console.log('最终结论:', apiOK ? '✅ dashboard 接口正常' : '❌ 接口异常');
    process.exit(apiOK ? 0 : 1);
  } catch (e) {
    console.error('异常:', e.message);
    process.exit(1);
  }
}

main();

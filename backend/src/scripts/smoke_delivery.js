// 验证小程序配送模块接口：pending/mine/upload-photo/assign 校验
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
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

// multipart 上传（用 Node 22 内置 fetch + FormData）
function uploadFile(path, token, buf, filename) {
  const form = new FormData();
  form.append('file', new Blob([buf]), filename);
  return fetch('http://localhost:3000' + path, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: form
  }).then(async (res) => ({ statusCode: res.status, body: await res.json() }));
}

async function main() {
  const TEST_USER = 'smoke_delivery_admin';
  const TEST_PASS = 'admin123';
  try {
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    const passwordHash = await bcrypt.hash(TEST_PASS, 10);
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES (CONCAT('smoke_del_', UNIX_TIMESTAMP(NOW())), '13900000008', 'admin', '1', 1, ?, ?, NOW())`, [TEST_USER, passwordHash]);

    const login = await httpReq('/mini/auth/password-login', 'POST', { username: TEST_USER, password: TEST_PASS });
    const token = login.body && login.body.data && login.body.data.token;
    console.log('login:', login.body && login.body.code, token ? 'token OK' : 'NO TOKEN');
    if (!token) process.exit(1);

    // 1) 待接单列表
    const p = await httpReq('/mini/delivery/pending', 'GET', null, token);
    console.log('pending: code=', p.body && p.body.code, 'count=', p.body && p.body.data && p.body.data.list ? p.body.data.list.length : 0);
    if (p.body.data && p.body.data.list && p.body.data.list.length > 0) {
      const f = p.body.data.list[0];
      console.log('pending[0]:', JSON.stringify({ orderId: f.orderId, customerName: f.customerName, deliveryFee: f.deliveryFee }));
    }

    // 2) 我的配送列表（分页结构）
    const m = await httpReq('/mini/delivery/mine?page=1&pageSize=5', 'GET', null, token);
    console.log('mine: code=', m.body && m.body.code, 'total=', m.body && m.body.data && m.body.data.total, 'list=', m.body && m.body.data && m.body.data.list ? m.body.data.list.length : 0);
    const mP = await httpReq('/mini/delivery/mine?status=pending', 'GET', null, token);
    const mpList = mP.body && mP.body.data && mP.body.data.list || [];
    const allOk = mpList.every(o => o.orderStatus === 1);
    console.log('mine?status=pending: count=', mpList.length, '全部status=1?', allOk ? '✅' : '❌');

    // 3) 上传照片
    // 1x1 透明 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await uploadFile('/mini/delivery/upload-photo', token, png, 'test_delivery.png');
    console.log('upload-photo: code=', up.body && up.body.code, 'url=', up.body && up.body.data && up.body.data.url, up.body && up.body.code === 200 ? '✅' : '❌');
    const imgUrl = up.body && up.body.data && up.body.data.url;
    if (imgUrl) {
      const stat = await fetch('http://localhost:3000' + imgUrl);
      console.log('静态访问 ' + imgUrl + ': status=', stat.status, stat.status === 200 ? '✅' : '❌');
    }

    // 4) assign 缺参数校验
    const as = await httpReq('/mini/delivery/assign', 'POST', {}, token);
    console.log('assign 缺参: code=', as.body && as.body.code, 'msg=', as.body && as.body.message, as.body.code === 400 ? '✅' : '❌');

    // 清理测试账号
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    console.log('已清理测试账号');

    const ok = p.body.code === 200 && m.body.code === 200 && mP.body.code === 200 && allOk
      && up.body.code === 200 && as.body.code === 400;
    console.log('最终结论:', ok ? '✅ 配送模块接口正常' : '❌ 异常');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('异常:', e.message);
    process.exit(1);
  }
}

main();

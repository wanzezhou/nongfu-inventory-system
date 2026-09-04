require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const http = require('http');

function httpPost(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
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
    req.write(body);
    req.end();
  });
}

async function main() {
  const TEST_USER = 'test_admin_login';
  const TEST_PASS = 'admin123';
  const WRONG_PASS = 'wrongpwd';
  try {
    console.log('=== Step A: 清理残留测试数据 + 插入测试账号（bcrypt 哈希） ===');
    await pool.query("DELETE FROM mini_accounts WHERE username IN (?)", [TEST_USER]);

    const passwordHash = await bcrypt.hash(TEST_PASS, 10);
    const openid = 'test_placeholder_login_' + Date.now();
    await pool.query(`
      INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES (?, '13900000002', 'admin', '1', 1, ?, ?, NOW())
    `, [openid, TEST_USER, passwordHash]);
    console.log('测试账号插入成功: username=', TEST_USER, 'password=', TEST_PASS);

    console.log('');
    console.log('=== Step B: 正确密码登录 (期望 code=200, 含 token) ===');
    const respOK = await httpPost('/mini/auth/password-login', { username: TEST_USER, password: TEST_PASS });
    console.log('HTTP Status:', respOK.statusCode);
    console.log('Body:', JSON.stringify(respOK.body, null, 2));
    const passOK = respOK.statusCode === 200 && respOK.body && respOK.body.code === 200 && respOK.body.data && respOK.body.data.token;
    console.log('Result: ' + (passOK ? '✅ PASS（正确密码返回200+token）' : '❌ FAIL'));

    console.log('');
    console.log('=== Step C: 错误密码登录 (期望 body.code=400, message=账号或密码错误) ===');
    const respFail = await httpPost('/mini/auth/password-login', { username: TEST_USER, password: WRONG_PASS });
    console.log('HTTP Status:', respFail.statusCode);
    console.log('Body:', JSON.stringify(respFail.body, null, 2));
    const failOK = respFail.body && (respFail.body.code === 400 || respFail.body.code === 404) && /账号或密码错误/.test(respFail.body.message);
    console.log('Result: ' + (failOK ? '✅ PASS（错误密码返回明确错误）' : '❌ FAIL'));

    console.log('');
    console.log('=== Step D: 空账号/空密码参数校验 (期望 message=请输入账号和密码) ===');
    const respEmpty = await httpPost('/mini/auth/password-login', { username: '', password: '' });
    console.log('HTTP Status:', respEmpty.statusCode);
    console.log('Body:', JSON.stringify(respEmpty.body, null, 2));
    const emptyOK = respEmpty.body && respEmpty.body.code === 400 && /请输入账号和密码/.test(respEmpty.body.message);
    console.log('Result: ' + (emptyOK ? '✅ PASS（空参校验通过）' : '❌ FAIL'));

    console.log('');
    console.log('=== Step E: 账号未设置密码 (期望 message=该账号未设置密码...) ===');
    const NO_PASS_USER = 'test_no_pass';
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [NO_PASS_USER]);
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, username, password_hash, created_at)
      VALUES ('test_no_pass_${Date.now()}', '13900000003', 'admin', '1', 1, ?, NULL, NOW())`, [NO_PASS_USER]);
    const respNoPwd = await httpPost('/mini/auth/password-login', { username: NO_PASS_USER, password: TEST_PASS });
    console.log('HTTP Status:', respNoPwd.statusCode);
    console.log('Body:', JSON.stringify(respNoPwd.body, null, 2));
    const noPwdOK = respNoPwd.body && respNoPwd.body.code === 400 && /未设置密码/.test(respNoPwd.body.message);
    console.log('Result: ' + (noPwdOK ? '✅ PASS（无密码哈希账号拒绝登录）' : '❌ FAIL'));
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [NO_PASS_USER]);

    console.log('');
    await pool.query("DELETE FROM mini_accounts WHERE username = ?", [TEST_USER]);
    console.log('已清理测试数据');
    process.exit(passOK && failOK && emptyOK && noPwdOK ? 0 : 1);
  } catch (e) {
    console.error('smoke-test 异常：', e.message);
    process.exit(1);
  }
}

main();

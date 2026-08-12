// 幂等创建联调测试账号：salesmen 测试业务员1 + mini_accounts 4 角色绑定
// 登录方式：账号密码（username + password，密码统一 123456）
// 角色账号: admin / worker / station / salesman
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const PWD = '123456';

// 各角色绑定目标（基于现有业务表数据）
const BINDS = [
  { username: 'admin',    phone: '13900000001', role: 'admin',    targetId: '1',                  openid: 'seed_admin' },
  { username: 'worker',   phone: '111111111',    role: 'worker',   targetId: 'W17851563703197234', openid: 'seed_worker' },
  { username: 'station',  phone: '1234567890',   role: 'station',  targetId: 'S17853284880312262', openid: 'seed_station' }
];

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory'
  });

  // 1. 测试业务员 1（手机 13900000004）
  const [existSales] = await pool.query('SELECT salesman_id FROM salesmen WHERE phone = ?', ['13900000004']);
  let salesmanId;
  if (existSales.length > 0) {
    salesmanId = existSales[0].salesman_id;
    console.log('测试业务员已存在: ' + salesmanId);
  } else {
    salesmanId = 'SM' + Date.now();
    await pool.query(
      'INSERT INTO salesmen (salesman_id, salesman_name, phone, commission_rate, status, created_at, updated_at) VALUES (?, ?, ?, 0.03, 1, NOW(), NOW())',
      [salesmanId, '测试业务员1', '13900000004']
    );
    console.log('测试业务员1 已创建: ' + salesmanId);
  }
  BINDS.push({ username: 'salesman', phone: '13900000004', role: 'salesman', targetId: salesmanId, openid: 'seed_salesman' });

  // 2. mini_accounts 4 角色绑定（username 唯一幂等）
  const hash = bcrypt.hashSync(PWD, 10);
  for (const b of BINDS) {
    await pool.query(
      `INSERT INTO mini_accounts (openid, username, password_hash, phone, role, target_id, status, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         phone = VALUES(phone),
         role = VALUES(role),
         target_id = VALUES(target_id),
         status = 1`,
      [b.openid, b.username, hash, b.phone, b.role, b.targetId]
    );
    console.log(`绑定 OK: ${b.role} (${b.username}) -> ${b.targetId}`);
  }

  // 3. 校验
  const [rows] = await pool.query(
    'SELECT username, role, target_id, phone, (password_hash IS NOT NULL) AS hasPwd FROM mini_accounts WHERE username IN (?,?,?,?)',
    ['admin', 'worker', 'station', 'salesman']
  );
  console.log('== mini_accounts 校验 ==');
  console.log(JSON.stringify(rows, null, 1));

  await pool.end();
  console.log('完成。登录密码: ' + PWD);
}

main().catch(e => { console.error(e.message); process.exit(1); });

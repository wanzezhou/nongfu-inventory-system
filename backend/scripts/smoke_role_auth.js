/**
 * 冒烟测试：P1-S4 角色鉴权（requireAdmin）
 * 场景：临时 staff 用户 → 资金账户变更类接口 403、读取类 200、作废入库单 403
 *      admin 全部正常 → 清理临时用户
 * 运行：node scripts/smoke_role_auth.js（需后端已启动）
 */
const BASE = 'http://localhost:3000/api';

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
const assert = (cond, name) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
};

(async () => {
  const { pool } = require('../src/config/db');
  const bcrypt = require('bcryptjs');

  // 创建临时 staff 用户
  const uname = `smoke_staff_${Date.now()}`;
  const hash = await bcrypt.hash('Staff123456', 10);
  await pool.query(
    "INSERT INTO users (username, password, display_name, role) VALUES (?, ?, '冒烟临时员工', 'staff')",
    [uname, hash]
  );

  try {
    const staffLogin = await call('POST', '/auth/login', { username: uname, password: 'Staff123456' });
    assert(staffLogin.data?.token, 'staff 用户登录');
    const staffToken = staffLogin.data.token;
    assert(staffLogin.data.user?.role === 'staff', 'staff 角色正确');

    const adminLogin = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    const adminToken = adminLogin.data.token;
    assert(!!adminToken, 'admin 登录');

    // 读取类：staff 可用
    const list = await call('GET', '/finance-accounts', null, staffToken);
    assert(list.code === 200, 'staff 可读取账户列表');

    // 变更类：staff 全部 403
    const create = await call('POST', '/finance-accounts', { accountName: '冒烟账户', accountType: 7, initialBalance: 0 }, staffToken);
    assert(create.code === 403, `staff 新建账户被拒(403): ${create.code}`);
    const adj = await call('POST', '/finance-accounts/1/adjust', { amount: 1, remark: 'smoke' }, staffToken);
    assert(adj.code === 403, `staff 调账被拒(403): ${adj.code}`);
    const transfer = await call('POST', '/finance-accounts/transfer', { fromAccountId: 1, toAccountId: 2, amount: 1 }, staffToken);
    assert(transfer.code === 403, `staff 转账被拒(403): ${transfer.code}`);

    // 作废入库单：staff 403（用一个不存在的单号即可验证权限层拦截）
    const voidRes = await call('POST', '/inventory/purchases/PR_SMOKE_NOT_EXIST/void', { reason: 'smoke' }, staffToken);
    assert(voidRes.code === 403, `staff 作废入库单被拒(403): ${voidRes.code}`);

    // admin 正常
    const adminCreate = await call('POST', '/finance-accounts', { accountName: `冒烟账户${Date.now()}`, accountType: 7, initialBalance: 0 }, adminToken);
    assert(adminCreate.code === 200, `admin 新建账户正常: ${adminCreate.code} ${adminCreate.message || ''}`);
    if (adminCreate.data?.accountId) {
      await pool.query('DELETE FROM finance_accounts WHERE account_id = ?', [adminCreate.data.accountId]);
    } else {
      await pool.query("DELETE FROM finance_accounts WHERE account_name LIKE '冒烟账户%'");
    }

    // staff 可读流水（读取类不拦）
    const tx = await call('GET', '/finance-accounts/1/transactions?page=1&pageSize=1', null, staffToken);
    assert(tx.code === 200, 'staff 可读取账户流水');
  } finally {
    await pool.query('DELETE FROM users WHERE username = ?', [uname]);
    console.log('清理完成（临时 staff 用户已删除）');
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });

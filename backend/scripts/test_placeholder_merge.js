require('dotenv').config();
const { pool } = require('../src/config/db');

async function test() {
  try {
    console.log('=== Step A: 确保 users 表存在 ID=1 的记录（作为 admin 实体）===');
    const [users] = await pool.query('SELECT id, display_name, phone FROM users WHERE id = 1 LIMIT 1');
    if (users.length === 0) {
      console.log('插入一条测试 admin 记录到 users 表');
      await pool.query(`INSERT INTO users (id, username, display_name, password, role, status, phone)
        VALUES (1, 'test_admin', '测试管理员', 'placeholder', 'admin', 1, '13900000001')
        ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), phone=VALUES(phone)`);
    } else {
      console.log('已有 admin 记录：', users[0]);
      if (!users[0].phone) {
        await pool.query("UPDATE users SET phone = '13900000001' WHERE id = 1");
        console.log('已更新 phone=13900000001');
      }
    }

    console.log('');
    console.log('=== Step B: 模拟 PC 后台预创建占位 openid 记录 ===');
    await pool.query("DELETE FROM mini_accounts WHERE openid IN ('pc_placeholder_test', 'wx_real_openid_123')");
    await pool.query(`INSERT INTO mini_accounts (openid, phone, role, target_id, status, created_at)
      VALUES ('pc_placeholder_test', '13900000001', 'admin', '1', 1, NOW())`);
    const [beforeRows] = await pool.query("SELECT id, openid, phone, role, target_id, status FROM mini_accounts WHERE openid='pc_placeholder_test'");
    console.log('插入后的占位记录：', beforeRows[0]);

    console.log('');
    console.log('=== Step C: 模拟小程序 bindPhone 新逻辑（先按 role+target_id 查 → UPDATE）===');
    const role = 'admin';
    const targetId = '1';
    const realOpenid = 'wx_real_openid_123';
    const realPhone  = '13900000001';

    const [existingByTarget] = await pool.query(
      'SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? LIMIT 1',
      [role, targetId]
    );
    console.log('按 (role, target_id) 查询命中行数：', existingByTarget.length);

    if (existingByTarget.length > 0) {
      await pool.query(
        `UPDATE mini_accounts SET openid = ?, phone = ?, status = 1, last_login_at = NOW() WHERE id = ?`,
        [realOpenid, realPhone, existingByTarget[0].id]
      );
      console.log('已执行 UPDATE，id =', existingByTarget[0].id);
    } else {
      console.log('未命中（这是错误的，此测试应走 UPDATE 分支）');
    }

    console.log('');
    console.log('=== Step D: 验证结果 ===');
    const [oldRows] = await pool.query("SELECT id, openid FROM mini_accounts WHERE openid='pc_placeholder_test'");
    console.log('原占位 openid(pc_placeholder_test) 剩余记录数：', oldRows.length, '(期望 0)');

    const [newRows] = await pool.query("SELECT id, openid, phone, role, target_id, status FROM mini_accounts WHERE openid='wx_real_openid_123'");
    console.log('新 openid(wx_real_openid_123) 记录：', newRows[0]);
    console.log('记录总数变化：应该不变（1 → 1，UPDATE 而不是新增）');

    console.log('');
    console.log('=== 总结 ===');
    const ok = oldRows.length === 0 && newRows.length === 1 && newRows[0].target_id === '1' && newRows[0].role === 'admin';
    if (ok) {
      console.log('✅ placeholder 合并路径验证通过！已验证 UPDATE 路径确保只做一次记录（无重复）');
    } else {
      console.log('❌ 验证失败，请检查输出');
    }

    await pool.query("DELETE FROM mini_accounts WHERE openid IN ('pc_placeholder_test', 'wx_real_openid_123')");
    console.log('已清理测试数据');

    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('测试异常：', e.message);
    process.exit(1);
  }
}

test();

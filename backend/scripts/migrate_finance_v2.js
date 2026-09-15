// 幂等迁移：财务管理 V2 —— 账户体系重构（2026-09-15）
//
// 需求 2：将 5「可上单信用余额」/ 6「可上单折扣余额」/ 7「自有费用余额」
//         合并为「农夫上单账户」（类型 8）；新增「量贩机账户」(9)、「零售机账户」(10)。
// 方案（用户确认）：新建账户 + 停用旧三个（保留流水可追溯）；余额直接相加。
//
// 关键约束：旧三账户余额迁出后必须置 0，否则「余额 = 期初 + 流水净额」
//          恒等式在这些停用账户上不再成立（余额凭空多出来）。
//
// 幂等：按 account_id 判存在；已迁移过则跳过余额搬迁。
// 执行：cd backend && node scripts/migrate_finance_v2.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const OLD_IDS = ['ACCOUNT_CREDIT', 'ACCOUNT_DISCOUNT', 'ACCOUNT_FEE'];
const NEW_ACCOUNTS = [
  { id: 'ACCOUNT_NFSD', name: '农夫上单账户', type: 8, remark: '由「可上单信用余额/可上单折扣余额/自有费用余额」合并（2026-09-15）' },
  { id: 'ACCOUNT_BULK_MACHINE', name: '量贩机账户', type: 9, remark: '量贩机营收归集账户（2026-09-15）' },
  { id: 'ACCOUNT_RETAIL_MACHINE', name: '零售机账户', type: 10, remark: '零售机营收归集账户（2026-09-15）' }
];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4'
  });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // —— 0) 迁移前快照（用于核对与回滚参考） ——
    const [before] = await conn.query(
      `SELECT account_id, account_name, account_type, current_balance, status
       FROM finance_accounts WHERE account_id IN (?,?,?) ORDER BY account_type`,
      OLD_IDS
    );
    console.log('迁移前各账户余额：');
    before.forEach((r) =>
      console.log(`  ${r.account_id.padEnd(18)} ${r.account_name.padEnd(12)} 余额=${Number(r.current_balance).toFixed(2)} status=${r.status}`)
    );
    const mergedTotal = round2(before.reduce((s, r) => s + Number(r.current_balance), 0));
    console.log(`  合计（将并入农夫上单账户）= ${mergedTotal.toFixed(2)}`);

    // —— 1) 判断是否已迁移（农夫上单账户是否已存在） ——
    const [existNfsd] = await conn.query(
      `SELECT account_id, current_balance, status FROM finance_accounts WHERE account_id = 'ACCOUNT_NFSD'`
    );
    const alreadyMigrated = existNfsd.length > 0;

    if (alreadyMigrated) {
      console.log('\n[跳过] 农夫上单账户已存在，判定为已迁移 —— 不重复搬余额。');
    } else {
      // —— 2) 新建农夫上单账户，余额 = 三者之和 ——
      await conn.query(
        `INSERT INTO finance_accounts
           (account_id, account_name, account_type, bank_name, bank_account,
            initial_balance, current_balance, remark, status, created_at, updated_at)
         VALUES ('ACCOUNT_NFSD', '农夫上单账户', 8, NULL, NULL, ?, ?, ?, 1, NOW(), NOW())`,
        [mergedTotal, mergedTotal, NEW_ACCOUNTS[0].remark]
      );
      console.log(`\n已新建 ACCOUNT_NFSD 农夫上单账户，余额 = ${mergedTotal.toFixed(2)}`);

      // —— 3) 旧三账户余额清零 + 停用（保留流水可追溯） ——
      await conn.query(
        `UPDATE finance_accounts
         SET status = 0,
             current_balance = 0.00,
             remark = CONCAT(COALESCE(remark, ''), ' [已合并至农夫上单账户 2026-09-15]'),
             updated_at = NOW()
         WHERE account_id IN (?,?,?)`,
        OLD_IDS
      );
      console.log('已将旧三账户余额清零并停用（记录与流水保留）。');
    }

    // —— 4) 新建量贩机 / 零售机账户（各自独立，幂等） ——
    for (const acc of NEW_ACCOUNTS.slice(1)) {
      const [ex] = await conn.query('SELECT account_id FROM finance_accounts WHERE account_id = ?', [acc.id]);
      if (ex.length) {
        console.log(`[跳过] ${acc.name} 已存在`);
        continue;
      }
      await conn.query(
        `INSERT INTO finance_accounts
           (account_id, account_name, account_type, bank_name, bank_account,
            initial_balance, current_balance, remark, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, 0.00, 0.00, ?, 1, NOW(), NOW())`,
        [acc.id, acc.name, acc.type, acc.remark]
      );
      console.log(`已新建 ${acc.name}（类型 ${acc.type}）`);
    }

    await conn.commit();

    // —— 5) 迁移后核对 ——
    const [after] = await conn.query(
      `SELECT account_id, account_name, account_type, current_balance, status
       FROM finance_accounts ORDER BY account_type, account_id`
    );
    console.log('\n迁移后账户全量：');
    after.forEach((r) =>
      console.log(`  [${String(r.account_type).padStart(2)}] ${r.account_id.padEnd(22)} ${r.account_name.padEnd(14)} 余额=${Number(r.current_balance).toFixed(2).padStart(10)} status=${r.status}`)
    );

    // —— 6) 恒等式校验：余额 = 期初 + 流水净额（逐账户） ——
    const [idCheck] = await conn.query(
      `SELECT a.account_id, a.account_name, a.initial_balance, a.current_balance,
              COALESCE(SUM(CASE WHEN t.tx_type = 1 THEN t.amount
                                WHEN t.tx_type = 2 THEN -t.amount
                                ELSE 0 END), 0) AS tx_net
       FROM finance_accounts a
       LEFT JOIN finance_transactions t ON t.account_id = a.account_id
       GROUP BY a.account_id, a.account_name, a.initial_balance, a.current_balance
       ORDER BY a.account_id`
    );
    let bad = 0;
    idCheck.forEach((r) => {
      const expect = round2(Number(r.initial_balance) + Number(r.tx_net));
      const actual = round2(r.current_balance);
      const ok = Math.abs(expect - actual) < 0.01;
      if (!ok) {
        bad++;
        console.log(`  ✗ 恒等式不符 ${r.account_id}：期初${r.initial_balance} + 流水净额${r.tx_net} = ${expect}，实际 ${actual}`);
      }
    });
    console.log(bad === 0 ? '\n恒等式校验：全部通过 ✓' : `\n恒等式校验：${bad} 个账户不符 ✗`);

    // 停用账户余额必须为 0（迁移正确性判据）
    const stoppedWithBalance = after.filter((r) => Number(r.status) !== 1 && Math.abs(Number(r.current_balance)) > 0.009);
    console.log(stoppedWithBalance.length === 0
      ? '停用账户余额均为 0 ✓'
      : `停用账户仍有余额：${stoppedWithBalance.map((r) => r.account_id).join(', ')} ✗`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('迁移失败: ' + e.message);
  process.exit(1);
});

// 幂等迁移：积分钱包「双积分」拆分（2026-09-23）
//
// 变更：wallet_accounts 加 recharge_balance / delivery_fee_balance 两个分账户列；
//       wallet_transactions 加 points_type / points_month（见 database/migration_wallet_points_split.sql）。
//
// 幂等：逐列读 information_schema，已存在的列跳过 → 可安全重复执行。
// 回滚：node scripts/migrate_wallet_points_split.js --rollback
// 执行：cd backend && node scripts/migrate_wallet_points_split.js
//
// ⚠️ 涉生产库 DDL —— 执行前已 mysqldump 全量备份（database/backup/pre_wallet_points_split_2026-09-23.sql）。
const mysql = require('mysql2/promise');
require('dotenv').config();

const ROLLBACK = process.argv.includes('--rollback');

/** 逐列 DDL：顺序与 migration_wallet_points_split.sql 保持一致 */
const ADD_COLUMNS = [
  {
    table: 'wallet_accounts',
    column: 'recharge_balance',
    ddl: `ALTER TABLE \`wallet_accounts\`
            ADD COLUMN \`recharge_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00
            COMMENT '充值积分余额（管理员后台设置，可与配送费积分混合抵扣）' AFTER \`balance\``
  },
  {
    table: 'wallet_accounts',
    column: 'delivery_fee_balance',
    ddl: `ALTER TABLE \`wallet_accounts\`
            ADD COLUMN \`delivery_fee_balance\` DECIMAL(14,2) NOT NULL DEFAULT 0.00
            COMMENT '配送费积分余额（返货配送费 1 元 = 1 积分，来源水票发行）' AFTER \`recharge_balance\``
  },
  {
    table: 'wallet_transactions',
    column: 'points_type',
    ddl: `ALTER TABLE \`wallet_transactions\`
            ADD COLUMN \`points_type\` ENUM('RECHARGE','DELIVERY_FEE') NOT NULL DEFAULT 'RECHARGE'
            COMMENT '积分类型：RECHARGE=充值积分 DELIVERY_FEE=配送费积分' AFTER \`amount\``
  },
  {
    table: 'wallet_transactions',
    column: 'points_month',
    ddl: `ALTER TABLE \`wallet_transactions\`
            ADD COLUMN \`points_month\` VARCHAR(7) NULL
            COMMENT '配送费积分发行月份 YYYY-MM（仅 DELIVERY_FEE 入账填写，用于按月发放明细）' AFTER \`points_type\``
  }
];

/** 回滚用：与 ADD_COLUMNS 逆序 */
const DROP_COLUMNS = [
  { table: 'wallet_transactions', column: 'points_month' },
  { table: 'wallet_transactions', column: 'points_type' },
  { table: 'wallet_accounts', column: 'delivery_fee_balance' },
  { table: 'wallet_accounts', column: 'recharge_balance' }
];

async function columnExists(conn, table, column) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return r[0].n > 0;
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
  const conn = await pool.getConnection();
  try {
    if (ROLLBACK) {
      console.log('模式：回滚（删除本次新增的 4 个列）\n');
      for (const t of DROP_COLUMNS) {
        if (await columnExists(conn, t.table, t.column)) {
          await conn.query(`ALTER TABLE \`${t.table}\` DROP COLUMN \`${t.column}\``);
          console.log(`  已删除 ${t.table}.${t.column}`);
        } else {
          console.log(`  [跳过] ${t.table}.${t.column} 不存在`);
        }
      }
      console.log('\n回滚完成。');
      return;
    }

    // 1) 迁移前现状
    console.log('迁移前:');
    for (const t of ADD_COLUMNS) {
      const exists = await columnExists(conn, t.table, t.column);
      console.log(`  ${t.table}.${t.column} → ${exists ? '已存在' : '缺失'}`);
    }

    // 2) 逐列执行（已存在则跳过）
    console.log('\n执行:');
    let changed = 0;
    for (const t of ADD_COLUMNS) {
      if (await columnExists(conn, t.table, t.column)) {
        console.log(`  [跳过] ${t.table}.${t.column}`);
        continue;
      }
      await conn.query(t.ddl);
      changed++;
      console.log(`  已新增 ${t.table}.${t.column}`);
    }
    console.log(changed ? `  共新增 ${changed} 列` : '  （无需变更，全部已存在）');

    // 3) 存量回填：拆分前的余额语义等同「充值积分」
    //    仅处理 balance≠0 且两个分账户都还是 0 的行（避免二次执行覆盖已分类数据）
    const [fill] = await conn.query(
      `UPDATE wallet_accounts
          SET recharge_balance = balance, delivery_fee_balance = 0.00
        WHERE recharge_balance = 0.00 AND delivery_fee_balance = 0.00 AND balance <> 0.00`
    );
    console.log(`\n存量回填: ${fill.affectedRows} 行（原余额归入「充值积分」）`);

    // 4) 迁移后核对
    console.log('\n迁移后核对:');
    const [cols] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND ((TABLE_NAME = 'wallet_accounts' AND COLUMN_NAME IN ('recharge_balance','delivery_fee_balance'))
            OR (TABLE_NAME = 'wallet_transactions' AND COLUMN_NAME IN ('points_type','points_month')))
        ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );
    cols.forEach(c =>
      console.log(
        `  ${c.TABLE_NAME}.${c.COLUMN_NAME} ${c.COLUMN_TYPE} ${c.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'} 默认${c.COLUMN_DEFAULT}`
      )
    );
    const okCount = cols.length === 4;
    console.log(okCount ? '  4 列齐备 ✓' : `  ✗ 只找到 ${cols.length} 列`);

    // 5) 分账户一致性（balance = recharge + delivery_fee）
    const [inconsistent] = await conn.query(
      `SELECT wallet_id, balance, recharge_balance, delivery_fee_balance
         FROM wallet_accounts
        WHERE ROUND(balance, 2) <> ROUND(recharge_balance + delivery_fee_balance, 2)`
    );
    console.log(
      `\n分账户一致性: ${inconsistent.length === 0 ? '全部一致 ✓' : '✗ ' + inconsistent.length + ' 处不一致'}`
    );
    inconsistent.forEach(r =>
      console.log(`  ${r.wallet_id}: 总 ${r.balance} ≠ 充值 ${r.recharge_balance} + 配送费 ${r.delivery_fee_balance}`)
    );

    // 6) 恒等式（balance = 期初 + 流水净额）—— 迁移不得改变余额口径
    const [identity] = await conn.query(
      `SELECT w.wallet_id, w.balance, w.initial_balance,
              ROUND(COALESCE(SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE -t.amount END), 0), 2) AS net
         FROM wallet_accounts w
         LEFT JOIN wallet_transactions t ON t.wallet_id = w.wallet_id
        GROUP BY w.wallet_id, w.balance, w.initial_balance
       HAVING ROUND(w.balance, 2) <> ROUND(w.initial_balance + net, 2)`
    );
    console.log(`恒等式: ${identity.length === 0 ? '全部成立 ✓' : '✗ ' + identity.length + ' 处不成立'}`);

    if (!okCount || inconsistent.length || identity.length) process.exitCode = 1;
    else console.log('\n迁移完成并核对通过 ✓');
  } catch (e) {
    console.error('迁移失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error('迁移异常: ' + e.message);
  process.exit(1);
});

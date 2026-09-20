// 幂等迁移执行器：微信订货小程序 V1.1 · Phase 1 ~ 5（2026-09-20）
// ===========================================================================
// 权威 DDL 事实源：database/migration_mini_program_v1.sql
// 本脚本**不自己写 DDL**，只做三件事：
//   ① 解析 .sql 里的 `-- [STEP]` / `-- [GUARD]` 标记
//   ② 按 information_schema 判定每个 STEP 是否已生效 → 只跑未生效的
//   ③ 跑完做核对（表/列/唯一约束/占位账号清理/备份行）并打印报告
//
// 为什么不用 `mysql < migration.sql`：
//   MySQL 8 不支持 `ADD COLUMN IF NOT EXISTS`，直接重跑会报错，
//   不满足 §4.1.1「清理 migration 必须可重入」的要求。
//   同时仓库规范要求「用 node + mysql2 执行，勿用 mysql.exe（中文会乱码）」。
//
// 用法：
//   cd backend
//   node scripts/migrate_mini_program_v1.js --dry-run   # 预演：只打印将要执行的 STEP
//   node scripts/migrate_mini_program_v1.js --apply     # 执行
//
// ⚠️ --apply 前必须先 mysqldump 全量备份并确认体积非 0（项目规范，已因此出过事故）。
//    本次备份：database/backup_20260920_203139_before_miniprogram.sql
// ===========================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const SQL_FILE = path.join(__dirname, '..', '..', 'database', 'migration_mini_program_v1.sql');
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY; // 默认预演；显式 --apply 才写库

/** 解析迁移文件为 STEP 列表 */
function parseSteps(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const steps = [];
  let cur = null;
  for (const line of lines) {
    const mStep = line.match(/^--\s*\[STEP\s+([a-z0-9_]+)\]\s*$/i);
    if (mStep) {
      cur = { name: mStep[1], guard: null, desc: [], sql: [] };
      steps.push(cur);
      continue;
    }
    if (!cur) continue; // 文件头（到第一个 STEP 之前）忽略
    const mGuard = line.match(/^--\s*\[GUARD\]\s*(.+?)\s*$/i);
    if (mGuard) {
      cur.guard = mGuard[1].trim();
      continue;
    }
    const mDesc = line.match(/^--\s*\[DESC\]\s*(.*)$/i);
    if (mDesc) {
      cur.desc.push(mDesc[1]);
      continue;
    }
    cur.sql.push(line);
  }
  // 去掉每段 SQL 首尾空行
  for (const s of steps) {
    while (s.sql.length && s.sql[0].trim() === '') s.sql.shift();
    while (s.sql.length && s.sql[s.sql.length - 1].trim() === '') s.sql.pop();
  }
  return steps;
}

/** 判定 STEP 是否需要执行 */
async function shouldRun(conn, guard) {
  if (!guard) return { run: true, why: '无守卫（默认执行）' };
  const parts = guard.split(':').map(s => s.trim());

  if (parts[0].toUpperCase() === 'ALWAYS') return { run: true, why: 'ALWAYS' };

  if (parts[0].toUpperCase() === 'TABLE') {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [parts[1]]
    );
    return rows[0].n === 0 ? { run: true, why: `表 ${parts[1]} 不存在` } : { run: false, why: `表 ${parts[1]} 已存在` };
  }

  // HAS* 系列 = 「对象存在才执行」，用于 DROP 类步骤（与 TABLE/COLUMN 的判定方向相反）
  if (parts[0].toUpperCase() === 'HASTABLE') {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [parts[1]]
    );
    return rows[0].n > 0 ? { run: true, why: `表 ${parts[1]} 仍存在` } : { run: false, why: `表 ${parts[1]} 已不存在` };
  }

  if (parts[0].toUpperCase() === 'HASCOLUMN') {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [parts[1], parts[2]]
    );
    return rows[0].n > 0
      ? { run: true, why: `列 ${parts[1]}.${parts[2]} 仍存在` }
      : { run: false, why: `列 ${parts[1]}.${parts[2]} 已不存在` };
  }

  if (parts[0].toUpperCase() === 'COLUMN') {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [parts[1], parts[2]]
    );
    return rows[0].n === 0
      ? { run: true, why: `列 ${parts[1]}.${parts[2]} 不存在` }
      : { run: false, why: `列 ${parts[1]}.${parts[2]} 已存在` };
  }

  if (parts[0].toUpperCase() === 'INDEX') {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [parts[1], parts[2]]
    );
    return rows[0].n > 0
      ? { run: true, why: `索引 ${parts[2]} 仍存在` }
      : { run: false, why: `索引 ${parts[2]} 已不存在` };
  }

  if (parts[0].toUpperCase() === 'COLUMN_TYPE') {
    // GUARD 形如 COLUMN_TYPE:mini_accounts:role:worker —— 列类型里仍含 needle 才执行
    const [rows] = await conn.query(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [parts[1], parts[2]]
    );
    if (!rows.length) return { run: false, why: `列 ${parts[1]}.${parts[2]} 不存在，无需裁剪` };
    const hit = String(rows[0].t).includes(parts[3]);
    return hit ? { run: true, why: `列类型仍含 '${parts[3]}'` } : { run: false, why: `列类型已不含 '${parts[3]}'` };
  }

  throw new Error(`无法识别的 GUARD: ${guard}`);
}

/** 核对 & 报告 */
async function verify(conn) {
  const out = [];
  const q = async (sql, params = []) => (await conn.query(sql, params))[0];

  // 1) 表数量与新增表
  const expectTables = [
    'wallet_accounts',
    'wallet_transactions',
    'mini_payment_orders',
    'mini_idempotency',
    'mini_audit_logs'
  ];
  const t = await q(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  out.push(`库表总数 = ${t[0].n}`);
  for (const name of expectTables) {
    const r = await q(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [name]
    );
    out.push(`  ${r[0].n ? '✓' : '✗'} 表 ${name}`);
  }
  const sms = await q(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_codes'`
  );
  out.push(`  ${sms[0].n === 0 ? '✓' : '✗'} sms_codes 已处置（应不存在）`);

  // 2) orders 新增列
  const orderCols = [
    'order_source',
    'buyer_type',
    'buyer_id',
    'payment_method',
    'wallet_id',
    'fulfillment_type',
    'fulfillment_status',
    'order_scene',
    'refund_status',
    'created_from_mini_account_id'
  ];
  const oc = await q(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME IN (?)`,
    [orderCols]
  );
  const ocSet = new Set(oc.map(r => r.c));
  out.push(
    `orders 新增列 ${ocSet.size}/${orderCols.length}：` + orderCols.map(c => (ocSet.has(c) ? '✓' : '✗') + c).join(' ')
  );

  // 3) products
  const pc = await q(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
        AND COLUMN_NAME IN ('salesman_mini_enabled','salesman_min_price')`
  );
  out.push(`products 新增列 ${pc.length}/2：` + pc.map(r => '✓' + r.c).join(' '));

  // 4) water_ticket_issuance
  const wc = await q(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'water_ticket_issuance'
        AND COLUMN_NAME IN ('distribution_delivery_fee_unit','distribution_delivery_fee_total','wallet_transaction_id')`
  );
  out.push(`water_ticket_issuance 新增列 ${wc.length}/3：` + wc.map(r => '✓' + r.c).join(' '));

  // 5) mini_accounts
  const ma = await q(
    `SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mini_accounts'`
  );
  const maMap = new Map(ma.map(r => [r.c, r.t]));
  out.push(`mini_accounts.role 类型 = ${maMap.get('role')}`);
  out.push(`  ${maMap.get('role') && !String(maMap.get('role')).includes('worker') ? '✓' : '✗'} role 已裁掉 worker`);
  out.push(`  ${!maMap.has('username') ? '✓' : '✗'} username 已移除`);
  out.push(`  ${!maMap.has('password_hash') ? '✓' : '✗'} password_hash 已移除`);
  out.push(`  ${maMap.has('active_key') ? '✓' : '✗'} active_key 生成列已添加`);
  const uk = await q(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mini_accounts' AND INDEX_NAME = 'uk_role_active'`
  );
  out.push(`  ${uk[0].n ? '✓' : '✗'} uk_role_active 唯一索引已建立`);

  const seed = await q(`SELECT COUNT(*) AS n FROM mini_accounts WHERE openid LIKE 'seed\\_%'`);
  out.push(`  ${seed[0].n === 0 ? '✓' : '✗'} 占位账号 seed_* 已清除（剩余 ${seed[0].n} 条）`);

  // 6) 存量回填：无法整除的记录必须列出交业务确认（§12.2.1 不得静默四舍五入）
  const inexact = await q(
    `SELECT issuance_id, station_id, product_id, quantity, distribution_delivery_fee,
            distribution_delivery_fee_unit, distribution_delivery_fee_total
       FROM water_ticket_issuance
      WHERE quantity > 0
        AND ROUND(distribution_delivery_fee_unit * quantity, 2) <> distribution_delivery_fee_total`
  );
  if (inexact.length === 0) {
    out.push('✓ 存量水票发行记录：单件值 × 数量 与总额一致（无偏差）');
  } else {
    out.push(`⚠️ 存量水票发行记录存在 ${inexact.length} 条不可整除/有偏差的记录，须交业务确认（不得静默四舍五入）：`);
    for (const r of inexact) {
      out.push(
        `    ${r.issuance_id} 水站=${r.station_id} 商品=${r.product_id} ` +
          `数量=${r.quantity} 总额=${r.distribution_delivery_fee} ` +
          `单件值=${r.distribution_delivery_fee_unit} 单件值×数量=${r.distribution_delivery_fee_total}`
      );
    }
  }

  // 7) 自提已下线：配置键应**不存在**，且两列的注释不应再宣传 PICKUP
  const pick = await q(`SELECT setting_value FROM system_settings WHERE setting_key = 'mini_self_pickup_address'`);
  out.push(
    pick.length === 0
      ? '✓ mini_self_pickup_address 已删除（自提下线 2026-09-20，无代码读取该键）'
      : `! mini_self_pickup_address 仍存在（值为 ${pick[0].setting_value === null ? 'NULL' : pick[0].setting_value}）—— 预期应被删除，请检查上面的 STEP 是否执行`
  );

  // 履约方式列的取值说明必须与代码一致：自提下线后注释里不该再出现 PICKUP 可用的说法
  const cols = await q(
    `SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, COLLATION_NAME AS coll, IS_NULLABLE AS nul,
            COLUMN_DEFAULT AS def, COLUMN_COMMENT AS cmt
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
        AND COLUMN_NAME IN ('fulfillment_type','fulfillment_status')`
  );
  for (const c of cols) {
    out.push(`  · orders.${c.c}: ${c.t} / ${c.coll} / NULL=${c.nul} / default=${c.def === null ? 'NULL' : c.def}`);
    out.push(`    注释：${c.cmt}`);
  }
  const typeCol = cols.find(c => c.c === 'fulfillment_type');
  if (typeCol && /PICKUP=自提/.test(typeCol.cmt) && !/下线/.test(typeCol.cmt)) {
    out.push('! orders.fulfillment_type 注释仍把 PICKUP 写成可用取值，与本版代码不符');
  }

  return out;
}

async function main() {
  if (!fs.existsSync(SQL_FILE)) {
    console.error(`迁移文件不存在: ${SQL_FILE}`);
    process.exit(1);
  }
  const steps = parseSteps(fs.readFileSync(SQL_FILE, 'utf8'));
  if (steps.length === 0) {
    console.error('未解析到任何 STEP，请检查迁移文件的标记格式');
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4',
    multipleStatements: true
  });

  const conn = await pool.getConnection();
  let failed = 0;
  try {
    console.log(`迁移文件: ${path.basename(SQL_FILE)}`);
    console.log(`目标库  : ${process.env.DB_NAME || 'nongfu_inventory'} @ ${process.env.DB_HOST || 'localhost'}`);
    console.log(`模式    : ${DRY ? '预演（--dry-run，不写库）' : '★ 执行（--apply）'}`);
    console.log(`共解析 ${steps.length} 个 STEP\n`);

    for (const step of steps) {
      const { run, why } = await shouldRun(conn, step.guard);
      const tag = run ? (DRY ? '[待执行]' : '[执行]') : '[跳过]';
      console.log(`${tag} ${step.name}  —— ${why}`);
      if (step.desc.length) {
        for (const d of step.desc) if (d.trim()) console.log(`         ${d.trim()}`);
      }
      if (!run || DRY) continue;

      const sql = step.sql.join('\n').trim();
      if (!sql) {
        console.log('         （空 SQL，跳过）');
        continue;
      }
      try {
        await conn.query(sql);
      } catch (e) {
        failed++;
        console.error(`         ✗ 失败: ${e.code || ''} ${e.message}`);
        console.error('         → 已停止后续 STEP。请用备份回滚后重试，不要盲目重跑。');
        break;
      }
    }

    if (DRY) {
      console.log('\n（预演结束，未改动任何数据。加 --apply 才会执行。）');
      return;
    }

    console.log('\n================ 核对报告 ================');
    const report = await verify(conn);
    report.forEach(l => console.log(l));

    if (failed) {
      console.log('\n迁移未全部完成 ✗');
      process.exitCode = 1;
    } else {
      console.log('\n迁移完成。后续务必执行（仓库规范）：');
      console.log('  cd backend && node scripts/export_dump.js     # 重导 full_schema_data.sql');
      console.log('  docs/项目概览.md                              # 同步真实数据模型与变更记录');
    }
  } catch (e) {
    console.error('迁移异常: ' + (e.code || '') + ' ' + e.message);
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

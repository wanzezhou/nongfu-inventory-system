/**
 * 系统数据重置（2026-09-18）
 * ===========================================================================
 * 需求：除「商品管理」模块的商品信息外，其余初始化系统、清除历史数据。
 *
 * 业务方确认的范围（4 项）：
 *   ① 保留全部基础档案，只清业务流水
 *   ② 库存数量清零，但保留 inventory 的 159 行（商品档案不删）
 *   ③ 资金账户余额与期初全部归零
 *   ④ 存量债权（水站欠款 / 水票 / 桶押金）全部清零
 *
 * 用法：
 *   node scripts/reset_system_data.js            # 预演（只读，不做任何修改）
 *   node scripts/reset_system_data.js --apply    # 执行
 *   node scripts/reset_system_data.js --verify   # 只校验当前是否已处于初始状态
 *
 * 特性：
 *   - 全部删除与重置在**单个事务**内完成，任一步失败整体回滚
 *   - 删除顺序按外键依赖排（子表先删），启动时会自动校验顺序合法性
 *   - 幂等：重复执行结果一致，不会报错
 *   - 脚本**不负责备份**：执行前必须自行 mysqldump（见 database/backup_*.sql）
 */

const { pool } = require('../src/config/db');

// ---------------------------------------------------------------------------
// 待清空的业务表（顺序 = 删除顺序，子表必须在前）
// ---------------------------------------------------------------------------
const PURGE_TABLES = [
  // 订单体系（orders 被 3 张表引用，必须最后删）
  { name: 'order_items', label: '订单商品明细' },
  { name: 'delivery_fee_settlement', label: '配送费结算' },
  { name: 'financial_settlement', label: '资金结算对账' },
  { name: 'orders', label: '订单主表' },

  // 工资体系（发放-预支抵扣引用发放与预支）
  { name: 'salary_payment_advances', label: '工资发放-预支抵扣明细' },
  { name: 'salary_payments', label: '工资发放记录' },
  { name: 'salary_advances', label: '工资预支记录' },
  { name: 'staff_salaries', label: '人员工资表' },

  // 报销（附件引用主表）
  { name: 'reimburse_attachments', label: '报销附件' },
  { name: 'reimbursements', label: '报销记录' },

  // 水站返货（明细引用主表）
  { name: 'station_return_items', label: '水站返货商品明细' },
  { name: 'station_returns', label: '水站返货记录' },

  // 水票
  { name: 'water_tickets', label: '水票' },
  { name: 'water_ticket_issuance', label: '水票发行记录' },

  // 押金
  { name: 'barrel_deposits', label: '桶押金登记' },

  // 进销存台账
  { name: 'purchase_records', label: '进货入库记录' },
  { name: 'stock_out_records', label: '出库台账' },
  { name: 'machine_sales', label: '机台销量记录' },

  // 费用
  { name: 'other_expenses', label: '其他支出' },
  { name: 'fixed_expenses', label: '固定支出' },

  // 资金流水（放最后：它是所有资金动作的账，先清业务再清账）
  { name: 'finance_transactions', label: '资金流水' },

  // 临时数据
  { name: 'sms_codes', label: '短信验证码' }
];

// 清空后需要归位 AUTO_INCREMENT 的表（仅「清空且自增」的表；
// inventory / barrel_config / mini_accounts / users 保留行，不能重置）
const RESET_AUTO_INCREMENT = ['order_items', 'reimbursements', 'reimburse_attachments', 'barrel_deposits', 'sms_codes'];

// ---------------------------------------------------------------------------
// 需要「重置字段」而非清空的表
// ---------------------------------------------------------------------------
const RESET_FIELDS = [
  {
    table: 'inventory',
    label: '库存（数量清零，保留商品行）',
    sql: 'UPDATE inventory SET quantity = 0, last_in_time = NULL, last_out_time = NULL'
  },
  {
    table: 'finance_accounts',
    label: '资金账户（余额与期初归零）',
    sql: 'UPDATE finance_accounts SET initial_balance = 0, current_balance = 0'
  },
  {
    table: 'sub_stations',
    label: '水站（欠款归零）',
    sql: 'UPDATE sub_stations SET current_debt = 0'
  }
];

// ---------------------------------------------------------------------------
// 必须保留的基础档案（用于校验行数未变）
// ---------------------------------------------------------------------------
const KEEP_TABLES = [
  'products', 'workers', 'sub_stations', 'suppliers', 'machine_stations',
  'salesmen', 'mini_accounts', 'users', 'system_settings', 'barrel_config'
];

const APPLY = process.argv.includes('--apply');
const VERIFY_ONLY = process.argv.includes('--verify');

const q = (sql, args) => pool.query(sql, args);

async function count(table) {
  const [r] = await q('SELECT COUNT(*) AS n FROM `' + table + '`');
  return Number(r[0].n);
}

/** 校验删除顺序合法：任何「待删表 A」的子表若也是待删表，则子表必须排在 A 之前 */
async function assertDeleteOrder() {
  const [fks] = await q(
    `SELECT TABLE_NAME AS child, REFERENCED_TABLE_NAME AS parent
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  const idx = {};
  PURGE_TABLES.forEach((t, i) => { idx[t.name] = i; });
  const bad = [];
  for (const f of fks) {
    if (idx[f.child] === undefined || idx[f.parent] === undefined) continue;
    if (idx[f.child] > idx[f.parent]) bad.push(`${f.child} 应在 ${f.parent} 之前`);
  }
  if (bad.length) throw new Error('删除顺序违反外键依赖：' + bad.join('; '));
  return true;
}

async function printPlan() {
  console.log('=== 待清空的业务表（' + PURGE_TABLES.length + ' 张）===');
  let total = 0;
  for (const t of PURGE_TABLES) {
    const n = await count(t.name);
    total += n;
    console.log('  ' + t.name.padEnd(28) + String(n).padStart(6) + ' 行   ' + t.label);
  }
  console.log('  ' + '合计'.padEnd(26) + String(total).padStart(6) + ' 行');

  console.log('\n=== 字段重置 ===');
  for (const r of RESET_FIELDS) {
    const n = await count(r.table);
    console.log('  ' + r.table.padEnd(28) + String(n).padStart(6) + ' 行   ' + r.label);
  }

  console.log('\n=== 保留不动 ===');
  for (const t of KEEP_TABLES) {
    const n = await count(t);
    console.log('  ' + t.padEnd(28) + String(n).padStart(6) + ' 行');
  }
}

/** 校验是否已处于初始状态；返回问题列表（空数组 = 已干净） */
async function findIssues() {
  const issues = [];
  for (const t of PURGE_TABLES) {
    const n = await count(t.name);
    if (n !== 0) issues.push(`${t.name} 仍有 ${n} 行`);
  }
  const [inv] = await q('SELECT COUNT(*) AS n FROM inventory WHERE quantity <> 0 OR last_in_time IS NOT NULL OR last_out_time IS NOT NULL');
  if (Number(inv[0].n) !== 0) issues.push(`inventory 仍有 ${inv[0].n} 行非零库存/时间戳`);
  const [acc] = await q('SELECT COUNT(*) AS n FROM finance_accounts WHERE current_balance <> 0 OR initial_balance <> 0');
  if (Number(acc[0].n) !== 0) issues.push(`finance_accounts 仍有 ${acc[0].n} 个账户余额或期初非 0`);
  const [debt] = await q('SELECT COUNT(*) AS n FROM sub_stations WHERE current_debt <> 0');
  if (Number(debt[0].n) !== 0) issues.push(`sub_stations 仍有 ${debt[0].n} 个水站欠款非 0`);
  return issues;
}

(async () => {
  console.log('系统数据重置 —— 模式：' + (VERIFY_ONLY ? '仅校验' : APPLY ? '执行(--apply)' : '预演(只读)'));
  console.log('数据库：' + (process.env.DB_NAME || 'nongfu_inventory') + '\n');

  await assertDeleteOrder();
  console.log('✓ 删除顺序符合外键依赖\n');

  if (VERIFY_ONLY) {
    const issues = await findIssues();
    console.log(issues.length === 0
      ? '✓ 已处于初始状态（业务表全空 / 库存为 0 / 账户余额为 0 / 欠款为 0）'
      : '✗ 尚未初始化，存在 ' + issues.length + ' 项：\n   - ' + issues.join('\n   - '));
    await pool.end();
    process.exitCode = issues.length ? 1 : 0;
    return;
  }

  await printPlan();

  if (!APPLY) {
    console.log('\n【预演模式】未做任何修改。确认无误后执行：');
    console.log('  node scripts/reset_system_data.js --apply');
    await pool.end();
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let deleted = 0;
    for (const t of PURGE_TABLES) {
      const [r] = await conn.query('DELETE FROM `' + t.name + '`');
      deleted += r.affectedRows;
      console.log('  清空 ' + t.name.padEnd(28) + r.affectedRows + ' 行');
    }

    for (const r of RESET_FIELDS) {
      const [res] = await conn.query(r.sql);
      console.log('  重置 ' + r.table.padEnd(28) + res.affectedRows + ' 行   ' + r.label);
    }

    await conn.commit();
    console.log('\n✓ 事务已提交，共删除 ' + deleted + ' 行业务数据');
  } catch (e) {
    await conn.rollback();
    console.error('\n✗ 执行失败，已整体回滚：' + e.message);
    conn.release();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  conn.release();

  // AUTO_INCREMENT 归位（DDL，隐式提交，故放在事务之后）
  for (const t of RESET_AUTO_INCREMENT) {
    try {
      await q('ALTER TABLE `' + t + '` AUTO_INCREMENT = 1');
    } catch (e) {
      console.log('  （' + t + ' 自增归位跳过：' + e.message + '）');
    }
  }
  console.log('✓ 已清空表的自增 ID 归位');

  // 执行后校验
  console.log('\n=== 执行后校验 ===');
  const issues = await findIssues();
  if (issues.length) {
    console.log('✗ 仍有 ' + issues.length + ' 项不符：\n   - ' + issues.join('\n   - '));
    process.exitCode = 1;
  } else {
    console.log('✓ 22 张业务表全空 / 库存为 0 / 账户余额与期初为 0 / 水站欠款为 0');
  }

  console.log('\n=== 保留档案（应保持不变）===');
  for (const t of KEEP_TABLES) {
    console.log('  ' + t.padEnd(28) + String(await count(t)).padStart(6) + ' 行');
  }

  // 资金恒等式：流水已清空 ⇒ 余额(0) 必须等于 期初(0) + 流水净额(0)
  const [accRows] = await q(
    `SELECT a.account_id, a.initial_balance, a.current_balance,
            COALESCE(SUM(CASE WHEN t.tx_type = 1 THEN t.amount WHEN t.tx_type = 2 THEN -t.amount
                              WHEN t.tx_type = 3 THEN -t.amount WHEN t.tx_type = 4 THEN t.amount ELSE 0 END), 0) AS tx_net
     FROM finance_accounts a
     LEFT JOIN finance_transactions t ON t.account_id = a.account_id
     GROUP BY a.account_id`
  );
  let bad = 0;
  accRows.forEach((r) => {
    const expect = Math.round((Number(r.initial_balance) + Number(r.tx_net)) * 100) / 100;
    const actual = Math.round(Number(r.current_balance) * 100) / 100;
    if (Math.abs(expect - actual) > 0.01) { bad++; console.log('  ✗ ' + r.account_id + ' 期望 ' + expect + ' 实际 ' + actual); }
  });
  console.log('  资金账户 ' + accRows.length + ' 个，恒等式不符 ' + bad + ' 个 ' + (bad === 0 ? '✓' : '✗'));
  if (bad) process.exitCode = 1;

  await pool.end();
})().catch(async (e) => {
  console.error('脚本异常：' + e.message);
  try { await pool.end(); } catch (err) { /* ignore */ }
  process.exit(1);
});

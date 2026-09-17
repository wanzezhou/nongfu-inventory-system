/**
 * 一次性数据修正：恢复被误删的两台量贩机（2026-09-17）
 * ---------------------------------------------------------------------------
 * 背景：机台管理页存在「同一组件被多条路由复用 → 实例复用 → 数据不按 machineType
 *      重新加载」的缺陷（已在 MainLayout 用 route.path 作 router-view 的 key 修复）。
 *      用户在「零售机管理」页看到的其实是量贩机的数据，执行删除时删掉的是
 *      **量贩机 M001 / M002**（走的是「无引用 → 物理删除」分支）。
 *
 * 数据来源：database/backup_20260916_232507_before_worker_status_fix.sql
 *          （误删发生于 2026-09-17 晚，该备份早于误删，含完整原始行）
 *
 * 用量：node scripts/fix_restore_machines_20260917.js            # 预演（默认，不改库）
 *      node scripts/fix_restore_machines_20260917.js --apply    # 执行
 * 幂等：已存在的 ID 一律跳过，重复执行无副作用。
 */
const { pool } = require('../src/config/db');

const APPLY = process.argv.includes('--apply');

// 原始行（来自备份，字段顺序与表一致：
// machine_id, machine_type, station_name, address, manager, manager_phone, status, created_at, updated_at）
const ROWS = [
  ['M001', 1, '量贩机-万达广场店', '南京市建邺区万达广场1F', '张店长', '13700000001', 1, '2026-08-25 23:40:29', '2026-08-25 23:40:29'],
  ['M002', 1, '量贩机-中央商场店', '南京市秦淮区新街口中央商场3F', '李店长', '13700000002', 1, '2026-08-25 23:40:29', '2026-08-25 23:40:29']
];

(async () => {
  console.log('=== 目标：恢复被误删的量贩机（数据源：备份 backup_20260916_232507）===');
  console.log(APPLY ? '模式：执行（--apply）' : '模式：预演（不改库，加 --apply 才执行）');
  console.log();

  const before = await pool.query('SELECT machine_id, machine_type, station_name, status FROM machine_stations ORDER BY machine_id');
  console.log('当前 machine_stations（' + before[0].length + ' 行）：');
  before[0].forEach((r) => console.log(`   ${r.machine_id}  type=${r.machine_type}  ${r.station_name}  status=${r.status}`));
  console.log();

  const missing = [];
  for (const r of ROWS) {
    const [hit] = await pool.query('SELECT machine_id FROM machine_stations WHERE machine_id = ?', [r[0]]);
    if (hit.length === 0) missing.push(r);
    else console.log(`   ⏭️  ${r[0]} 已存在，跳过（幂等）`);
  }

  if (missing.length === 0) {
    console.log('\n无需恢复：目标行均已存在 ✓');
    await pool.end();
    return;
  }

  console.log('将恢复以下行：');
  missing.forEach((r) => console.log(`   + ${r[0]}  ${r[2]}  ${r[3]}  ${r[4]} / ${r[5]}`));
  console.log();

  if (!APPLY) {
    console.log('（预演结束，未改动数据库。确认无误后加 --apply 执行）');
    await pool.end();
    return;
  }

  for (const r of missing) {
    await pool.query(
      `INSERT INTO machine_stations
         (machine_id, machine_type, station_name, address, manager, manager_phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r
    );
    console.log(`   ✅ 已恢复 ${r[0]} ${r[2]}`);
  }

  // 核对
  const [after] = await pool.query('SELECT machine_id, machine_type, station_name, status FROM machine_stations ORDER BY machine_id');
  console.log('\n恢复后 machine_stations（' + after.length + ' 行）：');
  after.forEach((r) => console.log(`   ${r.machine_id}  type=${r.machine_type}  ${r.station_name}  status=${r.status}`));

  const stillMissing = missing.filter((r) => !after.some((a) => a.machine_id === r[0]));
  const type1 = after.filter((r) => Number(r.machine_type) === 1).length;
  const type2 = after.filter((r) => Number(r.machine_type) === 2).length;
  console.log(`\n量贩机(type=1) ${type1} 台 ｜ 零售机(type=2) ${type2} 台`);
  console.log(stillMissing.length === 0 ? '核对通过 ✓' : `核对未通过 ✗ 仍缺：${stillMissing.map((r) => r[0]).join(', ')}`);
  if (stillMissing.length) process.exitCode = 1;

  await pool.end();
})();

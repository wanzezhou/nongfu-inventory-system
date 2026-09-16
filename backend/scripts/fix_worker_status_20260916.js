// 一次性数据修正：恢复被误设为「离职」的员工（2026-09-16）
// ---------------------------------------------------------------------------
// 背景：员工删除接口原先只做软删（status=0），但前端在「删除成功」提示后列表
//       并不会少一行，用户误以为删除无效并重复操作，导致 5 名员工在
//       2026-09-16 22:51~22:52 被设为离职：
//         W001 张师傅(店长) / W002 李师傅(店长) / W003 王师傅(店长) / W004 刘师傅(店长)
//         SM001 赵敏(业务员)
//       影响：工资统计只统计在职员工（WHERE w.status=1），上述人员会从工资统计与
//             配送员工下拉中消失。业务方确认这些并非真实离职 → 恢复为在职(1)。
//
// 用法：
//   node scripts/fix_worker_status_20260916.js            # 预演（只打印，不改数据）
//   node scripts/fix_worker_status_20260916.js --apply    # 执行
//
// 幂等：仅当目标行当前 status = 0 时才更新；已恢复过再跑不会产生任何改动。
// 留痕：workers 表无备注列，故修正记录见 .workbuddy/memory/2026-09-16.md 与本次提交说明。
// 安全：执行前请先 mysqldump 全量备份（项目规范）。
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');

// 明确列出目标，不使用模糊条件（避免误伤其他离职人员）
const TARGETS = [
  ['W001', '张师傅', 1],
  ['W002', '李师傅', 1],
  ['W003', '王师傅', 1],
  ['W004', '刘师傅', 1],
  ['SM001', '赵敏', 3]
];

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
    console.log(APPLY ? '模式：执行（--apply）' : '模式：预演（不改数据，加 --apply 执行）');
    console.log('\n修正前：');
    const ids = TARGETS.map((t) => t[0]);
    const [before] = await conn.query(
      `SELECT worker_id, worker_name, employee_type, status, updated_at
       FROM workers WHERE worker_id IN (?) ORDER BY worker_id`,
      [ids]
    );
    before.forEach((r) => console.log(
      `  ${r.worker_id.padEnd(6)} ${r.worker_name.padEnd(6)} type=${r.employee_type} status=${r.status} (更新于 ${new Date(r.updated_at).toLocaleString('zh-CN')})`
    ));

    const missing = ids.filter((id) => !before.some((r) => r.worker_id === id));
    if (missing.length) {
      console.log(`\n⚠️ 以下目标不存在，将跳过：${missing.join(', ')}`);
    }

    const toFix = before.filter((r) => Number(r.status) === 0);
    const nameMismatch = toFix.filter((r) => {
      const t = TARGETS.find((x) => x[0] === r.worker_id);
      return t && t[1] !== r.worker_name;
    });
    if (nameMismatch.length) {
      throw new Error('姓名与预期不符，已中止：' + nameMismatch.map((r) => `${r.worker_id}=${r.worker_name}`).join(', '));
    }

    if (toFix.length === 0) {
      console.log('\n[跳过] 目标员工均已是「在职」，无需修正（幂等）。');
    } else if (!APPLY) {
      console.log(`\n预演：将把以下 ${toFix.length} 人恢复为在职(status=1)：`);
      toFix.forEach((r) => console.log(`  ${r.worker_id} ${r.worker_name}（type=${r.employee_type}，当前 status=0）`));
      console.log('\n（预演模式未改数据；确认无误后加 --apply 执行）');
    } else {
      // 已在同一连接上，直接开事务（多行一起改，避免中途失败留下半套数据）
      await conn.beginTransaction();
      try {
        for (const r of toFix) {
          await conn.execute(
            'UPDATE workers SET status = 1, updated_at = ? WHERE worker_id = ? AND status = 0',
            [new Date(), r.worker_id]
          );
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
      console.log(`\n已恢复 ${toFix.length} 人为在职：${toFix.map((r) => r.worker_id).join(', ')}`);
    }

    // 修正后核对
    const [after] = await conn.query(
      `SELECT worker_id, worker_name, employee_type, status FROM workers WHERE worker_id IN (?) ORDER BY worker_id`,
      [ids]
    );
    console.log('\n修正后：');
    after.forEach((r) => console.log(
      `  ${r.worker_id.padEnd(6)} ${r.worker_name.padEnd(6)} type=${r.employee_type} status=${r.status}`
    ));
    const stillOff = after.filter((r) => Number(r.status) !== 1);
    if (APPLY) {
      console.log(stillOff.length === 0
        ? '\n核对通过 ✓（目标员工全部在职）'
        : `\n核对未通过 ✗（仍为离职：${stillOff.map((r) => r.worker_id).join(', ')}）`);
      if (stillOff.length) process.exitCode = 1;
    } else {
      console.log(`\n（预演：上述 ${stillOff.length} 人尚未改动，属预期）`);
    }

    const [cnt] = await conn.query(
      `SELECT COUNT(*) total, SUM(status = 1) active FROM workers`
    );
    console.log(`全库员工：${cnt[0].total} 人，在职 ${cnt[0].active} 人`);
  } catch (e) {
    console.error('修正失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('修正异常: ' + e.message);
  process.exit(1);
});

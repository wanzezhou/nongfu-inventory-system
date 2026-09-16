/**
 * 一次性数据修正：负库存归零 + 盘库台账留痕
 *
 * 背景（2026-09-16 排查）：
 *   冒烟脚本以「真实商品」为测试对象建单后用原生 SQL 直删订单，绕过
 *   restoreSalesEffects，导致库存被扣却不复原。实测 380mL天然矿泉水15入纸箱
 *   的库存被扣至 -36，而 09-14 两次盘库已把该商品归零，两次扣减均无凭证。
 *
 * 修正口径（业务方 2026-09-16 确认）：
 *   按 2026-09-14 盘库基准归零，并在「出入库记录」台账补一条调整记录留痕。
 *
 * 留痕约定：
 *   - 记入 stock_out_records（本项目盘库调整的台账表），out_type=3（其他）
 *   - quantity 记 **负数**：该表行语义为「减少」，负数表示本次为库存净增（冲正）
 *   - stock_after 记调整后的真实库存
 *   - remark 以「数据修正: 」开头，便于识别与幂等判重
 *
 * 幂等：同一商品已有「数据修正: 」开头留痕记录时跳过，不会重复补记。
 * 用法：node backend/scripts/fix_negative_inventory.js [--apply]
 *       不带 --apply 时为预演，只打印将要执行的修正，不写库。
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const TRACE_PREFIX = '数据修正: ';

function generateStockOutId() {
  return `SO${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory',
    charset: 'utf8mb4'
  });

  const negatives = await conn.execute(
    'SELECT product_id, quantity FROM inventory WHERE quantity < 0 ORDER BY product_id'
  ).then(([rows]) => rows);

  console.log(`模式: ${APPLY ? 'APPLY（写库）' : 'DRY-RUN（预演）'}`);
  console.log(`发现负库存商品: ${negatives.length} 个\n`);

  if (!negatives.length) {
    console.log('无需修正，退出。');
    await conn.end();
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const row of negatives) {
    const pid = row.product_id;
    const qty = Number(row.quantity);

    const [prows] = await conn.execute(
      'SELECT product_name, product_code FROM products WHERE product_id = ?', [pid]
    );
    const pname = prows[0] ? prows[0].product_name : null;
    const pcode = prows[0] ? prows[0].product_code : null;

    // 幂等判重：已有同类留痕则跳过
    const [exist] = await conn.execute(
      `SELECT record_id FROM stock_out_records WHERE product_id = ? AND remark LIKE ? LIMIT 1`,
      [pid, `${TRACE_PREFIX}%`]
    );
    if (exist.length) {
      console.log(`[跳过] ${pid} ${pname} —— 已存在留痕记录 ${exist[0].record_id}`);
      skipped++;
      continue;
    }

    const now = new Date();
    const remark = `${TRACE_PREFIX}冲正无凭证扣减 ${Math.abs(qty)} 件（2026-09-15 冒烟删单遗留），按 2026-09-14 盘库基准归零，库存 ${qty} → 0`;

    console.log(`[修正] ${pid} ${pname}（${pcode || '无编码'}）库存 ${qty} → 0，补留痕: ${remark}`);

    if (!APPLY) continue;

    await conn.beginTransaction();
    try {
      const [res] = await conn.execute(
        'UPDATE inventory SET quantity = 0, updated_at = ? WHERE product_id = ? AND quantity < 0',
        [now, pid]
      );
      if (res.affectedRows !== 1) {
        throw new Error(`更新影响行数异常: ${res.affectedRows}（商品 ${pid}）`);
      }

      await conn.execute(
        `INSERT INTO stock_out_records
           (record_id, product_id, product_name, product_code, quantity, out_type, stock_after, remark, handler, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [generateStockOutId(), pid, pname, pcode, -Math.abs(qty), 3, 0, remark, 'system', now]
      );

      await conn.commit();
      fixed++;
    } catch (err) {
      await conn.rollback();
      console.error(`[失败] ${pid}: ${err.message}`);
      throw err;
    }
  }

  if (APPLY) {
    const [after] = await conn.execute('SELECT COUNT(*) c FROM inventory WHERE quantity < 0');
    console.log(`\n已修正 ${fixed} 个，跳过 ${skipped} 个。剩余负库存商品: ${after[0].c}`);
  } else {
    console.log('\n预演结束，未写库。加 --apply 执行。');
  }

  await conn.end();
})().catch(err => {
  console.error('脚本异常:', err.message);
  process.exit(1);
});

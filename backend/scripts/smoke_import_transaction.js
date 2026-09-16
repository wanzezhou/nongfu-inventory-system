/**
 * 冒烟测试：P1-F5 Excel 导入事务化
 * 场景：库存导入文件含 1 行有效 + 1 行商品编码不存在 → 应整体回滚（有效行也不生效）
 *      全有效文件 → 正常提交
 * 运行：node scripts/smoke_import_transaction.js（需后端已启动）
 *
 * 2026-09-16 改造：不再取真实商品。
 *   旧版 `SELECT product_id, product_code FROM products LIMIT 1` 取真实商品，
 *   虽然收尾会还原库存，但脚本异常退出（断言抛错、进程被 kill、后端未起）
 *   就会把真实商品的库存留在被导入改写的状态。现改为一律自建 `SMK` 标记商品，
 *   并在 finally 里整体删除。
 */
process.env.TZ = 'Asia/Shanghai';
const BASE = 'http://localhost:3000/api';
const { writeWorkbook } = require('../src/utils/excel');

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

async function buildWorkbookBuffer(rows) {
  const headers = ['商品编码', '库存数量'];
  return writeWorkbook([{ name: '导入模板', data: [headers, ...rows] }]);
}

async function upload(path, token, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  return res.json().catch(() => ({}));
}

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  const { pool } = require('../src/config/db');

  // 自建带「SMK / 冒烟」标记的临时商品 + 库存，不依赖真实数据
  const pid = 'SMK' + Date.now();
  const pcode = pid;
  await pool.query(
    "INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, category, status, created_at, updated_at) " +
    "VALUES (?, ?, '冒烟-导入事务测试商品', '', '箱', 1, 1, 1, 1, 0, 0, 0, 0, 0, '冒烟测试', 1, NOW(), NOW())",
    [pid, pcode]
  );
  await pool.query('INSERT INTO inventory (product_id, quantity, last_in_time) VALUES (?, 10, NOW())', [pid]);

  const qtyOf = async () => {
    const [[r]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [pid]);
    return Number(r ? r.quantity : NaN);
  };
  const invBefore = { product_id: pid, product_code: pcode, quantity: 10 };
  console.log(`[准备] 已自建临时冒烟商品 ${pcode}，当前库存 ${invBefore.quantity}`);

  const cleanup = async () => {
    try {
      await pool.query('DELETE FROM stock_out_records WHERE product_id = ?', [pid]);
      await pool.query('DELETE FROM purchase_records WHERE product_id = ?', [pid]);
      await pool.query('DELETE FROM inventory WHERE product_id = ?', [pid]);
      await pool.query('DELETE FROM products WHERE product_id = ?', [pid]);
      const [[left]] = await pool.query('SELECT COUNT(*) c FROM products WHERE product_id = ?', [pid]);
      if (Number(left.c) !== 0) throw new Error('临时商品未删除干净');
    } catch (e) {
      console.error('清理失败:', e.message);
    }
  };

  try {
    // 场景1：1 行有效 + 1 行编码不存在 → 整体回滚
    const badBuf = await buildWorkbookBuffer([
      [pcode, 123],
      ['NOT_EXIST_CODE_XYZ', 999]
    ]);
    const badRes = await upload('/excel/inventory/import', token, badBuf);
    assert(badRes.code === 400, `坏文件被拒绝(400): ${badRes.code} ${badRes.message || ''}`);
    assert((badRes.data?.failedRows || []).length >= 1, '返回失败行明细');
    assert(await qtyOf() === invBefore.quantity, `整体回滚：库存未变（${await qtyOf()} === ${invBefore.quantity}）`);
    const [ghostRows] = await pool.query('SELECT product_id FROM products WHERE product_code = ?', ['NOT_EXIST_CODE_XYZ']);
    assert(ghostRows.length === 0, '无效编码未入库');

    // 场景2：全有效文件 → 正常提交
    const goodBuf = await buildWorkbookBuffer([
      [pcode, invBefore.quantity + 7]
    ]);
    const goodRes = await upload('/excel/inventory/import', token, goodBuf);
    assert(goodRes.code === 200, `好文件导入成功: ${goodRes.message || ''}`);
    assert(await qtyOf() === invBefore.quantity + 7, `有效导入已提交（${await qtyOf()} = ${invBefore.quantity}+7）`);
  } finally {
    // 自建对象整体删除，无需回写跑前快照
    await cleanup();
    console.log('清理完成（临时商品/库存/记录已删除）');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });

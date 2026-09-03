/**
 * 冒烟测试：P1-F5 Excel 导入事务化
 * 场景：库存导入文件含 1 行有效 + 1 行商品编码不存在 → 应整体回滚（有效行也不生效）
 *      全有效文件 → 正常提交
 * 运行：node scripts/smoke_import_transaction.js（需后端已启动）
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
  const [[p]] = await pool.query("SELECT product_id, product_code FROM products LIMIT 1");
  const [[invBefore]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [p.product_id]);
  console.log(`测试商品 ${p.product_code}，当前库存 ${invBefore.quantity}`);

  // 场景1：1 行有效 + 1 行编码不存在 → 整体回滚
  const badBuf = await buildWorkbookBuffer([
    [p.product_code, 123],
    ['NOT_EXIST_CODE_XYZ', 999]
  ]);
  const badRes = await upload('/excel/inventory/import', token, badBuf);
  assert(badRes.code === 400, `坏文件被拒绝(400): ${badRes.code} ${badRes.message || ''}`);
  assert((badRes.data?.failedRows || []).length >= 1, '返回失败行明细');
  const [[invAfterBad]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [p.product_id]);
  assert(invAfterBad.quantity === invBefore.quantity, `整体回滚：库存未变（${invAfterBad.quantity} === ${invBefore.quantity}）`);
  const [ghostRows] = await pool.query('SELECT product_id FROM products WHERE product_code = ?', ['NOT_EXIST_CODE_XYZ']);
  assert(ghostRows.length === 0, '无效编码未入库');

  // 场景2：全有效文件 → 正常提交
  const goodBuf = await buildWorkbookBuffer([
    [p.product_code, invBefore.quantity + 7]
  ]);
  const goodRes = await upload('/excel/inventory/import', token, goodBuf);
  assert(goodRes.code === 200, `好文件导入成功: ${goodRes.message || ''}`);
  const [[invAfterGood]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [p.product_id]);
  assert(invAfterGood.quantity === invBefore.quantity + 7, `有效导入已提交（${invAfterGood.quantity} = ${invBefore.quantity}+7）`);

  // 还原库存
  await pool.query('UPDATE inventory SET quantity = ? WHERE product_id = ?', [invBefore.quantity, p.product_id]);
  console.log('清理完成（库存已还原）');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });

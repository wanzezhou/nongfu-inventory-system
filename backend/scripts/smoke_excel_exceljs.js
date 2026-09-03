// 冒烟：S5 exceljs 换库——导出产物合法性 + 导入解析（xlsx 模板 / csv）
// 前置：后端已启动（node src/app.js）
// 运行：node backend/scripts/smoke_excel_exceljs.js
const BASE = 'http://localhost:3000/api';
const ExcelJS = require('exceljs');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function main() {
  // 登录
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then(r => r.json());
  if (lr.code !== 200) throw new Error('登录失败：' + lr.message);
  const H = { Authorization: 'Bearer ' + lr.data.token };

  // 取回 buffer 的 GET
  const getBuf = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: H });
    return { status: res.status, ct: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) };
  };

  // 解析 xlsx buffer → { sheetName: aoa }
  const parseXlsx = async (buf) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const out = {};
    wb.eachSheet((ws) => {
      const aoa = [];
      ws.eachRow({ includeEmpty: true }, (row) => {
        const arr = [];
        for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) arr.push(row.getCell(c).value);
        aoa.push(arr);
      });
      out[ws.name] = aoa;
    });
    return out;
  };

  const CSV_TYPE = 'text/csv; charset=utf-8';
  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ===== 1. 库存导出 =====
  console.log('\n[导出] 库存');
  let r = await getBuf('/excel/inventory/export');
  check('HTTP 200 且为 xlsx 类型', r.status === 200 && r.ct.includes('spreadsheetml.sheet'), `${r.status} ${r.ct}`);
  check('文件头为 ZIP（PK）', r.buf.subarray(0, 2).toString() === 'PK', r.buf.subarray(0, 4).toString('hex'));
  let sheets = await parseXlsx(r.buf);
  check('sheet 名「库存数据」且表头正确', sheets['库存数据'] && sheets['库存数据'][0][0] === '商品编码', JSON.stringify(Object.keys(sheets)));

  // ===== 2. 订单导出 =====
  console.log('\n[导出] 订单');
  r = await getBuf('/excel/orders/export');
  sheets = await parseXlsx(r.buf);
  check('sheet「订单数据」表头首列=订单号', sheets['订单数据'] && sheets['订单数据'][0][0] === '订单号', JSON.stringify(Object.keys(sheets)));

  // ===== 3. 通用模块导出（products）+ 模板 =====
  console.log('\n[导出/模板] 通用模块');
  r = await getBuf('/excel/products/export');
  sheets = await parseXlsx(r.buf);
  check('sheet「数据」存在', !!sheets['数据'], JSON.stringify(Object.keys(sheets)));
  r = await getBuf('/excel/products/template');
  sheets = await parseXlsx(r.buf);
  check('模板 sheet「导入模板」示例值正常', sheets['导入模板'] && sheets['导入模板'].length >= 2, JSON.stringify(Object.keys(sheets)));

  // ===== 4. 营收导出（多 sheet + 中文文件名） =====
  console.log('\n[导出] 营收（中文文件名 RFC5987）');
  const start = '2000-01-01', end = '2099-12-31';
  const resRaw = await fetch(`${BASE}/finance/export?startDate=${start}&endDate=${end}`, { headers: H });
  const cdispo = resRaw.headers.get('content-disposition') || '';
  check('Content-Disposition 含 UTF-8 编码文件名', cdispo.includes("filename*=UTF-8''"), cdispo);
  r = { status: resRaw.status, buf: Buffer.from(await resRaw.arrayBuffer()) };
  sheets = await parseXlsx(r.buf);
  check('营收 sheet 含订单/机台至少一类', Object.keys(sheets).some((k) => k.startsWith('订单营收明细') || k.startsWith('机台销量明细')), JSON.stringify(Object.keys(sheets)));

  // ===== 5. 商品销售统计导出 =====
  console.log('\n[导出] 商品销售统计');
  r = await getBuf(`/statistics/product-sales/export?range=all`);
  sheets = await parseXlsx(r.buf);
  check('sheet「商品销售统计」表头=序号', sheets['商品销售统计'] && sheets['商品销售统计'][0][0] === '序号', JSON.stringify(Object.keys(sheets)));

  // ===== 6. 其他支出：模板 + xlsx 导出 + csv 导出 + csv 导入解析 =====
  console.log('\n[其他支出] 模板 / 导出 / CSV 导入');
  r = await getBuf('/expenses/template');
  sheets = await parseXlsx(r.buf);
  check('支出模板表头含「支出名称*」', sheets['其他支出模板'] && JSON.stringify(sheets['其他支出模板'][0]).includes('支出名称'), JSON.stringify(Object.keys(sheets)));

  r = await getBuf('/expenses/export?format=xlsx');
  sheets = await parseXlsx(r.buf);
  check('支出 xlsx 导出 sheet「其他支出」', !!sheets['其他支出'], JSON.stringify(Object.keys(sheets)));

  r = await getBuf('/expenses/export?format=csv');
  const csvText = r.buf.toString('utf8').replace(/^\ufeff/, '');
  check('CSV 导出含表头', r.status === 200 && csvText.includes('支出名称'), `${r.status}`);

  // CSV 导入：一行合法（账户留空）+ 一行账户不存在 → 解析与校验路径验证
  const csvContent = '支出名称*,金额*,支出日期*（YYYY-MM-DD）,支出类别*,备注,支出账户\nCSV冒烟支出,12.5,2099-01-01,冒烟类别,自动化,\nCSV冒烟支出2,13,2099-01-01,冒烟类别,,不存在的账户XYZ';
  const form = new FormData();
  form.append('file', new Blob([csvContent], { type: CSV_TYPE }), 'smoke.csv');
  const impRes = await fetch(`${BASE}/expenses/import`, { method: 'POST', headers: H, body: form }).then((x) => x.json());
  check('CSV 导入接口 200', impRes.code === 200, JSON.stringify(impRes));
  check('合法行成功 1 条', impRes.data?.successCount === 1, JSON.stringify(impRes.data));
  check('账户不存在行被拦截', (impRes.data?.failed || []).length === 1, JSON.stringify(impRes.data?.failed));

  // 清理 CSV 导入产生的支出 + 流水 + 余额回补
  try {
    const mysql = require('mysql2/promise');
    require('dotenv').config();
    const pool = await mysql.createPool({
      host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'nongfu_inventory'
    });
    const [rows] = await pool.query("SELECT expense_id, amount, account_id FROM other_expenses WHERE expense_name = 'CSV冒烟支出'");
    if (rows.length) {
      const e = rows[0];
      if (e.account_id) {
        await pool.query('UPDATE finance_accounts SET current_balance = current_balance + ? WHERE account_id = ?', [Number(e.amount), e.account_id]);
        await pool.query("DELETE FROM finance_transactions WHERE related_module = 'expense' AND related_id = ?", [e.expense_id]);
      }
      await pool.query('DELETE FROM other_expenses WHERE expense_id = ?', [e.expense_id]);
    }
    await pool.end();
    console.log('  ✅ 已清理 CSV 导入测试数据');
  } catch (e) {
    console.log('  ⚠️ 清理失败（不影响断言）: ' + e.message);
  }

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('冒烟执行失败:', e); process.exit(1); });

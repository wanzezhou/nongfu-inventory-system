// 端到端验证：机台销量一键导入（需求 3）
// 覆盖：模板下载可用、导入成功行落库、非法行被拦截并回传行号、营收汇总随之变化
// 自建临时数据（SMK* 商品 + SMKST* 水站），收尾全部清理。
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' -> ' + extra : '')); }
}

function req(method, urlPath, { token, body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload = null;
    if (body && !raw) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (raw) { headers['Content-Type'] = raw.contentType; payload = raw.buffer; }
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (!raw || /json/.test(res.headers['content-type'] || '')) {
          try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* 非 JSON */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, json, buffer: buf });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// 构造 multipart/form-data（无需第三方库）
function buildMultipart(fileBuffer, filename, field = 'file') {
  const boundary = '----SmokeBoundary' + Date.now();
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { buffer: Buffer.concat([head, fileBuffer, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function waitHealth(retries = 40) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      req('GET', '/api/health').then(() => resolve()).catch(() => {
        if (++n >= retries) return reject(new Error('后端未就绪'));
        setTimeout(tick, 500);
      });
    };
    tick();
  });
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

  const suffix = Date.now().toString().slice(-6);
  const PROD_CODE = 'SMKIMP' + suffix;
  const STATION_ID = 'SMKST' + suffix;
  const MACHINE_ID = 'SMKM' + suffix;
  let server = null;

  try {
    // —— 自建测试数据：商品 + 水站 + 机台 ——
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, retail_price, status, created_at, updated_at)
       VALUES (?, ?, ?, '550ml', '瓶', 1.20, 2.50, 1, NOW(), NOW())`,
      ['SMKP' + suffix, PROD_CODE, '冒烟导入测试商品' + suffix]
    );
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, status, created_at, updated_at)
       VALUES (?, ?, '冒烟', '13900000000', '冒烟地址', 1, NOW(), NOW())`,
      [STATION_ID, '冒烟导入测试水站' + suffix]
    );
    await pool.query(
      `INSERT INTO machine_stations (machine_id, machine_type, station_name, address, status, created_at, updated_at)
       VALUES (?, 1, ?, '冒烟地址', 1, NOW(), NOW())`,
      [MACHINE_ID, '冒烟导入测试量贩机' + suffix]
    );

    // —— 起后端（必须与测试同一进程生命周期，否则被回收） ——
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'app.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});
    await waitHealth();

    // —— 登录 ——
    const login = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
    const token = login.json?.data?.token || login.json?.data?.accessToken;
    ok('管理员登录成功并取得 token', !!token, JSON.stringify(login.json).slice(0, 160));
    if (!token) throw new Error('无法登录，后续用例跳过');

    // —— 用例 1：模板下载 ——
    const tpl = await req('GET', '/api/finance/machine-sales/template', { token });
    ok('模板下载返回 200 且为 xlsx（PK 魔数）',
      tpl.status === 200 && tpl.buffer.length > 0 && tpl.buffer.slice(0, 2).toString() === 'PK',
      'status=' + tpl.status + ' len=' + tpl.buffer.length);

    // —— 用例 2：正常导入（2 行有效） ——
    const { writeWorkbook, parseTable } = require(path.join(__dirname, '..', 'src', 'utils', 'excel'));
    const data = [
      { 机台编号: MACHINE_ID, 商品编码: PROD_CODE, 销售数量: 10, 销售单价: 2.5, 销售日期: '2026-09-01', 备注: '冒烟导入1' },
      { 机台编号: MACHINE_ID, 商品编码: PROD_CODE, 销售数量: 4, 销售单价: 3.0, 销售日期: '2026-09-02', 备注: '冒烟导入2' }
    ];
    const xlsx = await writeWorkbook([{ name: '机台销量', data }]);
    const mp = buildMultipart(xlsx, 'import.xlsx');
    const imp = await req('POST', '/api/finance/machine-sales/import', { token, raw: mp });
    ok('导入接口返回 code=200', imp.json?.code === 200, JSON.stringify(imp.json).slice(0, 200));
    ok('导入 2 条成功', imp.json?.data?.inserted === 2, JSON.stringify(imp.json?.data));

    // 落库校验
    const [rows] = await pool.query(
      `SELECT sale_id, quantity, sale_price, sale_date, machine_type FROM machine_sales WHERE machine_id = ? ORDER BY sale_date`,
      [MACHINE_ID]
    );
    ok('数据库落库 2 条', rows.length === 2, 'rows=' + rows.length);
    ok('机台类型由服务端反查补齐为 1（量贩机）', rows.every((r) => Number(r.machine_type) === 1), JSON.stringify(rows.map((r) => r.machine_type)));
    const totalQty = rows.reduce((s, r) => s + Number(r.quantity), 0);
    ok('数量合计 14', totalQty === 14, 'qty=' + totalQty);

    // —— 用例 3：非法行被拦（商品编码不存在 + 数量为 0 + 日期非法） ——
    const bad = [
      { 机台编号: MACHINE_ID, 商品编码: 'NOTEXIST999', 销售数量: 5, 销售单价: 1, 销售日期: '2026-09-03' },
      { 机台编号: MACHINE_ID, 商品编码: PROD_CODE, 销售数量: 0, 销售单价: 1, 销售日期: '2026-09-03' },
      { 机台编号: MACHINE_ID, 商品编码: PROD_CODE, 销售数量: 3, 销售单价: 1, 销售日期: '不是日期' }
    ];
    const badXlsx = await writeWorkbook([{ name: '机台销量', data: bad }]);
    const badImp = await req('POST', '/api/finance/machine-sales/import', {
      token, raw: buildMultipart(badXlsx, 'bad.xlsx')
    });
    ok('全部非法时导入被判失败（code=400）', badImp.json?.code === 400, JSON.stringify(badImp.json).slice(0, 240));
    const errMsg = String(badImp.json?.message || '');
    ok('错误信息含行号定位', /第 \d+ 行/.test(errMsg), errMsg.slice(0, 200));
    const [afterBad] = await pool.query('SELECT COUNT(*) n FROM machine_sales WHERE machine_id = ?', [MACHINE_ID]);
    ok('非法导入未写入任何数据（仍为 2 条）', Number(afterBad[0].n) === 2, 'count=' + afterBad[0].n);

    // —— 用例 4：混合导入（1 有效 + 1 非法，部分成功） ——
    const mixed = [
      { 机台编号: MACHINE_ID, 商品编码: PROD_CODE, 销售数量: 6, 销售单价: 2.0, 销售日期: '2026-09-04' },
      { 机台编号: MACHINE_ID, 商品编码: 'NOTEXIST999', 销售数量: 6, 销售单价: 2.0, 销售日期: '2026-09-04' }
    ];
    const mixedXlsx = await writeWorkbook([{ name: '机台销量', data: mixed }]);
    const mixedImp = await req('POST', '/api/finance/machine-sales/import', {
      token, raw: buildMultipart(mixedXlsx, 'mixed.xlsx')
    });
    ok('混合导入：成功 1 条 / 跳过 1 条',
      mixedImp.json?.data?.inserted === 1 && mixedImp.json?.data?.skipped === 1,
      JSON.stringify(mixedImp.json?.data));

    // —— 用例 5：营收汇总随之变化（2026-09 区间，取 list 中 orderType=4） ——
    const sum = await req('GET', '/api/finance/summary?range=custom&startDate=2026-09-01&endDate=2026-10-01&orderType=4', { token });
    const list = sum.json?.data?.list || [];
    const machineRow = list.find((x) => Number(x.orderType) === 4);
    const rev = Number(machineRow?.revenue);
    const expect = 10 * 2.5 + 4 * 3.0 + 6 * 2.0; // 25 + 12 + 12 = 49
    ok(`量贩机营收汇总 = ${expect}（实际 ${rev}）`, Math.abs(rev - expect) < 0.01, JSON.stringify(machineRow));

    // —— 用例 6：空文件被拦 ——
    const emptyXlsx = await writeWorkbook([{ name: '机台销量', data: [] }]);
    const emptyImp = await req('POST', '/api/finance/machine-sales/import', {
      token, raw: buildMultipart(emptyXlsx, 'empty.xlsx')
    });
    ok('空数据文件返回 400', emptyImp.json?.code === 400, JSON.stringify(emptyImp.json).slice(0, 160));

  } catch (err) {
    console.error("!! 用例执行异常：" + (err && err.stack || err));
    fail++;
  } finally {
    // —— 统一收尾清理（规范要求：凡写库脚本必须在 finally 调 cleanupSmokeResidue） ——
    try {
      const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
      await cleanupSmokeResidue(pool);
    } catch (e) {
      console.error('!! 统一清理异常：' + e.message);
    }
    // 兜底：按前缀精确清除本脚本自建数据（幂等）
    let cleanupOk = true;
    try {
      await pool.query(`DELETE FROM machine_sales WHERE machine_id = ?`, [MACHINE_ID]);
      await pool.query(`DELETE FROM machine_stations WHERE machine_id = ?`, [MACHINE_ID]);
      await pool.query(`DELETE FROM sub_stations WHERE station_id = ?`, [STATION_ID]);
      await pool.query(`DELETE FROM products WHERE product_id = ?`, ['SMKP' + suffix]);
    } catch (e) {
      cleanupOk = false;
      console.error('!! 清理失败：' + e.message);
    }
    const [residue] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM machine_sales WHERE machine_id=?) ms,
              (SELECT COUNT(*) FROM machine_stations WHERE machine_id=?) mt,
              (SELECT COUNT(*) FROM sub_stations WHERE station_id=?) ss,
              (SELECT COUNT(*) FROM products WHERE product_id=?) pd`,
      [MACHINE_ID, MACHINE_ID, STATION_ID, 'SMKP' + suffix]
    );
    const left = Object.values(residue[0]).reduce((s, v) => s + Number(v), 0);
    if (left === 0 && cleanupOk) console.log('\n清理完成：无残留 ✓');
    else console.log('\n!! 清理异常：残留 ' + left + ' 条，请人工核查');

    if (server) { try { server.kill('SIGKILL'); } catch (e) { /* ignore */ } }
    await pool.end();

    console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => {
  console.error('脚本异常：' + e.message);
  process.exit(1);
});

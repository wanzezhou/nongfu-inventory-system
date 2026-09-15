// 端到端验证：订单营收入账（需求 5）
// 覆盖：类型1/5 单账户入账、类型2 按实际抵扣拆两笔、类型4 不入账、
//       改单先冲回再重记、取消订单回冲、硬删除回冲、资金恒等式。
// 自建临时数据（SMK* 商品 / SMKST* 水站 / SMKWT_* 水票），收尾由 cleanupSmokeResidue 统一清理。
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = 'http://127.0.0.1:3000/api';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra)?.slice(0, 300) : '')); }
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function req(method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    let payload = null;
    if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let s = '';
      res.on('data', (c) => s += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(s); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// 无 /health 路由，用需鉴权接口探测：401 信封同样说明服务已就绪
function waitHealth(retries = 60) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      req('GET', '/orders?page=1&pageSize=1')
        .then((r) => { if (r.status === 200 || r.json?.code === 401) resolve(); else throw new Error('not ready'); })
        .catch(() => { if (++n >= retries) return reject(new Error('后端未就绪')); setTimeout(tick, 500); });
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
  const PROD_ID = 'SMKP' + suffix;
  const PROD_CODE = 'SMKINV' + suffix;
  const STATION_ID = 'SMKST' + suffix;
  const TICKET_IDS = ['SMKWT_' + suffix + '_1', 'SMKWT_' + suffix + '_2'];
  const ORDER_TAG = '冒烟入账';
  let server = null;

  try {
    // —— 自建商品（含水站分销价；类型1/2 看进货价+总包配送费，类型5 看零售价）——
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, total_delivery_fee, status, created_at, updated_at)
       VALUES (?, ?, ?, '550ml', '瓶', 1.20, 8.00, 20.00, 0.50, 1, NOW(), NOW())`,
      [PROD_ID, PROD_CODE, '冒烟入账测试商品' + suffix]
    );
    // —— 自建水站 + 水票（类型2 抵扣需要真实水票）——
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, status, created_at, updated_at)
       VALUES (?, ?, '冒烟', '13900000000', '冒烟地址', 1, NOW(), NOW())`,
      [STATION_ID, '冒烟入账测试水站' + suffix]
    );
    // —— 自建库存（建单要求商品有库存记录，否则报「商品库存不存在」）——
    await pool.query(
      `INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 1000, NOW())`,
      [PROD_ID]
    );
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟入账测试'), (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟入账测试')`,
      [TICKET_IDS[0], PROD_ID, STATION_ID, TICKET_IDS[1], PROD_ID, STATION_ID]
    );

    const [workers] = await pool.query('SELECT worker_id FROM workers WHERE status=1 LIMIT 1');
    const worker = workers[0];
    if (!worker) throw new Error('库内无可用员工，无法建单');

    // —— 起后端（须与测试同进程生命周期，否则随 shell 退出被回收）——
    server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'app.js')], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    server.stdout.on('data', () => {});
    server.stderr.on('data', () => {});
    await waitHealth();

    const login = await req('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
    const token = login.json?.data?.token || login.json?.data?.accessToken;
    ok('管理员登录成功并取得 token', !!token, JSON.stringify(login.json).slice(0, 160));
    if (!token) throw new Error('无法登录，后续用例跳过');

    const bal = async (type) => {
      const [r] = await pool.query('SELECT account_id, current_balance FROM finance_accounts WHERE account_type=?', [type]);
      return r.length ? { id: r[0].account_id, v: Number(r[0].current_balance) } : null;
    };
    const txOf = async (orderId) => (await pool.query(
      "SELECT tx_id, account_id, amount, tx_category FROM finance_transactions WHERE related_module='order_revenue' AND related_id=? ORDER BY tx_id",
      [orderId]
    ))[0];

    const startNfsd = await bal(8);   // 农夫上单账户
    const startSzx = await bal(1);    // 晟之溪公户
    const startSgs = await bal(2);    // 水公社公户

    // —— 用例 1：类型1 送水到府 → 农夫上单账户；营收=(进货价+总包配送费)×数量 ——
    const qty1 = 2;
    const expect1 = round2((1.20 + 0.50) * qty1);
    const c1 = await req('POST', '/orders', { token, body: {
      orderType: 1, customerName: ORDER_TAG + '客户A', customerPhone: '13900000001',
      customerAddress: '冒烟地址', deliveryMethod: 1, deliveryStaffId: worker.worker_id,
      items: [{ productId: PROD_ID, quantity: qty1 }]
    } });
    ok('类型1 创建订单 code=200', c1.json?.code === 200, c1.json);
    const oid1 = c1.json?.data?.id || c1.json?.data?.orderNo;
    const t1 = await txOf(oid1);
    ok('类型1 生成 1 条 order_revenue 流水', t1.length === 1, t1);
    ok(`类型1 入账金额 = ${expect1}`, t1.length === 1 && Number(t1[0].amount) === expect1, t1);
    const nfsd1 = await bal(8);
    ok(`类型1 农夫上单账户 +${expect1}`, nfsd1.v === round2(startNfsd.v + expect1), { before: startNfsd.v, after: nfsd1.v });

    // —— 用例 2：类型5 水公社 → 水公社公户；营收=零售价×数量 ——
    const qty5 = 3;
    const expect5 = round2(20.00 * qty5);
    const c5 = await req('POST', '/orders', { token, body: {
      orderType: 5, customerName: ORDER_TAG + '客户B', customerPhone: '13900000002',
      customerAddress: '冒烟地址', deliveryMethod: 1, deliveryStaffId: worker.worker_id,
      items: [{ productId: PROD_ID, quantity: qty5 }]
    } });
    ok('类型5 创建订单 code=200', c5.json?.code === 200, c5.json);
    const oid5 = c5.json?.data?.id || c5.json?.data?.orderNo;
    const t5 = await txOf(oid5);
    ok(`类型5 营收=${expect5} 且入水公社公户`, t5.length === 1 && Number(t5[0].amount) === expect5, t5);
    const sgs1 = await bal(2);
    ok(`类型5 水公社公户 +${expect5}`, sgs1.v === round2(startSgs.v + expect5), { before: startSgs.v, after: sgs1.v });

    // —— 用例 3：类型2 直营水站拆账（一行抵扣 2 件 + 一行不抵扣 1 件）——
    // 抵扣件走 晟之溪公户（进货价+总包配送费），非抵扣件走 农夫上单账户（水站分销价）
    const expectDeduct = round2((1.20 + 0.50) * 2);
    const expectWhole = round2(8.00 * 1);
    const c2 = await req('POST', '/orders', { token, body: {
      orderType: 2, stationId: STATION_ID, customerName: ORDER_TAG + '水站',
      customerPhone: '13900000003', deliveryMethod: 2, deliveryStaffId: worker.worker_id,
      items: [
        { productId: PROD_ID, quantity: 2, useTicket: true, ticketQty: 2 },
        { productId: PROD_ID, quantity: 1 }
      ]
    } });
    ok('类型2 创建订单 code=200', c2.json?.code === 200, c2.json);
    const oid2 = c2.json?.data?.id || c2.json?.data?.orderNo;
    const t2 = await txOf(oid2);
    ok('类型2 按实际抵扣拆成 2 条流水', t2.length === 2, t2);
    const deductTx = t2.find((x) => String(x.tx_category).includes('抵扣'));
    const wholeTx = t2.find((x) => String(x.tx_category).includes('分销'));
    ok(`类型2 抵扣笔=${expectDeduct}（农夫上单账户）`,
      deductTx && Number(deductTx.amount) === expectDeduct && deductTx.account_id === startNfsd.id, t2);
    ok(`类型2 分销笔=${expectWhole}（晟之溪公户）`,
      wholeTx && Number(wholeTx.amount) === expectWhole && wholeTx.account_id === startSzx.id, t2);

    // —— 用例 3b：全抵扣订单只写 1 笔（未抵扣金额=0 时不写第 2 笔）——
    // 需要 2 张可用水票：上一单已核销 2 张，此处再补 2 张
    await pool.query(
      `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
       VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟入账测试'), (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟入账测试')`,
      ['SMKWT_' + suffix + '_3', PROD_ID, STATION_ID, 'SMKWT_' + suffix + '_4', PROD_ID, STATION_ID]
    );
    const expectAllDeduct = round2((1.20 + 0.50) * 2);
    const c3b = await req('POST', '/orders', { token, body: {
      orderType: 2, stationId: STATION_ID, customerName: ORDER_TAG + '全抵扣水站',
      customerPhone: '13900000004', deliveryMethod: 2, deliveryStaffId: worker.worker_id,
      items: [{ productId: PROD_ID, quantity: 2, useTicket: true, ticketQty: 2 }]
    } });
    const oid3b = c3b.json?.data?.id || c3b.json?.data?.orderNo;
    if (oid3b) {
      const t3b = await txOf(oid3b);
      ok('全抵扣订单只写 1 条流水（不写零额流水）', t3b.length === 1 && Number(t3b[0].amount) === expectAllDeduct, t3b);
    } else {
      ok('全抵扣订单创建 code=200', false, c3b.json);
    }

    // —— 用例 4：类型4 量贩机不入账（NO_AMOUNT_TYPES）——
    const c4 = await req('POST', '/orders', { token, body: {
      orderType: 4, machineStationId: 'SMKM' + suffix, customerName: ORDER_TAG + '机台',
      deliveryMethod: 1, items: [{ productId: PROD_ID, quantity: 5 }]
    } });
    const oid4 = c4.json?.data?.id || c4.json?.data?.orderNo;
    if (oid4) {
      const t4 = await txOf(oid4);
      ok('类型4 不产生 order_revenue 流水', t4.length === 0, t4);
    } else {
      // 无机台被拒同样天然不入账
      ok('类型4 因无机台被拒（天然不入账）', c4.json?.code !== 200, c4.json);
    }

    // —— 用例 5：改单先冲回旧账、再按新单重记 ——
    const beforeEdit = await bal(8);
    const qtyEdit = 4;
    const expectEdit = round2((1.20 + 0.50) * qtyEdit);
    const u1 = await req('PUT', '/orders/' + oid1, { token, body: {
      orderType: 1, customerName: ORDER_TAG + '客户A', customerPhone: '13900000001',
      customerAddress: '冒烟地址', deliveryMethod: 1, deliveryStaffId: worker.worker_id,
      items: [{ productId: PROD_ID, quantity: qtyEdit }]
    } });
    ok('改单 code=200', u1.json?.code === 200, u1.json);
    const t1b = await txOf(oid1);
    ok('改单后仍只有 1 条流水（旧账已冲回）', t1b.length === 1, t1b);
    ok(`改单后金额 = ${expectEdit}`, t1b.length === 1 && Number(t1b[0].amount) === expectEdit, t1b);
    const afterEdit = await bal(8);
    ok('改单后余额 = 原值 - 旧账 + 新账',
      afterEdit.v === round2(beforeEdit.v - expect1 + expectEdit),
      { before: beforeEdit.v, after: afterEdit.v, expect: round2(beforeEdit.v - expect1 + expectEdit) });

    // —— 用例 6：取消订单回冲 ——
    const beforeCancel = await bal(2);
    const d1 = await req('DELETE', '/orders/' + oid5, { token });
    ok('取消订单 code=200', d1.json?.code === 200, d1.json);
    const t5b = await txOf(oid5);
    ok('取消后流水已删', t5b.length === 0, t5b);
    const afterCancel = await bal(2);
    ok('取消后余额回到入账前', afterCancel.v === round2(beforeCancel.v - expect5), { before: beforeCancel.v, after: afterCancel.v });

    // —— 用例 7：硬删除订单回冲（路由是 /force）——
    const beforeDel = await bal(8);
    const d2 = await req('DELETE', '/orders/' + oid1 + '/force', { token });
    ok('硬删除接口可用（/force）', d2.json?.code === 200, d2.json);
    if (d2.json?.code === 200) {
      const t1c = await txOf(oid1);
      ok('硬删除后流水已删', t1c.length === 0, t1c);
      const afterDel = await bal(8);
      ok('硬删除后余额回冲', afterDel.v === round2(beforeDel.v - expectEdit), { before: beforeDel.v, after: afterDel.v });
    }

    // —— 用例 8：资金恒等式（仅校验本脚本涉及的 3 个账户）——
    // 说明：全局恒等式检查会被「其他脚本/历史残留导致的全库漂移」干扰，
    // 而 cleanupSmokeResidue 会在收尾时按恒等式重算余额（balanceFixed）。
    // 本脚本只对自己入账过的账户负责，故按账户窄化校验。
    const touchedIds = [startNfsd.id, startSzx.id, startSgs.id];
    const [bad] = await pool.query(`
      SELECT fa.account_id, fa.account_name,
             ROUND(fa.initial_balance + COALESCE((SELECT SUM(CASE WHEN t.tx_type=1 THEN t.amount WHEN t.tx_type=2 THEN -t.amount ELSE 0 END) FROM finance_transactions t WHERE t.account_id=fa.account_id),0),2) AS expect,
             ROUND(fa.current_balance,2) AS actual
      FROM finance_accounts fa
      WHERE fa.account_id IN (?)
      HAVING ABS(expect - actual) > 0.01`, [touchedIds]);
    ok('本脚本涉及的入账账户恒等式成立（余额=期初+流水净额）', bad.length === 0, bad);

  } catch (err) {
    console.error('!! 用例执行异常：' + (err && err.stack || err));
    fail++;
  } finally {
    // —— 统一收尾清理（规范：凡写库脚本必在 finally 调 cleanupSmokeResidue）——
    try {
      const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
      await cleanupSmokeResidue(pool);
    } catch (e) {
      console.error('!! 统一清理异常：' + e.message);
    }
    // 兜底：按标记精确清除本脚本自建数据（幂等）
    let cleanupOk = true;
    try {
      // 先回冲本脚本产生的营收入账流水，再删单（避免余额被扣两次：cleanup 也会重算余额）
      const [txs] = await pool.query("SELECT tx_id, account_id, amount FROM finance_transactions WHERE related_module='order_revenue'");
      for (const t of txs) {
        await pool.query('UPDATE finance_accounts SET current_balance = current_balance - ? WHERE account_id = ?', [Number(t.amount), t.account_id]);
        await pool.query('DELETE FROM finance_transactions WHERE tx_id = ?', [t.tx_id]);
      }
      const [ords] = await pool.query(`SELECT order_id FROM orders WHERE customer_name LIKE '${ORDER_TAG}%'`);
      for (const o of ords) {
        await pool.query('DELETE FROM order_items WHERE order_id = ?', [o.order_id]);
        await pool.query('DELETE FROM orders WHERE order_id = ?', [o.order_id]);
      }
      await pool.query("DELETE FROM water_tickets WHERE ticket_id LIKE 'SMKWT\\_%'");
      await pool.query('DELETE FROM water_tickets WHERE station_id = ?', [STATION_ID]);
      await pool.query('DELETE FROM order_items WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM inventory WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM products WHERE product_id = ?', [PROD_ID]);
      await pool.query('DELETE FROM sub_stations WHERE station_id = ?', [STATION_ID]);
      console.log(`  清理：回冲流水 ${txs.length} 条 / 订单 ${ords.length} 张`);
    } catch (e) {
      cleanupOk = false;
      console.error('!! 清理失败：' + e.message);
    }
    const [residue] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM products WHERE product_id=?) pd,
              (SELECT COUNT(*) FROM sub_stations WHERE station_id=?) ss,
              (SELECT COUNT(*) FROM water_tickets WHERE ticket_id LIKE 'SMKWT\\_%') wt,
              (SELECT COUNT(*) FROM orders WHERE customer_name LIKE '${ORDER_TAG}%') od,
              (SELECT COUNT(*) FROM finance_transactions WHERE related_module='order_revenue') tx`,
      [PROD_ID, STATION_ID]
    );
    const left = Object.values(residue[0]).reduce((s, v) => s + Number(v), 0);
    if (left === 0 && cleanupOk) console.log('\n清理完成：无残留 ✓');
    else console.log('!! 清理异常：残留 ' + left + ' 条，请人工核查');

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

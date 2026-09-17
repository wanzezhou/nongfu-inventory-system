/**
 * 冒烟：主数据删除语义 + 请求体字段归一化（机台 / 供应商 / 水站）
 * ---------------------------------------------------------------------------
 * 覆盖（全部自建 SMK* 临时对象，结束清理）：
 *   1) 删除语义：**无引用 → 物理删除（mode=hard，行消失）**；
 *                **有引用 → 转停用（mode=soft，status=0，行保留）** + 返回引用清单
 *   2) 请求体归一化（D7）：同一接口分别用 snake_case 与 camelCase 提交，
 *      **两者都必须写入成功** —— 回归「normalizeBody 全局把蛇形键转驼峰并删原键，
 *      而控制器只读蛇形键 → 字段恒为 undefined（新增/编辑静默失效）」
 *   3) 机台的 CASCADE 陷阱：machine_sales 外键是 ON DELETE CASCADE，
 *      有销量时必须走 soft（否则物理删会连带毁掉销量记录）
 *   4) 编辑接口生效（改名称后能读到新值）
 *   5) 404 文案、引用清单字段
 *
 * 运行：node scripts/smoke_masterdata_delete.js（需后端已启动；或经 run_smokes.js 调度）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';

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
function assert(cond, name, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`); }
}

const TS = Date.now().toString().slice(-8);

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  if (!login.data?.token) { console.log('\n结果：登录失败，终止'); process.exit(1); }
  const token = login.data.token;

  const { pool } = require('../src/config/db');
  const cleanup = { orders: [], products: [], purchases: [], machines: [], suppliers: [], stations: [] };

  try {
    // =====================================================================
    console.log('\n=== 1) 机台：字段归一化 + 新增 + 编辑 ===');
    // 1a. snake_case 提交（旧前端写法）
    const mSnake = await call('POST', '/machine-stations', {
      machine_type: 1, station_name: `SMK量贩机${TS}-snake`, address: '测试地址甲',
      manager: '测试店长甲', manager_phone: '13000000001', status: 1
    }, token);
    assert(mSnake.code === 200, '机台新增（snake_case 提交）成功', JSON.stringify(mSnake).slice(0, 160));
    const m1 = mSnake.data?.machine_id || mSnake.data?.machineId;
    if (m1) cleanup.machines.push(m1);
    assert(!!m1, '返回 machine_id');
    assert(mSnake.data?.station_name === `SMK量贩机${TS}-snake`, '站点名称已写入（snake_case 生效）',
      String(mSnake.data?.station_name));
    assert(mSnake.data?.manager === '测试店长甲' && mSnake.data?.manager_phone === '13000000001',
      '负责人/联系方式已写入', `${mSnake.data?.manager} / ${mSnake.data?.manager_phone}`);
    assert(Number(mSnake.data?.machine_type) === 1, '机台类型已写入', String(mSnake.data?.machine_type));

    // 1b. camelCase 提交（D7 约定写法）
    const mCamel = await call('POST', '/machine-stations', {
      machineType: 2, stationName: `SMK零售机${TS}-camel`, address: '测试地址乙',
      manager: '测试店长乙', managerPhone: '13000000002', status: 1
    }, token);
    assert(mCamel.code === 200, '机台新增（camelCase 提交）成功', JSON.stringify(mCamel).slice(0, 160));
    const m2 = mCamel.data?.machine_id || mCamel.data?.machineId;
    if (m2) cleanup.machines.push(m2);
    assert(mCamel.data?.station_name === `SMK零售机${TS}-camel` && Number(mCamel.data?.machine_type) === 2,
      'camelCase 提交同样正确落库', `${mCamel.data?.station_name} / ${mCamel.data?.machine_type}`);

    // 1c. 编辑（改名称 + 联系方式）
    const mUpd = await call('PUT', `/machine-stations/${m1}`, {
      station_name: `SMK量贩机${TS}-已改名`, manager_phone: '13900000009'
    }, token);
    assert(mUpd.code === 200, '机台编辑成功', JSON.stringify(mUpd).slice(0, 160));
    const [mRow] = await pool.query('SELECT station_name, manager_phone FROM machine_stations WHERE machine_id = ?', [m1]);
    assert(mRow[0]?.station_name === `SMK量贩机${TS}-已改名`, '编辑后名称已更新', JSON.stringify(mRow[0]));
    assert(mRow[0]?.manager_phone === '13900000009', '编辑后联系方式已更新', String(mRow[0]?.manager_phone));

    // =====================================================================
    console.log('\n=== 2) 机台删除：无引用 → 物理删除 ===');
    const mDel = await call('DELETE', `/machine-stations/${m1}`, null, token);
    assert(mDel.code === 200 && mDel.data?.mode === 'hard', '删除返回 mode=hard', JSON.stringify(mDel.data));
    const [mLeft] = await pool.query('SELECT COUNT(*) n FROM machine_stations WHERE machine_id = ?', [m1]);
    assert(mLeft[0].n === 0, '行已从库中物理删除（列表不再出现）', String(mLeft[0].n));
    cleanup.machines = cleanup.machines.filter((x) => x !== m1);

    // =====================================================================
    console.log('\n=== 3) 机台删除：有引用（供货订单）→ 转停用 ===');
    const oid = `SMKREFM${TS}`;
    cleanup.orders.push(oid);
    await pool.query(
      `INSERT INTO orders (order_id, order_type, machine_station_id, customer_name, created_at, updated_at)
       VALUES (?, 4, ?, '冒烟引用机台', NOW(), NOW())`,
      [oid, m2]
    );
    const mDel2 = await call('DELETE', `/machine-stations/${m2}`, null, token);
    assert(mDel2.code === 200 && mDel2.data?.mode === 'soft', '有引用时返回 mode=soft', JSON.stringify(mDel2.data));
    assert((mDel2.data?.references || []).some((r) => r.label === '供货订单' && r.count === 1),
      '返回引用清单（供货订单 1 条）', JSON.stringify(mDel2.data?.references));
    assert(/停用/.test(mDel2.message || ''), '提示文案说明「已转为停用保留而非删除」', mDel2.message);
    const [mRow2] = await pool.query('SELECT status FROM machine_stations WHERE machine_id = ?', [m2]);
    assert(mRow2.length === 1 && Number(mRow2[0].status) === 0, '行保留且 status=0（停用）', JSON.stringify(mRow2));

    // =====================================================================
    console.log('\n=== 4) 供应商：字段归一化 + 新增 + 编辑 + 删除 ===');
    const sIns = await call('POST', '/suppliers', {
      supplier_name: `SMK供应商${TS}`, contact_name: '测试联系人', phone: '025-99990001',
      address: '测试地址', bank_name: '测试银行', bank_account: '6222000000000001',
      account_name: '测试户名', tax_number: 'TAX123', invoice_title: '测试抬头', remark: '冒烟', status: 1
    }, token);
    assert(sIns.code === 200, '供应商新增（snake_case）成功', JSON.stringify(sIns).slice(0, 160));
    const s1 = sIns.data?.supplier_id || sIns.data?.supplierId;
    if (s1) cleanup.suppliers.push(s1);
    assert(sIns.data?.supplier_name === `SMK供应商${TS}`, '名称已写入（snake_case 生效）', String(sIns.data?.supplier_name));
    assert(sIns.data?.contact_name === '测试联系人' && sIns.data?.bank_name === '测试银行'
      && sIns.data?.tax_number === 'TAX123' && sIns.data?.invoice_title === '测试抬头',
      '联系人/银行/税号/抬头均已写入（此前这些字段全是 undefined）',
      JSON.stringify({ c: sIns.data?.contact_name, b: sIns.data?.bank_name, t: sIns.data?.tax_number }));

    const sCamelIns = await call('POST', '/suppliers', {
      supplierName: `SMK供应商${TS}-camel`, contactName: '驼峰联系人', phone: '025-99990002', status: 1
    }, token);
    const s2 = sCamelIns.data?.supplier_id || sCamelIns.data?.supplierId;
    if (s2) cleanup.suppliers.push(s2);
    assert(sCamelIns.code === 200 && sCamelIns.data?.contact_name === '驼峰联系人',
      'camelCase 提交同样正确落库', JSON.stringify(sCamelIns.data?.contact_name));

    const sUpd = await call('PUT', `/suppliers/${s1}`, { contact_name: '改后联系人', phone: '025-99990009' }, token);
    assert(sUpd.code === 200, '供应商编辑成功', JSON.stringify(sUpd).slice(0, 160));
    const [sRow] = await pool.query('SELECT contact_name, phone FROM suppliers WHERE supplier_id = ?', [s1]);
    assert(sRow[0]?.contact_name === '改后联系人' && sRow[0]?.phone === '025-99990009',
      '编辑后字段已更新', JSON.stringify(sRow[0]));

    // 无引用 → hard（先删掉刚建的第二个供应商）
    const sDel2 = await call('DELETE', `/suppliers/${s2}`, null, token);
    assert(sDel2.code === 200 && sDel2.data?.mode === 'hard', '供应商无引用 → mode=hard', JSON.stringify(sDel2.data));
    const [sLeft2] = await pool.query('SELECT COUNT(*) n FROM suppliers WHERE supplier_id = ?', [s2]);
    assert(sLeft2[0].n === 0, '供应商行已物理删除', String(sLeft2[0].n));
    cleanup.suppliers = cleanup.suppliers.filter((x) => x !== s2);

    // =====================================================================
    console.log('\n=== 5) 供应商删除：有采购记录 → 转停用 ===');
    const pid = `SMKP${TS}`;
    cleanup.products.push(pid);
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, machine_price,
         total_delivery_fee, distribution_delivery_fee,
         worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, status)
       VALUES (?, ?, ?, '550ml', '箱', 1, 1, 1, 1, 0, 0, 0, 0, 0, 1)`,
      [pid, `SMK${TS}`, `SMK冒烟商品${TS}`]
    );
    const purchaseId = `SMKPR${TS}`;
    cleanup.purchases.push(purchaseId);
    await pool.query(
      `INSERT INTO purchase_records (purchase_id, product_id, supplier_id, quantity, unit_price, total_amount, status, created_at)
       VALUES (?, ?, ?, 1, 1, 1, 1, NOW())`,
      [purchaseId, pid, s1]
    );
    const sDel1 = await call('DELETE', `/suppliers/${s1}`, null, token);
    assert(sDel1.code === 200 && sDel1.data?.mode === 'soft', '有采购记录 → mode=soft', JSON.stringify(sDel1.data));
    assert((sDel1.data?.references || []).some((r) => r.label === '采购入库记录' && r.count === 1),
      '引用清单含「采购入库记录 1 条」', JSON.stringify(sDel1.data?.references));
    const [sRow1] = await pool.query('SELECT status FROM suppliers WHERE supplier_id = ?', [s1]);
    assert(sRow1.length === 1 && Number(sRow1[0].status) === 0, '供应商行保留且转停用', JSON.stringify(sRow1));

    // =====================================================================
    console.log('\n=== 6) 水站：字段归一化 + 新增 + 编辑 + 删除 ===');
    const stIns = await call('POST', '/stations', {
      station_name: `SMK水站${TS}`, contact_name: '水站联系人', phone: '025-88880099',
      address: '测试地址', area: '测试片区', credit_limit: 5000, payment_type: 2,
      bank_name: '水站银行', bank_account: '6222000000000002', account_name: '水站户名',
      invoice_title: '水站抬头', tax_number: 'TAXW1', status: 1
    }, token);
    assert(stIns.code === 200, '水站新增（snake_case）成功', JSON.stringify(stIns).slice(0, 160));
    const st1 = stIns.data?.station_id || stIns.data?.stationId;
    if (st1) cleanup.stations.push(st1);
    assert(stIns.data?.station_name === `SMK水站${TS}`, '水站名称已写入', String(stIns.data?.station_name));
    assert(stIns.data?.contact_name === '水站联系人' && stIns.data?.area === '测试片区'
      && Number(stIns.data?.credit_limit) === 5000 && Number(stIns.data?.payment_type) === 2,
      '联系人/片区/信用额度/付款方式均已写入（此前全是 undefined）',
      JSON.stringify({ c: stIns.data?.contact_name, a: stIns.data?.area, l: stIns.data?.credit_limit }));
    assert(stIns.data?.bank_name === '水站银行' && stIns.data?.invoice_title === '水站抬头',
      '银行/抬头字段已写入', JSON.stringify({ b: stIns.data?.bank_name, t: stIns.data?.invoice_title }));

    const stUpd = await call('PUT', `/stations/${st1}`, { contact_name: '改后水站联系人', credit_limit: 8000 }, token);
    assert(stUpd.code === 200, '水站编辑成功', JSON.stringify(stUpd).slice(0, 160));
    const [stRow] = await pool.query('SELECT contact_name, credit_limit FROM sub_stations WHERE station_id = ?', [st1]);
    assert(stRow[0]?.contact_name === '改后水站联系人' && Number(stRow[0]?.credit_limit) === 8000,
      '编辑后字段已更新', JSON.stringify(stRow[0]));

    // 水站 hard 路径
    const stDel = await call('DELETE', `/stations/${st1}`, null, token);
    assert(stDel.code === 200 && stDel.data?.mode === 'hard', '水站无引用 → mode=hard', JSON.stringify(stDel.data));
    const [stLeft] = await pool.query('SELECT COUNT(*) n FROM sub_stations WHERE station_id = ?', [st1]);
    assert(stLeft[0].n === 0, '水站行已物理删除', String(stLeft[0].n));
    cleanup.stations = cleanup.stations.filter((x) => x !== st1);

    // 水站 soft 路径（造一条订单引用）
    const stIns2 = await call('POST', '/stations', {
      station_name: `SMK水站${TS}-B`, contact_name: '水站乙', phone: '025-88880098',
      area: '测试片区', credit_limit: 1000, payment_type: 1, status: 1
    }, token);
    assert(stIns2.code === 200, '第二个水站新增成功（用于 soft 路径）', JSON.stringify(stIns2).slice(0, 160));
    const st2 = stIns2.data?.station_id || stIns2.data?.stationId;
    if (st2) cleanup.stations.push(st2);
    const oid2 = `SMKREFS${TS}`;
    cleanup.orders.push(oid2);
    await pool.query(
      `INSERT INTO orders (order_id, order_type, station_id, customer_name, created_at, updated_at)
       VALUES (?, 2, ?, '冒烟引用水站', NOW(), NOW())`,
      [oid2, st2]
    );
    const stDel2 = await call('DELETE', `/stations/${st2}`, null, token);
    assert(stDel2.code === 200 && stDel2.data?.mode === 'soft', '水站有引用 → mode=soft', JSON.stringify(stDel2.data));
    assert((stDel2.data?.references || []).some((r) => r.label === '订单' && r.count === 1),
      '引用清单含「订单 1 条」', JSON.stringify(stDel2.data?.references));
    const [stRow2] = await pool.query('SELECT status FROM sub_stations WHERE station_id = ?', [st2]);
    assert(stRow2.length === 1 && Number(stRow2[0].status) === 0, '水站行保留且转停用', JSON.stringify(stRow2));

    // =====================================================================
    console.log('\n=== 7) 边界 ===');
    const nf1 = await call('DELETE', '/machine-stations/NOT_EXIST', null, token);
    assert(nf1.code === 404, '删除不存在机台 → 404', JSON.stringify(nf1).slice(0, 120));
    const nf2 = await call('DELETE', '/suppliers/NOT_EXIST', null, token);
    assert(nf2.code === 404, '删除不存在供应商 → 404', JSON.stringify(nf2).slice(0, 120));
    const nf3 = await call('DELETE', '/stations/NOT_EXIST', null, token);
    assert(nf3.code === 404, '删除不存在水站 → 404', JSON.stringify(nf3).slice(0, 120));
  } catch (e) {
    fail++;
    console.log('\n❌ 执行异常: ' + e.message);
    console.log(e.stack);
  } finally {
    // 清理：按外键依赖顺序
    try {
      if (cleanup.orders.length) {
        await pool.query('DELETE FROM orders WHERE order_id IN (?)', [cleanup.orders]);
      }
      if (cleanup.purchases.length) {
        await pool.query('DELETE FROM purchase_records WHERE purchase_id IN (?)', [cleanup.purchases]);
      }
      if (cleanup.products.length) {
        await pool.query('DELETE FROM inventory WHERE product_id IN (?)', [cleanup.products]);
        await pool.query('DELETE FROM products WHERE product_id IN (?)', [cleanup.products]);
      }
      if (cleanup.machines.length) {
        await pool.query('DELETE FROM machine_stations WHERE machine_id IN (?)', [cleanup.machines]);
      }
      if (cleanup.suppliers.length) {
        await pool.query('DELETE FROM suppliers WHERE supplier_id IN (?)', [cleanup.suppliers]);
      }
      if (cleanup.stations.length) {
        await pool.query('DELETE FROM sub_stations WHERE station_id IN (?)', [cleanup.stations]);
      }
      const [resid] = await pool.query(
        `SELECT (SELECT COUNT(*) FROM machine_stations WHERE station_name LIKE 'SMK%') m,
                (SELECT COUNT(*) FROM suppliers WHERE supplier_name LIKE 'SMK%') s,
                (SELECT COUNT(*) FROM sub_stations WHERE station_name LIKE 'SMK%') st,
                (SELECT COUNT(*) FROM orders WHERE order_id LIKE 'SMKREF%') o,
                (SELECT COUNT(*) FROM products WHERE product_id LIKE 'SMKP%') p,
                (SELECT COUNT(*) FROM purchase_records WHERE purchase_id LIKE 'SMKPR%') pr`
      );
      const r = resid[0];
      const clean = Object.values(r).every((v) => Number(v) === 0);
      console.log(clean ? '清理完成：无残留 ✓' : '⚠️ 仍有残留：' + JSON.stringify(r));
      if (!clean) fail++;
      else pass++;
    } catch (e) {
      console.log('  ⚠️ 清理异常（可能有残留）: ' + e.message);
      fail++;
    }
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();

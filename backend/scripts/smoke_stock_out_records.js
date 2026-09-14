/**
 * 冒烟测试：P1-F4 出库台账
 * 链路：出库 1 件 → 断言台账新增记录且字段完整（快照/类型/出库后库存/经手人）
 *      → 断言列表接口筛选可用 → 恢复库存并清理台账记录
 * 运行：node scripts/smoke_stock_out_records.js（需后端已启动）
 */
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
const assert = (cond, name) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
};

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  const { pool } = require('../src/config/db');

  // 找一个库存充足的商品做测试对象。若真实数据里没有（库存被清空 / 全新部署），
  // 就自建一个带「SMK / 冒烟」标记的临时商品+库存，避免脚本依赖真实数据而假失败
  // （项目约定：禁止把真实数据当测试对象，且测试数据必须带标记便于清理）。
  let [[inv]] = await pool.query("SELECT product_id, quantity FROM inventory WHERE quantity >= 5 ORDER BY quantity DESC LIMIT 1");
  let tempProduct = null;
  if (!inv) {
    const pid = 'SMK' + Date.now();
    await pool.query(
      "INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, category, status, created_at, updated_at) " +
      "VALUES (?, ?, ?, '', '箱', 1, 1, 1, 1, 0, 0, 0, 0, 0, '冒烟测试', 1, NOW(), NOW())",
      [pid, pid, '冒烟-出库台账测试商品']
    );
    await pool.query('INSERT INTO inventory (product_id, quantity) VALUES (?, 20)', [pid]);
    inv = { product_id: pid, quantity: 20 };
    tempProduct = pid;
    console.log('  [准备] 无充足库存商品，已自建临时冒烟商品 ' + pid);
  }
  assert(!!inv, '找到测试商品库存');

  const pid = inv.product_id;
  const before = inv.quantity;

  const cleanup = async () => {
    // 恢复库存 + 删除台账记录；临时商品则连同库存一并物理清除
    try {
      await pool.query('UPDATE inventory SET quantity = ? WHERE product_id = ?', [before, pid]);
      await pool.query("DELETE FROM stock_out_records WHERE remark = '冒烟-台账测试'");
      if (tempProduct) {
        await pool.query('DELETE FROM inventory WHERE product_id = ?', [tempProduct]);
        await pool.query('DELETE FROM products WHERE product_id = ?', [tempProduct]);
      }
    } catch (e) {
      console.error('清理失败:', e.message);
    }
  };

  // 无 token 拉台账应被拦截
  const noAuth = await call('GET', '/inventory/stock-out-records?page=1');
  assert(noAuth.code === 401, '未登录访问台账被拦截(401)');

  try {
    // 出库 2 件
    const out = await call('POST', '/inventory/out', { productId: pid, quantity: 2, type: 2, remark: '冒烟-台账测试' }, token);
    assert(out.code === 200, `出库成功: ${out.message || ''}`);

    // 台账应有记录
    const list = await call('GET', '/inventory/stock-out-records?page=1&pageSize=10', null, token);
    assert(list.code === 200, '台账列表接口可用');
    const rec = (list.data?.list || []).find(r => r.productId === pid && r.remark === '冒烟-台账测试');
    assert(!!rec, '找到本次出库台账记录');
    if (rec) {
      assert(rec.quantity === 2, `数量=2（实际 ${rec.quantity}）`);
      assert(rec.outType === 2, `类型=2 调拨出库（实际 ${rec.outType}）`);
      assert(rec.stockAfter === before - 2, `出库后库存=${before - 2}（实际 ${rec.stockAfter}）`);
      assert(!!rec.recordId && rec.recordId.startsWith('SO'), `单号 SO 前缀（${rec.recordId}）`);
      assert(!!rec.handler, `经手人已记录（${rec.handler}）`);
      assert(!!rec.createdAt, '出库时间已记录');
    }

    // 类型筛选
    const filtered = await call('GET', '/inventory/stock-out-records?outType=1&page=1&pageSize=100', null, token);
    assert(!(filtered.data?.list || []).some(r => r.remark === '冒烟-台账测试'), '类型筛选 outType=1 不含本次(type=2)记录');

    // 关键词筛选
    const kw = await call('GET', `/inventory/stock-out-records?keyword=${encodeURIComponent('冒烟-台账测试')}&page=1&pageSize=10`, null, token);
    assert((kw.data?.list || []).length >= 1, '关键词筛选命中');

    // 恢复并校验（临时商品此时尚未删除，可核对数量）
    await pool.query('UPDATE inventory SET quantity = ? WHERE product_id = ?', [before, pid]);
    await pool.query("DELETE FROM stock_out_records WHERE remark = '冒烟-台账测试'");
    const [[after]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [pid]);
    assert(after.quantity === before, `库存已恢复（${after.quantity} === ${before}）`);
  } finally {
    // 无论断言是否失败/提前抛错，都必须清干净临时商品与台账记录
    await cleanup();
  }
  console.log('清理完成');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });

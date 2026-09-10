// 冒烟：入库关联公司账户（扣款 + 流水 + 作废退回）
// 用法：node backend/scripts/smoke_stockin_account.js
const BASE = 'http://localhost:3000/api';
const mysql = require('mysql2/promise');
require('dotenv').config();
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');

let pool; // 模块级：异常路径的兜底清理也要能拿到它
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function db() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nongfu_inventory'
  });
}

async function main() {
  pool = await db();

  // 登录
  const lr = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  }).then(r => r.json());
  if (lr.code !== 200) throw new Error('登录失败：' + lr.message);
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lr.data.token };
  const call = (path, opt = {}) => fetch(`${BASE}${path}`, { headers: H, ...opt }).then(r => r.json());

  // 准备数据：账户 + 商品
  const accRes = await call('/finance-accounts');
  const accounts = (accRes.data?.list || []).filter(a => a.status);
  if (!accounts.length) throw new Error('无启用账户，无法冒烟');
  let acc = accounts.find(a => Number(a.currentBalance) > 0);

  // 无可用余额时，先人工收入入账 1000（走正规调账接口，保证有流水）
  if (!acc) {
    acc = accounts[0];
    const adj = await call(`/finance-accounts/${acc.accountId}/adjust`, {
      method: 'POST', body: JSON.stringify({ type: 'income', amount: 1000, remark: '冒烟测试：预充值' })
    });
    if (adj.code !== 200) throw new Error('预充值失败：' + JSON.stringify(adj));
    acc = (await call('/finance-accounts')).data.list.find(a => a.accountId === acc.accountId);
  }

  // 造一个临时商品，避免把测试入库记录挂到真实商品上
  // （历史教训：旧版取 products LIMIT 1，导致真实商品被冒烟入库单/流水污染）
  const productId = 'SMK' + Date.now();
  await pool.query(
    `INSERT INTO products (product_id, product_code, product_name, specification, unit,
       purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
       distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
       worker_machine_delivery_fee, status)
     VALUES (?,?,?,?,?, 10, 12, 15, 16, 2, 1.5, 1, 0.8, 0.6, 1)`,
    [productId, 'SMK' + String(Date.now()).slice(-8), '冒烟入库账户测试商品', '550ml', '箱']
  );
  await pool.query('INSERT INTO inventory (product_id, quantity, last_in_time) VALUES (?, 0, NOW())', [productId]);
  const product = { product_id: productId, product_name: '冒烟入库账户测试商品' };

  const stockOf = async () => {
    const [[r]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [product.product_id]);
    return r ? Number(r.quantity) : 0;
  };
  const balanceOf = async (id) => {
    const [[r]] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [id]);
    return Number(r.current_balance);
  };

  console.log(`\n测试账户：${acc.accountName}  余额 ¥${(await balanceOf(acc.accountId)).toFixed(2)}`);
  console.log(`测试商品：${product.product_name}  当前库存 ${await stockOf()}\n`);

  // ---------- 1. 未选择账户 ----------
  console.log('【1】未选择付款账户应被拒绝');
  const stock0 = await stockOf(), bal0 = await balanceOf(acc.accountId);
  const r1 = await call('/inventory/in', {
    method: 'POST', body: JSON.stringify({ productId: product.product_id, quantity: 5, unitPrice: 1 })
  });
  check('返回 400 提示选择账户', r1.code === 400 && /账户/.test(r1.message), JSON.stringify(r1));
  check('库存未变化', (await stockOf()) === stock0);
  check('余额未变化', (await balanceOf(acc.accountId)) === bal0);

  // ---------- 2. 账户不存在 ----------
  console.log('【2】不存在的账户应被拒绝');
  const r2 = await call('/inventory/in', {
    method: 'POST', body: JSON.stringify({ productId: product.product_id, quantity: 5, unitPrice: 1, accountId: 'NOT_EXIST' })
  });
  check('返回 400 账户不存在/停用', r2.code === 400, JSON.stringify(r2));
  check('库存未变化', (await stockOf()) === stock0);

  // ---------- 3. 余额不足（事务回滚） ----------
  console.log('【3】余额不足应整体回滚');
  const huge = (await balanceOf(acc.accountId)) + 100000;
  const r3 = await call('/inventory/in', {
    method: 'POST', body: JSON.stringify({ productId: product.product_id, quantity: 1, unitPrice: huge, accountId: acc.accountId })
  });
  check('返回 400 余额不足', r3.code === 400 && /余额不足/.test(r3.message), JSON.stringify(r3));
  check('库存未增加（已回滚）', (await stockOf()) === stock0);
  check('余额未扣减（已回滚）', (await balanceOf(acc.accountId)) === bal0);

  // ---------- 4. 正常入库扣款 ----------
  console.log('【4】正常入库：库存 + 扣款 + 流水');
  const qty = 5, price = 2;
  const r4 = await call('/inventory/in', {
    method: 'POST', body: JSON.stringify({ productId: product.product_id, quantity: qty, unitPrice: price, accountId: acc.accountId, remark: '冒烟测试入库' })
  });
  check('入库成功', r4.code === 200, JSON.stringify(r4));
  const purchaseId = r4.data?.purchaseId;
  check('返回入库单号', !!purchaseId);
  check(`库存 +${qty}`, (await stockOf()) === stock0 + qty);
  const bal1 = await balanceOf(acc.accountId);
  check(`余额 -${qty * price}`, Math.abs(bal1 - (bal0 - qty * price)) < 0.001, `期望 ${bal0 - qty * price}，实际 ${bal1}`);

  // 流水
  const [[tx]] = await pool.query(
    `SELECT * FROM finance_transactions WHERE related_module = 'purchase' AND related_id = ?`, [purchaseId]
  );
  check('生成资金流水', !!tx);
  if (tx) {
    check('流水类型为支出(2)', Number(tx.tx_type) === 2);
    check('流水分类为采购入库', tx.tx_category === '采购入库');
    check('流水金额 = 10', Math.abs(Number(tx.amount) - qty * price) < 0.001);
    check('变动前余额正确', Math.abs(Number(tx.balance_before) - bal0) < 0.001);
    check('变动后余额正确', Math.abs(Number(tx.balance_after) - bal1) < 0.001);
    check('流水含操作人', !!tx.handler, String(tx.handler));
    check('流水含交易时间', !!tx.tx_date);
  }
  // 入库单字段
  const [[pr]] = await pool.query('SELECT * FROM purchase_records WHERE purchase_id = ?', [purchaseId]);
  check('入库单记录账户ID', pr.account_id === acc.accountId);
  check('入库单记录账户名快照', pr.account_name === acc.accountName);
  check('入库单实付金额 = 10', Math.abs(Number(pr.paid_amount) - qty * price) < 0.001);
  check('入库单 payment_status = 1', Number(pr.payment_status) === 1);
  check('入库单 status = 1', Number(pr.status) === 1);

  // ---------- 5. 入库记录列表 ----------
  console.log('【5】入库记录列表');
  const r5 = await call(`/inventory/purchases?keyword=${purchaseId}`);
  check('列表可查到该单', r5.code === 200 && (r5.data?.list || []).some(x => x.purchaseId === purchaseId), JSON.stringify(r5).slice(0, 200));

  // ---------- 6. 作废退回 ----------
  console.log('【6】作废入库单：回退库存 + 原路退回');
  const r6 = await call(`/inventory/purchases/${purchaseId}/void`, {
    method: 'POST', body: JSON.stringify({ reason: '冒烟测试作废' })
  });
  check('作废成功', r6.code === 200, JSON.stringify(r6));
  check(`库存回退至 ${stock0}`, (await stockOf()) === stock0);
  const bal2 = await balanceOf(acc.accountId);
  check(`余额回补至 ${bal0}`, Math.abs(bal2 - bal0) < 0.001, `期望 ${bal0}，实际 ${bal2}`);

  const [[tx2]] = await pool.query(
    `SELECT * FROM finance_transactions WHERE related_module = 'purchase_void' AND related_id = ?`, [purchaseId]
  );
  check('生成退回流水', !!tx2);
  if (tx2) {
    check('退回流水类型为收入(1)', Number(tx2.tx_type) === 1);
    check('退回金额 = 10', Math.abs(Number(tx2.amount) - qty * price) < 0.001);
    check('退回变动后余额正确', Math.abs(Number(tx2.balance_after) - bal0) < 0.001);
  }
  const [[pr2]] = await pool.query('SELECT * FROM purchase_records WHERE purchase_id = ?', [purchaseId]);
  check('入库单状态 = 已作废(2)', Number(pr2.status) === 2);
  check('记录作废人与原因', !!pr2.void_by && pr2.void_reason === '冒烟测试作废');

  // ---------- 7. 重复作废 ----------
  console.log('【7】重复作废应被拒绝');
  const r7 = await call(`/inventory/purchases/${purchaseId}/void`, {
    method: 'POST', body: JSON.stringify({ reason: '再作废一次' })
  });
  check('返回 400 已作废', r7.code === 400, JSON.stringify(r7));
  check('余额未被二次回补', Math.abs((await balanceOf(acc.accountId)) - bal0) < 0.001);

  // ---------- 8. 作废不存在的单 ----------
  console.log('【8】作废不存在的入库单应被拒绝');
  const r8 = await call(`/inventory/purchases/NOT_EXIST/void`, {
    method: 'POST', body: JSON.stringify({ reason: 'x' })
  });
  check('返回 400 单据不存在', r8.code === 400, JSON.stringify(r8));

  // ---------- 9. 0 元入库（盘库场景） ----------
  console.log('【9】0 元入库（盘库增加）');
  const bal3 = await balanceOf(acc.accountId), stock3 = await stockOf();
  const r9 = await call('/inventory/in', {
    method: 'POST', body: JSON.stringify({ productId: product.product_id, quantity: 3, unitPrice: 0, accountId: acc.accountId, remark: '盘库增加: 其他原因' })
  });
  check('0 元入库成功', r9.code === 200, JSON.stringify(r9));
  check('库存 +3', (await stockOf()) === stock3 + 3);
  check('余额不变', Math.abs((await balanceOf(acc.accountId)) - bal3) < 0.001);
  // 清理：作废盘库单（断言用），随后统一收尾物理删除临时商品/入库单/流水，
  // 并把「冒烟预充值」这类垫资一并清掉、按恒等式重算账户余额。
  if (r9.code === 200) await call(`/inventory/purchases/${r9.data.purchaseId}/void`, { method: 'POST', body: JSON.stringify({ reason: '冒烟清理' }) });
  await cleanupSmokeResidue(pool);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
}

main()
  .then(async () => { await pool.end(); process.exit(fail ? 1 : 0); })
  .catch(async (e) => {
    console.error('冒烟异常:', e);
    // 异常路径也要清理，否则临时商品与入库单会留在库里
    if (pool) { await cleanupSmokeResidue(pool); await pool.end(); }
    process.exit(1);
  });

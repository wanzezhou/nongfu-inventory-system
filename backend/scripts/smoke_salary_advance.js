/**
 * 冒烟（新增）：固定月薪 + 工资预支 + 负数挂账（2026-09-07）
 * 覆盖：
 *   1. 店长/业务员固定月薪（workers.monthly_salary 增改查；2026-09-09 起月薪不再自动计入应发，汇总口径=全员配送费）
 *   2. 预支登记（公司账户扣款 + 支出流水）
 *   3. 发工资抵扣预支（实发 = 应发 - 待扣预支）
 *   4. 已参与结算的预支不可撤销
 *   5. 负数结算（预支 > 应发，实发为负挂账下月继续扣，负数发放不扣账户无流水）
 *   6. 下月续扣 + 预支全部结清
 *   7. 撤销发放反向还原预支（含负数发放撤销不动账户）
 *   8. 撤销预支回补账户 + 删流水
 *   9. 配送员工：配送费 + 预支负数挂账 + 下月续扣（端到端核心链路）
 * 运行：node scripts/smoke_salary_advance.js（需后端已启动）
 * 清理：测试员工/订单/商品/预支/发放/流水全部删除，账户余额绝对还原。
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = 'http://localhost:3000/api';
const { revertOrderRevenueBySql } = require('./lib/smokeCleanup');

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
function assert(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
const approx = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  const token = login.data.token;

  const { pool } = require('../src/config/db');
  const cleanup = { workers: [], orders: [], productIds: [], paymentIds: [], advanceIds: [] };
  let accId = null, accBal0 = null;

  const setBal = async (v) => {
    await pool.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [v, accId]);
  };
  const bal = async () => {
    const [b] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accId]);
    return Number(b[0].current_balance);
  };
  const nextItemId = async () => {
    const [[r]] = await pool.query('SELECT COALESCE(MAX(item_id), 0) + 1 AS n FROM order_items');
    return r.n;
  };
  const workerIdOf = (name) => {
    const w = cleanup.workers.find((x) => x[1] === name);
    return w ? w[0] : null;
  };

  try {
    // 测试月份（当月 / 下月）
    const now = new Date();
    const mon = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nextMon = now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;

    // 启用账户（余额最大的），临时置为 200000 保证全程足够
    const [[acc]] = await pool.query(
      "SELECT account_id, account_name FROM finance_accounts WHERE status = 1 ORDER BY current_balance DESC LIMIT 1"
    );
    assert(!!acc, '存在启用账户');
    accId = acc.account_id;
    const [bb] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accId]);
    accBal0 = Number(bb[0].current_balance);
    await setBal(200000);

    // ---------- 1. 员工固定月薪 ----------
    console.log('\n[1] 员工固定月薪');
    let r = await call('POST', '/workers', { workerName: '冒烟店长', phone: '13800001111', employeeType: 1, vehicleType: 1, monthlySalary: 5000 }, token);
    assert(r.code === 200 && r.data?.workerId, '创建店长（月薪5000）', JSON.stringify(r));
    cleanup.workers.push([r.data.workerId, '冒烟店长']);
    assert(approx(r.data.monthlySalary, 5000), '店长 monthlySalary=5000', String(r.data.monthlySalary));
    r = await call('PUT', `/workers/${workerIdOf('冒烟店长')}`, { monthlySalary: 5500 }, token);
    assert(approx(r.data?.monthlySalary, 5500), '更新店长月薪=5500', JSON.stringify(r));
    r = await call('POST', '/workers', { workerName: '冒烟业务员', phone: '13800002222', employeeType: 3, vehicleType: 1, monthlySalary: 6000, commissionRate: 2 }, token);
    assert(r.code === 200 && r.data?.workerId, '创建业务员（月薪6000）', JSON.stringify(r));
    cleanup.workers.push([r.data.workerId, '冒烟业务员']);
    assert(approx(r.data.monthlySalary, 6000), '业务员 monthlySalary=6000', String(r.data.monthlySalary));
    r = await call('POST', '/workers', { workerName: '冒烟配送', phone: '13800003333', employeeType: 2, vehicleType: 1 }, token);
    assert(r.code === 200 && r.data?.workerId, '创建配送员工（无月薪）', JSON.stringify(r));
    cleanup.workers.push([r.data.workerId, '冒烟配送']);
    assert(r.data.monthlySalary == null, '配送员工 monthlySalary 为空', String(r.data.monthlySalary));

    // ---------- 2. 工资统计：全员应发=当月配送费（月薪不再自动计入，2026-09-09 起） ----------
    console.log('\n[2] 工资统计（全员应发=配送费口径）');
    r = await call('GET', `/salary/summary?month=${mon}`, null, token);
    assert(r.code === 200 && Array.isArray(r.data?.list), '工资汇总查询成功', JSON.stringify(r));
    const rowOf = (wid) => (r.data.list || []).find((x) => x.workerId === wid);
    let row = rowOf(workerIdOf('冒烟店长'));
    assert(row && approx(row.due, 0), '店长（当月无订单）应发=0（月薪不再自动计入）', row ? String(row.due) : 'no row');
    row = rowOf(workerIdOf('冒烟业务员'));
    assert(row && approx(row.due, 0), '业务员（当月无订单）应发=0', row ? String(row.due) : 'no row');
    row = rowOf(workerIdOf('冒烟配送'));
    assert(row && approx(row.due, 0), '配送员工（当月无订单）应发=0', row ? String(row.due) : 'no row');

    // ---------- 3. 预支登记（账户扣款 + 流水） ----------
    console.log('\n[3] 预支登记（账户扣款+流水）');
    r = await call('POST', '/salary/advances', { workerId: workerIdOf('冒烟店长'), amount: 3000, advanceDate: `${mon}-05`, accountId: accId, remark: '冒烟-预支3000' }, token);
    assert(r.code === 200 && r.data?.advanceId, '预支登记成功', JSON.stringify(r));
    cleanup.advanceIds.push(r.data.advanceId);
    const adv1 = r.data.advanceId;
    assert(approx(await bal(), 197000), '账户扣款3000（200000-3000）', String(await bal()));
    let [tx] = await pool.query("SELECT * FROM finance_transactions WHERE related_module='salary_advance' AND related_id=?", [adv1]);
    assert(tx.length === 1 && tx[0].tx_category === '工资预支' && approx(tx[0].amount, 3000), '支出流水（工资预支,3000）');
    r = await call('GET', `/salary/advances?workerId=${workerIdOf('冒烟店长')}`, null, token);
    assert(r.code === 200 && r.data?.list?.length === 1 && approx(r.data.list[0].pendingAmount, 3000), '预支列表 pendingAmount=3000');

    // ---------- 4. 发工资抵扣预支 ----------
    console.log('\n[4] 发工资抵扣预支（实发=应发-预支）');
    r = await call('POST', '/salary/pay', { workerId: workerIdOf('冒烟店长'), month: mon, accountId: accId, amount: 5500, remark: '冒烟-发放' }, token);
    assert(r.code === 200 && r.data?.paymentId, '发放成功', JSON.stringify(r));
    cleanup.paymentIds.push(r.data.paymentId);
    const pay1 = r.data.paymentId;
    assert(approx(r.data.amount, 2500), '实发=2500（5500-3000）', String(r.data.amount));
    assert(approx(await bal(), 194500), '账户再扣2500', String(await bal()));
    [tx] = await pool.query("SELECT * FROM finance_transactions WHERE related_module='salary_payment' AND related_id=?", [pay1]);
    assert(tx.length === 1 && tx[0].tx_category === '工资发放' && approx(tx[0].amount, 2500), '发放支出流水2500');
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv1]);
    assert(approx(tx[0].deducted_amount, 3000) && Number(tx[0].status) === 1, '预支结清（deducted=3000,status=1）');
    [tx] = await pool.query('SELECT * FROM salary_payment_advances WHERE payment_id = ?', [pay1]);
    assert(tx.length === 1 && approx(tx[0].deducted_amount, 3000), '发放-预支抵扣明细已记录');
    r = await call('GET', `/salary/summary?month=${mon}`, null, token);
    row = rowOf(workerIdOf('冒烟店长'));
    assert(row && row.paid && approx(row.paidAmount, 2500), '汇总已发放行锁定 2500', row ? JSON.stringify({ paid: row.paid, paidAmount: row.paidAmount }) : 'no row');

    // ---------- 5. 已参与结算的预支不可撤销 ----------
    console.log('\n[5] 已参与结算的预支不可撤销');
    r = await call('DELETE', `/salary/advances/${adv1}`, null, token);
    assert(r.code === 400, '已结清预支撤销被拒', JSON.stringify(r));

    // ---------- 6. 负数结算（预支>应发） ----------
    console.log('\n[6] 负数结算（预支>应发）');
    r = await call('POST', '/salary/advances', { workerId: workerIdOf('冒烟业务员'), amount: 8000, advanceDate: `${mon}-06`, accountId: accId, remark: '冒烟-预支8000' }, token);
    assert(r.code === 200 && r.data?.advanceId, '业务员预支8000', JSON.stringify(r));
    cleanup.advanceIds.push(r.data.advanceId);
    const adv2 = r.data.advanceId;
    assert(approx(await bal(), 186500), '账户扣款8000', String(await bal()));
    r = await call('POST', '/salary/pay', { workerId: workerIdOf('冒烟业务员'), month: mon, accountId: accId, amount: 6000 }, token);
    assert(r.code === 200 && approx(r.data.amount, -2000), '实发=-2000（负数挂账）', JSON.stringify(r));
    cleanup.paymentIds.push(r.data.paymentId);
    const pay2 = r.data.paymentId;
    assert(approx(await bal(), 186500), '负数发放不扣账户', String(await bal()));
    [tx] = await pool.query("SELECT COUNT(*) n FROM finance_transactions WHERE related_module='salary_payment' AND related_id=?", [pay2]);
    assert(Number(tx[0].n) === 0, '负数发放无支出流水');
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2]);
    assert(approx(tx[0].deducted_amount, 6000) && Number(tx[0].status) === 0, '预支部分抵扣（6000,未结清）');
    r = await call('GET', `/salary/summary?month=${mon}`, null, token);
    row = rowOf(workerIdOf('冒烟业务员'));
    assert(row && row.paid && approx(row.paidAmount, -2000), '汇总已发放行锁定 -2000', row ? JSON.stringify({ paidAmount: row.paidAmount }) : 'no row');

    // ---------- 7. 下月续扣 ----------
    console.log('\n[7] 下月续扣');
    r = await call('POST', '/salary/pay', { workerId: workerIdOf('冒烟业务员'), month: nextMon, accountId: accId, amount: 6000 }, token);
    assert(r.code === 200 && approx(r.data.amount, 4000), '下月实发=4000（6000-2000）', JSON.stringify(r));
    cleanup.paymentIds.push(r.data.paymentId);
    const pay3 = r.data.paymentId;
    assert(approx(await bal(), 182500), '下月扣款4000', String(await bal()));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2]);
    assert(approx(tx[0].deducted_amount, 8000) && Number(tx[0].status) === 1, '预支全部结清');

    // ---------- 8. 撤销发放还原预支 ----------
    console.log('\n[8] 撤销发放还原预支');
    r = await call('DELETE', `/salary/payments/${pay3}`, null, token);
    assert(r.code === 200, '撤销下月发放', JSON.stringify(r));
    assert(approx(await bal(), 186500), '账户回补4000', String(await bal()));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2]);
    assert(approx(tx[0].deducted_amount, 6000) && Number(tx[0].status) === 0, '预支还原（6000,未结清）');
    r = await call('DELETE', `/salary/payments/${pay2}`, null, token);
    assert(r.code === 200, '撤销负数发放', JSON.stringify(r));
    assert(approx(await bal(), 186500), '撤销负数发放不动账户', String(await bal()));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [adv2]);
    assert(approx(tx[0].deducted_amount, 0) && Number(tx[0].status) === 0, '预支全额还原');

    // ---------- 9. 撤销预支回补 ----------
    console.log('\n[9] 撤销预支回补');
    r = await call('DELETE', `/salary/advances/${adv2}`, null, token);
    assert(r.code === 200, '撤销未结清预支', JSON.stringify(r));
    assert(approx(await bal(), 194500), '账户回补8000', String(await bal()));
    [tx] = await pool.query("SELECT COUNT(*) n FROM finance_transactions WHERE related_module='salary_advance' AND related_id=?", [adv2]);
    assert(Number(tx[0].n) === 0, '预支流水已删除');

    // ---------- 10. 配送员工：配送费+预支+负数挂账+下月续扣 ----------
    console.log('\n[10] 配送员工（配送费+预支+负数挂账+下月续扣）');
    const pid = `P${Date.now()}`;
    cleanup.productIds.push(pid);
    await pool.query(
      "INSERT INTO products (product_id, product_code, product_name, specification, unit, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
      [pid, 'T' + pid, '冒烟工资测试', '550ml', '箱', 10, 15, 20, 5, 2, 0, 5, 0, 0]
    );
    await pool.query('INSERT INTO inventory (product_id, quantity, last_in_time) VALUES (?, 100, NOW())', [pid]);
    // 当月订单：类型1 × 4件 → 零售配送费 5×4=20
    const o1 = `O${Date.now()}a`;
    cleanup.orders.push(o1);
    await pool.query(
      "INSERT INTO orders (order_id, order_type, customer_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, created_at) VALUES (?, 1, '冒烟配送客户', 40, 0, 40, 1, ?, NOW())",
      [o1, workerIdOf('冒烟配送')]
    );
    await pool.query(
      "INSERT INTO order_items (item_id, order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, pricing_type, ticket_qty, subtotal) VALUES (?, ?, ?, 4, 10, 10, 15, 20, 5, 2, 0, 5, 0, 0, 1, 0, 40)",
      [await nextItemId(o1), o1, pid]
    );
    r = await call('GET', `/salary/summary?month=${mon}`, null, token);
    row = rowOf(workerIdOf('冒烟配送'));
    assert(row && approx(row.due, 20), '配送员工 汇总应发=20', row ? String(row.due) : 'no row');
    // 预支 30 > 配送费 20 → 实发 -10
    r = await call('POST', '/salary/advances', { workerId: workerIdOf('冒烟配送'), amount: 30, advanceDate: `${mon}-07`, accountId: accId }, token);
    assert(r.code === 200 && r.data?.advanceId, '配送员工预支30', JSON.stringify(r));
    cleanup.advanceIds.push(r.data.advanceId);
    const advWD = r.data.advanceId;
    assert(approx(await bal(), 194470), '账户扣款30', String(await bal()));
    r = await call('POST', '/salary/pay', { workerId: workerIdOf('冒烟配送'), month: mon, accountId: accId, amount: 20 }, token);
    assert(r.code === 200 && approx(r.data.amount, -10), '配送员工 实发=-10', JSON.stringify(r));
    cleanup.paymentIds.push(r.data.paymentId);
    const payWD1 = r.data.paymentId;
    assert(approx(await bal(), 194470), '负数发放不扣账户', String(await bal()));
    // 下月订单：类型1 × 10件 → 配送费 5×10=50 → 实发 = 50-10 = 40
    const o2 = `O${Date.now()}b`;
    cleanup.orders.push(o2);
    await pool.query(
      "INSERT INTO orders (order_id, order_type, customer_name, order_amount, delivery_fee, total_receivable, delivery_type, worker_id, created_at) VALUES (?, 1, '冒烟配送客户2', 100, 0, 100, 1, ?, STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s'))",
      [o2, workerIdOf('冒烟配送'), `${nextMon}-15 10:00:00`]
    );
    await pool.query(
      "INSERT INTO order_items (item_id, order_id, product_id, quantity, unit_price, purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee, distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee, pricing_type, ticket_qty, subtotal) VALUES (?, ?, ?, 10, 10, 10, 15, 20, 5, 2, 0, 5, 0, 0, 1, 0, 100)",
      [await nextItemId(o2), o2, pid]
    );
    r = await call('POST', '/salary/pay', { workerId: workerIdOf('冒烟配送'), month: nextMon, accountId: accId, amount: 50 }, token);
    assert(r.code === 200 && approx(r.data.amount, 40), '配送员工 下月实发=40', JSON.stringify(r));
    cleanup.paymentIds.push(r.data.paymentId);
    const payWD2 = r.data.paymentId;
    assert(approx(await bal(), 194430), '下月扣款40', String(await bal()));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [advWD]);
    assert(approx(tx[0].deducted_amount, 30) && Number(tx[0].status) === 1, '配送员工预支结清');
    r = await call('DELETE', `/salary/payments/${payWD2}`, null, token);
    assert(r.code === 200, '撤销配送员工下月发放', JSON.stringify(r));
    assert(approx(await bal(), 194470), '账户回补40', String(await bal()));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [advWD]);
    assert(approx(tx[0].deducted_amount, 20) && Number(tx[0].status) === 0, '预支部分还原（deducted=20,未结清）');
    r = await call('DELETE', `/salary/payments/${payWD1}`, null, token);
    assert(r.code === 200, '撤销配送员工负数发放', JSON.stringify(r));
    [tx] = await pool.query('SELECT deducted_amount, status FROM salary_advances WHERE advance_id = ?', [advWD]);
    assert(approx(tx[0].deducted_amount, 0) && Number(tx[0].status) === 0, '预支全额还原');
  } finally {
    // ---------- 清理还原（DB 直删 + 账户绝对还原） ----------
    try {
      await pool.query('DELETE FROM salary_payment_advances WHERE payment_id IN (?)', [cleanup.paymentIds.length ? cleanup.paymentIds : [null]]);
      await pool.query('DELETE FROM salary_payments WHERE payment_id IN (?)', [cleanup.paymentIds.length ? cleanup.paymentIds : [null]]);
      await pool.query('DELETE FROM salary_advances WHERE advance_id IN (?)', [cleanup.advanceIds.length ? cleanup.advanceIds : [null]]);
      for (const id of [...cleanup.paymentIds, ...cleanup.advanceIds]) {
        await pool.query("DELETE FROM finance_transactions WHERE related_id = ? AND related_module IN ('salary_payment','salary_advance')", [id]);
      }
      if (cleanup.orders.length) {
        const ph = cleanup.orders.map(() => '?').join(',');
        // 需求 5：订单创建即营收入账。原生 SQL 直删订单会绕过 DELETE /orders 的回冲，
        // 必须先手动回冲 order_revenue 流水 + 还原余额。
        await revertOrderRevenueBySql(pool, cleanup.orders);
        await pool.query(`DELETE FROM order_items WHERE order_id IN (${ph})`, cleanup.orders);
        await pool.query(`DELETE FROM orders WHERE order_id IN (${ph})`, cleanup.orders);
      }
      for (const p of cleanup.productIds) {
        await pool.query('DELETE FROM inventory WHERE product_id = ?', [p]);
        await pool.query('DELETE FROM products WHERE product_id = ?', [p]);
      }
      if (cleanup.workers.length) {
        const wids = cleanup.workers.map((x) => x[0]);
        await pool.query('DELETE FROM workers WHERE worker_id IN (?)', [wids]);
      }
      if (accId !== null && accBal0 !== null) {
        await setBal(accBal0);
      }
      console.log('\n清理完成（测试员工/订单/商品/预支/发放/流水已删除，账户余额已还原）');
    } catch (e) {
      console.log('清理异常:', e.message);
    }
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();

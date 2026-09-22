/**
 * 一次性清理：历史冒烟测试残留数据
 *
 * 背景：多个 smoke_*.js 早期版本收尾不完整，在库里留下了测试数据，
 *      且部分表（products / workers）业务删除是「软删除」（status=0），
 *      导致前台上永远看得到、删不掉。
 *
 * 清理范围（物理删除）：
 *   1. workers            冒烟业务员 / 冒烟配送员
 *   2. mini_accounts      smoke_* 冒烟登录账号
 *   3. products           冒烟归一化商品（SMK 前缀）
 *   4. orders             冒烟-水票还原 测试订单（及其 order_items）
 *   5. purchase_records   冒烟入库单 / 冒烟清理盘库单（含已作废单）
 *   6. finance_transactions 上述采购单的收支流水 + 冒烟预充值 + 用户确认删除的测试工资发放流水
 *      + **订单营收入账孤儿流水**（需求 5 上线后，老脚本用原生 SQL 直删订单绕过回冲所致）
 *   7. salary_payments    用户确认删除的测试工资发放单
 *   8. inventory          冒烟商品库存行
 *   9. sub_stations       冒烟自建水站（SMKST 前缀），连同其水票/发行批次/结算/订单引用
 *
 * 收尾：按「余额 = 初始余额 + 剩余流水净额」重算所有账户 current_balance，
 *      保证资金记账恒等式成立后再提交。整个过程单事务，任一步失败整体回滚。
 *      另附「水站欠款对账」只读报告（口径：该站有效 type2 订单金额合计），
 *      历史漂移只提示、不自动改，避免覆盖业务方手工调整或线下还款登记。
 *
 * 用法：
 *   node scripts/cleanup_smoke_data.js          # 预演（只读，不修改任何数据）
 *   node scripts/cleanup_smoke_data.js --apply  # 实际执行
 *
 * 幂等：可重复执行，第二次运行应报告 0 条待清理。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');

/**
 * 本次额外清理的工资发放单（用户 2026-09-10 确认：属工资改造期间的测试发放，
 * 金额 20.40 由冒烟预充值垫付，一并删除后账户回到 0）。
 */
const EXTRA_SALARY_PAYMENT_IDS = ['PAYMTU7ADSXHH'];

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nongfu_inventory',
  charset: 'utf8mb4',
  connectionLimit: 2
});

const line = (s = '') => console.log(s);
const head = s => {
  line();
  line('─'.repeat(64));
  line(s);
  line('─'.repeat(64));
};

async function main() {
  const conn = await pool.getConnection();
  const ins = (sql, args) => conn.query(sql, args);

  try {
    // ============ 1. 采集待删主键（全部为只读查询） ============
    const pick = async (sql, args = []) => {
      const [rows] = await conn.query(sql, args);
      return rows;
    };

    const smokeWorkers = await pick("SELECT worker_id, worker_name, phone FROM workers WHERE worker_name LIKE '冒烟%'");
    // ⚠️ mini_accounts.username / password_hash 两列已随小程序迁移移除（新版走 wx.login + 实名手机号），
    //    继续查 username 会让本脚本**整体报错回滚**（Unknown column 'username'）——
    //    同一个坑在 lib/smokeCleanup.js 修过并留了注释，这里漏了（2026-09-22 实测）。
    const smokeAccounts = await pick("SELECT id, openid FROM mini_accounts WHERE openid LIKE 'smoke\\_%'");
    // 冒烟自建公司账户：**按账户名**识别（账户域走 API 建，account_id 由服务端生成 ACC…，
    // 按前缀清必然漏 —— 实测曾积 56 个）
    const smokeFinanceAccounts = await pick(
      "SELECT account_id, account_name FROM finance_accounts WHERE account_name LIKE '冒烟%'"
    );
    const smokeProducts = await pick(
      "SELECT product_id, product_code, product_name FROM products WHERE product_name LIKE '冒烟%' OR product_name LIKE '%测试商品%' OR product_code LIKE 'SMK%' OR product_code LIKE 'TESTP%'"
    );
    const smokeOrders = await pick("SELECT order_id, customer_name FROM orders WHERE customer_name LIKE '冒烟%'");
    const smokePurchases = await pick(
      "SELECT purchase_id, product_id, status, remark, void_reason FROM purchase_records WHERE remark LIKE '%冒烟%' OR void_reason LIKE '%冒烟%'"
    );

    const workerIds = smokeWorkers.map(r => r.worker_id);
    const accountIds = smokeAccounts.map(r => r.id);
    const productIds = smokeProducts.map(r => r.product_id);
    const orderIds = smokeOrders.map(r => r.order_id);
    const purchaseIds = smokePurchases.map(r => r.purchase_id);

    // 流水：①采购单关联 ②命中冒烟备注 ③本次额外确认的工资发放
    const txByPurchase = purchaseIds.length
      ? await pick('SELECT tx_id, tx_no, amount, tx_type, remark FROM finance_transactions WHERE related_id IN (?)', [
          purchaseIds
        ])
      : [];
    const txByRemark = await pick(
      "SELECT tx_id, tx_no, amount, tx_type, remark FROM finance_transactions WHERE remark LIKE '%冒烟%'"
    );
    const txBySalary = EXTRA_SALARY_PAYMENT_IDS.length
      ? await pick(
          "SELECT tx_id, tx_no, amount, tx_type, remark FROM finance_transactions WHERE related_module = 'salary_payment' AND related_id IN (?)",
          [EXTRA_SALARY_PAYMENT_IDS]
        )
      : [];
    const txIds = [...new Set([...txByPurchase, ...txByRemark, ...txBySalary].map(r => r.tx_id))];

    const salaries = EXTRA_SALARY_PAYMENT_IDS.length
      ? await pick(
          'SELECT payment_id, worker_name, salary_month, amount FROM salary_payments WHERE payment_id IN (?)',
          [EXTRA_SALARY_PAYMENT_IDS]
        )
      : [];

    // 关联产物（用于删除）
    const orderItems = orderIds.length
      ? await pick('SELECT item_id FROM order_items WHERE order_id IN (?)', [orderIds])
      : [];
    const orderItemsByProduct = productIds.length
      ? await pick('SELECT item_id FROM order_items WHERE product_id IN (?)', [productIds])
      : [];
    const dfSettleByOrder = orderIds.length
      ? await pick('SELECT settlement_id FROM delivery_fee_settlement WHERE order_id IN (?)', [orderIds])
      : [];
    const dfSettleByProduct = productIds.length
      ? await pick('SELECT settlement_id FROM delivery_fee_settlement WHERE product_id IN (?)', [productIds])
      : [];
    const finSettle =
      orderIds.length || workerIds.length
        ? await pick(`SELECT settlement_id FROM financial_settlement WHERE order_id IN (?) OR worker_id IN (?)`, [
            orderIds.length ? orderIds : [null],
            workerIds.length ? workerIds : [null]
          ])
        : [];
    const invRows = productIds.length
      ? await pick('SELECT inventory_id FROM inventory WHERE product_id IN (?)', [productIds])
      : [];
    const machineSales = productIds.length
      ? await pick('SELECT sale_id FROM machine_sales WHERE product_id IN (?)', [productIds])
      : [];
    // 冒烟自建机台（SMKM* 前缀 / 名称含冒烟）—— 2026-09-15 起纳入口径
    const smokeMachines = await pick(
      "SELECT machine_id, station_name FROM machine_stations WHERE machine_id LIKE 'SMKM%' OR station_name LIKE '冒烟%'"
    );
    const machineIds = smokeMachines.map(r => r.machine_id);
    // 冒烟自建水站（SMKST* 前缀 / 名称含冒烟）—— 2026-09-16 起纳入口径
    // 背景：旧版冒烟脚本取「真实水站」建单（sub_stations ORDER BY station_id LIMIT 1），
    //      建单经 addStationDebt 直接累加真实 current_debt；清理靠「跑前快照回写」，
    //      脚本异常退出或两脚本交叉执行时虚高会被固化（实测 ST001 由 154 涨到 550）。
    const smokeStations = await pick(
      "SELECT station_id, station_name, current_debt FROM sub_stations WHERE station_id LIKE 'SMKST%' OR station_name LIKE '冒烟%'"
    );
    const stationIds = smokeStations.map(r => r.station_id);
    const stockOuts = productIds.length
      ? await pick('SELECT record_id FROM stock_out_records WHERE product_id IN (?)', [productIds])
      : [];
    const tickets = productIds.length
      ? await pick('SELECT ticket_id FROM water_tickets WHERE product_id IN (?)', [productIds])
      : [];
    const ticketIssues = productIds.length
      ? await pick('SELECT issuance_id FROM water_ticket_issuance WHERE product_id IN (?)', [productIds])
      : [];
    const ticketsByOrder = orderIds.length
      ? await pick('SELECT ticket_id FROM water_tickets WHERE order_id IN (?)', [orderIds])
      : [];
    // 水票标记口径：2099 未来月份（脚本写死 month:'2099-01'）/ 脚本专用 issued_by / 冒烟备注
    const ticketMarkers = await pick(
      "SELECT ticket_id, product_id, month, issued_by FROM water_tickets WHERE month LIKE '2099%' OR issued_by IN ('smoke', 't1', 'a6') OR remark LIKE '%冒烟%'"
    );
    const salaryLinks = EXTRA_SALARY_PAYMENT_IDS.length
      ? await pick('SELECT payment_id, advance_id FROM salary_payment_advances WHERE payment_id IN (?)', [
          EXTRA_SALARY_PAYMENT_IDS
        ])
      : [];
    const ordersByWorker = workerIds.length
      ? await pick('SELECT order_id FROM orders WHERE worker_id IN (?) OR created_by IN (?)', [workerIds, workerIds])
      : [];
    // 订单营收入账（需求 5）的孤儿流水：部分老冒烟脚本用原生 SQL 直删订单，
    // 绕过 DELETE /orders 的回冲逻辑 → related_module='order_revenue' 的流水成悬挂数据。
    const orphanRevenueTx = await pick(
      `SELECT tx_id, account_id, amount, related_id FROM finance_transactions
       WHERE related_module = 'order_revenue'
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = finance_transactions.related_id)`
    );

    // ============ 2. 打印清理计划 ============
    head(`冒烟残留清理计划　${APPLY ? '【实际执行】' : '【预演 · 不修改数据】'}`);
    const plan = [
      ['workers（冒烟员工）', smokeWorkers.map(r => `${r.worker_id}/${r.worker_name}`)],
      ['mini_accounts（冒烟账号）', smokeAccounts.map(r => `${r.id}/${r.openid}`)],
      ['finance_accounts（冒烟公司账户）', smokeFinanceAccounts.map(r => `${r.account_id}/${r.account_name}`)],
      ['products（冒烟商品）', smokeProducts.map(r => `${r.product_code}/${r.product_name}`)],
      ['orders（冒烟订单）', smokeOrders.map(r => `${r.order_id}/${r.customer_name}`)],
      ['purchase_records（冒烟入库单）', smokePurchases.map(r => `${r.purchase_id}(status=${r.status})`)],
      [
        'finance_transactions（冒烟流水）',
        []
          .concat(txByPurchase, txByRemark, txBySalary)
          .filter((v, i, a) => a.findIndex(x => x.tx_id === v.tx_id) === i)
          .map(r => `${r.tx_no}/${r.tx_type}/${r.amount}`)
      ],
      ['finance_transactions（营收入账孤儿流水）', orphanRevenueTx.map(r => `${r.tx_id}/${r.related_id}/${r.amount}`)],
      ['salary_payments（确认删除的测试发放）', salaries.map(r => `${r.payment_id}/${r.worker_name}/${r.amount}`)],
      ['order_items（冒烟订单明细）', [].concat(orderItems, orderItemsByProduct).map(r => `#${r.item_id}`)],
      ['inventory（冒烟商品库存行）', invRows.map(r => `#${r.inventory_id}`)],
      ['water_tickets（2099/脚本标记水票）', ticketMarkers.map(r => `${r.ticket_id}(${r.month}/${r.issued_by})`)],
      ['machine_stations（冒烟机台）', smokeMachines.map(r => `${r.machine_id}/${r.station_name}`)],
      ['sub_stations（冒烟水站）', smokeStations.map(r => `${r.station_id}/${r.station_name}(欠款${r.current_debt})`)],
      [
        '其他零散关联',
        [].concat(
          machineSales.map(r => `machine_sales/${r.sale_id}`),
          stockOuts.map(r => `stock_out_records/${r.record_id}`),
          tickets.map(r => `water_tickets/${r.ticket_id}`),
          ticketIssues.map(r => `water_ticket_issuance/${r.issuance_id}`),
          ticketsByOrder.map(r => `water_tickets/${r.ticket_id}`),
          dfSettleByOrder.map(r => `dfs/${r.settlement_id}`),
          dfSettleByProduct.map(r => `dfs/${r.settlement_id}`),
          finSettle.map(r => `fin#${r.settlement_id}`),
          salaryLinks.map(r => `spa/${r.payment_id}`),
          ordersByWorker.map(r => `orders/${r.order_id}`)
        )
      ]
    ];
    for (const [label, items] of plan) {
      line(
        `${label.padEnd(38, ' ')} ${String(items.length).padStart(3)} 条${items.length ? '  → ' + items.slice(0, 6).join(', ') + (items.length > 6 ? ' …' : '') : ''}`
      );
    }

    // 账户余额变化预览
    const [accounts] = await conn.query(
      'SELECT account_id, account_name, initial_balance, current_balance FROM finance_accounts ORDER BY account_id'
    );
    const [delNet] = await conn.query(
      txIds.length
        ? 'SELECT ROUND(COALESCE(SUM(CASE WHEN tx_type=1 THEN amount WHEN tx_type=2 THEN -amount ELSE 0 END),0),2) n FROM finance_transactions WHERE tx_id IN (?)'
        : 'SELECT 0 n',
      txIds.length ? [txIds] : []
    );
    line();
    line('受影响账户余额：');
    line(`  待删流水净额合计：${Number(delNet[0].n).toFixed(2)}`);
    for (const a of accounts) {
      const before = Number(a.current_balance);
      const [r] = await conn.query(
        txIds.length
          ? 'SELECT ROUND(COALESCE(SUM(CASE WHEN tx_type=1 THEN amount WHEN tx_type=2 THEN -amount ELSE 0 END),0),2) n FROM finance_transactions WHERE account_id=? AND tx_id IN (?)'
          : 'SELECT 0 n',
        txIds.length ? [a.account_id, txIds] : [a.account_id]
      );
      const after = Math.round((before - Number(r[0].n)) * 100) / 100;
      const flag = after !== before ? '  ← 变化' : '';
      line(
        `  ${a.account_name.padEnd(12, ' ')} ${before.toFixed(2).padStart(10)} → ${after.toFixed(2).padStart(10)}${flag}`
      );
    }

    // 水站欠款对账（只读报告）：口径 = 该站**有效** type2 订单金额合计
    // 自动「回补」只发生在 cleanupSmokeResidue 内「本次冒烟订单确实引用过的水站」这一窄范围；
    // 这里对**历史遗留**漂移只做提示、不动数据——重算可能覆盖业务方手工调整或线下还款登记。
    const { reconcileStationDebt } = require('./lib/smokeCleanup');
    const debtRecon = await reconcileStationDebt(pool, null, false);
    line();
    line(
      `水站欠款对账（口径：该站有效 type2 订单金额合计）　共 ${debtRecon.total} 个水站，存在偏差 ${debtRecon.drift.length} 个`
    );
    for (const d of debtRecon.drift) {
      line(
        `  ${d.stationId} ${String(d.stationName || '').padEnd(10, ' ')} 账面 ${d.book.toFixed(2).padStart(10)} ≠ 凭证 ${d.voucher.toFixed(2).padStart(10)}　差额 ${(d.book - d.voucher).toFixed(2)}`
      );
    }
    if (debtRecon.drift.length) {
      line('  说明：本脚本不自动修正历史漂移；如需按凭证归位，请先确认后单独处理。');
    }

    const total =
      productIds.length +
      orderIds.length +
      purchaseIds.length +
      txIds.length +
      workerIds.length +
      accountIds.length +
      salaries.length +
      orderItems.length +
      orderItemsByProduct.length +
      invRows.length;
    line();
    line(`合计待删除记录：约 ${total} 条`);

    if (!APPLY) {
      line();
      line('预演结束。确认无误后加 --apply 实际执行。');
      return;
    }

    // ============ 3. 实际执行（单事务） ============
    line();
    line('开始执行（单事务）…');
    await conn.beginTransaction();

    const del = async (table, sql, args) => {
      const [res] = await conn.query(sql, args);
      if (res.affectedRows) line(`  ${table.padEnd(26)} -${res.affectedRows}`);
      return res.affectedRows;
    };

    // 3.1 冒烟订单的子孙
    if (orderIds.length) {
      await del('order_items', 'DELETE FROM order_items WHERE order_id IN (?)', [orderIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE order_id IN (?)', [orderIds]);
      await del('financial_settlement', 'DELETE FROM financial_settlement WHERE order_id IN (?)', [orderIds]);
      await del('water_tickets(by order)', 'DELETE FROM water_tickets WHERE order_id IN (?)', [orderIds]);
    }
    // 3.2 冒烟商品的子孙
    if (productIds.length) {
      await del('order_items(by product)', 'DELETE FROM order_items WHERE product_id IN (?)', [productIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE product_id IN (?)', [productIds]);
      await del('machine_sales', 'DELETE FROM machine_sales WHERE product_id IN (?)', [productIds]);
      await del('stock_out_records', 'DELETE FROM stock_out_records WHERE product_id IN (?)', [productIds]);
      await del('water_tickets', 'DELETE FROM water_tickets WHERE product_id IN (?)', [productIds]);
      await del('water_ticket_issuance', 'DELETE FROM water_ticket_issuance WHERE product_id IN (?)', [productIds]);
    }
    // 3.2b 标记水票（2099 未来月份 / 脚本 issued_by / 冒烟备注）
    if (ticketMarkers.length) {
      await del('water_tickets(marked)', 'DELETE FROM water_tickets WHERE ticket_id IN (?)', [
        ticketMarkers.map(r => r.ticket_id)
      ]);
    }
    // 3.2c 冒烟机台：先删其销量，再删机台本身
    if (machineIds.length) {
      await del('machine_sales(by machine)', 'DELETE FROM machine_sales WHERE machine_id IN (?)', [machineIds]);
      await del('machine_stations', 'DELETE FROM machine_stations WHERE machine_id IN (?)', [machineIds]);
    }
    // 3.3 工资发放子孙
    if (EXTRA_SALARY_PAYMENT_IDS.length) {
      await del('salary_payment_advances', 'DELETE FROM salary_payment_advances WHERE payment_id IN (?)', [
        EXTRA_SALARY_PAYMENT_IDS
      ]);
    }
    // 3.4 资金流水（先于业务单删除）
    if (txIds.length) {
      await del('finance_transactions', 'DELETE FROM finance_transactions WHERE tx_id IN (?)', [txIds]);
    }
    // 3.4b 订单营收入账的孤儿流水（关联订单已不存在）
    if (orphanRevenueTx.length) {
      await del(
        'finance_transactions(order_revenue 孤儿)',
        `DELETE FROM finance_transactions
         WHERE related_module = 'order_revenue'
           AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = finance_transactions.related_id)`
      );
    }
    // 3.5 业务单
    if (purchaseIds.length) {
      await del('purchase_records', 'DELETE FROM purchase_records WHERE purchase_id IN (?)', [purchaseIds]);
    }
    if (EXTRA_SALARY_PAYMENT_IDS.length) {
      await del('salary_payments', 'DELETE FROM salary_payments WHERE payment_id IN (?)', [EXTRA_SALARY_PAYMENT_IDS]);
    }
    if (invRows.length) {
      await del('inventory', 'DELETE FROM inventory WHERE inventory_id IN (?)', [invRows.map(r => r.inventory_id)]);
    }
    if (orderIds.length) {
      await del('orders', 'DELETE FROM orders WHERE order_id IN (?)', [orderIds]);
    }
    if (productIds.length) {
      await del('products', 'DELETE FROM products WHERE product_id IN (?)', [productIds]);
    }
    // 3.5b 冒烟自建水站：先清引用（水票/发行批次/结算/订单），再删水站本身
    if (stationIds.length) {
      await del('water_tickets(by station)', 'DELETE FROM water_tickets WHERE station_id IN (?)', [stationIds]);
      await del('water_ticket_issuance(station)', 'DELETE FROM water_ticket_issuance WHERE station_id IN (?)', [
        stationIds
      ]);
      await del('financial_settlement(station)', 'DELETE FROM financial_settlement WHERE station_id IN (?)', [
        stationIds
      ]);
      await del('orders(by station)', 'DELETE FROM orders WHERE station_id IN (?)', [stationIds]);
      await del('sub_stations', 'DELETE FROM sub_stations WHERE station_id IN (?)', [stationIds]);
    }
    // 3.6 员工（先摘除引用）
    if (workerIds.length) {
      await del('financial_settlement(worker)', 'DELETE FROM financial_settlement WHERE worker_id IN (?)', [workerIds]);
      await del('orders(by worker)', 'DELETE FROM orders WHERE worker_id IN (?) OR created_by IN (?)', [
        workerIds,
        workerIds
      ]);
      await del('workers', 'DELETE FROM workers WHERE worker_id IN (?)', [workerIds]);
    }
    // 3.7 冒烟登录账号
    if (accountIds.length) {
      await del('mini_accounts', 'DELETE FROM mini_accounts WHERE id IN (?)', [accountIds]);
    }
    // 3.7a 冒烟自建公司账户（先删其流水，再删账户；随后的余额重算会覆盖剩余账户）
    const smokeFinanceAccountIds = smokeFinanceAccounts.map(r => r.account_id);
    if (smokeFinanceAccountIds.length) {
      await del('finance_transactions(smoke accounts)', 'DELETE FROM finance_transactions WHERE account_id IN (?)', [
        smokeFinanceAccountIds
      ]);
      await del('finance_accounts(smoke)', 'DELETE FROM finance_accounts WHERE account_id IN (?)', [
        smokeFinanceAccountIds
      ]);
    }
    // 3.7b 冒烟后台账号（users 表；smoke_* 前缀，含 smoke_staff_* 临时鉴权用户）
    await del('users(smoke_*)', "DELETE FROM users WHERE username LIKE 'smoke\\_%'");

    // ============ 4. 重算账户余额并校验恒等式 ============
    line();
    line('重算账户余额…');
    const [accts] = await conn.query(
      'SELECT account_id, account_name, initial_balance, current_balance FROM finance_accounts ORDER BY account_id'
    );
    const netMap = await netOf(conn);
    for (const a of accts) {
      const init = Number(a.initial_balance);
      const net = Number(netMap[a.account_id] || 0);
      const target = Math.round((init + net) * 100) / 100;
      if (Math.abs(target - Number(a.current_balance)) > 0.001) {
        await conn.query('UPDATE finance_accounts SET current_balance = ? WHERE account_id = ?', [
          target,
          a.account_id
        ]);
        line(
          `  ${a.account_name.padEnd(12, ' ')} ${Number(a.current_balance).toFixed(2).padStart(10)} → ${target.toFixed(2).padStart(10)}`
        );
      } else {
        line(`  ${a.account_name.padEnd(12, ' ')} ${Number(a.current_balance).toFixed(2).padStart(10)}   （无变化）`);
      }
    }

    // 校验恒等式
    const bad = [];
    for (const a of accts) {
      const [[row]] = await conn.query(
        'SELECT current_balance, initial_balance FROM finance_accounts WHERE account_id = ?',
        [a.account_id]
      );
      const net = Number(netMap[a.account_id] || 0);
      const expect = Math.round((Number(row.initial_balance) + net) * 100) / 100;
      if (Math.abs(expect - Number(row.current_balance)) > 0.001) {
        bad.push(`${a.account_id}: 余额 ${row.current_balance} ≠ 初始 ${row.initial_balance} + 净额 ${net}`);
      }
    }
    if (bad.length) {
      throw Object.assign(new Error('余额恒等式校验失败：\n' + bad.join('\n')), { business: true });
    }
    line('  ✔ 恒等式校验通过（余额 = 初始余额 + 全部剩余流水净额）');

    await conn.commit();
    line();
    line('✅ 清理完成，已提交。');
  } catch (e) {
    try {
      await conn.rollback();
      line();
      line('❌ 执行失败，已回滚，数据未变更。');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

async function netOf(conn) {
  const [rows] = await conn.query(
    `SELECT account_id, ROUND(COALESCE(SUM(CASE WHEN tx_type=1 THEN amount WHEN tx_type=2 THEN -amount ELSE 0 END),0),2) net
     FROM finance_transactions GROUP BY account_id`
  );
  const map = {};
  for (const r of rows) map[r.account_id] = r.net;
  return map;
}

main()
  .then(() => pool.end())
  .catch(e => {
    console.error('\n错误：', e.message);
    pool.end();
    process.exit(1);
  });

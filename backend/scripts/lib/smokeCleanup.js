/**
 * 冒烟脚本统一收尾清理
 *
 * 为什么需要它：过去各 smoke_*.js 各自写清理代码，普遍存在两个漏洞——
 *   1. 只在「成功路径」清理，一旦中间断言抛错 / 提前 process.exit，清理被整段跳过；
 *   2. 清理口径不全（只删最后一条、只作废不删除、软删除接口清不掉）。
 * 结果就是测试数据在库里堆积，而且 products / workers 走的是业务软删除接口，
 * 在前台永远看得到、删不掉。
 *
 * 用法（务必放在 finally 里，保证异常路径也执行）：
 *
 *   const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
 *   let cleanup = null;
 *   try {
 *     ...冒烟主体...
 *   } finally {
 *     cleanup = await cleanupSmokeResidue(pool);
 *   }
 *
 * 识别口径：见 MARKERS。凡是按此口径命名的测试数据，一律物理删除；
 * 调用方还可用 extraSalaryPayments / extraProducts / extraOrders 追加精确主键。
 * 清理后按「余额 = 初始余额 + 剩余流水净额」重算账户 current_balance，
 * 保证资金记账恒等式成立。整个过程单事务，失败整体回滚。
 */
const MARKERS = {
  workers: "worker_name LIKE '冒烟%'",
  // ⚠️ 2026-09-20 修正：mini_accounts.username / password_hash 两列已按文档 §4.1.1
  //    在小程序迁移中移除（新版走 wx.login + 微信实名手机号，不需要口令）。
  //    原标记 `username LIKE 'smoke\\_%'` 会让**所有**冒烟脚本在收尾时抛
  //    「Unknown column 'username'」—— 冒烟主体跑通了、收尾却炸，最容易被误判成回归。
  //    改用 openid 前缀识别（openid 仍存在，且是绑定关系的事实主键）。
  //    注意：**不**把 dev_ 前缀纳入标记 —— 那是本地开发登录建立的真实绑定，不该被清理。
  miniAccounts: "openid LIKE 'smoke\\_%'",
  // 小程序钱包：冒烟自建钱包用 SMKW 前缀或挂在冒烟主体名下
  walletAccounts:
    "(wallet_id LIKE 'SMKW%' OR owner_id IN (SELECT worker_id FROM workers WHERE worker_name LIKE '冒烟%'))",
  products:
    "(product_name LIKE '冒烟%' OR product_name LIKE '%测试商品%' OR product_code LIKE 'SMK%' OR product_code LIKE 'TESTP%')",
  orders: "customer_name LIKE '冒烟%'",
  purchaseRecords: "(remark LIKE '%冒烟%' OR void_reason LIKE '%冒烟%')",
  txByRemark: "remark LIKE '%冒烟%'",
  subStations: "(station_name LIKE '冒烟%' OR station_id LIKE 'SMKST%')",
  machineStations: "(station_name LIKE '冒烟%' OR machine_id LIKE 'SMKM%')",
  users: "username LIKE 'smoke\\_%'"
};

async function cleanupSmokeResidue(pool, opts = {}) {
  const { extraSalaryPayments = [], log = console.log } = opts;
  const conn = await pool.getConnection();
  const summary = {};

  try {
    const pick = async (sql, args = []) => (await conn.query(sql, args))[0];

    // 小程序相关表是否存在（2026-09-20 新增）：
    // 迁移 migration_mini_program_v1.sql 应用前，wallet_* / mini_idempotency / mini_audit_logs
    // 并不存在。这里做一次存在性探测，使本收尾函数对新旧两种库都可用 ——
    // 若不加判断，未迁移的库上所有冒烟脚本都会在收尾阶段报「表不存在」。
    const [miniTableRows] = await conn.query(
      `SELECT TABLE_NAME AS t FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('wallet_accounts','wallet_transactions','mini_idempotency','mini_audit_logs')`
    );
    const miniTables = new Set(miniTableRows.map(r => r.t));
    const hasWallets = miniTables.has('wallet_accounts') && miniTables.has('wallet_transactions');
    const hasIdem = miniTables.has('mini_idempotency');
    const hasAudit = miniTables.has('mini_audit_logs');

    const smokeWorkers = await pick(`SELECT worker_id FROM workers WHERE ${MARKERS.workers}`);
    const smokeAccounts = await pick(`SELECT id FROM mini_accounts WHERE ${MARKERS.miniAccounts}`);
    const smokeProducts = await pick(`SELECT product_id FROM products WHERE ${MARKERS.products}`);
    const smokeOrders = await pick(`SELECT order_id FROM orders WHERE ${MARKERS.orders}`);
    const smokePurchases = await pick(`SELECT purchase_id FROM purchase_records WHERE ${MARKERS.purchaseRecords}`);
    const smokeStations = await pick(`SELECT station_id FROM sub_stations WHERE ${MARKERS.subStations}`);
    const smokeMachines = await pick(`SELECT machine_id FROM machine_stations WHERE ${MARKERS.machineStations}`);
    const smokeUsers = await pick(`SELECT id FROM users WHERE ${MARKERS.users}`);
    const smokeWallets = hasWallets
      ? await pick(`SELECT wallet_id FROM wallet_accounts WHERE ${MARKERS.walletAccounts}`)
      : [];

    const workerIds = smokeWorkers.map(r => r.worker_id);
    const accountIds = smokeAccounts.map(r => r.id);
    const productIds = smokeProducts.map(r => r.product_id);
    const orderIds = smokeOrders.map(r => r.order_id);
    const purchaseIds = smokePurchases.map(r => r.purchase_id);
    const stationIds = smokeStations.map(r => r.station_id);
    const machineIds = smokeMachines.map(r => r.machine_id);
    const userIds = smokeUsers.map(r => r.id);
    const walletIds = smokeWallets.map(r => r.wallet_id);

    // 冒烟订单曾引用的水站（删除订单前先记下，删完再按凭证重算欠款；见下方「水站欠款回补」）
    const touchedStationRows = orderIds.length
      ? await pick('SELECT DISTINCT station_id FROM orders WHERE order_id IN (?) AND station_id IS NOT NULL', [
          orderIds
        ])
      : [];
    const touchedStationIds = touchedStationRows.map(r => r.station_id);

    const txConds = [MARKERS.txByRemark];
    const txArgs = [];
    if (purchaseIds.length) {
      txConds.push('related_id IN (?)');
      txArgs.push(purchaseIds);
    }
    if (extraSalaryPayments.length) {
      txConds.push("(related_module = 'salary_payment' AND related_id IN (?))");
      txArgs.push(extraSalaryPayments);
    }
    const txRows = await pick(`SELECT tx_id FROM finance_transactions WHERE ${txConds.join(' OR ')}`, txArgs);
    const txIds = txRows.map(r => r.tx_id);

    const touched = [
      workerIds.length,
      accountIds.length,
      productIds.length,
      orderIds.length,
      purchaseIds.length,
      txIds.length,
      extraSalaryPayments.length,
      stationIds.length,
      machineIds.length,
      userIds.length,
      walletIds.length
    ].reduce((a, b) => a + b, 0);
    if (!touched) return { total: 0, resume: '无残留' };

    await conn.beginTransaction();
    const del = async (key, sql, args) => {
      const [r] = await conn.query(sql, args);
      if (r.affectedRows) summary[key] = (summary[key] || 0) + r.affectedRows;
      return r.affectedRows;
    };

    if (orderIds.length) {
      await del('order_items', 'DELETE FROM order_items WHERE order_id IN (?)', [orderIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE order_id IN (?)', [orderIds]);
      await del('financial_settlement', 'DELETE FROM financial_settlement WHERE order_id IN (?)', [orderIds]);
      await del('water_tickets', 'DELETE FROM water_tickets WHERE order_id IN (?)', [orderIds]);
    }
    // 冒烟脚本自建的载体数据：脚本专用 issued_by 标记 / 2099 未来月份 / 冒烟备注
    await del('water_tickets', "DELETE FROM water_tickets WHERE issued_by IN ('smoke', 't1', 'a6')");
    await del('water_tickets', "DELETE FROM water_tickets WHERE remark LIKE '%冒烟%'");
    // 水票永远按真实当月发行，2099 开头的月份必然来自冒烟脚本的 month: '2099-01'
    await del('water_tickets', "DELETE FROM water_tickets WHERE month LIKE '2099%'");
    await del(
      'water_ticket_issuance',
      "DELETE FROM water_ticket_issuance WHERE month LIKE '2099%' OR remark LIKE '%冒烟%'"
    );
    await del('machine_sales', "DELETE FROM machine_sales WHERE sale_date >= '2099-01-01' OR remark LIKE '%冒烟%'");
    if (productIds.length) {
      await del('order_items', 'DELETE FROM order_items WHERE product_id IN (?)', [productIds]);
      await del('delivery_fee_settlement', 'DELETE FROM delivery_fee_settlement WHERE product_id IN (?)', [productIds]);
      await del('machine_sales', 'DELETE FROM machine_sales WHERE product_id IN (?)', [productIds]);
      await del('stock_out_records', 'DELETE FROM stock_out_records WHERE product_id IN (?)', [productIds]);
      await del('water_tickets', 'DELETE FROM water_tickets WHERE product_id IN (?)', [productIds]);
      await del('water_ticket_issuance', 'DELETE FROM water_ticket_issuance WHERE product_id IN (?)', [productIds]);
      await del('inventory', 'DELETE FROM inventory WHERE product_id IN (?)', [productIds]);
    }
    if (extraSalaryPayments.length) {
      await del('salary_payment_advances', 'DELETE FROM salary_payment_advances WHERE payment_id IN (?)', [
        extraSalaryPayments
      ]);
    }
    if (txIds.length) {
      await del('finance_transactions', 'DELETE FROM finance_transactions WHERE tx_id IN (?)', [txIds]);
    }
    // ---- 小程序钱包 / 幂等 / 审计 清理（2026-09-20 新增）----
    // ⚠️ 为什么必须在这里清：钱包的「余额 = 期初 + Σ正向流水 − Σ负向流水」是资金恒等式
    //    （文档 §11.5 / §44.12），只要留下一条孤儿流水或留下被改动过的余额，恒等式即破。
    //    冒烟脚本若只删订单、不清钱包流水，下一次跑「钱包恒等式」断言就会假红。
    if (hasWallets) {
      if (orderIds.length) {
        await del(
          'wallet_transactions',
          "DELETE FROM wallet_transactions WHERE related_type = 'ORDER' AND related_id IN (?)",
          [orderIds]
        );
      }
      // 冒烟备注 / 冒烟操作人标记（与 ORDER 关联之外的手工调整、充值等）
      await del('wallet_transactions', "DELETE FROM wallet_transactions WHERE remark LIKE '%冒烟%'");
      await del('wallet_transactions', "DELETE FROM wallet_transactions WHERE operator_id LIKE '%smoke%'");
      if (walletIds.length) {
        // 先删流水（外键 ON DELETE RESTRICT：钱包下有流水就删不掉钱包）
        await del('wallet_transactions', 'DELETE FROM wallet_transactions WHERE wallet_id IN (?)', [walletIds]);
        await del('wallet_accounts', 'DELETE FROM wallet_accounts WHERE wallet_id IN (?)', [walletIds]);
      }
      // 挂在本轮冒烟主体名下的钱包（可能未被 wallet_id 前缀命中）
      if (workerIds.length) {
        const [w] = await conn.query(
          "SELECT wallet_id FROM wallet_accounts WHERE owner_type = 'SALESMAN' AND owner_id IN (?)",
          [workerIds]
        );
        const ids = w.map(r => r.wallet_id);
        if (ids.length) {
          await del('wallet_transactions', 'DELETE FROM wallet_transactions WHERE wallet_id IN (?)', [ids]);
          await del('wallet_accounts', 'DELETE FROM wallet_accounts WHERE wallet_id IN (?)', [ids]);
        }
      }
      if (stationIds.length) {
        const [w] = await conn.query(
          "SELECT wallet_id FROM wallet_accounts WHERE owner_type = 'STATION' AND owner_id IN (?)",
          [stationIds]
        );
        const ids = w.map(r => r.wallet_id);
        if (ids.length) {
          await del('wallet_transactions', 'DELETE FROM wallet_transactions WHERE wallet_id IN (?)', [ids]);
          await del('wallet_accounts', 'DELETE FROM wallet_accounts WHERE wallet_id IN (?)', [ids]);
        }
      }
      await del('mini_payment_orders', "DELETE FROM mini_payment_orders WHERE out_trade_no LIKE 'SMK%'");
    }
    if (hasIdem) {
      // ⚠️ 幂等键残留会**污染下一次运行**：同键重试会被判定为「重复请求」而直接返回首次结果，
      //    表现为「第二次跑冒烟时下单没有真的落库」。故必须清理。
      await del('mini_idempotency', "DELETE FROM mini_idempotency WHERE idem_key LIKE 'smoke%'");
      await del('mini_idempotency', "DELETE FROM mini_idempotency WHERE scope LIKE '%SMK%'");
      if (accountIds.length) {
        await del('mini_idempotency', 'DELETE FROM mini_idempotency WHERE mini_account_id IN (?)', [accountIds]);
      }
    }
    if (hasAudit) {
      if (accountIds.length) {
        await del('mini_audit_logs', 'DELETE FROM mini_audit_logs WHERE actor_id IN (?)', [
          accountIds.map(id => `mini:${id}`)
        ]);
      }
      if (orderIds.length) {
        await del('mini_audit_logs', "DELETE FROM mini_audit_logs WHERE target_type = 'ORDER' AND target_id IN (?)", [
          orderIds
        ]);
      }
      // 本地开发登录建立的绑定也会留审计，但那是真实绑定，不清理
      await del('mini_audit_logs', "DELETE FROM mini_audit_logs WHERE actor_type = 'DEV' AND detail LIKE '%冒烟%'");
    }

    // 订单营收入账流水（需求 5）的孤儿：
    // 多个老冒烟脚本（smoke_order_pricing / smoke_a6_revenue / smoke_salary_advance）
    // 会用**原生 SQL 直删订单**，绕过 DELETE /orders 的回冲逻辑，
    // 于是 related_module='order_revenue' 的流水成了悬挂数据，且账户余额被抬高。
    // 这里按「关联订单已不存在」清理，随后统一按恒等式重算余额即可自愈。
    await del(
      'finance_transactions',
      `DELETE FROM finance_transactions
      WHERE related_module = 'order_revenue'
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = finance_transactions.related_id)`
    );
    // 订单已不存在却仍留在 water_tickets.order_id 上的悬挂引用（同理由直删订单造成）
    await conn.query(
      'UPDATE water_tickets SET order_id = NULL WHERE order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = water_tickets.order_id)'
    );
    if (purchaseIds.length) {
      await del('purchase_records', 'DELETE FROM purchase_records WHERE purchase_id IN (?)', [purchaseIds]);
    }
    if (extraSalaryPayments.length) {
      await del('salary_payments', 'DELETE FROM salary_payments WHERE payment_id IN (?)', [extraSalaryPayments]);
    }
    if (orderIds.length) {
      await del('orders', 'DELETE FROM orders WHERE order_id IN (?)', [orderIds]);
    }
    // ---- 水站欠款回补（2026-09-16 新增）----
    // 为什么需要：旧版冒烟脚本取「真实水站」建单（sub_stations ORDER BY station_id LIMIT 1），
    // 清理靠「跑前快照回写 current_debt」——脚本异常退出、或两个脚本交叉执行时，
    // 后跑的会把自己基线定成前者尚未回滚的虚高值并固化下来（实测 ST001 由 154 涨到 550，
    // 而真实 type2 订单只有 154）。此前的 MARKERS 完全不含 current_debt，兜底清理修不了。
    // 口径与 addStationDebt / restoreSalesEffects 一致：current_debt = 该站**有效** type2 订单金额合计。
    // 只在「本次冒烟订单确实引用过该站」时才重算，避免误改业务方手工调整过的欠款。
    for (const sid of touchedStationIds) {
      if (stationIds.includes(sid)) continue; // 冒烟自建水站即将整体删除，无需重算
      const [[voucher]] = await conn.query(
        `SELECT COALESCE(SUM(order_amount), 0) AS v FROM orders
         WHERE order_type = 2 AND station_id = ? AND canceled_at IS NULL`,
        [sid]
      );
      const [r] = await conn.query(
        'UPDATE sub_stations SET current_debt = ? WHERE station_id = ? AND current_debt <> ?',
        [voucher.v, sid, voucher.v]
      );
      if (r.affectedRows) {
        summary.stationDebtReconciled = (summary.stationDebtReconciled || 0) + r.affectedRows;
      }
    }
    if (productIds.length) {
      await del('products', 'DELETE FROM products WHERE product_id IN (?)', [productIds]);
    }
    // 冒烟自建水站：先删其关联水票（可能未被 remark 命中），再删水站本身
    if (stationIds.length) {
      await del('water_tickets', 'DELETE FROM water_tickets WHERE station_id IN (?)', [stationIds]);
      await del('water_ticket_issuance', 'DELETE FROM water_ticket_issuance WHERE station_id IN (?)', [stationIds]);
      await del('orders', 'DELETE FROM orders WHERE station_id IN (?)', [stationIds]);
      await del('sub_stations', 'DELETE FROM sub_stations WHERE station_id IN (?)', [stationIds]);
    }
    if (workerIds.length) {
      await del('financial_settlement', 'DELETE FROM financial_settlement WHERE worker_id IN (?)', [workerIds]);
      await del('orders', 'DELETE FROM orders WHERE worker_id IN (?) OR created_by IN (?)', [workerIds, workerIds]);
      await del('workers', 'DELETE FROM workers WHERE worker_id IN (?)', [workerIds]);
    }
    if (accountIds.length) {
      await del('mini_accounts', 'DELETE FROM mini_accounts WHERE id IN (?)', [accountIds]);
    }
    // 冒烟自建机台：先删其销量记录（可能未被 remark/sale_date 命中），再删机台本身
    if (machineIds.length) {
      await del('machine_sales', 'DELETE FROM machine_sales WHERE machine_id IN (?)', [machineIds]);
      await del('machine_stations', 'DELETE FROM machine_stations WHERE machine_id IN (?)', [machineIds]);
    }
    // 冒烟登录账号（users 表；smoke_* 前缀）
    if (userIds.length) {
      await del('users', 'DELETE FROM users WHERE id IN (?)', [userIds]);
    }

    // 按恒等式重算账户余额
    const [accounts] = await conn.query('SELECT account_id, initial_balance, current_balance FROM finance_accounts');
    const [nets] = await conn.query(
      `SELECT account_id, ROUND(COALESCE(SUM(CASE WHEN tx_type = 1 THEN amount WHEN tx_type = 2 THEN -amount ELSE 0 END), 0), 2) net
       FROM finance_transactions GROUP BY account_id`
    );
    const netMap = {};
    for (const n of nets) netMap[n.account_id] = Number(n.net);
    for (const a of accounts) {
      const target = Math.round((Number(a.initial_balance) + (netMap[a.account_id] || 0)) * 100) / 100;
      if (Math.abs(target - Number(a.current_balance)) > 0.001) {
        await conn.query('UPDATE finance_accounts SET current_balance = ? WHERE account_id = ?', [
          target,
          a.account_id
        ]);
        summary.balanceFixed = (summary.balanceFixed || 0) + 1;
      }
    }

    // 按恒等式重算**钱包**余额（2026-09-20 新增，与上面 finance_accounts 同一手法）
    // ⚠️ 为什么两套账本都要自愈：文档 §24.5 约束 1 要求「两套账本必须同事务」。
    //    冒烟若删掉钱包流水却不动 balance，钱包恒等式（§11.5）就破了 ——
    //    下一次跑「钱包恒等式」断言会假红，而真实原因在上一次运行的收尾阶段。
    //    这个自愈对**停用钱包同样生效**（§11.7 第 4 条：恒等式在 status=0 时也必须成立）。
    if (hasWallets) {
      const [wallets] = await conn.query('SELECT wallet_id, initial_balance, balance FROM wallet_accounts');
      const [wnets] = await conn.query(
        `SELECT wallet_id, ROUND(COALESCE(SUM(CASE WHEN direction = 1 THEN amount WHEN direction = 2 THEN -amount ELSE 0 END), 0), 2) net
           FROM wallet_transactions GROUP BY wallet_id`
      );
      const wnetMap = {};
      for (const n of wnets) wnetMap[n.wallet_id] = Number(n.net);
      for (const w of wallets) {
        const target = Math.round((Number(w.initial_balance) + (wnetMap[w.wallet_id] || 0)) * 100) / 100;
        if (Math.abs(target - Number(w.balance)) > 0.001) {
          await conn.query('UPDATE wallet_accounts SET balance = ? WHERE wallet_id = ?', [target, w.wallet_id]);
          summary.walletBalanceFixed = (summary.walletBalanceFixed || 0) + 1;
        }
      }
    }

    await conn.commit();
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    log(
      `  [清理] 冒烟残留已清除：${
        Object.entries(summary)
          .map(([k, v]) => `${k}×${v}`)
          .join(' ') || '无'
      }`
    );
    return { total, detail: summary };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    log(`  [清理] ⚠️ 收尾清理失败（不影响冒烟结论）：${e.message}`);
    return { total: 0, error: e.message };
  } finally {
    conn.release();
  }
}

/**
 * 按「订单已不存在」清理订单营收入账孤儿流水（需求 5 上线后的配套工具）。
 *
 * 场景：老冒烟脚本用**原生 SQL 直删订单**（不经 DELETE /orders 接口），
 *      而订单创建时已按需求 5 写入了 order_revenue 流水 + 抬高账户余额，
 *      于是这些流水成了悬挂数据、余额虚高。
 *
 * 两种用法：
 *   - 删除订单**之前**调用 `revertOrderRevenueBySql(pool, orderIds)`：把这些订单的
 *     入账逐笔回补余额并删除流水（推荐，语义最清晰）；
 *   - 任意时机调用 `sweepOrphanOrderRevenue(pool)`：按「关联订单已不存在」兜底清扫。
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {Array<string>} orderIds 即将被删除的订单号
 * @returns {Promise<number>} 回冲金额合计
 */
async function revertOrderRevenueBySql(pool, orderIds) {
  if (!orderIds || !orderIds.length) return 0;
  const [txs] = await pool.query(
    `SELECT tx_id, account_id, amount FROM finance_transactions
     WHERE related_module = 'order_revenue' AND related_id IN (?)`,
    [orderIds]
  );
  let reverted = 0;
  for (const t of txs) {
    await pool.query('UPDATE finance_accounts SET current_balance = current_balance - ? WHERE account_id = ?', [
      Number(t.amount),
      t.account_id
    ]);
    await pool.query('DELETE FROM finance_transactions WHERE tx_id = ?', [t.tx_id]);
    reverted += Number(t.amount) || 0;
  }
  return Math.round(reverted * 100) / 100;
}

/** 清扫「关联订单已不存在」的营收入账孤儿流水（幂等，可重复执行） */
async function sweepOrphanOrderRevenue(pool) {
  const [res] = await pool.query(
    `DELETE FROM finance_transactions
     WHERE related_module = 'order_revenue'
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id = finance_transactions.related_id)`
  );
  return res.affectedRows || 0;
}

/**
 * 水站欠款对账（2026-09-16 新增）。
 *
 * 口径：`sub_stations.current_debt` 应等于该站**有效** type2 订单金额合计
 *      （与 orderPricingService 的 addStationDebt / restoreSalesEffects 一致）。
 *
 * 用途：诊断并可选修复「快照回写」模式留下的欠款虚高。
 *      ⚠️ 若业务方会手工调整欠款或线下登记还款，重算会覆盖这些调整，
 *         因此默认只**报告**（apply=false），确认后再显式修复。
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {Array<string>|null} stationIds 目标水站（null = 全量）
 * @param {boolean} apply 是否写库修复
 * @returns {Promise<{total:number, applied:number, drift:Array}>}
 */
async function reconcileStationDebt(pool, stationIds = null, apply = false) {
  const args = [];
  let where = '';
  if (stationIds && stationIds.length) {
    where = 'WHERE s.station_id IN (?)';
    args.push(stationIds);
  }
  const [rows] = await pool.query(
    `SELECT s.station_id, s.station_name, s.current_debt,
            COALESCE(v.total, 0) AS voucherDebt
       FROM sub_stations s
       LEFT JOIN (
         SELECT station_id, SUM(order_amount) AS total
           FROM orders
          WHERE order_type = 2 AND canceled_at IS NULL
          GROUP BY station_id
       ) v ON v.station_id = s.station_id
       ${where}
       ORDER BY s.station_id`,
    args
  );

  const drift = rows
    .filter(r => Math.abs(Number(r.current_debt) - Number(r.voucherDebt)) > 0.001)
    .map(r => ({
      stationId: r.station_id,
      stationName: r.station_name,
      book: Math.round(Number(r.current_debt) * 100) / 100,
      voucher: Math.round(Number(r.voucherDebt) * 100) / 100
    }));

  if (apply) {
    for (const d of drift) {
      await pool.query('UPDATE sub_stations SET current_debt = ? WHERE station_id = ?', [d.voucher, d.stationId]);
    }
  }
  return { total: rows.length, applied: apply ? drift.length : 0, drift };
}

module.exports = {
  cleanupSmokeResidue,
  MARKERS,
  revertOrderRevenueBySql,
  sweepOrphanOrderRevenue,
  reconcileStationDebt
};

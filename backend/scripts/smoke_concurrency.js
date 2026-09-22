/**
 * 并发正确性冒烟 —— 文档 §45 的三条并发路径 + 幂等键并发
 * ============================================================================
 * 覆盖：
 *   ① 水票并发核销（同一批水票不得被两笔订单同时核销）
 *   ② 钱包并发扣款（余额已扣空时第二笔必须被拒，不得出现负余额）
 *   ③ 库存并发扣减（不得「丢失更新」：两笔各扣 10，30 必须变成 10 而不是 20）
 *   ④ 幂等键并发（同一 clientRequestId 并发两笔，只允许一笔真正执行）
 *
 * ── 为什么用「两个连接在服务层赛跑」而不是打 HTTP 并发 ──────────────────────
 *   ① **确定性**：本脚本的每一段都构造成「结果与两笔请求的调度顺序无关」——
 *      无论谁先谁后，期望的结论都相同（详见各段注释）。打 HTTP 并发则会依赖
 *      线程/连接的调度运气，偶尔变绿，是最糟的一种测试（假安全感）。
 *   ② **零残留**：水票/钱包/库存三段全程在事务里，段末一律 rollback（只有夹具是
 *      提交的），因此不会产生订单、营收流水、水站欠款 —— 也就不需要「删单前先回冲
 *      营收」那一整套收尾（见 REF §一 第 5 条）。
 *   ③ HTTP 层对本脚本要验的不变量**没有增量**：它不会绕开这些服务函数。
 *
 * ── 为什么要「先建立 read view」这一步（不是凑数）────────────────────────────
 *   MySQL 默认 REPEATABLE-READ：事务内的**普通（非锁定）读**看到的是本事务
 *   **第一次读时**的快照，之后别人提交了什么它都看不见。生产路径的真实顺序是：
 *       进事务 → `fetchProductMap`（普通读，快照就此固定）→ …写… → 核销水票
 *   所以「B 事务先做一次普通读，再让 A 提交，然后 B 才去核销」不是人为构造，
 *   而正是生产里真实存在的交错。**只靠 FOR UPDATE 之外的方式读守卫名单，
 *   就会读到过期快照**——第 ① 段抓的就是这个。
 *
 * ⚠️ 跑本脚本**不需要启动后端**（纯服务层 + 直连数据库），也不占用 3000 端口。
 * 用法：cd backend && node scripts/smoke_concurrency.js
 */
require('dotenv').config();
const { pool } = require('../src/config/db');
const { writeOffTickets, deductInventoryForSale } = require('../src/services/orderPricingService');
const walletService = require('../src/services/walletService');
const { WALLET_TX_TYPE, WALLET_RELATED_TYPE, IDEM_SCOPE } = require('../src/constants/mini');

let pass = 0;
let fail = 0;
const assert = (cond, name, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? '  ← ' + extra : ''}`);
  }
};
const section = t => console.log(`\n${t}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TS = Date.now().toString(36).toUpperCase();
const F = {
  stationId: `SMKST${TS}`,
  productId: `SMKPR${TS}`,
  productCode: `SMKC${TS}`,
  orderA: `SMKCA${TS}`,
  orderB: `SMKCB${TS}`,
  idemKey: `smk_con_${TS}`
};
/** writeOffTickets 只在「票不足」的报错文案里用到 product_name */
const productMap = { [F.productId]: { product_name: '冒烟并发商品' } };

async function main() {
  const conns = [];
  const mkConn = async () => {
    const c = await pool.getConnection();
    conns.push(c);
    return c;
  };
  let walletId = null;
  let fixturesReady = false;

  try {
    // ══════════════════ 0. 夹具（全部自建 SMK* 对象，不用真实业务数据）══════════════════
    section('0. 夹具：自建水站 / 商品 / 库存 30 / 3 张未用水票 / 水站积分钱包');
    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, address, credit_limit, current_debt, payment_type, status, created_at, updated_at)
       VALUES (?, '冒烟并发送水站', '冒烟联系人', '13600000000', '南京市冒烟路1号', 0.00, 0.00, 1, 1, NOW(), NOW())`,
      [F.stationId]
    );
    await pool.query(
      `INSERT INTO products (product_id, product_code, product_name, specification, unit,
         purchase_price, wholesale_price, retail_price, machine_price, total_delivery_fee,
         distribution_delivery_fee, worker_retail_delivery_fee, worker_wholesale_delivery_fee,
         worker_machine_delivery_fee, category, status, salesman_mini_enabled, salesman_min_price, created_at, updated_at)
       VALUES (?, ?, '冒烟并发商品19L', '19L', '桶', 10.00, 50.00, 20.00, 0.00, 2.00, 3.00, 1.00, 0.50, 0.00, '冒烟', 1, 1, 18.00, NOW(), NOW())`,
      [F.productId, F.productCode]
    );
    await pool.query('INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 30, NOW())', [F.productId]);
    for (const suffix of ['A', 'B', 'C']) {
      await pool.query(
        `INSERT INTO water_tickets (ticket_id, product_id, station_id, status, month, issued_at, issued_by, remark)
         VALUES (?, ?, ?, 1, '2099-01', NOW(), 'smoke', '冒烟并发水票')`,
        [`SMKTK${TS}${suffix}`, F.productId, F.stationId]
      );
    }

    // 水站积分钱包：期初 0，走正规入账原语注入 20（后续第 ② 段要正好花光它）
    const connSeed = await mkConn();
    await connSeed.beginTransaction();
    const w = await walletService.ensureWallet(connSeed, {
      ownerType: 'STATION',
      ownerId: F.stationId,
      ownerName: '冒烟并发送水站'
    });
    const seedRow = await walletService.loadWalletForUpdate(connSeed, w.wallet_id);
    await walletService.creditWallet(connSeed, seedRow, {
      txType: WALLET_TX_TYPE.ADJUST_IN,
      amount: 20,
      relatedType: WALLET_RELATED_TYPE.MANUAL_ADJUST,
      operatorId: 'smoke',
      remark: '冒烟并发：注入 20 积分'
    });
    await connSeed.commit();
    walletId = w.wallet_id;
    fixturesReady = true;
    console.log(`  夹具就绪：水站 ${F.stationId} / 商品 ${F.productId} / 钱包 ${walletId}（20 积分）`);

    // ══════════════════ 1. 水票并发核销 ══════════════════
    section('1. 水票并发核销：同一批 3 张票，两笔订单都要求抵扣 3 张');
    {
      const connA = await mkConn();
      const connB = await mkConn();

      await connA.beginTransaction();
      await writeOffTickets(connA, F.stationId, { [F.productId]: 3 }, F.orderA, productMap, new Date());

      // ⚠️ B 先建立 read view（= 生产里 fetchProductMap 的位置），再让 A 提交 —— 见文件头说明
      await connB.beginTransaction();
      await connB.query('SELECT product_id FROM products WHERE product_id = ?', [F.productId]);
      await connA.commit();

      let bErr = null;
      try {
        await writeOffTickets(connB, F.stationId, { [F.productId]: 3 }, F.orderB, productMap, new Date());
      } catch (e) {
        bErr = e;
      }

      assert(
        bErr !== null,
        '1.1 ★ 第二笔必须被拒（同一批水票不得被两笔订单同时核销）',
        bErr ? '' : '第二笔竟然成功 —— 一张票被抵扣了两次，且第一笔订单已「花掉」的票不再指向它'
      );
      assert(
        bErr === null || bErr.business === true,
        '1.2 拒绝必须是业务错误（bizFail → HTTP 400），不是 500',
        bErr ? String(bErr.message).slice(0, 80) : ''
      );
      await connB.rollback();

      const [tk] = await pool.query(
        'SELECT ticket_id, status, order_id FROM water_tickets WHERE station_id = ? AND product_id = ?',
        [F.stationId, F.productId]
      );
      assert(
        tk.length === 3 && tk.every(t => Number(t.status) === 2 && t.order_id === F.orderA),
        '1.3 三张票仍全部归属第一笔订单（未被第二笔覆盖）',
        tk.map(t => `${t.ticket_id}:${t.status}/${t.order_id}`).join(' ')
      );
      assert(tk.filter(t => t.order_id === F.orderB).length === 0, '1.4 无任何一张票挂在第二笔订单下');
    }

    // ══════════════════ 2. 钱包并发扣款 ══════════════════
    section('2. 钱包并发扣款：余额 20，两笔各扣 20 → 第二笔必须被拒，余额不得为负');
    {
      const connC = await mkConn();
      const connD = await mkConn();

      await connC.beginTransaction();
      const rowC = await walletService.loadWalletForUpdate(connC, walletId);
      await walletService.debitWallet(connC, rowC, {
        txType: WALLET_TX_TYPE.ORDER_PAYMENT,
        amount: 20,
        relatedType: WALLET_RELATED_TYPE.ORDER,
        relatedId: F.orderA,
        operatorId: 'smoke',
        remark: '冒烟并发：第一笔扣款'
      });
      await connC.commit();

      await connD.beginTransaction();
      await connD.query('SELECT wallet_id FROM wallet_accounts WHERE wallet_id = ?', [walletId]); // 建立 read view
      let dErr = null;
      try {
        const rowD = await walletService.loadWalletForUpdate(connD, walletId);
        await walletService.debitWallet(connD, rowD, {
          txType: WALLET_TX_TYPE.ORDER_PAYMENT,
          amount: 20,
          relatedType: WALLET_RELATED_TYPE.ORDER,
          relatedId: F.orderB,
          operatorId: 'smoke',
          remark: '冒烟并发：第二笔扣款'
        });
      } catch (e) {
        dErr = e;
      }
      assert(
        dErr !== null && dErr.business === true,
        '2.1 ★ 余额已扣空 → 第二笔必须被拒（不得出现负余额）',
        dErr ? String(dErr.message).slice(0, 60) : '第二笔竟然成功'
      );
      await connD.rollback();

      const [[wRow]] = await pool.query('SELECT balance, initial_balance FROM wallet_accounts WHERE wallet_id = ?', [
        walletId
      ]);
      assert(Number(wRow.balance) === 0, `2.2 余额 = 0（不为负）：实得 ${wRow.balance}`);

      const [[net]] = await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE -amount END), 0) AS n
           FROM wallet_transactions WHERE wallet_id = ?`,
        [walletId]
      );
      assert(
        Math.abs(Number(wRow.initial_balance) + Number(net.n) - Number(wRow.balance)) < 0.001,
        `2.3 ★ 恒等式 余额 = 期初 + 流水净额（${wRow.initial_balance} + ${net.n} = ${wRow.balance}）`
      );
      const [[outCnt]] = await pool.query(
        'SELECT COUNT(*) n FROM wallet_transactions WHERE wallet_id = ? AND direction = 2',
        [walletId]
      );
      assert(Number(outCnt.n) === 1, '2.4 出账流水恰好 1 笔（被拒的请求不得留下半截流水）', `实得 ${outCnt.n}`);
    }

    // ══════════════════ 3. 库存并发扣减 ══════════════════
    section('3. 库存并发扣减：库存 30，两笔各扣 10 → 必须变成 10（丢失更新会得到 20）');
    {
      const connE = await mkConn();
      const connF = await mkConn();

      await connE.beginTransaction();
      await deductInventoryForSale(connE, F.productId, 10, new Date());

      await connF.beginTransaction();
      await connF.query('SELECT product_id FROM products WHERE product_id = ?', [F.productId]); // 建立 read view
      // F 会在 inventory 行锁上等待 E 提交（这正是行锁要起到的作用）
      const fPromise = deductInventoryForSale(connF, F.productId, 10, new Date()).then(
        () => null,
        e => e
      );
      await sleep(250);
      await connE.commit();
      const fErr = await fPromise;

      assert(fErr === null, '3.1 第二笔扣减成功（库存允许负数，不因并发被拒）', fErr ? String(fErr.message) : '');
      await connF.commit();

      const [[inv]] = await pool.query('SELECT quantity FROM inventory WHERE product_id = ?', [F.productId]);
      assert(
        Number(inv.quantity) === 10,
        `3.2 ★ 无丢失更新：30 − 10 − 10 = 10（实得 ${inv.quantity}；若为 20 说明第二笔用了过期快照）`
      );
    }

    // ══════════════════ 4. 幂等键并发 ══════════════════
    section('4. 幂等键并发：同一 clientRequestId 两笔，只允许一笔真正执行');
    {
      const connG = await mkConn();
      const connH = await mkConn();

      await connG.beginTransaction();
      const g = await walletService.claimIdempotency(connG, {
        scope: IDEM_SCOPE.WALLET_ADJUST,
        key: F.idemKey
      });

      // H：先进事务做一次普通读建立快照，再抢同一个键（唯一索引上会阻塞到 G 提交）
      await connH.beginTransaction();
      await connH.query('SELECT 1 AS x');
      const hPromise = walletService.claimIdempotency(connH, { scope: IDEM_SCOPE.WALLET_ADJUST, key: F.idemKey }).then(
        v => v,
        e => ({ error: e })
      );
      await sleep(250);
      await connG.commit();
      const h = await hPromise;

      assert(g.replayed === false && g.conflict === false, '4.1 第一笔拿到通行证（非重放、非冲突）', JSON.stringify(g));
      assert(!h.error, '4.2 第二笔不抛错（并发重放不是异常路径）', h.error ? String(h.error.message) : '');
      assert(h.replayed === true, '4.3 ★ 同键第二笔被判为重复提交（不得再执行一次业务动作）', JSON.stringify(h));
      await connH.rollback();
    }
  } finally {
    for (const c of conns) {
      try {
        await c.rollback();
      } catch (e) {
        /* ignore */
      }
      try {
        c.release();
      } catch (e) {
        /* ignore */
      }
    }
    // ── 清理夹具（只删本次 SMK*/TS 命中的行），并核对零残留 ──────────────────
    try {
      await pool.query('DELETE FROM water_tickets WHERE ticket_id LIKE ?', [`SMKTK${TS}%`]);
      if (walletId) {
        await pool.query('DELETE FROM wallet_transactions WHERE wallet_id = ?', [walletId]);
        await pool.query('DELETE FROM wallet_accounts WHERE wallet_id = ?', [walletId]);
      }
      await pool.query('DELETE FROM mini_idempotency WHERE idem_key = ?', [F.idemKey]);
      await pool.query('DELETE FROM inventory WHERE product_id = ?', [F.productId]);
      await pool.query('DELETE FROM products WHERE product_id = ?', [F.productId]);
      await pool.query('DELETE FROM sub_stations WHERE station_id = ?', [F.stationId]);

      const [[residue]] = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM water_tickets WHERE ticket_id LIKE ?) AS tickets,
           (SELECT COUNT(*) FROM products WHERE product_id = ?) AS products,
           (SELECT COUNT(*) FROM sub_stations WHERE station_id = ?) AS stations,
           (SELECT COUNT(*) FROM mini_idempotency WHERE idem_key = ?) AS idem`,
        [`SMKTK${TS}%`, F.productId, F.stationId, F.idemKey]
      );
      const total =
        Number(residue.tickets) + Number(residue.products) + Number(residue.stations) + Number(residue.idem);
      console.log(`\n清理：残留 ${total} 条${total === 0 ? ' ✓' : ' ✗ ' + JSON.stringify(residue)}`);
      if (!fixturesReady) console.log('  ⚠️ 夹具未就绪即退出，请检查上方异常');
    } catch (e) {
      console.log(`\n清理：⚠️ 清理失败 ${e.message}`);
    }
    await pool.end();
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('冒烟异常:', e);
  process.exit(1);
});

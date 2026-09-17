/**
 * 冒烟：仪表盘口径一致性（卡片 ↔ 趋势 ↔ 各统计页）
 * ---------------------------------------------------------------------------
 * 覆盖（全部只读，不写库、无残留）：
 *   1) /dashboard/trends 五种粒度的结构与桶数（日30/周12/月12/季8/年5）、桶键唯一
 *   2) 逐桶恒等式：cost = orderCost + salary + otherExpense；revenue = orderRevenue + machineRevenue；
 *                  profit = revenue − cost
 *   3) 趋势「末桶」与卡片 /metrics 逐位对账（月/季/年：同一自然周期，必须完全相等）
 *   4) 卡片口径：总成本 = 订单商品成本 + 工资 + 其他支出；总利润 = 总营收 − 总成本
 *   5) 跨页对账：订单成本 ↔ /cost/overview 各类型成本合计；工资 ↔ 工资统计页；其他支出 ↔ /expenses
 *   6) 趋势分桶求和 ↔ 独立 SQL 整段直算（抓「漏桶 / 桶键对不上导致整桶为 0」）
 *   7) 工资必须是「在职员工 + 应发配送费」口径（离职员工名下配送费不计入）
 *   8) 非法粒度 / 非法周期返回 400
 *
 * 运行：node scripts/smoke_dashboard_trends.js（需后端已启动；或经 run_smokes.js 调度）
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
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;

const EXPECT_BUCKETS = { day: 30, week: 12, month: 12, quarter: 8, year: 5 };

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(login.data?.token, '管理员登录');
  if (!login.data?.token) { console.log('\n结果：登录失败，终止'); process.exit(1); }
  const token = login.data.token;

  const { pool } = require('../src/config/db');
  const { costExpr } = require('../src/utils/costExpr');
  const { itemRevenueExpr } = require('../src/utils/revenueExpr');
  const { deliveryFeeExpr } = require('../src/services/salarySummary');
  const { VALID_ORDER_TYPES } = require('../src/constants/order');
  const ORDER_TYPE_IN = `o.order_type IN (${VALID_ORDER_TYPES.join(',')})`;

  try {
    // ---------- 1) 结构 ----------
    console.log('\n=== 1) /dashboard/trends 结构（5 种粒度）===');
    const trends = {};
    for (const g of Object.keys(EXPECT_BUCKETS)) {
      const res = await call('GET', `/dashboard/trends?granularity=${g}`, null, token);
      const d = res.data;
      const okStruct = res.code === 200 && d && Array.isArray(d.buckets);
      assert(okStruct, `trends(${g}) 返回 200 且含 buckets`, JSON.stringify(res).slice(0, 120));
      if (!okStruct) continue;
      trends[g] = d;
      assert(d.buckets.length === EXPECT_BUCKETS[g], `trends(${g}) 桶数 = ${EXPECT_BUCKETS[g]}`,
        `实际 ${d.buckets.length}`);
      const keys = d.buckets.map((b) => b.key);
      assert(new Set(keys).size === keys.length, `trends(${g}) 桶键无重复`);
      assert(d.buckets.every((b) => typeof b.label === 'string' && b.label), `trends(${g}) 每个桶都有 label`);
      assert(!!d.start && !!d.end && d.start < d.end, `trends(${g}) 范围合法`, `${d.start} ~ ${d.end}`);
      console.log(`     范围 ${d.start} ~ ${d.end}｜首桶 ${keys[0]}｜末桶 ${keys[keys.length - 1]}`);
    }

    // ---------- 2) 逐桶恒等式 ----------
    console.log('\n=== 2) 逐桶拆分恒等式 ===');
    const broken = [];
    Object.entries(trends).forEach(([g, d]) => {
      d.buckets.forEach((b) => {
        if (!near(b.cost, Number(b.orderCost) + Number(b.salary) + Number(b.otherExpense))) broken.push(`${g}/${b.key} cost`);
        if (!near(b.revenue, Number(b.orderRevenue) + Number(b.machineRevenue))) broken.push(`${g}/${b.key} revenue`);
        if (!near(b.profit, Number(b.revenue) - Number(b.cost))) broken.push(`${g}/${b.key} profit`);
      });
    });
    assert(broken.length === 0, '各粒度逐桶满足 cost / revenue / profit 拆分恒等式', broken.slice(0, 6).join('; '));

    // ---------- 3) 趋势末桶 ↔ 卡片 ----------
    console.log('\n=== 3) 趋势末桶 ↔ /dashboard/metrics 卡片 ===');
    const metrics = {};
    for (const g of ['month', 'quarter', 'year']) {
      const res = await call('GET', `/dashboard/metrics?range=${g}`, null, token);
      assert(res.code === 200 && res.data, `metrics(${g}) 返回 200`);
      if (!res.data) continue;
      metrics[g] = res.data;
      const last = trends[g].buckets[trends[g].buckets.length - 1];
      assert(near(res.data.salesQty, last.salesQty), `trends(${g}) 末桶销量 == 卡片`,
        `${last.salesQty} vs ${res.data.salesQty}`);
      assert(near(res.data.revenue, last.revenue), `trends(${g}) 末桶营收 == 卡片`,
        `${last.revenue} vs ${res.data.revenue}`);
      assert(near(res.data.cost, last.cost), `trends(${g}) 末桶成本 == 卡片`,
        `${last.cost} vs ${res.data.cost}`);
      assert(near(res.data.salary, last.salary), `trends(${g}) 末桶工资 == 卡片`,
        `${last.salary} vs ${res.data.salary}`);
      assert(near(res.data.profit, last.profit), `trends(${g}) 末桶利润 == 卡片`,
        `${last.profit} vs ${res.data.profit}`);
    }

    const m = metrics.month;
    if (m) {
      // ---------- 4) 卡片口径 ----------
      console.log('\n=== 4) 卡片口径（总成本含工资与其他支出）===');
      const d = m.detail || {};
      console.log(`     营收 ${m.revenue}｜订单成本 ${d.orderCost}｜工资 ${d.salary}｜其他支出 ${d.otherExpense}｜成本 ${m.cost}｜利润 ${m.profit}`);
      assert(near(m.cost, Number(d.orderCost) + Number(d.salary) + Number(d.otherExpense)),
        '总成本 = 订单商品成本 + 工资 + 其他支出',
        `${m.cost} vs ${Number(d.orderCost) + Number(d.salary) + Number(d.otherExpense)}`);
      assert(near(m.profit, Number(m.revenue) - Number(m.cost)), '总利润 = 总营收 − 总成本');
      assert(near(m.salary, d.salary) && near(m.otherExpense, d.otherExpense), '卡片工资/其他支出与明细字段一致');
      if (Number(d.salary) !== 0) {
        assert(Number(m.cost) > Number(d.orderCost), '总成本确实已并入工资（大于纯订单成本）');
      }

      // ---------- 5) 跨页对账 ----------
      console.log('\n=== 5) 跨页对账 ===');
      const costOv = await call('GET', '/cost/overview?range=month', null, token);
      assert(costOv.code === 200 && costOv.data, '成本统计 /cost/overview 可访问');
      if (costOv.data) {
        assert(near(d.orderCost, costOv.data.orderCostTotal), '订单商品成本 == 成本统计页各类型成本合计',
          `${d.orderCost} vs ${costOv.data.orderCostTotal}`);
      }
      const sal = await call('GET', '/salary/summary?range=month', null, token);
      assert(sal.code === 200 && sal.data, '工资统计 /salary/summary 可访问');
      if (sal.data) {
        assert(near(d.salary, sal.data.summary.totalDue), '工资 == 工资统计页「应发」合计（totalDue）',
          `${d.salary} vs ${sal.data.summary.totalDue}`);
        console.log(`     （参考：工资页结算口径 totalDeliveryFee = ${sal.data.summary.totalDeliveryFee}）`);
      }
      const ex = await call('GET', '/expenses?range=month', null, token);
      assert(ex.code === 200 && ex.data, '其他支出 /expenses 可访问');
      if (ex.data) {
        assert(near(d.otherExpense, ex.data.sumAmount), '其他支出 == 其他支出页合计',
          `${d.otherExpense} vs ${ex.data.sumAmount}`);
      }
    }

    // ---------- 6) 分桶求和 ↔ 独立 SQL 整段直算 ----------
    console.log('\n=== 6) 趋势分桶求和 ↔ 整段独立直算 ===');
    for (const g of ['day', 'week', 'month', 'quarter', 'year']) {
      const d = trends[g];
      if (!d) continue;
      const [rows] = await pool.query(
        `SELECT ROUND(COALESCE(SUM(${costExpr()}), 0), 2) AS cost,
                ROUND(COALESCE(SUM(${itemRevenueExpr()}), 0), 2) AS revenue
         FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
         WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN} AND o.created_at >= ? AND o.created_at < ?`,
        [d.start, d.end]
      );
      const sumCost = d.buckets.reduce((s, b) => s + Number(b.orderCost), 0);
      const sumRev = d.buckets.reduce((s, b) => s + Number(b.orderRevenue), 0);
      assert(near(sumCost, rows[0].cost), `trends(${g}) 各桶订单成本合计 == 直算`,
        `${Math.round(sumCost * 100) / 100} vs ${rows[0].cost}`);
      assert(near(sumRev, rows[0].revenue), `trends(${g}) 各桶订单营收合计 == 直算`,
        `${Math.round(sumRev * 100) / 100} vs ${rows[0].revenue}`);
    }

    // ---------- 7) 工资口径：在职员工 + 应发配送费 ----------
    console.log('\n=== 7) 工资口径（在职员工 · 应发配送费）===');
    if (m) {
      const fee = deliveryFeeExpr();
      const [feeRows] = await pool.query(
        `SELECT ROUND(COALESCE(SUM(CASE WHEN o.delivery_type IN (1,2) AND o.worker_id IS NOT NULL AND wk.status = 1
                                        THEN ${fee} * oi.quantity ELSE 0 END), 0), 2) AS on_active,
                ROUND(COALESCE(SUM(CASE WHEN o.delivery_type IN (1,2) AND o.worker_id IS NOT NULL
                                        THEN ${fee} * oi.quantity ELSE 0 END), 0), 2) AS all_workers,
                ROUND(COALESCE(SUM(CASE WHEN o.delivery_type IN (1,2) AND o.worker_id IS NOT NULL AND wk.status = 0
                                        THEN ${fee} * oi.quantity ELSE 0 END), 0), 2) AS off_active
         FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
         LEFT JOIN workers wk ON wk.worker_id = o.worker_id
         WHERE o.canceled_at IS NULL AND ${ORDER_TYPE_IN} AND o.created_at >= ? AND o.created_at < ?`,
        [m.start, m.end]
      );
      const r = feeRows[0];
      console.log(`     在职 ${r.on_active}｜含离职 ${r.all_workers}｜离职名下 ${r.off_active}`);
      assert(near(m.detail.salary, r.on_active), '卡片工资 == 在职员工配送费合计',
        `${m.detail.salary} vs ${r.on_active}`);
      const lastBucket = trends.month.buckets[trends.month.buckets.length - 1];
      assert(near(lastBucket.salary, r.on_active), '趋势末桶工资 == 在职员工配送费合计',
        `${lastBucket.salary} vs ${r.on_active}`);
      if (Number(r.off_active) !== 0) {
        console.log(`     ℹ️ 库中存在离职员工名下的配送费 ${r.off_active} 元，已按工资统计页口径排除（本断言具区分度）`);
      }
    }

    // ---------- 8) 非法入参 ----------
    console.log('\n=== 8) 非法入参 ===');
    const bad1 = await call('GET', '/dashboard/trends?granularity=bogus', null, token);
    assert(bad1.code === 400, '非法粒度 trends → 400', JSON.stringify(bad1).slice(0, 120));
    const bad2 = await call('GET', '/dashboard/metrics?range=bogus', null, token);
    assert(bad2.code === 400, '非法周期 metrics → 400', JSON.stringify(bad2).slice(0, 120));
  } catch (e) {
    fail++;
    console.log('\n❌ 执行异常: ' + e.message);
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})();

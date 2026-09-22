// 小程序管理端 · 报表三域（Phase 8b 第 12~14 域：营收 / 成本 / 利润，文档 §5.3）
// ===========================================================================
// 为什么这三个域一次交付：它们**全是只读报表**，接口形状同构（区间 + 概览 + 按订单类型明细），
//   没有幂等/审计/资金动作，风险面只有一条 —— **数字必须与 Web 端一致**。
//   因此本域的设计重点是「取数单源」：三个接口分别复用 Web 控制器里抽出的
//   `loadFinanceSummary` / `loadCostOverview` / `loadProfitOverview`，
//   小程序侧**一行 SQL 都不写**（报表分叉的表现是「同一区间两个端数字不同」，
//   而那种时候没人能判断哪个对 —— 只能靠物理上只有一份实现来保证）。
//
// ⚠️⚠️ **两套区间约定的不对称（必须显式处理，否则静默错数据）**：
//   ① 营收走 financialController.resolveDateRange：预设 `all/day/week/month/year/custom`，
//      **未知 key 会走 default 分支退化成「今天」** —— 也就是说 `?range=quarter` 不会报错，
//      而是安静地只算今天。这是本仓「静默错数据」的典型形态（历史同类事故见 docs 概览）。
//   ② 成本/利润走 utils/dateRange.resolveRange：预设含 `quarter`，未知 key **返回 null** → 400。
//   → 所以本控制器**自己维护白名单**（每域一个，来自各自实现真正支持的键），
//     非法一律 400，绝不让「未知区间」掉进任何默认分支。
//   （收费端那侧的 default 兜底仍按原样保留，未在本批改动 —— 已登记为待办，见交付文档。）
//
// ⚠️ 另外两处口径细节（都在被复用的取数函数注释里写明，这里只留索引）：
//   · 营收 = 订单类(1/2/3/5) + 机台类(4/6，来自 machine_sales) + 其他收入(手工台账)；
//     其他收入**只进总额不进 list**（list 是「按订单类型」维度）。
//   · 利润 overall.profit 由 revenue − costTotal 重算（不是 sum(list.profit)），
//     以保证 overall.profit === overall.revenue − overall.costTotal 恒成立。
// ===========================================================================
const { success, error } = require('../../../utils/response');
const { resolveRange, RANGE_INVALID_MSG } = require('../../../utils/dateRange');
const { loadFinanceSummary, FINANCE_RANGE_INVALID_MSG } = require('../../financialController');
const { loadCostOverview } = require('../../costController');
const { loadProfitOverview } = require('../../profitController');

/**
 * 各域**真正支持**的预设键 —— 逐个运行时核对过，不是「我们想支持什么」：
 *   · financialController.resolveDateRange: all / day / week / month / year（+ custom）
 *   · utils/dateRange.resolveRange:        day / week / month / lastMonth / quarter / year（+ custom）
 *   两边都支持的只有 month / year；quarter 只有成本/利润有；all 只有营收有。
 * ⚠️ 这就是必须逐域白名单的原因：把两套预设当成同一套，就会出现跨界键。
 *    ✅ 2026-09-22 已修：营收侧未知 range 现在返回 null → **400**（不再静默变成「今天」）；
 *       修复前 `?range=quarter` 返回 200 且数值与 `range=day` 完全相同 —— 不报错、还像模像样。
 *    ⚠️ 白名单仍必须保留：它在进入取数函数**之前**就拦下跨界键（文案也更准确），
 *       且成本 `?range=all` 依然依赖它（utils/dateRange 的 RANGE_KEYS 里没有 all）。
 * ⚠️ 只暴露两边都有语义的 month/year + 各域独有键；custom 需要起止日期，
 *    手机端本期不给（Web 上可用）—— 这是有意的范围决定，不是遗漏。
 */
const RANGE_KEYS = {
  revenue: ['month', 'year', 'all'],
  cost: ['month', 'quarter', 'year'],
  profit: ['month', 'quarter', 'year']
};

const RANGE_LABEL = { month: '本月', quarter: '本季度', year: '本年', all: '全部' };

/** 区间选项（下发给页面，避免前端再维护一份与后端不一致的清单） */
function rangeOptions(kind) {
  return RANGE_KEYS[kind].map(v => ({ value: v, label: RANGE_LABEL[v] || v }));
}

/** 区间白名单校验：返回 {range} 或 {error} */
function pickRange(kind, raw) {
  const key = raw === undefined || raw === null || raw === '' ? 'month' : String(raw);
  if (!RANGE_KEYS[kind].includes(key)) {
    return { error: `区间参数不正确（${kind} 仅支持 ${RANGE_KEYS[kind].join('/')}）` };
  }
  return { range: key };
}

/** 金额两位小数（报表展示用；不参与计算，计算口径一律在取数函数里） */
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ── GET /mini/admin/reports/revenue —— 营收概览（复用 loadFinanceSummary）──
async function getRevenue(req, res) {
  const picked = pickRange('revenue', req.query.range);
  if (picked.error) return error(res, picked.error, 400);
  try {
    const data = await loadFinanceSummary({ range: picked.range });
    // 白名单已在上方拦过一轮；这里兜底，防止将来放宽白名单时把 null 当成功返回
    if (!data) return error(res, FINANCE_RANGE_INVALID_MSG, 400);
    return success(res, {
      kind: 'revenue',
      range: picked.range,
      rangeOptions: rangeOptions('revenue'),
      // ⚠️ 营收取数用的是「start 含 / end **含**」那套约定，故这里原样回传，
      //    页面只展示不参与计算
      start: data.start,
      end: data.end,
      totalRevenue: r2(data.overall.totalRevenue),
      otherIncome: r2(data.overall.otherIncome),
      list: (data.list || []).map(x => ({
        orderType: x.orderType,
        typeName: x.typeName,
        revenue: r2(x.revenue),
        goodsAmount: r2(x.goodsAmount),
        deliveryFee: r2(x.deliveryFee),
        ticketValue: r2(x.ticketValue),
        source: x.source,
        qty: Number(x.qty) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 营收概览失败:', e);
    return error(res, '营收概览查询失败');
  }
}

// ── GET /mini/admin/reports/cost —— 成本概览（复用 loadCostOverview）────────
async function getCost(req, res) {
  const picked = pickRange('cost', req.query.range);
  if (picked.error) return error(res, picked.error, 400);
  const r = resolveRange({ range: picked.range });
  if (!r) return error(res, RANGE_INVALID_MSG, 400);
  try {
    const data = await loadCostOverview(r);
    return success(res, {
      kind: 'cost',
      range: picked.range,
      rangeOptions: rangeOptions('cost'),
      start: data.start,
      end: data.end,
      orderCostTotal: r2(data.orderCostTotal),
      list: (data.list || []).map(x => ({
        orderType: x.orderType,
        typeName: x.typeName,
        costTotal: r2(x.costTotal),
        orderCount: Number(x.orderCount) || 0,
        totalQty: Number(x.totalQty) || 0,
        label: x.label || null
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 成本概览失败:', e);
    return error(res, '成本概览查询失败');
  }
}

// ── GET /mini/admin/reports/profit —— 利润概览（复用 loadProfitOverview）────
async function getProfit(req, res) {
  const picked = pickRange('profit', req.query.range);
  if (picked.error) return error(res, picked.error, 400);
  const r = resolveRange({ range: picked.range });
  if (!r) return error(res, RANGE_INVALID_MSG, 400);
  try {
    const data = await loadProfitOverview(r);
    const o = data.overall || {};
    return success(res, {
      kind: 'profit',
      range: picked.range,
      rangeOptions: rangeOptions('profit'),
      start: data.start,
      end: data.end,
      overall: {
        revenue: r2(o.revenue),
        costTotal: r2(o.costTotal),
        profit: r2(o.profit),
        otherIncome: r2(o.otherIncome),
        margin: Number(o.margin) || 0
      },
      list: (data.list || []).map(x => ({
        orderType: x.orderType,
        typeName: x.typeName,
        revenue: r2(x.revenue),
        costTotal: r2(x.costTotal),
        profit: r2(x.profit),
        orderCount: Number(x.orderCount) || 0,
        totalQty: Number(x.totalQty) || 0,
        // 直营水站（类型 2）拆成利润1/利润2，与 Web 利润页口径一致
        revenue1: x.revenue1 === undefined ? null : r2(x.revenue1),
        revenue2: x.revenue2 === undefined ? null : r2(x.revenue2),
        cost1: x.cost1 === undefined ? null : r2(x.cost1),
        cost2: x.cost2 === undefined ? null : r2(x.cost2),
        profit1: x.profit1 === undefined ? null : r2(x.profit1),
        profit2: x.profit2 === undefined ? null : r2(x.profit2),
        label: x.label || null
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 利润概览失败:', e);
    return error(res, '利润概览查询失败');
  }
}

module.exports = { getRevenue, getCost, getProfit };

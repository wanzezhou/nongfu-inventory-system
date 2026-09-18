/**
 * 其他支出 / 其他收入 的汇总单源
 * ============================================================================
 * 为什么要有这个文件：
 *   「其他支出」原先在 dashboardController 里自带一个 loadOtherExpense，
 *   现在又要加「其他收入」——若照抄一份，就会变成两处各写一份 SUM。
 *   本项目已多次因「同一口径写两遍」出问题（成本/利润/仪表盘的营收口径就曾各写一份），
 *   故这里把两张台账的取数收敛成一处：表名、日期列、聚合写法只定义一次。
 *
 * 口径：均为**全表求和**，按各自日期列过滤区间；区间语义由 utils/dateRange 统一
 *      （range/month 走 resolveRange，start 含、end 不含）。
 *
 * ⚠️ 改表名 / 改日期列 / 改聚合方式，只改 LEDGERS 即可。
 */
const { pool } = require('../config/db');
const { bucketExpr } = require('../utils/trendBuckets');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// 两类台账的物理定义（kind -> 表与日期列）
const LEDGERS = {
  expense: { table: 'other_expenses', dateCol: 'expense_date' },
  income: { table: 'other_incomes', dateCol: 'income_date' }
};

/**
 * 台账合计（按区间过滤）
 *
 * ⚠️ `endInclusive` 必须与**调用方的区间约定**一致 —— 本仓存在两套约定：
 *    · utils/dateRange.buildRangeWhere  → start 含、end **不含**（仪表盘 / 趋势 / 收入页）
 *    · financialController.resolveDateRange → start 含、end **含**（营收汇总 / 利润汇总页）
 *    混用会造成「今天录入的数据在某个页面看不到」这类隐蔽缺口：
 *    2026-09-18 新增其他收入时即踩到 —— 营收汇总的 otherIncome 恒为 0，
 *    因为 `income_date < 今天` 把当天记录全部排除了。
 *    故这里把约定显式化为参数，而不是让调用方"碰巧"传对。
 */
async function loadLedgerTotal(kind, { start, end, endInclusive = false } = {}) {
  const { table, dateCol } = LEDGERS[kind];
  const clauses = [];
  const params = [];
  if (start) {
    clauses.push(`${dateCol} >= ?`);
    params.push(start);
  }
  if (end) {
    clauses.push(`${dateCol} ${endInclusive ? '<=' : '<'} ?`);
    params.push(end);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const [rows] = await pool.execute(
    `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM ${table} ${where}`,
    params
  );
  return round2(rows[0].total);
}

/** 台账分桶（趋势图用）：返回原始行 [{ bucket, amount }]，补 0 由调用方按桶刻度完成 */
async function loadLedgerBuckets(kind, granularity, start, end) {
  const { table, dateCol } = LEDGERS[kind];
  const [rows] = await pool.execute(
    `SELECT ${bucketExpr(dateCol, granularity)} AS bucket,
            ROUND(COALESCE(SUM(amount), 0), 2) AS amount
     FROM ${table}
     WHERE ${dateCol} >= ? AND ${dateCol} < ?
     GROUP BY bucket`,
    [start, end]
  );
  return rows;
}

const loadOtherExpenseTotal = r => loadLedgerTotal('expense', r);
const loadOtherIncomeTotal = r => loadLedgerTotal('income', r);
const loadOtherExpenseBuckets = (g, start, end) => loadLedgerBuckets('expense', g, start, end);
const loadOtherIncomeBuckets = (g, start, end) => loadLedgerBuckets('income', g, start, end);

module.exports = {
  LEDGERS,
  loadOtherExpenseTotal,
  loadOtherIncomeTotal,
  loadOtherExpenseBuckets,
  loadOtherIncomeBuckets
};

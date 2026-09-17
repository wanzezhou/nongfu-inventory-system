// 趋势分桶（日 / 周 / 月 / 季 / 年）—— 仪表盘趋势图专用（2026-09-17）
// ---------------------------------------------------------------------------
// 为什么单独抽出来：分桶要同时产出两样东西，二者必须严格对齐
//   ① { key, label }  —— Node 侧补齐「零值桶」用（SQL 查不到的桶要显示 0，不能缺 x 轴刻度）
//   ② bucketExpr()    —— SQL 的 GROUP BY 表达式，其结果必须与 key 逐字符相同
//   若两处各自实现，最容易出的错是「SQL 分出来的键在 key 列表里找不到」→ 整条曲线全 0。
//
// 桶数（每档显示固定个数，便于一眼看出量级与走势）：
//   日 30 天 / 周 12 周 / 月 12 个月 / 季 8 个季度 / 年 5 年
//
// ⚠️ 每个桶都是**完整自然周期**（本周=周一~周日、本月=整个自然月…），
//    最后一个桶是「当前未结束的周期」。因此整段范围与 utils/dateRange.resolveRange
//    的 week/month/quarter/year 完全一致 ⇒ 趋势各桶合计可以跟卡片数字直接对账。
//    （若把末桶截到「今天」，则会出现「趋势合计 < 卡片数字」的假象，排障时极易误判。）

const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'];

const BUCKET_COUNTS = { day: 30, week: 12, month: 12, quarter: 8, year: 5 };

const pad2 = (n) => String(n).padStart(2, '0');

function fmt(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * SQL 分组表达式（结果须与 buildBuckets 产出的 key 一致）
 * @param {string} column 时间列，如 'o.created_at' / 'sale_date' / 'expense_date'
 * @param {string} granularity day|week|month|quarter|year
 * @returns {string} 可放进 SELECT / GROUP BY 的表达式
 */
function bucketExpr(column, granularity) {
  switch (granularity) {
    case 'day':
      return `DATE_FORMAT(${column}, '%Y-%m-%d')`;
    case 'week':
      // WEEKDAY() 0=周一 → 回退到本周一；按「周一日期」作为该周的键
      return `DATE_FORMAT(DATE_SUB(DATE(${column}), INTERVAL WEEKDAY(${column}) DAY), '%Y-%m-%d')`;
    case 'month':
      return `DATE_FORMAT(${column}, '%Y-%m')`;
    case 'quarter':
      return `CONCAT(YEAR(${column}), 'Q', QUARTER(${column}))`;
    case 'year':
      return `DATE_FORMAT(${column}, '%Y')`;
    default:
      throw new Error(`未知趋势粒度: ${granularity}`);
  }
}

/** 某个周期起点对应的「下一周期起点」（开区间终点） */
function periodEnd(granularity, date) {
  switch (granularity) {
    case 'day': return addDays(date, 1);
    case 'week': return addDays(date, 7);
    case 'month': return new Date(date.getFullYear(), date.getMonth() + 1, 1);
    case 'quarter': return new Date(date.getFullYear(), date.getMonth() + 3, 1);
    case 'year': return new Date(date.getFullYear() + 1, 0, 1);
    default: return addDays(date, 1);
  }
}

/**
 * 生成连续桶序列（含起点日期 date，供计算整段范围）
 * @returns {{list: Array<{key:string,label:string,date:Date}>, start:string, end:string}}
 */
function buildBuckets(granularity) {
  const size = BUCKET_COUNTS[granularity];
  if (!size) throw new Error(`未知趋势粒度: ${granularity}`);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const list = [];

  if (granularity === 'day') {
    for (let i = size - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      list.push({ key: fmt(d), label: `${d.getMonth() + 1}/${d.getDate()}`, date: d });
    }
  } else if (granularity === 'week') {
    const dow = today.getDay() || 7; // 周日=7
    const monday = addDays(today, -(dow - 1));
    for (let i = size - 1; i >= 0; i--) {
      const d = addDays(monday, -7 * i);
      list.push({ key: fmt(d), label: `${d.getMonth() + 1}/${d.getDate()}`, date: d });
    }
  } else if (granularity === 'month') {
    // label 只给「M月」保持 x 轴清爽（12 个月必然跨年，同月号不会重复）；完整年月在 tooltip 里给
    for (let i = size - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      list.push({ key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: `${d.getMonth() + 1}月`, date: d });
    }
  } else if (granularity === 'quarter') {
    const base = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    for (let i = size - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - 3 * i, 1);
      const q = Math.floor(d.getMonth() / 3) + 1;
      list.push({
        key: `${d.getFullYear()}Q${q}`,
        label: `${String(d.getFullYear()).slice(2)}Q${q}`, // 8 个季度必跨年，故 label 带年份
        date: d
      });
    }
  } else {
    for (let i = size - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear() - i, 0, 1);
      list.push({ key: String(d.getFullYear()), label: String(d.getFullYear()), date: d });
    }
  }

  return {
    list,
    start: fmt(list[0].date),
    end: fmt(periodEnd(granularity, list[list.length - 1].date))
  };
}

module.exports = { GRANULARITIES, BUCKET_COUNTS, bucketExpr, buildBuckets };

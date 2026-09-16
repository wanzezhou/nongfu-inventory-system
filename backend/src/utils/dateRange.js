// 统一时间范围解析（成本统计 / 工资统计 / 其他支出等模块共用）
//
// 预设：day(今日) / week(本周) / month(本月) / lastMonth(上月) / quarter(本季度) / year(今年) / custom(自定义)
// 兼容旧参数：month=YYYY-MM（等价于该整月，供历史调用与冒烟脚本使用）
//
// 约定：返回的 start 为闭区间起点、end 为开区间终点（均 YYYY-MM-DD，含端点为 end 前一天）
//   例如 7 月整月 → { start: '2026-07-01', end: '2026-08-01' }
//   day → { start: '今天', end: '明天' }；week → { start: '本周一', end: '明天' }
//   （day/week 口径与 statisticsController 的历史实现一致，均到「今天」为止，不含未来）

const RANGE_KEYS = ['day', 'week', 'month', 'lastMonth', 'quarter', 'year', 'custom'];

// 非法 range 的统一提示文案：由白名单派生，避免增删预设后文案漂移（各控制器统一引用）
const RANGE_INVALID_MSG =
  `时间范围不合法：range 支持 ${RANGE_KEYS.join('/')}，自定义需合法起止日期`;

function isMonthStr(m) {
  return typeof m === 'string' && /^\d{4}-\d{2}$/.test(m);
}

function isDateStr(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 'YYYY-MM-DD' → 本地 0 点 Date（避免 new Date('YYYY-MM-DD') 按 UTC 解析导致跨日偏移）
function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 解析时间范围。
 * @param {object} q 查询参数
 * @param {string} [q.range]     预设键
 * @param {string} [q.startDate] 自定义起（YYYY-MM-DD）
 * @param {string} [q.endDate]   自定义止（YYYY-MM-DD，含）
 * @param {string} [q.month]     旧参数 YYYY-MM
 * @returns {{start:string,end:string|null,startMonth:string,endMonth:string,isSingleMonth:boolean,range:string}|null}
 *          解析失败返回 null（调用方回 400）
 */
function resolveRange(q = {}) {
  const { range, startDate, endDate, month } = q;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let key = range;
  if (!key) {
    // 显式传了 month 就必须合法，否则 400——不可静默回退成本月
    if (month !== undefined && month !== null && month !== '') {
      if (!isMonthStr(month)) return null;
      key = 'legacyMonth';
    } else {
      key = 'month';
    }
  }
  if (key !== 'legacyMonth' && !RANGE_KEYS.includes(key)) return null;

  let start;
  let end;

  switch (key) {
    case 'legacyMonth': {
      if (!isMonthStr(month)) return null;
      const [y, m] = month.split('-').map(Number);
      start = fmt(new Date(y, m - 1, 1));
      end = fmt(new Date(y, m, 1));
      break;
    }
    case 'day': {
      start = fmt(today);
      end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      break;
    }
    case 'week': {
      const dow = now.getDay() || 7; // 周日=7，周一=1
      start = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1));
      end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      break;
    }
    case 'month': {
      start = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      end = fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1));
      break;
    }
    case 'lastMonth': {
      start = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      end = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
      break;
    }
    case 'quarter': {
      const qm = Math.floor(now.getMonth() / 3) * 3; // 本季度首月
      start = fmt(new Date(now.getFullYear(), qm, 1));
      end = fmt(new Date(now.getFullYear(), qm + 3, 1));
      break;
    }
    case 'year': {
      start = fmt(new Date(now.getFullYear(), 0, 1));
      end = fmt(new Date(now.getFullYear() + 1, 0, 1));
      break;
    }
    case 'custom': {
      if (!isDateStr(startDate)) return null;
      start = startDate;
      // 未给结束日期 → 开放区间（仅约束下界）
      end = isDateStr(endDate) ? fmt(new Date(parseDate(endDate).getTime() + 86400000)) : null;
      if (end && end <= start) return null; // 起止倒置
      break;
    }
    default:
      return null;
  }

  const startMonth = start.slice(0, 7);
  // 开区间终点回退一天即为实际最后一天；开放区间则以今天为界
  const lastDay = end ? new Date(parseDate(end).getTime() - 86400000) : today;
  const endMonth = fmt(lastDay).slice(0, 7);

  return {
    start,
    end,
    startMonth,
    endMonth,
    isSingleMonth: startMonth === endMonth,
    range: key
  };
}

/**
 * 生成时间范围 SQL 片段与参数（列名由调用方给出，勿传用户输入）。
 * @param {string} column 如 'o.created_at' / 'expense_date'
 * @param {{start:string,end:string|null}} r resolveRange 结果
 * @returns {{clause:string, params:Array}} clause 为空串表示无时间条件
 */
function buildRangeWhere(column, r) {
  if (!r) return { clause: '', params: [] };
  const clauses = [`${column} >= ?`];
  const params = [r.start];
  if (r.end) {
    clauses.push(`${column} < ?`);
    params.push(r.end);
  }
  return { clause: clauses.join(' AND '), params };
}

module.exports = { resolveRange, buildRangeWhere, isMonthStr, isDateStr, RANGE_KEYS, RANGE_INVALID_MSG };

// 统计类页面统一的时间范围筛选（与后端 utils/dateRange.js 的预设键一一对应）
//
// 约定：预设只传 range，由后端解析具体区间（避免前后端各算一套日期）；
//      自定义传 range='custom' + startDate/endDate（YYYY-MM-DD，含端）。

export const RANGE_PRESETS = [
  { value: 'month', label: '本月' },
  { value: 'lastMonth', label: '上月' },
  { value: 'quarter', label: '本季度' },
  { value: 'year', label: '今年' },
  { value: 'custom', label: '自定义' }
]

export function defaultRange() {
  return { range: 'month', startDate: '', endDate: '' }
}

// 组装请求参数
export function toQuery(r) {
  if (!r) return { range: 'month' }
  const q = { range: r.range || 'month' }
  if (q.range === 'custom') {
    q.startDate = r.startDate
    q.endDate = r.endDate
  }
  return q
}

// 自定义区间是否已选完整
export function isRangeReady(r) {
  if (!r) return false
  if (r.range !== 'custom') return true
  return !!r.startDate && !!r.endDate
}

// 展示文案（纯预设推导，不做区间边界计算）
export function rangeText(r) {
  if (!r) return ''
  const now = new Date()
  const y = now.getFullYear()
  switch (r.range) {
    case 'month':
      return `${y}年${now.getMonth() + 1}月`
    case 'lastMonth': {
      const d = new Date(y, now.getMonth() - 1, 1)
      return `${d.getFullYear()}年${d.getMonth() + 1}月`
    }
    case 'quarter':
      return `${y}年第${Math.floor(now.getMonth() / 3) + 1}季度`
    case 'year':
      return `${y}年`
    case 'custom':
      return r.startDate && r.endDate ? `${r.startDate} ~ ${r.endDate}` : '自定义'
    default:
      return ''
  }
}

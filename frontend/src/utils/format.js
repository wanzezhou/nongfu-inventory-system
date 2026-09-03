/**
 * 全局格式化工具
 * formatMoney：金额两位小数 + 千分位（zh-CN）。
 * 注意：0 是合法金额；undefined/null/NaN/'' 统一显示 '0.00'。
 */
export function formatMoney(value) {
  const num = Number(value) || 0
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * 通用业务ID生成器
 * 格式：前缀 + 13位毫秒时间戳 + 4位随机数（与历史各模块生成格式完全一致）
 * 注意：订单ID（generateOrderId）基于数据库序号生成，不在此工具范围内
 */
function generateId(prefix = '') {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}${timestamp}${random}`;
}

module.exports = { generateId };

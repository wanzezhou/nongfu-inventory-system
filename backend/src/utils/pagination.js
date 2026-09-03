/**
 * 分页参数解析工具
 * 将 query 中的 page/pageSize 统一解析并做边界保护：
 *   page ≥ 1（非法值回退 1），1 ≤ size ≤ maxSize（默认回退 10）
 * 返回 { page, size, offset }，供 LIMIT/OFFSET 与 pagination(res,...) 复用
 */
function parsePage(query = {}, { maxSize = 200 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(maxSize, Math.max(1, parseInt(query.pageSize, 10) || 10));
  const offset = (page - 1) * size;
  return { page, size, offset };
}

module.exports = { parsePage };

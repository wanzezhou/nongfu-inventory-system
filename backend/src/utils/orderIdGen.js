// 订单号生成器 —— 订单ID 规则的唯一实现
// ===========================================================================
// 规则：SZX + yyyymmdd + 5 位当日序号（每天从 00001 开始递增）
//
// 抽取原因（2026-09-20）：小程序订单与 Web 订单**共享 orders 表**，
// 若小程序侧另抄一份编号逻辑，两套实现一旦分叉就会出现订单号碰撞
// （同一个 SZX2026092000001 被两条 INSERT 抢）——而订单号是主键，碰撞即 500。
// 文档 §2 也明确要求「订单统一：小程序订单和 Web 订单共享 orders / order_items」。
//
// ⚠️ 本函数必须在**事务内**调用，且与 INSERT orders 处于同一事务，
//    否则并发下仍可能取到同一个最大号（当前实现依赖「读最大号 → 插入」在事务内的隔离性）。
// ===========================================================================

/**
 * 生成订单ID
 * @param {object} connection 已开启事务的连接
 * @returns {Promise<string>} 形如 SZX2026092000001
 */
async function generateOrderId(connection) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePart = `${year}${month}${day}`;
  const prefix = `SZX${datePart}`;

  // 查询当天已有的最大订单号
  const [rows] = await connection.execute(
    'SELECT order_id FROM orders WHERE order_id LIKE ? ORDER BY order_id DESC LIMIT 1',
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0) {
    const lastOrderId = rows[0].order_id;
    const lastSeq = parseInt(lastOrderId.slice(prefix.length), 10);
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1;
    }
  }

  return `${prefix}${String(seq).padStart(5, '0')}`;
}

module.exports = { generateOrderId };

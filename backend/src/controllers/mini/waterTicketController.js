// 小程序水票查询（文档 §21.7 / §30）
// ===========================================================================
// ⚠️ 本期**只做只读**：水票发行入账与作废回冲属 **Phase 7**（§12 / §43）。
//    该阶段是文档明确标注的「唯一会改动既有 Web 功能的阶段」，且要求逐个端点定处置方案、
//    准备回滚路径（§12.9.1 / §43 Phase 7 风险预案），因此不在本次交付范围内 ——
//    本次交付范围为 Phase 1~5 + 8a。
//
//    ⚠️ 注意与「数据库迁移」的区别：migration_mini_program_v1.sql **已**按 §20.4 补上
//       distribution_delivery_fee_unit / _total / wallet_transaction_id 三列并对存量回填。
//       补列是因为「单件值从不落库」是 Phase 7 的根本阻塞项（§12.2.1），先补列不改变任何
//       既有行为；而 Phase 7 的端点改造会改变既有 Web 行为，故留待独立批次。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error } = require('../../utils/response');
const { MINI_ROLES } = require('../../constants/mini');

/** GET /api/mini/water-tickets —— 我的水票（按商品 + 月份分组） */
async function listWaterTickets(req, res) {
  const conn = await pool.getConnection();
  try {
    // 仅直营水站持有水票（§3.7 / §4.3）
    if (req.mini.role !== MINI_ROLES.STATION) {
      return error(res, '仅直营水站可查看水票', 403);
    }
    const stationId = req.mini.targetId;

    // §30 水票页：商品 / 可用水票数量 / 水票月份
    const [rows] = await conn.execute(
      `SELECT t.product_id, t.month, t.status, COUNT(*) AS cnt,
              p.product_name, p.product_code, p.specification, p.unit, p.image_url,
              p.wholesale_price, p.distribution_delivery_fee
         FROM water_tickets t
         LEFT JOIN products p ON p.product_id = t.product_id
        WHERE t.station_id = ?
        GROUP BY t.product_id, t.month, t.status,
                 p.product_name, p.product_code, p.specification, p.unit, p.image_url,
                 p.wholesale_price, p.distribution_delivery_fee
        ORDER BY t.month DESC, p.product_code ASC`,
      [stationId]
    );

    const byProduct = new Map();
    for (const r of rows) {
      const key = r.product_id;
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          productId: r.product_id,
          productName: r.product_name,
          productCode: r.product_code,
          specification: r.specification,
          unit: r.unit,
          imageUrl: r.image_url || null,
          /** 水站分销价（下单时按此价抵扣，§9.3） */
          wholesalePrice: Number(r.wholesale_price) || 0,
          availableQty: 0,
          usedQty: 0,
          voidQty: 0,
          months: []
        });
      }
      const entry = byProduct.get(key);
      const cnt = Number(r.cnt) || 0;
      if (Number(r.status) === 1)
        entry.availableQty += cnt; // 1 未用
      else if (Number(r.status) === 2)
        entry.usedQty += cnt; // 2 已核销
      else if (Number(r.status) === 3) entry.voidQty += cnt; // 3 作废

      const monthEntry = entry.months.find(m => m.month === r.month && m.status === Number(r.status));
      if (monthEntry) monthEntry.count += cnt;
      else entry.months.push({ month: r.month, status: Number(r.status), count: cnt });
    }

    const list = Array.from(byProduct.values())
      .map(p => ({ ...p, months: p.months.sort((a, b) => (a.month < b.month ? 1 : -1)) }))
      .sort((a, b) => b.availableQty - a.availableQty);

    return success(res, { list, totalAvailable: list.reduce((s, p) => s + p.availableQty, 0) });
  } catch (err) {
    console.error('[mini/ticket] 水票查询失败:', err);
    return error(res, '获取水票失败');
  } finally {
    conn.release();
  }
}

/** GET /api/mini/water-tickets/summary —— 水票汇总（首页用） */
async function getWaterTicketSummary(req, res) {
  const conn = await pool.getConnection();
  try {
    if (req.mini.role !== MINI_ROLES.STATION) {
      return success(res, { totalAvailable: 0, totalUsed: 0, totalVoid: 0, productKinds: 0 });
    }
    const [rows] = await conn.execute(
      `SELECT status, COUNT(*) AS cnt, COUNT(DISTINCT product_id) AS kinds
         FROM water_tickets WHERE station_id = ? GROUP BY status`,
      [req.mini.targetId]
    );
    const out = { totalAvailable: 0, totalUsed: 0, totalVoid: 0, productKinds: 0 };
    for (const r of rows) {
      const cnt = Number(r.cnt) || 0;
      if (Number(r.status) === 1) {
        out.totalAvailable = cnt;
        out.productKinds = Number(r.kinds) || 0;
      } else if (Number(r.status) === 2) out.totalUsed = cnt;
      else if (Number(r.status) === 3) out.totalVoid = cnt;
    }
    return success(res, out);
  } catch (err) {
    console.error('[mini/ticket] 水票汇总失败:', err);
    return error(res, '获取水票汇总失败');
  } finally {
    conn.release();
  }
}

module.exports = { listWaterTickets, getWaterTicketSummary };

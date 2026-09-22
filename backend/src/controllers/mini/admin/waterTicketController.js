// 小程序管理端 · 水票域（Phase 8b 第 15 域 + Phase 7 补齐）
// ===========================================================================
// ✅ **Phase 7 已落地（2026-09-22）**，本域随之补齐发行能力。落地顺序（不可颠倒）：
//   ① §12.6 单件配送费**落库**（`distribution_delivery_fee_unit`，不再靠「总额 ÷ 数量」反推）；
//   ② §12.10 发行/编辑时单件值**一律由服务端从 `products.distribution_delivery_fee` 重取**；
//   ③ §12.9 停用两个「直接改历史金额」的配送费调整端点（410）；
//   ④ §12.7 发行入账 / 作废·减量·删批次回冲（水站钱包，1 积分 = 1 元）。
//   ⇒ 只有先收定价权（①②）才敢把发行搬到公网弱网环境；反了就是
//     「前端传多少，公司就欠水站多少积分」。
//
// 本域提供：库存 / 明细 / 发行记录（查）+ 作废单张 + **发行** + **改数量**（改）。
// ⚠️ **批次删除仍只在 Web**：它是破坏性操作（整批删除 + 按净入账回冲积分），
//    手机上误触的代价远高于收益 —— 这是范围决定，不是缺功能；冒烟有反向断言。
// ⚠️ 单据校验/金额计算全部走 Web 侧导出的**核心函数**（`createIssuance` / `updateIssuanceCore`），
//    本文件只做「鉴权 + 幂等 + 审计 + 响应」四件事，**不重写金额逻辑**。
//
// ⚠️ 状态是**数字**（1 未用 / 2 已核销 / 3 作废，见 constants/waterTicket.js）——
//    不是字符串。这里直接复用该常量与中文名，避免前端再维护一份映射。
//
// ⚠️ 作废/减量会**回冲积分**（按该票所属发行记录的单件值，方向 OUT）；
//    水站若已把积分花掉，会因余额不足被拒 → 事务回滚、票保持未用（不制造负余额）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const { TICKET_STATUS, TICKET_STATUS_NAMES } = require('../../../constants/waterTicket');
const waterTicketController = require('../../waterTicketController');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');

const {
  loadTicketInventory,
  loadTicketList,
  loadIssuanceList,
  cancelTicketById,
  // Phase 7 补齐：发行与改数量的**核心**（与 Web 共用同一段金额逻辑）
  createIssuance,
  updateIssuanceCore
} = waterTicketController;

// ── GET /mini/admin/water-tickets/options —— 筛选/发行用的水站 · 商品下拉 ──────
// ⚠️ 商品带上**单件分销配送费**（`unitDeliveryFee`）：发行页据此在提交前展示金额。
//    这只是**展示**用途 —— 服务端入库时一律从商品档案重取（§12.10），
//    客户端传回来的任何金额都不参与入库。
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [stations] = await conn.query(
      'SELECT station_id, station_name FROM sub_stations WHERE status = 1 ORDER BY station_name'
    );
    const [products] = await conn.query(
      `SELECT product_id, product_name, specification, unit, distribution_delivery_fee
         FROM products WHERE status = 1 ORDER BY product_name`
    );
    const d = new Date();
    return success(res, {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      stations: stations.map(s => ({ stationId: s.station_id, stationName: s.station_name })),
      products: products.map(p => ({
        productId: p.product_id,
        productName: p.product_name,
        specification: p.specification || '',
        unit: p.unit || '',
        unitDeliveryFee: Number(p.distribution_delivery_fee) || 0
      })),
      statusOptions: Object.keys(TICKET_STATUS_NAMES).map(k => ({ value: Number(k), label: TICKET_STATUS_NAMES[k] }))
    });
  } catch (e) {
    console.error('[mini/admin] 水票选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/water-tickets/inventory —— 水站水票库存（按水站 × 商品）──
// 本域最常用的一屏：某个水站手上还有多少张未用的票。
async function getInventory(req, res) {
  try {
    const data = await loadTicketInventory(req.query);
    return success(res, {
      // ⚠️ 逐字段映射（不整体透传）：取数字段集由 Web 页面需要决定，
      //    小程序侧只取自己展示的，避免「Web 加了列，手机端悄悄多出个字段」。
      list: (data.list || []).map(x => ({
        stationId: x.stationId,
        stationName: x.stationName,
        productId: x.productId,
        productName: x.productName,
        specification: x.specification || '',
        available: Number(x.available) || 0,
        // 该水站的分销配送费小计（Web 页面用合并单元格展示，手机端按行展示）
        stationDeliveryFee: Number(x.stationDeliveryFee) || 0
      }))
    });
  } catch (e) {
    console.error('[mini/admin] 水票库存失败:', e);
    return error(res, '水票库存查询失败');
  }
}

// ── GET /mini/admin/water-tickets/list —— 水票明细（分页）───────────────────
async function listTickets(req, res) {
  try {
    const data = await loadTicketList(req.query);
    const list = (data.list || []).map(t => ({
      ticketId: t.ticketId,
      productId: t.productId,
      productName: t.productName,
      specification: t.specification || '',
      stationId: t.stationId,
      stationName: t.stationName,
      // status 是数字（1 未用 / 2 已核销 / 3 作废）；状态中文名直接取服务端的映射
      status: Number(t.status),
      statusName: t.statusName || TICKET_STATUS_NAMES[Number(t.status)] || '未知',
      month: t.month,
      issuedAt: t.issuedAt,
      usedAt: t.usedAt,
      orderId: t.orderId || '',
      // 只有「未使用」可作废（服务端同样以 status 守卫；这里只用于决定按钮是否可点）
      canCancel: Number(t.status) === TICKET_STATUS.UNUSED
    }));
    return success(res, { list, total: Number(data.total) || 0, page: data.page, pageSize: data.pageSize });
  } catch (e) {
    console.error('[mini/admin] 水票明细失败:', e);
    return error(res, '水票明细查询失败');
  }
}

// ── GET /mini/admin/water-tickets/issuances —— 发行记录（**批次级**）────────
// ⚠️ 取数函数返回的是「批次 + 嵌套 items」（Web 页面按批次合并展示）——
//    小程序侧保持同一层级：把嵌套 items 摊平成显示行，但**保留 batchId**，
//    这样「同一批返货」在手机上仍然是可辨认的一组。
async function listIssuances(req, res) {
  try {
    const data = await loadIssuanceList(req.query);
    const list = (data.list || []).map(b => ({
      batchId: b.batchId,
      stationId: b.stationId,
      stationName: b.stationName,
      month: b.month,
      remark: b.remark || '',
      createdBy: b.createdBy || '',
      createdAt: b.createdAt,
      totalQuantity: Number(b.totalQuantity) || 0,
      totalFee: Number(b.totalFee) || 0,
      itemCount: Number(b.itemCount) || 0,
      items: (b.items || []).map(it => ({
        issuanceId: it.issuanceId,
        productName: it.productName,
        specification: it.specification || '',
        quantity: Number(it.quantity) || 0,
        // 单件值（Phase 7 §12.6 落库）：页面据此展示「单件 × 数量」，不靠总额反推
        unitFee: Number(it.unitFee) || 0,
        distributionDeliveryFee: Number(it.distributionDeliveryFee) || 0,
        remark: it.remark || ''
      }))
    }));
    return success(res, {
      list,
      total: Number(data.total) || 0,
      page: data.page,
      pageSize: data.pageSize,
      // 页面上要说清「删除批次仍在 Web」——这是范围决定，不是缺功能
      notice: '发行与改数量可在手机端完成；删除批次属破坏性操作，请到 Web 管理端操作。配送费由商品档案决定，不可调整。'
    });
  } catch (e) {
    console.error('[mini/admin] 发行记录失败:', e);
    return error(res, '发行记录查询失败');
  }
}

// ── POST /mini/admin/water-tickets/:id/cancel —— 作废单张（幂等 + 审计）─────
async function cancelTicket(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.CANCEL_TICKET_ADMIN,
      key: String(clientRequestId),
      requestHash: hashRequest({ ticketId: req.params.id }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { ticketId: req.params.id, replayed: true }, '该水票已作废（重复请求已合并）');
    }

    // 取票面信息用于审计（作废后仍要能追溯「作废的是哪张票、属于谁」）
    const [rows] = await conn.query(
      'SELECT ticket_id, station_id, product_id, month, status FROM water_tickets WHERE ticket_id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!rows.length) {
      await conn.rollback();
      return error(res, '水票不存在', 404);
    }
    const before = rows[0];

    try {
      // 单源原语（与 Web 端共用）。⚠️ Phase 7 起它会**回冲积分**（按该票所属发行记录的单件值，
      // 方向 OUT）；水站若已把积分花掉，会因余额不足被拒 → 事务回滚、票保持未用。
      await cancelTicketById(conn, req.params.id, `mini:${req.mini.accountId}`);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '作废失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.CANCEL_TICKET_ADMIN,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.CANCEL_TICKET_ADMIN,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'WATER_TICKET',
      targetId: req.params.id,
      detail: {
        stationId: before.station_id,
        productId: before.product_id,
        month: before.month,
        statusBefore: Number(before.status)
      }
    });
    await conn.commit();
    return success(res, { ticketId: req.params.id }, '已作废');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 作废水票失败:', e);
    return error(res, '作废失败');
  } finally {
    conn.release();
  }
}

// ── POST /mini/admin/water-tickets/issue —— 发行（返货清单录入，多行商品）─────
// ⚠️ 与 Web 端共用 `createIssuance` 核心：金额逻辑（单件值取数 + 水站积分入账）只有一份。
//    若这里另写一遍，迟早会分叉成「一端改了单件值来源、另一端没改」—— 而两边账面都像正常。
// ⚠️ 请求体里的 distributionDeliveryFee 一律忽略（§12.10，由核心保证）。
// ⚠️ 这是**资金动作**（给水站钱包入账），必须带幂等键：弱网重试一次就是真的多发一笔积分。
async function issueTickets(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.ISSUE_TICKET_ADMIN,
      key: String(clientRequestId),
      // 指纹用「水站 + 月份 + 明细」，与请求体字段顺序无关
      requestHash: hashRequest({
        stationId: body.stationId,
        month: body.month || null,
        items: Array.isArray(body.items)
          ? body.items.map(it => ({ productId: it.productId, quantity: Number(it.quantity) }))
          : null
      }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(
        res,
        { ...(claim.resultRef ? JSON.parse(claim.resultRef) : {}), replayed: true },
        '该发行已提交（重复请求已合并）'
      );
    }

    let data;
    try {
      data = await createIssuance(conn, {
        stationId: body.stationId,
        month: body.month,
        remark: body.remark,
        items: body.items,
        operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '发行失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.ISSUE_TICKET_ADMIN,
      key: String(clientRequestId),
      resultRef: JSON.stringify({ batchId: data.batchId, totalTickets: data.totalTickets, totalFee: data.totalFee })
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.ISSUE_TICKET_ADMIN,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'WATER_TICKET_ISSUANCE',
      targetId: data.batchId,
      // ⚠️ detail 记**金额与明细**，不只是数量：本动作会给水站入账积分，事后核账要看得出动了多少钱
      detail: {
        stationId: body.stationId,
        month: body.month || null,
        totalTickets: data.totalTickets,
        totalFee: data.totalFee,
        issuanceIds: data.issuanceIds
      }
    });

    await conn.commit();
    return success(res, data, `发行成功（${data.totalTickets} 张水票）`);
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 发行失败:', e);
    return error(res, '发行失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/water-tickets/issuances/:id —— 改数量（金额随单件值重算）──
// ⚠️ 只改数量/月份/备注；配送费不可改（§12.9/§12.10），传了也会被核心忽略。
// ⚠️ 加量补入账、减量回冲 —— 同样是资金动作，必须带幂等键。
async function updateIssuance(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_TICKET_ISSUANCE_ADMIN,
      key: String(clientRequestId),
      requestHash: hashRequest({ id: req.params.id, quantity: Number(body.quantity), month: body.month || null }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { issuanceId: req.params.id, replayed: true }, '该修改已提交（重复请求已合并）');
    }

    let data;
    try {
      data = await updateIssuanceCore(conn, {
        id: req.params.id,
        quantity: body.quantity,
        month: body.month,
        remark: body.remark,
        operator
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '修改失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_TICKET_ISSUANCE_ADMIN,
      key: String(clientRequestId),
      resultRef: String(req.params.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_TICKET_ISSUANCE_ADMIN,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'WATER_TICKET_ISSUANCE',
      targetId: req.params.id,
      detail: { quantity: data.quantity, totalFee: data.distributionDeliveryFee, month: body.month || null }
    });

    await conn.commit();
    return success(res, data, '修改成功');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 修改发行记录失败:', e);
    return error(res, '修改失败');
  } finally {
    conn.release();
  }
}

module.exports = {
  getFormOptions,
  getInventory,
  listTickets,
  listIssuances,
  cancelTicket,
  issueTickets,
  updateIssuance
};

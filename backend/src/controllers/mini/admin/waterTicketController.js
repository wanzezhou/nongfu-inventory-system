// 小程序管理端 · 水票域（Phase 8b 第 15 域，文档 §5.3）
// ===========================================================================
// ⚠️⚠️ **本域只做「查」与「作废单张」，发行类写操作刻意不在本批**（见 docs §7.2）：
//   · `POST /issue`（发行）、`DELETE /issuances/batch/:batchId`、`PUT /issuances/:id`、
//     `POST /adjust-balance`、两个 `adjust-*-delivery-fee` —— 文档把这 6 个既有 Web 端点
//     明确划给 **Phase 7（水票积分）独立批次**，要求「逐个定处置方案 + 准备回滚路径」。
//   · 更关键的是 §12.10：`unit_distribution_fee` 必须**由服务端从
//     `products.distribution_delivery_fee` 重取**，而现发行接口把客户端传入的
//     `distributionDeliveryFee` 直接写库 —— 等于把「公司欠水站多少积分」的定价权交给调用方。
//     手机端一旦开放发行，就等于把那套可信度问题从内网 Web 搬到公网弱网环境，
//     所以**不做发行不是省事，而是不做才安全**。
//   → 本域交付：库存 / 明细 / 发行记录（查）+ 作废单张（改，不动积分）。
//
// ⚠️ 状态是**数字**（1 未用 / 2 已核销 / 3 作废，见 constants/waterTicket.js）——
//    不是字符串。这里直接复用该常量与中文名，避免前端再维护一份映射。
//
// ⚠️ 作废只改 status，**不动积分/钱包**：票据退还的是「未使用」这个状态；
//    分销配送费积分在发行时就已发生，作废一张票不构成积分冲回（那是 Phase 7 的议题）。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION } = require('../../../constants/mini');
const { TICKET_STATUS, TICKET_STATUS_NAMES } = require('../../../constants/waterTicket');
const waterTicketController = require('../../waterTicketController');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');

const { loadTicketInventory, loadTicketList, loadIssuanceList, cancelTicketById } = waterTicketController;

// ── GET /mini/admin/water-tickets/options —— 筛选用的水站 / 商品下拉 ─────────
// ⚠️ 不返回账户与发行相关字段：本域没有发行入口（见文件头），列出来会被当成「可以做」。
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [stations] = await conn.query(
      'SELECT station_id, station_name FROM sub_stations WHERE status = 1 ORDER BY station_name'
    );
    const [products] = await conn.query(
      'SELECT product_id, product_name, specification, unit FROM products WHERE status = 1 ORDER BY product_name'
    );
    const d = new Date();
    return success(res, {
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      stations: stations.map(s => ({ stationId: s.station_id, stationName: s.station_name })),
      products: products.map(p => ({
        productId: p.product_id,
        productName: p.product_name,
        specification: p.specification || '',
        unit: p.unit || ''
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
        distributionDeliveryFee: Number(it.distributionDeliveryFee) || 0,
        remark: it.remark || ''
      }))
    }));
    return success(res, {
      list,
      total: Number(data.total) || 0,
      page: data.page,
      pageSize: data.pageSize,
      // 页面上要说清「发行与批次删除仍在 Web」——这是范围决定，不是缺功能
      notice: '发行录入 / 批次删除 / 账户与配送费调整属 Phase 7（水票积分）批次，请在 Web 管理端操作。'
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
      // 单源原语（与 Web 端共用；只改状态，不动积分）
      await cancelTicketById(conn, req.params.id);
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

module.exports = { getFormOptions, getInventory, listTickets, listIssuances, cancelTicket };

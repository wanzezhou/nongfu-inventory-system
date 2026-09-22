/**
 * 水票 · 分销配送费积分台账（Phase 7 §12.6 / §12.7 / §12.10）
 * ===========================================================================
 * 事实源：设计文档 §12；处置方案与回滚路径见 `docs/小程序开发说明.md` §7.2。
 *
 * 三条不变量（改动前先读这三条）：
 *   ① **单件值只由服务端取**（§12.10）：`unit` 一律来自 `products.distribution_delivery_fee`，
 *      请求体里的值只可用于展示。否则这套数字从「只是记录」变成「钱」之后，
 *      就等于「前端传多少，公司就欠水站多少积分」（违反设计文档自立的原则 §22.1）。
 *   ② **金额三列恒等**（§12.6）：`distribution_delivery_fee_unit × quantity`
 *      === `distribution_delivery_fee_total` === `distribution_delivery_fee`（遗留列，兼容旧读）。
 *      单件值必须落库而不能靠「总额 ÷ 数量」反推 —— 数量可改，除不尽就会引入误差。
 *   ③ **发行即入账、回冲按净额**（§12.7）：积分就是水站的**可用余额**（1 积分 = 1 元，
 *      下单时由 `miniOrderService.debitWallet` 直接抵扣），所以
 *      发行/加量 → **IN**；作废/减量/删批次 → **OUT**（方向为原方向的反向 ——
 *      抄成 `+` 就是「撤一次反而再加一笔」，恒等式却仍然成立，是本仓踩过的坑）。
 *
 * ⚠️ **回冲会被「余额不足」拒掉，这是有意的**：OUT 方向必须先校验余额（walletService 硬约束）。
 *    水站把积分花掉之后再来作废票，会得到明确报错而不是把余额压成负数 ——
 *    负余额会破坏「余额 = 期初 + 流水净额 ∧ 余额 ≥ 0」这条仓库铁律。
 *    业务上等价于「先用后作废需先补足」，与「批次内有已核销票则拒删」是同一类处置。
 *
 * ⚠️ **所有水票积分流水都挂在发行记录上**（`related_type='WATER_TICKET_ISSUANCE'`），
 *    票级作废也在 `remark` 里写明票号。这样「某条发行记录当前净入账」只需一处聚合查询，
 *    批次删除时才能精确回冲；若把票级流水另挂 `WATER_TICKET`，聚合就要跨两处、易漏。
 *
 * ⚠️ 账户调整补发的票（`issuance_id IS NULL`）**没有入过账**，因此作废它们不回冲积分 ——
 *    冒烟对此有断言（第 19.x 条），避免将来「顺手」给它补账时把恒等式弄坏。
 */
const { WALLET_TX_TYPE, WALLET_RELATED_TYPE, WALLET_OWNER_TYPE, TX_DIRECTION } = require('../constants/mini');
const {
  businessError,
  ensureWallet,
  loadWalletForUpdate,
  loadWalletForUpdateIncludingDisabled,
  applyTransaction
} = require('./walletService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * 取商品的单件分销配送费（§12.10 的唯一合法来源）
 * @returns {Promise<number>} 单件值（≥ 0）
 */
async function resolveUnitFee(conn, productId) {
  const [rows] = await conn.execute('SELECT product_id, distribution_delivery_fee FROM products WHERE product_id = ?', [
    productId
  ]);
  if (!rows.length) throw businessError(`商品不存在：${productId}`);
  return round2(rows[0].distribution_delivery_fee);
}

/** 三列恒等：由单件值 × 数量派生总额（不要另算一遍，避免两处各错一半） */
function computeFeeCols(unitFee, quantity) {
  const unit = round2(unitFee);
  return { unit, total: round2(unit * Number(quantity)) };
}

/** 取（必要时开立）水站积分钱包并加行锁 —— 入账要求启用，回冲允许停用 */
async function lockStationWallet(conn, { stationId, stationName, forReversal = false }) {
  const wallet = await ensureWallet(conn, {
    ownerType: WALLET_OWNER_TYPE.STATION,
    ownerId: stationId,
    ownerName: stationName || null
  });
  return forReversal
    ? loadWalletForUpdateIncludingDisabled(conn, wallet.wallet_id)
    : loadWalletForUpdate(conn, wallet.wallet_id);
}

/**
 * 发行 / 加量入账（IN）
 * @returns {Promise<object|null>} 流水行；金额为 0 时不写流水（避免 0 元噪声流水）
 */
async function creditDistributionFee(conn, { issuanceId, stationId, stationName, amount, operator, remark }) {
  const amt = round2(amount);
  if (amt <= 0) return null;
  const wallet = await lockStationWallet(conn, { stationId, stationName });
  return applyTransaction(conn, wallet, {
    txType: WALLET_TX_TYPE.DISTRIBUTION_FEE,
    amount: amt,
    relatedType: WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE,
    relatedId: issuanceId,
    operatorId: operator || null,
    operatorRole: 'admin',
    remark: remark || null
  });
}

/**
 * 回冲（OUT）：作废单张票 / 编辑减量 / 删除批次
 * ⚠️ 方向固定 OUT（原方向 IN 的反向）。余额不足时 `applyTransaction` 会抛业务错误，
 *    由调用方 rollback —— 这正是「不制造负余额」的落点。
 */
async function revertDistributionFee(conn, { issuanceId, stationId, amount, operator, remark }) {
  const amt = round2(amount);
  if (amt <= 0) return null;
  const wallet = await lockStationWallet(conn, { stationId, forReversal: true });
  return applyTransaction(conn, wallet, {
    txType: WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL,
    amount: amt,
    direction: TX_DIRECTION.OUT,
    relatedType: WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE,
    relatedId: issuanceId,
    operatorId: operator || null,
    operatorRole: 'admin',
    remark: remark || null
  });
}

/** 某条发行记录**当前净入账**（Σ IN − Σ OUT）—— 回冲的依据，不是 `distribution_delivery_fee_total` */
async function netCreditedByIssuance(conn, issuanceId) {
  const [rows] = await conn.execute(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE -amount END), 0), 2) AS net
       FROM wallet_transactions
      WHERE related_type = ? AND related_id = ?`,
    [TX_DIRECTION.IN, WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE, issuanceId]
  );
  return round2(rows[0].net);
}

/**
 * 某批次**当前净入账**合计（批次删除时的回冲依据）
 * ⚠️ 不能直接用 `SUM(distribution_delivery_fee_total)`：那只是发行时的快照，
 *    之后的票级作废与减量已经把一部分冲回去了，再按快照回冲会**多冲**。
 */
async function netCreditedByBatch(conn, batchId) {
  const [rows] = await conn.execute(
    `SELECT ROUND(COALESCE(SUM(CASE WHEN wt.direction = ? THEN wt.amount ELSE -wt.amount END), 0), 2) AS net
       FROM wallet_transactions wt
       JOIN water_ticket_issuance i
         ON wt.related_type = ? AND wt.related_id = i.issuance_id
      WHERE i.batch_id = ?`,
    [TX_DIRECTION.IN, WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE, batchId]
  );
  return round2(rows[0].net);
}

/** 某批次下「已入过账」的发行记录（批次删除时逐条回冲，便于审计追溯） */
async function issuancesWithCredit(conn, batchId) {
  const [rows] = await conn.execute(
    `SELECT i.issuance_id, i.station_id, i.quantity,
            ROUND(COALESCE(SUM(CASE WHEN wt.direction = ? THEN wt.amount ELSE -wt.amount END), 0), 2) AS net
       FROM water_ticket_issuance i
       JOIN wallet_transactions wt
         ON wt.related_type = ? AND wt.related_id = i.issuance_id
      WHERE i.batch_id = ?
      GROUP BY i.issuance_id, i.station_id, i.quantity
      HAVING net > 0`,
    [TX_DIRECTION.IN, WALLET_RELATED_TYPE.WATER_TICKET_ISSUANCE, batchId]
  );
  return rows.map(r => ({ ...r, net: round2(r.net) }));
}

module.exports = {
  round2,
  resolveUnitFee,
  computeFeeCols,
  creditDistributionFee,
  revertDistributionFee,
  netCreditedByIssuance,
  netCreditedByBatch,
  issuancesWithCredit
};

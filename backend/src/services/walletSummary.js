// 钱包对账取数服务（文档 §19.4 / §38 / §39 / §53）
// ===========================================================================
// §53 要求：三个对账视图（钱包对账 / 充值对账 / Web 对账）**抽成一个 service**，
// 供三处复用；**禁止在各自 controller 里各写一份聚合 SQL**。
// 本仓库已有「口径分叉」的历史教训 —— 一旦出现两份公式，对账结果不一致时
// 无法判断哪份是对的。
//
// ⚠️ 时间区间约定（§53 第 3 条：必须显式声明）
//   本文件统一采用 **start 含、end 含**（闭区间）。
//   仓库存在两套并存的区间约定（dateRange.buildRangeWhere 的 end 不含 vs
//   financialController.resolveDateRange 的 end 含），混用会**静默漏掉当天数据**。
//   因此本文件的每个函数都在参数名上带 Incl 后缀，且 SQL 一律写
//   `DATE(created_at) >= ? AND DATE(created_at) <= ?`，避免调用方误用。
// ===========================================================================
const { WALLET_TX_TYPE, TX_DIRECTION, TX_TYPE_LABEL, POINTS_TYPE, POINTS_TYPE_LABEL } = require('../constants/mini');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** 钱包流水类型全集（顺序即展示顺序，前端不再排序） */
const TX_TYPE_ORDER = [
  WALLET_TX_TYPE.RECHARGE,
  WALLET_TX_TYPE.DISTRIBUTION_FEE,
  WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL,
  WALLET_TX_TYPE.ORDER_PAYMENT,
  WALLET_TX_TYPE.REFUND,
  WALLET_TX_TYPE.ADJUST_IN,
  WALLET_TX_TYPE.ADJUST_OUT
];

/** 钱包概览（§33 钱包页面 / §19.4 账实恒等式） */
async function getWalletOverview(conn, walletId) {
  const [w] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, owner_name, initial_balance, balance,
            recharge_balance, delivery_fee_balance, status, created_at
       FROM wallet_accounts WHERE wallet_id = ?`,
    [walletId]
  );
  if (!w.length) return null;
  const wallet = w[0];

  // 按类型汇总（期初 + 各类型 = 当前余额，§19.4 的账实恒等式）
  const [rows] = await conn.execute(
    `SELECT transaction_type, direction, ROUND(SUM(amount), 2) AS total, COUNT(*) AS cnt
       FROM wallet_transactions WHERE wallet_id = ?
      GROUP BY transaction_type, direction`,
    [walletId]
  );

  const byType = {};
  let totalIn = 0;
  let totalOut = 0;
  for (const r of rows) {
    const t = Number(r.total) || 0;
    byType[r.transaction_type] = {
      type: r.transaction_type,
      label: TX_TYPE_LABEL[r.transaction_type] || r.transaction_type,
      direction: Number(r.direction),
      total: round2(t),
      count: Number(r.cnt)
    };
    if (Number(r.direction) === TX_DIRECTION.IN) totalIn += t;
    else totalOut += t;
  }
  totalIn = round2(totalIn);
  totalOut = round2(totalOut);
  const initialBalance = round2(wallet.initial_balance);
  const balance = round2(wallet.balance);
  const expected = round2(initialBalance + totalIn - totalOut);

  // ★ 双积分（2026-09-23）：两类分账户余额 + 第二条恒等式
  const rechargeBalance = round2(wallet.recharge_balance);
  const deliveryFeeBalance = round2(wallet.delivery_fee_balance);
  const splitDiff = round2(balance - round2(rechargeBalance + deliveryFeeBalance));

  return {
    walletId: wallet.wallet_id,
    ownerType: wallet.owner_type,
    ownerId: wallet.owner_id,
    ownerName: wallet.owner_name,
    status: Number(wallet.status),
    /** 当前积分 ≈ 当前可用订货额度（§33） */
    balance,
    /** 充值积分（管理员后台设置的那一类，下单时可抵扣） */
    rechargeBalance,
    /** 配送费积分（返货配送费 1 元 = 1 积分，下单时可抵扣） */
    deliveryFeeBalance,
    /** 分账户恒等式：balance = 充值积分 + 配送费积分 */
    splitDiff,
    splitOk: splitDiff === 0,
    initialBalance,
    totalIn,
    totalOut,
    /** 账实恒等式校验：balance 必须等于 expected（停用钱包同样成立，§11.7 第 4 条） */
    expected,
    diff: round2(balance - expected),
    identityOk: round2(balance - expected) === 0,
    byType: TX_TYPE_ORDER.filter(k => byType[k])
      .map(k => byType[k])
      .concat(Object.values(byType).filter(v => !TX_TYPE_ORDER.includes(v.type))),
    createdAt: wallet.created_at
  };
}

/**
 * 钱包流水列表（分页）
 * ⚠️ mysql2 **不支持 `LIMIT ?`**（仓库既有陷阱）→ 分页参数 parseInt 后内联。
 */
async function listWalletTransactions(
  conn,
  { walletId, transactionType = null, pointsType = null, page = 1, size = 10 }
) {
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, parseInt(size, 10) || 10);
  const offset = (currentPage - 1) * pageSize;

  let where = 'WHERE wallet_id = ?';
  const params = [walletId];
  if (transactionType) {
    where += ' AND transaction_type = ?';
    params.push(transactionType);
  }
  // ★ 双积分：可按积分类型筛选（前端「只看配送费积分」等视图）
  if (pointsType) {
    where += ' AND points_type = ?';
    params.push(pointsType);
  }

  const [countRows] = await conn.execute(`SELECT COUNT(*) AS total FROM wallet_transactions ${where}`, params);
  const total = Number(countRows[0].total) || 0;

  const [rows] = await conn.execute(
    `SELECT transaction_id, transaction_no, wallet_id, transaction_type, direction, amount,
            points_type, points_month,
            balance_before, balance_after, related_type, related_id, reversal_of,
            operator_id, operator_role, remark, created_at
       FROM wallet_transactions ${where}
      ORDER BY created_at DESC, transaction_id DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    total,
    page: currentPage,
    pageSize,
    list: rows.map(r => ({
      transactionId: r.transaction_id,
      transactionNo: r.transaction_no,
      type: r.transaction_type,
      typeLabel: TX_TYPE_LABEL[r.transaction_type] || r.transaction_type,
      /** ★ 双积分：本笔作用于哪一类积分（充值 / 配送费） */
      pointsType: r.points_type,
      pointsTypeLabel: POINTS_TYPE_LABEL[r.points_type] || r.points_type,
      /** 配送费积分的发行月份（仅发行入账有值，用于按月核对） */
      pointsMonth: r.points_month,
      direction: Number(r.direction),
      /** 带符号金额，直接可展示：正向 +、负向 −（方向以 direction 为准，不按类型反推） */
      signedAmount: Number(r.direction) === TX_DIRECTION.IN ? round2(r.amount) : round2(-r.amount),
      amount: round2(r.amount),
      balanceBefore: round2(r.balance_before),
      balanceAfter: round2(r.balance_after),
      relatedType: r.related_type,
      relatedId: r.related_id,
      reversalOf: r.reversal_of,
      operatorId: r.operator_id,
      remark: r.remark,
      createdAt: r.created_at
    }))
  };
}

/**
 * 区间对账（§39：按业务员 / 水站 / 日期范围 / 流水类型）
 * 约定：**startDate 含、endDate 含**（闭区间）
 */
async function reconcileWallet(conn, { walletId, startDate, endDate, transactionType = null }) {
  const params = [walletId];
  let where = 'WHERE wt.wallet_id = ?';
  if (startDate) {
    where += ' AND DATE(wt.created_at) >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND DATE(wt.created_at) <= ?';
    params.push(endDate);
  }
  if (transactionType) {
    where += ' AND wt.transaction_type = ?';
    params.push(transactionType);
  }

  const [rows] = await conn.execute(
    `SELECT wt.transaction_type, wt.direction, ROUND(SUM(wt.amount), 2) AS total, COUNT(*) AS cnt
       FROM wallet_transactions wt ${where}
      GROUP BY wt.transaction_type, wt.direction`,
    params
  );

  const items = rows.map(r => ({
    type: r.transaction_type,
    label: TX_TYPE_LABEL[r.transaction_type] || r.transaction_type,
    direction: Number(r.direction),
    total: round2(r.total),
    count: Number(r.cnt)
  }));

  const totalIn = round2(items.filter(i => i.direction === TX_DIRECTION.IN).reduce((s, i) => s + i.total, 0));
  const totalOut = round2(items.filter(i => i.direction === TX_DIRECTION.OUT).reduce((s, i) => s + i.total, 0));

  // 区间期初 = 当前余额 − 区间净额（这样区间期初 + 区间净额 必然等于当前余额）
  const [w] = await conn.execute('SELECT balance FROM wallet_accounts WHERE wallet_id = ?', [walletId]);
  const balance = w.length ? round2(w[0].balance) : 0;
  const net = round2(totalIn - totalOut);

  return {
    range: { startDate: startDate || null, endDate: endDate || null, endInclusive: true },
    items,
    totalIn,
    totalOut,
    net,
    /** 区间期末 = 当前余额（全量口径，便于与流水对账） */
    closingBalance: balance,
    openingBalance: round2(balance - net),
    /** 恒等式：期初 + 净额 = 期末 */
    identityOk: round2(round2(balance - net) + net - balance) === 0
  };
}

/** 管理员钱包总览（§18 / §21.8） */
async function listWalletsForAdmin(conn, { ownerType = null } = {}) {
  let where = 'WHERE 1 = 1';
  const params = [];
  if (ownerType) {
    where += ' AND w.owner_type = ?';
    params.push(ownerType);
  }

  const [rows] = await conn.execute(
    `SELECT w.wallet_id, w.owner_type, w.owner_id, w.owner_name, w.balance,
            w.recharge_balance, w.delivery_fee_balance, w.status, w.created_at,
            (SELECT COUNT(*) FROM wallet_transactions t WHERE t.wallet_id = w.wallet_id) AS tx_count,
            (SELECT MAX(t2.created_at) FROM wallet_transactions t2 WHERE t2.wallet_id = w.wallet_id) AS last_tx_at
       FROM wallet_accounts w ${where}
      ORDER BY w.owner_type ASC, w.owner_id ASC`,
    params
  );

  const totalBalance = round2(rows.reduce((s, r) => s + (Number(r.balance) || 0), 0));

  return {
    totalBalance,
    count: rows.length,
    list: rows.map(r => ({
      walletId: r.wallet_id,
      ownerType: r.owner_type,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      balance: round2(r.balance),
      /** ★ 双积分：两类分账户（管理员列表要能一眼看出钱的构成） */
      rechargeBalance: round2(r.recharge_balance),
      deliveryFeeBalance: round2(r.delivery_fee_balance),
      status: Number(r.status),
      txCount: Number(r.tx_count),
      lastTxAt: r.last_tx_at,
      createdAt: r.created_at
    }))
  };
}

/** 水站积分总额（§28 管理员首页指标） */
async function sumBalanceByOwnerType(conn) {
  const [rows] = await conn.execute(
    `SELECT owner_type, ROUND(SUM(balance), 2) AS total, COUNT(*) AS cnt
       FROM wallet_accounts WHERE status = 1 GROUP BY owner_type`
  );
  const out = { SALESMAN: 0, STATION: 0, total: 0 };
  for (const r of rows) {
    out[r.owner_type] = round2(r.total);
    out.total = round2(out.total + Number(r.total));
  }
  return out;
}

/**
 * ★ 配送费积分**按月汇总**（2026-09-23 双积分）
 *
 * 业务要求「能看每月发了多少配送费积分」。按 `points_month`（发行记录的月份）分组，
 * 同时给出**发放（入账）**、**回冲（作废/减量/删批次）**与**净额** ——
 * 只给"发放"会让「发了又被作废」的月份看起来仍然有钱进来。
 *
 * 已知边界：本表是**按发行月份**归集，不追踪"消耗属于哪个月"（下单抵扣不带月份）。
 * 因此 `net` 的含义是「该月发放后净留在账面的量」，不是"该月额度还剩多少"。
 *
 * ⚠️ 枚举一律由常量派生（禁硬编码字面量）。
 */
async function getDeliveryFeeMonthly(conn, walletId) {
  const [rows] = await conn.execute(
    `SELECT points_month AS month,
            ROUND(COALESCE(SUM(CASE WHEN transaction_type = ? THEN amount ELSE 0 END), 0), 2) AS credited,
            ROUND(COALESCE(SUM(CASE WHEN transaction_type = ? THEN amount ELSE 0 END), 0), 2) AS reverted,
            COUNT(*) AS cnt
       FROM wallet_transactions
      WHERE wallet_id = ? AND points_type = ?
      GROUP BY points_month
      ORDER BY points_month DESC`,
    [WALLET_TX_TYPE.DISTRIBUTION_FEE, WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL, walletId, POINTS_TYPE.DELIVERY_FEE]
  );
  return rows.map(r => ({
    month: r.month || '(未标月份)',
    credited: round2(r.credited),
    reverted: round2(r.reverted),
    net: round2(round2(r.credited) - round2(r.reverted)),
    count: Number(r.cnt)
  }));
}

module.exports = {
  TX_TYPE_ORDER,
  getWalletOverview,
  listWalletTransactions,
  getDeliveryFeeMonthly,
  reconcileWallet,
  listWalletsForAdmin,
  sumBalanceByOwnerType
};

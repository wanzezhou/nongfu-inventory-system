// 积分钱包服务（文档 §11 · §52 · §53）
// ===========================================================================
// 钱包是**与 finance_accounts（公司真实资金）并存的第二套余额体系**。
// 既有资金体系的纪律必须**逐条继承**，否则会出现「账实不符」且**不报错**（§11.7 原文）。
//
// 本文件落实 §11.7 七条：
//   ① 三联事务：业务记录 + wallet_accounts.balance + wallet_transactions
//      **必须同一事务**，失败整体 ROLLBACK。禁止先扣款后补流水。
//      → 本文件所有函数都**接收外部 connection**，自身不 begin/commit，
//        由调用方（service/controller）统一控制事务边界。这是刻意的：
//        只有这样才能保证钱包扣减与订单写入、营收入账在同一个事务里。
//   ② 扣减前加锁 + 校验余额：`WHERE wallet_id = ? AND status = 1 FOR UPDATE`，
//      再校验余额充足；**收入方向（充值/退款/分销配送费入账）不校验余额**。
//   ③ 流水字段须齐：transaction_type / amount / balance_before / balance_after /
//      related_type / related_id / operator_id / created_at（缺一不可，便于对账与排障）。
//   ④ 撤销类必须回补余额 + 写流水（作废水票、冲正、订单退款、批次删除）：
//      保证「余额 = 期初 + 流水净额」恒成立 —— **钱包停用（status=0）时也必须成立**。
//   ⑤ ⚠️ 方向别抄反：收入类流水的撤销是 **−amount**。若照抄支出侧的 +，
//      会变成「撤一次反而再加一笔」，而恒等式**看起来仍然成立** —— 本仓库真实踩过的坑。
//      → 本文件的落地方案：方向显式落库（wallet_transactions.direction），
//        撤销时 direction 取**原方向的反向**，而不是「按类型再推一次」。
//   ⑥ 禁止 `UPDATE wallet_accounts SET balance = ?` 直接改余额（§41 已禁）：
//      所有变动必须经由流水。→ 全仓库只有 applyTransaction 一个函数会写 balance。
//   ⑦ 不改既有资金体系：finance_accounts / finance_transactions 的记账规则、
//      账户类型、对账口径均不因小程序而改变（见 §52）。
// ===========================================================================
const {
  WALLET_TX_TYPE,
  TX_DIRECTION,
  TX_TYPE_DIRECTION,
  POINTS_TYPE,
  POINTS_TYPE_VALUES,
  POINTS_TYPE_LABEL,
  TX_TYPE_POINTS_TYPE,
  IDEM_SCOPE,
  IDEM_TTL_HOURS
} = require('../constants/mini');

/** 金额统一两位小数（仓库规范：Math.round(n*100)/100） */
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** 业务校验失败：抛 bizFail，由调用方 catch 统一 rollback 并返回 400（仓库既有模式） */
function businessError(message) {
  const e = new Error(message);
  e.business = true;
  return e;
}

// 钱包列清单（⚠️ 不使用 SELECT *，仓库红线）
// ⚠️ 钱包表字段一律**显式列出**，不用 `SELECT *`（仓库红线 R3），
//    也不用动态拼接列名（红线 R10：动态列名难以审计）。下方 3 处查询保持同一份字段清单。
//    字段清单：wallet_id, owner_type, owner_id, owner_name, initial_balance, balance,
//              status, remark, created_at, updated_at

function genWalletId() {
  return (
    'WLT' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1e4)
      .toString(36)
      .toUpperCase()
  );
}

function genTxId() {
  return (
    'WTX' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1e6)
      .toString(36)
      .toUpperCase()
  );
}

function genTxNo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return (
    'WT' +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
  );
}

/** 按主体查钱包（不加锁，用于读展示） */
async function findWallet(conn, ownerType, ownerId) {
  const [rows] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, owner_name,
                initial_balance, balance, recharge_balance, delivery_fee_balance,
                status, remark, created_at, updated_at
       FROM wallet_accounts WHERE owner_type = ? AND owner_id = ?`,
    [ownerType, ownerId]
  );
  return rows.length ? rows[0] : null;
}

/** 按 wallet_id 查钱包（不加锁，用于读展示；**不校验 status**，停用钱包也要能查账） */
async function findWalletById(conn, walletId) {
  const [rows] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, owner_name,
                initial_balance, balance, recharge_balance, delivery_fee_balance,
                status, remark, created_at, updated_at
       FROM wallet_accounts WHERE wallet_id = ?`,
    [walletId]
  );
  return rows.length ? rows[0] : null;
}

/**
 * 取钱包并加行锁（**所有余额变动前必须调用**，§11.7 第 2 条）
 * 锁条件带 status = 1：停用钱包不得再发生任何余额变动。
 * ⚠️ 但**撤销/退款**类操作例外 —— 见 loadWalletForUpdateIncludingDisabled 的说明。
 */
async function loadWalletForUpdate(conn, walletId) {
  const [rows] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, owner_name,
                initial_balance, balance, recharge_balance, delivery_fee_balance,
                status, remark, created_at, updated_at
       FROM wallet_accounts WHERE wallet_id = ? AND status = 1 FOR UPDATE`,
    [walletId]
  );
  if (!rows.length) {
    // 区分「不存在」与「已停用」，让报错可定位（不泄露表结构，只讲业务事实）
    const [any] = await conn.execute(`SELECT status FROM wallet_accounts WHERE wallet_id = ?`, [walletId]);
    if (!any.length) throw businessError('积分钱包不存在');
    throw businessError('积分钱包已停用，无法进行积分变动');
  }
  return rows[0];
}

/**
 * 取钱包并加行锁，**允许停用**（仅撤销/退款类使用）
 *
 * ⚠️ 为什么撤销必须允许停用钱包：§11.7 第 4 条明确要求
 *    「保证恒等式在**钱包停用（status = 0）时也必须成立**」。
 *    若钱包停用后禁止一切变动，那停用前多扣的那笔就永远退不回来，恒等式反而被破坏
 *    —— 与既有资金体系的「冲回对停用账户同样要回补余额」（orderRevenuePosting.js 注释第 4 条）一致。
 */
async function loadWalletForUpdateIncludingDisabled(conn, walletId) {
  const [rows] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, owner_name,
                initial_balance, balance, recharge_balance, delivery_fee_balance,
                status, remark, created_at, updated_at
       FROM wallet_accounts WHERE wallet_id = ? FOR UPDATE`,
    [walletId]
  );
  if (!rows.length) throw businessError('积分钱包不存在');
  return rows[0];
}

/**
 * 取钱包，不存在则创建（幂等：UNIQUE(owner_type, owner_id) 兜底并发）
 * 一个主体只有一个钱包（§3.2 / §11.1）—— 一个业务员一个钱包、一个直营水站一个钱包。
 */
async function ensureWallet(conn, { ownerType, ownerId, ownerName }) {
  const existing = await findWallet(conn, ownerType, ownerId);
  if (existing) return existing;

  const walletId = genWalletId();
  try {
    await conn.execute(
      `INSERT INTO wallet_accounts (wallet_id, owner_type, owner_id, owner_name, initial_balance, balance, status, remark)
       VALUES (?, ?, ?, ?, 0.00, 0.00, 1, ?)`,
      [walletId, ownerType, ownerId, ownerName || null, '小程序积分钱包（创建时自动开立）']
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    // 并发下另一个请求已创建 → 直接取它
    const again = await findWallet(conn, ownerType, ownerId);
    if (again) return again;
    throw e;
  }
  const created = await findWallet(conn, ownerType, ownerId);
  if (!created) throw businessError('积分钱包创建失败，请重试');
  return created;
}

/**
 * ★ 唯一允许写 wallet_accounts 余额的函数（§11.7 第 6 条）
 *
 * 必须在事务内调用，且调用前已通过 loadWalletForUpdate / loadWalletForUpdateIncludingDisabled
 * 拿到行锁。金额变动与流水写入在**同一事务**内完成（§11.7 第 1 条三联事务）。
 *
 * ★ 双积分（2026-09-23）：本函数同时维护**总额**与**分账户**：
 *      wallet_accounts.balance            = 充值积分 + 配送费积分（恒等式，恒成立）
 *      wallet_accounts.recharge_balance    ← pointsType = RECHARGE 时变动
 *      wallet_accounts.delivery_fee_balance ← pointsType = DELIVERY_FEE 时变动
 *   总额与分账户**必须写在同一条 UPDATE 里** —— 分两条语句会在中途暴露「总额已减、分账户未减」
 *   的不一致状态，一旦此时回滚/崩溃就留下对不上的账。
 *   出账时**两道校验都要过**：总额够、且「对应那一类积分」也够
 *   （总额够但某类不够是真实场景：充值 90 + 配送费 10，要扣配送费 20）。
 *
 * @param {object} conn       事务连接（不负责 begin/commit）
 * @param {object} walletRow  已加锁的钱包行（必须由本文件的读函数取得 —— 缺分账户列会直接报错）
 * @param {object} opts
 *   - txType       wallet_transactions.transaction_type（决定默认方向与默认积分类型）
 *   - amount       金额，必须是正数（方向由 direction 决定）
 *   - direction    可选：显式覆盖方向（撤销类必传，见 reverseTransaction）
 *   - pointsType   可选：'RECHARGE' | 'DELIVERY_FEE'，不传则按 txType 推导；
 *                  ORDER_PAYMENT / REFUND **必须显式传**（见 constants 的说明）
 *   - pointsMonth  可选：配送费积分的发行月份 YYYY-MM（仅发行入账填写，用于按月核对发放）
 *   - relatedType / relatedId / reversalOf / operatorId / operatorRole / remark
 * @returns {Promise<object>} 写入的流水行
 */
async function applyTransaction(conn, walletRow, opts) {
  const {
    txType,
    amount,
    direction: explicitDirection,
    relatedType = null,
    relatedId = null,
    reversalOf = null,
    operatorId = null,
    operatorRole = null,
    remark = null,
    pointsType: explicitPointsType = null,
    pointsMonth = null
  } = opts;

  if (!Object.values(WALLET_TX_TYPE).includes(txType)) {
    throw businessError(`未知的钱包流水类型: ${txType}`);
  }

  // ★ 积分类型：显式优先 → 按流水类型推导 → 都没有则**拒收**
  const pointsType = explicitPointsType || TX_TYPE_POINTS_TYPE[txType] || null;
  if (!pointsType || !POINTS_TYPE_VALUES.includes(pointsType)) {
    throw businessError(
      `无法确定积分类型（流水类型 ${txType}）：调用方必须显式传 pointsType，取值 ${POINTS_TYPE_VALUES.join(' / ')}`
    );
  }
  if (pointsMonth !== null && pointsMonth !== undefined && !/^\d{4}-\d{2}$/.test(String(pointsMonth))) {
    throw businessError(`积分归属月份格式非法：${pointsMonth}（应为 YYYY-MM）`);
  }

  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    // 金额恒为正数落库，方向只看 direction —— 避免负金额 × 方向带来的双重否定
    throw businessError('积分变动金额必须为正数');
  }

  const direction =
    explicitDirection !== undefined && explicitDirection !== null
      ? Number(explicitDirection)
      : TX_TYPE_DIRECTION[txType];
  if (![TX_DIRECTION.IN, TX_DIRECTION.OUT].includes(direction)) {
    throw businessError(`未知的资金方向: ${direction}`);
  }

  // 分账户列必须已随行读入（否则会把分账户静默重置为 0 —— 这是最容易漏、后果最重的一类）
  if (walletRow.recharge_balance === undefined || walletRow.delivery_fee_balance === undefined) {
    throw businessError('钱包行缺少分账户字段：请用 walletService 的读函数获取行（禁止自行拼装行对象）');
  }

  const before = round2(walletRow.balance);
  // ⚠️ §11.7 第 2 条：**支出方向**才校验余额；收入方向不校验
  if (direction === TX_DIRECTION.OUT && before < amt) {
    throw businessError(`积分不足：当前 ${before}，本次需要 ${amt}`);
  }
  // 双积分：总额够不等于该类够
  const isDelivery = pointsType === POINTS_TYPE.DELIVERY_FEE;
  const beforeSub = round2(isDelivery ? walletRow.delivery_fee_balance : walletRow.recharge_balance);
  if (direction === TX_DIRECTION.OUT && beforeSub < amt) {
    throw businessError(`${POINTS_TYPE_LABEL[pointsType]}不足：当前 ${beforeSub}，本次需要 ${amt}`);
  }

  const after = direction === TX_DIRECTION.IN ? round2(before + amt) : round2(before - amt);
  const afterSub = direction === TX_DIRECTION.IN ? round2(beforeSub + amt) : round2(beforeSub - amt);

  // ① 改余额：总额与分账户在**同一条 UPDATE**（全仓库仅此一处写钱包余额）
  await conn.execute(
    `UPDATE wallet_accounts
        SET balance = ?, recharge_balance = ?, delivery_fee_balance = ?, updated_at = NOW()
      WHERE wallet_id = ?`,
    [
      after,
      isDelivery ? round2(walletRow.recharge_balance) : afterSub,
      isDelivery ? afterSub : round2(walletRow.delivery_fee_balance),
      walletRow.wallet_id
    ]
  );
  // 让同一事务内多次变动时余额串联正确（与 orderRevenuePosting.postIncome 同一手法）
  walletRow.balance = after;
  if (isDelivery) walletRow.delivery_fee_balance = round2(afterSub);
  else walletRow.recharge_balance = round2(afterSub);

  // ② 写流水（字段齐备是 §11.7 第 3 条硬要求）
  const transactionId = genTxId();
  const transactionNo = genTxNo();
  await conn.execute(
    `INSERT INTO wallet_transactions
       (transaction_id, transaction_no, wallet_id, transaction_type, direction, amount,
        points_type, points_month, balance_before, balance_after, related_type, related_id,
        reversal_of, operator_id, operator_role, remark, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      transactionId,
      transactionNo,
      walletRow.wallet_id,
      txType,
      direction,
      amt,
      pointsType,
      pointsMonth || null,
      before,
      after,
      relatedType,
      relatedId,
      reversalOf,
      operatorId,
      operatorRole,
      remark
    ]
  );

  return {
    transaction_id: transactionId,
    transaction_no: transactionNo,
    wallet_id: walletRow.wallet_id,
    transaction_type: txType,
    direction,
    amount: amt,
    points_type: pointsType,
    points_month: pointsMonth || null,
    balance_before: before,
    balance_after: after,
    related_type: relatedType,
    related_id: relatedId,
    reversal_of: reversalOf
  };
}

/** 正向入账（充值 / 退款 / 分销配送费 / 管理员增加） */
async function creditWallet(conn, walletRow, opts) {
  return applyTransaction(conn, walletRow, { ...opts, direction: TX_DIRECTION.IN });
}

/** 负向出账（订单消费 / 管理员扣减）—— 会校验余额充足 */
async function debitWallet(conn, walletRow, opts) {
  return applyTransaction(conn, walletRow, { ...opts, direction: TX_DIRECTION.OUT });
}

/**
 * ★ 按分配额扣款：双积分「混合抵扣」（2026-09-23）
 *
 * 一次下单可由用户**自选**「充值积分 + 配送费积分」的组合（业务方确认的交互）。
 * 本函数把它编排成**两条独立流水**（各类型一条、同一 related_id），而不是一条带明细的流水：
 *   · 流水表是唯一的对账事实源 —— 一类积分一条流水，才能直接按 points_type 汇总核对；
 *   · 冲回（退款）时天然按原流水逐条还原，不需要解析明细。
 *
 * 实现上**复用 applyTransaction**（本文件唯一的记账入口）：余额校验、分账户维护、
 * 流水字段、恒等式全部继承，避免出现第二套记账逻辑（历史教训：两套口径必然分叉）。
 *
 * ⚠️ 分两次调用是安全的：同事务内、同一行已加锁，且任一步失败都会让调用方整体回滚；
 *    金额为 0 的那一类**不写流水**（流水金额必须为正数）。
 *
 * @param {object} split { rechargeAmount, deliveryFeeAmount } 金额可传 0，但两者之和须 > 0
 * @param {object} opts  透传给 applyTransaction（txType / relatedType / relatedId / operatorId …）
 * @returns {Promise<{txs: object[], total: number}>}
 */
async function debitWalletBySplit(conn, walletRow, split, opts = {}) {
  const rechargeAmount = round2((split && split.rechargeAmount) || 0);
  const deliveryFeeAmount = round2((split && split.deliveryFeeAmount) || 0);
  if (rechargeAmount < 0 || deliveryFeeAmount < 0) {
    throw businessError('抵扣积分不能为负数');
  }
  const total = round2(rechargeAmount + deliveryFeeAmount);
  if (total <= 0) {
    throw businessError('抵扣积分必须大于 0（请指定充值积分或配送费积分的抵扣数量）');
  }

  const parts = [
    { pointsType: POINTS_TYPE.RECHARGE, amount: rechargeAmount },
    { pointsType: POINTS_TYPE.DELIVERY_FEE, amount: deliveryFeeAmount }
  ].filter(p => p.amount > 0);

  const txs = [];
  for (const p of parts) {
    txs.push(
      await debitWallet(conn, walletRow, {
        ...opts,
        amount: p.amount,
        pointsType: p.pointsType
      })
    );
  }
  return { txs, total };
}

/**
 * 产生一笔冲回/撤销流水（§11.7 第 4、5 条）
 *
 * 撤销 = **原方向的反向**：
 *   - 原流水是「入账」（如分销配送费 +300）→ 冲回是出账 300（不是再 +300）
 *   - 原流水是「出账」（如订单消费 -500）  → 冲回是入账 500
 *
 * ⚠️ 这里刻意**不用** `TX_TYPE_DIRECTION[txType]` 推方向：撤销虽然也有自己的类型
 *   （如 DISTRIBUTION_FEE_REVERSAL），但方向必须由**被撤销的原流水**决定，
 *   否则「收入类流水的撤销」就会抄成 +，正是本仓库踩过的那个坑。
 *
 * @param {object} conn
 * @param {string} originalTxId 被撤销的原流水ID
 * @param {object} opts  { txType, amount（可选，默认=原流水金额）, relatedType, relatedId, operatorId, operatorRole, remark }
 */
async function reverseTransaction(conn, originalTxId, opts = {}) {
  const [rows] = await conn.execute(
    `SELECT transaction_id, wallet_id, transaction_type, direction, amount, points_type, points_month,
            related_type, related_id
       FROM wallet_transactions WHERE transaction_id = ?`,
    [originalTxId]
  );
  if (!rows.length) throw businessError('被撤销的钱包流水不存在');
  const original = rows[0];

  const walletRow = await loadWalletForUpdateIncludingDisabled(conn, original.wallet_id);
  const amount = opts.amount !== undefined && opts.amount !== null ? round2(opts.amount) : round2(original.amount);
  if (amount <= 0) throw businessError('冲回金额必须为正数');

  // ★ 原方向的反向
  const reverseDirection = Number(original.direction) === TX_DIRECTION.IN ? TX_DIRECTION.OUT : TX_DIRECTION.IN;

  // 原流水是入账时，冲回是出账 → 需要校验余额（可能已被消费掉）
  const tx = await applyTransaction(conn, walletRow, {
    txType: opts.txType || WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL,
    amount,
    direction: reverseDirection,
    relatedType: opts.relatedType !== undefined ? opts.relatedType : original.related_type,
    relatedId: opts.relatedId !== undefined ? opts.relatedId : original.related_id,
    reversalOf: original.transaction_id,
    // ★ 双积分：冲回**必须按原流水的积分类型**走。
    //   若一律记成充值积分，配送费积分的冲回会加错账户 —— 两张分账户各自都对不上，
    //   而总额恒等式**依然成立**（这正是最危险的一类静默错账）。
    pointsType: opts.pointsType || original.points_type || null,
    pointsMonth: opts.pointsMonth !== undefined ? opts.pointsMonth : original.points_month || null,
    operatorId: opts.operatorId || null,
    operatorRole: opts.operatorRole || null,
    remark: opts.remark || `冲回流水 ${original.transaction_id}`
  });
  return { original, reversal: tx };
}

/**
 * 查某笔业务已产生的钱包流水（权威值，用于退款金额取数与幂等判定）
 * ⚠️ 退款金额必须取「订单实际扣除积分」（§15.3），**不得**用订单总额重算
 *    —— 因为水票抵扣部分不扣积分，重算必然多退。
 */
async function findTransactionsByRelated(conn, { relatedType, relatedId, txType = null }) {
  let sql = `SELECT transaction_id, wallet_id, transaction_type, direction, amount,
                    points_type, points_month,
                    balance_before, balance_after, related_type, related_id, reversal_of, created_at
               FROM wallet_transactions WHERE related_type = ? AND related_id = ?`;
  const params = [relatedType, relatedId];
  if (txType) {
    sql += ' AND transaction_type = ?';
    params.push(txType);
  }
  sql += ' ORDER BY created_at ASC, transaction_id ASC';
  const [rows] = await conn.execute(sql, params);
  return rows;
}

/**
 * 恒等式校验（§11.5 / §44.12 ① ②）：当前余额 = 期初 + Σ正向 − Σ负向，精确到分。
 * 停用钱包同样必须成立 —— 因此这里不按 status 过滤。
 *
 * ★ 双积分（2026-09-23）新增**第二条恒等式**：余额 = 充值积分 + 配送费积分。
 *   两条都要成立：只验总额的话，「配送费积分被记成充值积分」这类错误完全看不出来。
 * @returns {Promise<{ok:boolean, balance:number, expected:number, diff:number, ...}>}
 */
async function assertWalletIdentity(conn, walletId) {
  const [w] = await conn.execute(
    `SELECT wallet_id, owner_type, owner_id, initial_balance, balance,
            recharge_balance, delivery_fee_balance, status
       FROM wallet_accounts WHERE wallet_id = ?`,
    [walletId]
  );
  if (!w.length) throw businessError('积分钱包不存在');
  const wallet = w[0];

  const [agg] = await conn.execute(
    `SELECT
        ROUND(COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0), 2) AS total_in,
        ROUND(COALESCE(SUM(CASE WHEN direction = 2 THEN amount ELSE 0 END), 0), 2) AS total_out,
        COUNT(*) AS tx_count
      FROM wallet_transactions WHERE wallet_id = ?`,
    [walletId]
  );
  const initial = round2(wallet.initial_balance);
  const totalIn = round2(agg[0].total_in);
  const totalOut = round2(agg[0].total_out);
  const expected = round2(initial + totalIn - totalOut);
  const balance = round2(wallet.balance);
  const diff = round2(balance - expected);

  // ★ 第二条恒等式：总额 = 两类分账户之和
  const rechargeBalance = round2(wallet.recharge_balance);
  const deliveryFeeBalance = round2(wallet.delivery_fee_balance);
  const splitDiff = round2(balance - round2(rechargeBalance + deliveryFeeBalance));

  return {
    walletId,
    ownerType: wallet.owner_type,
    ownerId: wallet.owner_id,
    status: Number(wallet.status),
    initialBalance: initial,
    totalIn,
    totalOut,
    balance,
    expected,
    diff,
    rechargeBalance,
    deliveryFeeBalance,
    splitDiff,
    splitOk: splitDiff === 0,
    txCount: Number(agg[0].tx_count),
    ok: diff === 0 && splitDiff === 0
  };
}

/** 全部钱包的恒等式体检（对账页 / 冒烟脚本共用） */
async function auditAllWallets(conn) {
  const [rows] = await conn.execute('SELECT wallet_id FROM wallet_accounts ORDER BY wallet_id ASC');
  const results = [];
  for (const r of rows) {
    results.push(await assertWalletIdentity(conn, r.wallet_id));
  }
  return results;
}

// ── 幂等（§23.1）──────────────────────────────────────────────────────────────
/**
 * 占用幂等键。**必须在业务事务内调用**（§23.1：不能事后补写）。
 *
 * @returns {Promise<{replayed:boolean, conflict:boolean, resultRef:string|null, status:string|null}>}
 *   replayed=true  → 同键重复请求：返回首次成功的同一结果（HTTP 200，不报错、不新建单）
 *   conflict=true  → 同键**不同参数**：视为客户端异常，调用方返回 400 并记日志
 *
 * 并发说明：第二次并发请求的 INSERT 会在唯一索引上**阻塞**到第一次事务提交，
 * 因此天然实现「进行中的重复请求不得并发进入扣款逻辑」；若第一次回滚，第二次即可正常插入。
 */
async function claimIdempotency(conn, { scope, key, requestHash = null, miniAccountId = null }) {
  if (!scope || !key) throw businessError('幂等参数不完整');

  const [existing] = await conn.execute(
    `SELECT idem_key, request_hash, status, result_ref, created_at,
            TIMESTAMPDIFF(HOUR, created_at, NOW()) AS age_hours
       FROM mini_idempotency WHERE scope = ? AND idem_key = ?`,
    [scope, key]
  );

  if (existing.length) {
    const row = existing[0];
    // §23.1 存活期：服务端保留至少 24h；过期后同键再次提交**按新请求**处理
    const expired = Number(row.age_hours) >= IDEM_TTL_HOURS;
    if (expired) {
      await conn.execute('DELETE FROM mini_idempotency WHERE scope = ? AND idem_key = ?', [scope, key]);
    } else {
      if (requestHash && row.request_hash && row.request_hash !== requestHash) {
        return { replayed: false, conflict: true, resultRef: row.result_ref, status: row.status };
      }
      return { replayed: true, conflict: false, resultRef: row.result_ref, status: row.status };
    }
  }

  try {
    await conn.execute(
      `INSERT INTO mini_idempotency (scope, idem_key, request_hash, status, result_ref, mini_account_id)
       VALUES (?, ?, ?, 'PENDING', NULL, ?)`,
      [scope, key, requestHash, miniAccountId]
    );
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    // 极小概率的并发窗口：插入瞬间被另一个事务抢占 → 视为重复请求，按首次结果处理
    const [again] = await conn.execute(
      'SELECT status, result_ref FROM mini_idempotency WHERE scope = ? AND idem_key = ?',
      [scope, key]
    );
    if (again.length && again[0].status === 'DONE') {
      return { replayed: true, conflict: false, resultRef: again[0].result_ref, status: 'DONE' };
    }
    return { replayed: true, conflict: false, resultRef: null, status: again.length ? again[0].status : 'PENDING' };
  }
  return { replayed: false, conflict: false, resultRef: null, status: 'PENDING' };
}

/** 事务内回填幂等结果（幂等键 → 首次成功的结果引用，如 order_id） */
async function completeIdempotency(conn, { scope, key, resultRef }) {
  await conn.execute(`UPDATE mini_idempotency SET status = 'DONE', result_ref = ? WHERE scope = ? AND idem_key = ?`, [
    resultRef || null,
    scope,
    key
  ]);
}

// ── 审计日志（§40）──────────────────────────────────────────────────────────
/** 写审计日志；**与业务同事务**（审计与业务不能一个成功一个失败） */
async function writeAuditLog(
  conn,
  { action, actorType = 'MINI', actorId = null, targetType = null, targetId = null, detail = null }
) {
  await conn.execute(
    `INSERT INTO mini_audit_logs (action, actor_type, actor_id, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [
      action,
      actorType,
      actorId,
      targetType,
      targetId,
      detail === null || detail === undefined
        ? null
        : typeof detail === 'string'
          ? detail.slice(0, 1000)
          : JSON.stringify(detail).slice(0, 1000)
    ]
  );
}

module.exports = {
  round2,
  businessError,
  findWallet,
  findWalletById,
  loadWalletForUpdate,
  loadWalletForUpdateIncludingDisabled,
  ensureWallet,
  applyTransaction,
  creditWallet,
  debitWallet,
  debitWalletBySplit,
  reverseTransaction,
  findTransactionsByRelated,
  assertWalletIdentity,
  auditAllWallets,
  claimIdempotency,
  completeIdempotency,
  writeAuditLog,
  IDEM_SCOPE
};

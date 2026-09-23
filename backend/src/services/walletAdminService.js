// 管理员调整积分（加/扣）· 共享实现
// ===========================================================================
// 为什么必须抽成一份（文档 §53「单源」要求）：
//   「调整积分」是**资金动作** —— 它直接改水站/业务员的可用订货额度。它的规则不是一条
//   而是一整套：入参规范化、幂等键去重（同键重放只生效一次 / 同键不同内容必须拒绝）、
//   加锁方式按方向区分（收入可动停用钱包、支出必须启用且余额充足）、记账与审计**同事务**、
//   方向与积分类型两个维度分别落库。
//
//   如果 Web 管理端与小程序管理端各写一份：任何一处漏掉「支出方向校验余额」或
//   「审计与业务同事务」，都不会报错、不会抛异常，**账面也看不出异常** ——
//   只有在「另一端的钱对不上」时才被发现。这正是本仓库「口径分叉」的历史教训。
//   因此本文件是**唯一实现**；两端只在「操作人身份」与「响应外形」上有差异。
//
// ⚠️ 事务边界由 controller 掌握：本文件只往传入的 conn 上写，不 begin/commit/rollback
//    （与 walletService / orderRevenuePosting 的既有约定一致）。
// ⚠️ 校验放在事务**外**（normalizeAdjustInput 由 controller 在 beginTransaction 前调用）：
//    非法入参不该占用行锁与连接。
// ===========================================================================
const walletService = require('./walletService');
const { hashRequest } = require('../utils/requestHash');
const {
  WALLET_TX_TYPE,
  TX_DIRECTION,
  POINTS_TYPE,
  POINTS_TYPE_VALUES,
  IDEM_SCOPE,
  IDEM_KEY_MAX_LEN,
  AUDIT_ACTION
} = require('../constants/mini');

/** 调整方向（**只用于「管理员手工调整」这一处**，与 WALLET_TX_TYPE 的 ORDINARY 方向无关） */
const ADJUST_DIRECTION = { IN: 'IN', OUT: 'OUT' };
const ADJUST_DIRECTION_VALUES = Object.values(ADJUST_DIRECTION);

/** 业务校验失败：抛 bizFail，由调用方 catch 统一 rollback 并返回 400（仓库既有模式） */
function businessError(message, httpStatus) {
  const e = new Error(message);
  e.business = true;
  // ⚠️ 允许带 httpStatus：钱包不存在应回 404（而不是 400）——
  //    否则「记错钱包 ID」与「参数写错」在日志里无法区分。
  if (httpStatus) e.httpStatus = httpStatus;
  return e;
}

/**
 * 入参规范化 + 校验（**在事务外调用**）
 * 校验顺序与报错文案沿用小程序端既有实现（已被 smoke_mini_program §10 断言覆盖），
 * 抽服务时**不改变**，避免「行为等价重构」变成「悄悄改了契约」。
 *
 * @param {object} input 请求体（驼峰；D7 normalizeBody 已把蛇形转驼峰）
 * @returns {{walletId:string, direction:string, amount:number, reason:string, remark:string, pointsType:string, clientRequestId:string}}
 */
function normalizeAdjustInput(input = {}) {
  const walletId = input.walletId;
  const direction = String(input.direction || '').toUpperCase();
  const amount = Number(input.amount);
  const reason = (input.reason || '').trim();
  const remark = (input.remark || '').trim();
  const clientRequestId = input.clientRequestId;
  // ★ 双积分（2026-09-23）：默认加到「充值积分」（= 业务口径里「管理员后台设置的那一类」），
  //   可显式指定配送费积分用于补发/对账修正（真实场景，不是预留能力）。
  const pointsType = String(input.pointsType || POINTS_TYPE.RECHARGE).toUpperCase();

  if (!walletId) throw businessError('缺少 walletId');
  if (!ADJUST_DIRECTION_VALUES.includes(direction)) {
    throw businessError('direction 只能是 IN（增加）或 OUT（扣减）');
  }
  if (!POINTS_TYPE_VALUES.includes(pointsType)) {
    throw businessError(`积分类型只能是 ${POINTS_TYPE_VALUES.join(' 或 ')}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) throw businessError('积分数量必须为正数');
  if (!reason) throw businessError('必须填写操作原因（文档 §18）');
  if (!clientRequestId || String(clientRequestId).length > IDEM_KEY_MAX_LEN) {
    throw businessError(`缺少或非法 clientRequestId（幂等键，长度不超过 ${IDEM_KEY_MAX_LEN}）`);
  }

  return { walletId, direction, amount, reason, remark, pointsType, clientRequestId: String(clientRequestId) };
}

/**
 * 幂等作用域：`WALLET_ADJUST:<渠道>:<钱包ID>`
 *
 * ⚠️ 必须带**渠道**：小程序与 Web 的幂等键分别由两端自行生成，键空间不同；
 *    若共用同一 scope，一旦两端碰巧生出同一个键（如都以时间戳为种子），
 *    先到者的结果会被当成后到者的「重放」→ 后到者拿到一个**与本意不符**的成功响应。
 *    加上渠道后两端完全隔离，且仍保留「同一钱包」的粒度。
 */
function buildIdemScope(channel, walletId) {
  return `${IDEM_SCOPE.WALLET_ADJUST}:${String(channel).toUpperCase()}:${walletId}`;
}

/**
 * 在**已开启的事务**里执行调整。
 *
 * @param {object} conn 事务连接
 * @param {object} input normalizeAdjustInput 的返回值
 * @param {object} ctx
 *   - scope      幂等作用域（建议用 buildIdemScope 构造）
 *   - actorType  'MINI' | 'WEB'（写审计用）
 *   - actorId    审计主体标识（如 `mini:12` / `web:admin`）
 *   - operatorId 流水里的操作人（如 `mini:12` / `web:admin`）
 *   - operatorRole 操作角色
 *   - miniAccountId 小程序账号 ID（Web 端为 null；列本身可空）
 * @returns {Promise<object>} { replayed, transactionNo, balanceBefore?, balanceAfter?, wallet? }
 */
async function applyAdjust(conn, input, ctx = {}) {
  const { walletId, direction, amount, reason, remark, pointsType, clientRequestId } = input;
  const {
    scope,
    actorType = 'MINI',
    actorId = null,
    operatorId = null,
    operatorRole = null,
    miniAccountId = null
  } = ctx;

  if (!scope) throw businessError('缺少幂等作用域（内部错误：未传 scope）');

  const wallet = await walletService.findWalletById(conn, walletId);
  if (!wallet) throw businessError('积分钱包不存在', 404);

  const claim = await walletService.claimIdempotency(conn, {
    scope,
    key: clientRequestId,
    // ⚠️ 用共享指纹函数，不要拼明文串：request_hash 是 varchar(64)，
    //    管理员把「操作原因」写长一点就会超长 → 接口 500（2026-09-21 修）
    // 指纹必须包含积分类型：否则「同一幂等键 + 同金额 + 不同类型」会被判成重复请求，
    // 第二次（本意是补发另一类积分）被静默合并掉
    requestHash: hashRequest({ direction, amount, reason, pointsType }),
    miniAccountId
  });

  if (claim.conflict) {
    throw businessError('重复提交的请求内容不一致，请刷新后重试');
  }
  if (claim.replayed) {
    // 重放：什么都不写，把首次结果引用交回，由 controller 决定响应外形
    return { replayed: true, transactionNo: claim.resultRef, walletId };
  }

  // ⚠️ 按方向选择加锁方式：
  //    增加积分是收入方向 → 允许停用钱包（撤销/补记类不因停用而卡死，§11.7 第 4 条）；
  //    扣减积分是支出方向 → 必须校验钱包启用 + 余额充足。
  const walletRow =
    direction === ADJUST_DIRECTION.IN
      ? await walletService.loadWalletForUpdateIncludingDisabled(conn, walletId)
      : await walletService.loadWalletForUpdate(conn, walletId);

  const tx = await walletService.applyTransaction(conn, walletRow, {
    txType: direction === ADJUST_DIRECTION.IN ? WALLET_TX_TYPE.ADJUST_IN : WALLET_TX_TYPE.ADJUST_OUT,
    amount,
    direction: direction === ADJUST_DIRECTION.IN ? TX_DIRECTION.IN : TX_DIRECTION.OUT,
    // ★ 双积分：作用于哪一类（默认充值积分，可显式指定配送费积分）
    pointsType,
    relatedType: 'MANUAL_ADJUST',
    relatedId: null,
    operatorId,
    operatorRole,
    // 操作原因必填（§18）；备注可空
    remark: remark ? `${reason}｜${remark}` : reason
  });

  await walletService.completeIdempotency(conn, {
    scope,
    key: clientRequestId,
    resultRef: tx.transaction_no
  });
  // 审计与业务**同事务**（一个成功一个失败是不能接受的）
  await walletService.writeAuditLog(conn, {
    action: AUDIT_ACTION.WALLET_ADJUST,
    actorType,
    actorId,
    targetType: 'WALLET',
    targetId: walletId,
    detail: { direction, amount, reason, remark, pointsType, transactionNo: tx.transaction_no }
  });

  return {
    replayed: false,
    walletId,
    transactionNo: tx.transaction_no,
    direction,
    amount,
    pointsType,
    balanceBefore: tx.balance_before,
    balanceAfter: tx.balance_after
  };
}

module.exports = {
  ADJUST_DIRECTION,
  ADJUST_DIRECTION_VALUES,
  normalizeAdjustInput,
  buildIdemScope,
  applyAdjust,
  businessError
};

// 小程序鉴权中间件 · 令牌隔离 + 每请求状态校验
// ===========================================================================
// 事实源：文档 §4.5.1 / §22.4 / §22.5 / §51 —— V1.1 把这三节列为「最重的一条」。
//
// 背景（V1.1 对现有代码核实后的结论）：
//   既有 backend/src/middleware/auth.js **只做 jwt.verify(token, JWT_SECRET)，不查库 status**（全文 43 行），
//   而 requireAdmin **只看 req.user.role === 'admin'**。
//   若小程序令牌共用 JWT_SECRET、payload 形状相同、且 role 取自 mini_accounts
//   （其枚举含 admin，且上一版残留的 seed_admin 正是 role=admin 且 status=1），则
//   **小程序管理员令牌可直接通过全部 Web 管理接口的 requireAdmin** —— 而 §5.3 恰好要求
//   管理员使用小程序（全覆盖），这条路在设计上是被默认打开的。
//
// 因此本文件落实三条硬性规则（§51.2）：
//   ① 小程序令牌使用**独立密钥** JWT_SECRET_MINI，并带独立 aud / iss；
//   ② `auth` / `requireAdmin` **显式拒绝**小程序令牌（见 middleware/auth.js 的改动）；
//   ③ 本中间件**每请求查库**校验账号与其绑定主体的 status。
//
// 关于「禁用即时生效」与「历史只读」的冲突（§4.5 vs §22.5）：
//   §4.5   ：禁用后禁止新登录 / 新订单 / 充值 / 钱包消费；**历史订单只读**
//   §22.5  ：禁用账号持有效令牌访问 → 返回 HTTP 401；且「禁用校验只拦『写』，不拦『读自己的历史』」
//   两条合并的落地方式：miniAuth 只**标记** blocked 而**不直接拒绝**，
//   由 requireMiniActive 挂在写接口上拒绝。这样读历史仍可用，写操作一律 401。
// ===========================================================================
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { unauthorized, forbidden, error } = require('../utils/response');
const { MINI_ROLES, MINI_TOKEN_AUDIENCE, MINI_TOKEN_ISSUER, MINI_MESSAGE } = require('../constants/mini');

// §51.3：与既有 auth.js:5-8 / authController.js:8-11 同一纪律 —— 缺失密钥直接抛错，
// **不要留 fallback 默认串**（本仓库历史上出现过硬编码 fallback 的隐患）。
const MINI_JWT_SECRET = process.env.JWT_SECRET_MINI;
if (!MINI_JWT_SECRET) {
  throw new Error(
    '环境变量 JWT_SECRET_MINI 未配置，拒绝启动。' +
      '小程序令牌必须与 Web 令牌隔离（文档 §51），请在 backend/.env 中设置独立强随机密钥。'
  );
}

function extractToken(req) {
  const h = req.headers['authorization'];
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

/** 读取账号绑定的主体启用状态；返回 blocked 对象或 null */
async function resolveBlocked(account) {
  // 账号本身被禁用
  if (Number(account.status) !== 1) {
    return { reason: 'ACCOUNT_DISABLED', message: MINI_MESSAGE.DISABLED_ACCOUNT };
  }
  // 绑定的主体被停用（§44.11 ⑤：workers.status=0 / sub_stations.status=0 同样必须被拒）
  if (account.role === MINI_ROLES.SALESMAN) {
    const [rows] = await pool.execute('SELECT status FROM workers WHERE worker_id = ?', [account.target_id]);
    if (!rows.length || Number(rows[0].status) !== 1) {
      return { reason: 'SUBJECT_DISABLED', message: MINI_MESSAGE.DISABLED_SUBJECT };
    }
  } else if (account.role === MINI_ROLES.STATION) {
    const [rows] = await pool.execute('SELECT status FROM sub_stations WHERE station_id = ?', [account.target_id]);
    if (!rows.length || Number(rows[0].status) !== 1) {
      return { reason: 'SUBJECT_DISABLED', message: MINI_MESSAGE.DISABLED_SUBJECT };
    }
  }
  // ADMIN（role=admin）绑定 users.id，users 表无 status 列，故只校验账号本身
  return null;
}

/**
 * 小程序鉴权中间件
 * 成功：req.mini = { accountId, role, targetId, openid, buyerType, blocked, tokenExp, tokenIat }
 * 失败：HTTP 401（与仓库 401 口径一致）
 */
async function miniAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return unauthorized(res, '未登录，请先登录');

  let payload;
  try {
    // ⚠️ 显式校验 aud / iss —— 这才是「双向隔离」的硬约束，
    //    不能只依赖「密钥不同」这一隐含屏障（§51.2 第 1 条）。
    payload = jwt.verify(token, MINI_JWT_SECRET, {
      audience: MINI_TOKEN_AUDIENCE,
      issuer: MINI_TOKEN_ISSUER
    });
  } catch (e) {
    // Web 令牌在这里会因 aud/iss 不匹配而落到这个分支 → §44.11 ③「Web 令牌访问小程序专用接口必须被拒」
    return unauthorized(res, '登录已过期或凭证类型不匹配，请重新登录');
  }

  if (payload.tokenUse !== 'mini' || !payload.miniAccountId) {
    // 双保险：即使有人把两个密钥配成同一个，也靠标记位拒绝（§41.1 禁止项）
    return unauthorized(res, '登录已过期或凭证类型不匹配，请重新登录');
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, openid, phone, role, target_id, nickname, avatar_url, status
         FROM mini_accounts WHERE id = ?`,
      [payload.miniAccountId]
    );
    if (!rows.length) {
      return unauthorized(res, '账号不存在或已解绑，请重新登录');
    }
    const account = rows[0];
    if (account.role !== payload.role || account.target_id !== payload.targetId) {
      // 令牌签发后绑定关系被改动（§4.6 解绑/重绑）→ 旧令牌立即失效，
      // 保证「解绑后旧账号不可再操作，钱包余额随 station_id 保持连续」（§44.11 ⑥）
      return unauthorized(res, '绑定关系已变更，请重新登录');
    }

    const blocked = await resolveBlocked(account);
    req.mini = {
      accountId: account.id,
      openid: account.openid,
      phone: account.phone,
      role: account.role,
      targetId: account.target_id,
      nickname: account.nickname,
      avatarUrl: account.avatar_url,
      // buyerType 由角色推导，**一律从令牌/库取，不接受请求体传入**（§22.2 / §51.2 第 3 条）
      buyerType:
        account.role === MINI_ROLES.SALESMAN ? 'SALESMAN' : account.role === MINI_ROLES.STATION ? 'STATION' : null,
      blocked,
      tokenExp: payload.exp,
      tokenIat: payload.iat
    };
    return next();
  } catch (e) {
    console.error('[miniAuth] 状态校验失败:', e);
    return error(res, '身份校验失败，请稍后重试');
  }
}

/**
 * 「主体必须处于启用状态」——挂在所有**写**接口上（下单 / 取消 / 退款 / 充值 / 管理操作）。
 * §22.5：禁用账号持有效令牌访问写接口 → HTTP 401（而非 403），前端据此清 token 跳登录。
 * 读接口（历史订单、流水）不挂，保证「历史订单只读」仍可用。
 */
function requireMiniActive(req, res, next) {
  if (req.mini && req.mini.blocked) {
    return unauthorized(res, req.mini.blocked.message);
  }
  return next();
}

/**
 * 小程序侧管理员校验（§22.4 第 4 条：另设 requireMiniAdmin，**不复用** Web 的 requireAdmin）。
 */
function requireMiniAdmin(req, res, next) {
  if (!req.mini) return unauthorized(res, '未登录，请先登录');
  if (req.mini.role !== MINI_ROLES.ADMIN) {
    return forbidden(res, '无权限执行此操作，需要管理员角色');
  }
  return next();
}

/** 角色白名单（例如仅直营水站可读水票） */
function requireMiniRole(...roles) {
  return (req, res, next) => {
    if (!req.mini) return unauthorized(res, '未登录，请先登录');
    if (!roles.includes(req.mini.role)) {
      return forbidden(res, '当前身份无权访问该功能');
    }
    return next();
  };
}

module.exports = miniAuth;
module.exports.requireMiniActive = requireMiniActive;
module.exports.requireMiniAdmin = requireMiniAdmin;
module.exports.requireMiniRole = requireMiniRole;
module.exports.MINI_JWT_SECRET = MINI_JWT_SECRET;

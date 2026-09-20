// 小程序认证与身份（文档 §4 / §21.1 / §51）
// ===========================================================================
// 路由挂载：/api/mini/auth/*
// ⚠️ 本组路由**不挂** miniAuth（登录本身不需要令牌），由 miniRoutes 单独处理。
// ===========================================================================
const { pool } = require('../../config/db');
const { success, error } = require('../../utils/response');
const miniAccountService = require('../../services/miniAccountService');
const walletService = require('../../services/walletService');
const walletSummary = require('../../services/walletSummary');
const wxMiniClient = require('../../services/wxMiniClient');
const {
  MINI_ROLES,
  ROLE_TO_OWNER_TYPE,
  MINI_TOKEN_TTL,
  MINI_TOKEN_RENEW_AFTER,
  MINI_MESSAGE,
  AUDIT_ACTION
} = require('../../constants/mini');

/**
 * 业务错误的统一出口。
 * ⚠️ 只对 `e.business` 透传 err.message（设计输出，非内部细节），
 *    其它异常一律走通用 500 文案，避免泄露表名/SQL/路径（仓库铁律 S7）。
 */
function handleError(res, err, fallback) {
  if (err && err.business) {
    const status = err.httpStatus || 400;
    // hazard-allow: bizFail 业务校验文案（设计输出，与 orderController 同一约定）
    return error(res, err.message, status);
  }
  console.error(`[mini/auth] ${fallback}:`, err);
  return error(res, fallback);
}

/** POST /api/mini/auth/login —— wx.login → openid →（可选）手机号绑定 → 签发令牌 */
async function login(req, res) {
  try {
    const { code, phoneCode, nickname, avatarUrl } = req.body || {};
    if (!code) return error(res, '缺少微信登录凭证 code', 400);
    const result = await miniAccountService.loginWithWxCode({ code, phoneCode, nickname, avatarUrl });
    return success(res, result);
  } catch (err) {
    return handleError(res, err, '登录失败，请稍后重试');
  }
}

/** POST /api/mini/auth/bind —— 用 bindTicket + 手机号 code 完成首次绑定 */
async function bind(req, res) {
  try {
    const { bindTicket, phoneCode, nickname, avatarUrl } = req.body || {};
    if (!bindTicket) return error(res, '缺少绑定票据，请重新登录', 400);
    if (!phoneCode) return error(res, '请授权微信手机号以完成绑定', 400);
    const result = await miniAccountService.bindWithTicket({ bindTicket, phoneCode, nickname, avatarUrl });
    return success(res, result, '绑定成功');
  } catch (err) {
    return handleError(res, err, '绑定失败，请稍后重试');
  }
}

/**
 * POST /api/mini/auth/dev-login —— 本地开发登录（**默认关闭**）
 * 详见 services/miniAccountService.devLogin 的边界说明。
 * 生产环境不得开启：MINI_DEV_LOGIN 未设为 '1' 时该接口直接拒绝。
 */
async function devLogin(req, res) {
  try {
    const { phone, role } = req.body || {};
    if (process.env.MINI_DEV_LOGIN !== '1') {
      return error(res, '本地开发登录未开启', 403);
    }
    const result = await miniAccountService.devLogin({ phone, role });
    return success(res, result, '开发环境登录成功');
  } catch (err) {
    return handleError(res, err, '登录失败，请稍后重试');
  }
}

/**
 * GET /api/mini/me —— 当前账号 + 主体 + 钱包
 *
 * ⚠️ 令牌**滑动续期**（§4.5.1 第 3 条要求「短令牌 + 刷新机制」）：
 *    令牌已过生命周期一半时，顺带在响应头 `X-Mini-Token` 下发新令牌。
 *    这样不必在 §21.1 已定稿的接口清单外新增 refresh 端点。
 *
 * ⚠️ 2026-09-20：原先额外下发 `pickup`（自提地点配置），随自提下线**已移除**。
 */
async function me(req, res) {
  const conn = await pool.getConnection();
  try {
    const profile = await miniAccountService.getAccountProfile(conn, req.mini.accountId);
    if (!profile) return error(res, '账号不存在', 401);

    // 钱包（admin 无钱包）
    let wallet = null;
    const ownerType = ROLE_TO_OWNER_TYPE[req.mini.role];
    if (ownerType) {
      const walletRow = await walletService.findWallet(conn, ownerType, req.mini.targetId);
      if (walletRow) wallet = await walletSummary.getWalletOverview(conn, walletRow.wallet_id);
    }

    // 滑动续期
    const nowSec = Math.floor(Date.now() / 1000);
    const iat = req.mini.tokenIat || nowSec;
    const exp = req.mini.tokenExp || nowSec;
    const ttl = exp - iat;
    if (ttl > 0 && nowSec - iat > ttl * MINI_TOKEN_RENEW_AFTER) {
      const [accountRow] = await conn.execute(`SELECT id, role, target_id, status FROM mini_accounts WHERE id = ?`, [
        req.mini.accountId
      ]);
      if (accountRow.length && Number(accountRow[0].status) === 1) {
        res.set(
          'X-Mini-Token',
          miniAccountService.signMiniToken({
            id: accountRow[0].id,
            role: accountRow[0].role,
            target_id: accountRow[0].target_id
          })
        );
        res.set('X-Mini-Token-Expires-In', MINI_TOKEN_TTL);
        // 浏览器/小程序需显式暴露自定义响应头
        res.set('Access-Control-Expose-Headers', 'X-Mini-Token, X-Mini-Token-Expires-In');
      }
    }

    return success(res, {
      account: profile.account,
      subject: profile.subject,
      wallet,
      blocked: req.mini.blocked || null,
      role: req.mini.role,
      permissions: describePermissions(req.mini.role)
    });
  } catch (err) {
    console.error('[mini/auth] 获取身份信息失败:', err);
    return error(res, '获取身份信息失败');
  } finally {
    conn.release();
  }
}

/**
 * 角色能力描述：下发给小程序，让前端菜单由**服务端**决定而不是前端硬编码角色判断。
 * （§5.1/§5.2/§5.3 的页面结构差异很大，集中在一处便于与文档对照）
 */
function describePermissions(role) {
  return {
    canOrder: role === MINI_ROLES.SALESMAN || role === MINI_ROLES.STATION,
    canUseWallet: role === MINI_ROLES.SALESMAN || role === MINI_ROLES.STATION,
    canSellWithCustomPrice: role === MINI_ROLES.SALESMAN, // 业务员可填成交价（§8.7）
    canUseWaterTicket: role === MINI_ROLES.STATION, // 仅直营水站有水票（§9.2）
    canViewAdminDashboard: role === MINI_ROLES.ADMIN // 管理员只读仪表盘（Phase 8a）
  };
}

/**
 * POST /api/mini/auth/logout
 * 无状态 JWT：服务端没有可吊销的会话（吊销能力靠 miniAuth 的每请求查库实现），
 * 因此这里只记录一次审计，实际登出由前端清本地 token 完成。
 */
async function logout(req, res) {
  const conn = await pool.getConnection();
  try {
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.LOGIN,
      actorType: 'MINI',
      actorId: `mini:${req.mini.accountId}`,
      targetType: 'MINI_ACCOUNT',
      targetId: String(req.mini.accountId),
      detail: { event: 'LOGOUT' }
    });
    return success(res, null, '已退出登录');
  } catch (err) {
    // 登出失败不影响前端清 token，因此不向用户报错为失败（但记录日志）
    console.error('[mini/auth] 登出审计写入失败:', err);
    return success(res, null, '已退出登录');
  } finally {
    conn.release();
  }
}

/**
 * GET /api/mini/config —— 免鉴权的公开配置
 * ⚠️ 只暴露「与身份无关」的开关，用于登录页判断是否显示「本地开发登录」入口。
 *    手机号、openid、密钥一律不出现在这里。
 */
async function publicConfig(req, res) {
  try {
    return success(res, {
      // 登录页据此决定是否显示本地开发入口（生产必须为 false）
      devLoginEnabled: process.env.MINI_DEV_LOGIN === '1',
      // 微信登录是否可用（未配置 WX_APPID/WX_SECRET 时为 false，前端提示走开发登录）
      wxLoginConfigured: wxMiniClient.isConfigured(),
      tokenTtl: MINI_TOKEN_TTL,
      messages: {
        needBind: MINI_MESSAGE.NEED_BIND,
        wechatPayNotOpen: MINI_MESSAGE.WECHAT_PAY_NOT_OPEN
      }
    });
  } catch (err) {
    console.error('[mini/auth] 读取公开配置失败:', err);
    return error(res, '读取配置失败');
  }
}

module.exports = { login, bind, devLogin, me, logout, publicConfig };

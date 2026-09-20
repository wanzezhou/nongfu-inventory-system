const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../utils/response');
const { MINI_TOKEN_AUDIENCE, MINI_TOKEN_ISSUER } = require('../constants/mini');

// 安全要求：密钥必须来自环境变量，缺失时启动即失败（见 app.js 的 assertJwtSecret）
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('环境变量 JWT_SECRET 未配置，拒绝启动。请在 backend/.env 中设置强随机密钥。');
}

/**
 * 显式拒绝小程序令牌（2026-09-20，文档 §22.4 / §51.2 第 1 条）。
 *
 * 为什么不能只靠「密钥不同」：这是**隐含**屏障 —— 只要有人把 JWT_SECRET_MINI 配成
 * 与 JWT_SECRET 相同（复制 .env 是最常见的操作），屏障立刻消失；而 mini_accounts
 * 的 role 枚举**含 admin**，Web 的 requireAdmin 又只看 `role === 'admin'`，
 * 于是小程序管理员令牌就能拿到全部 Web 管理接口的全权。§5.3 又恰好要求管理员用小程序。
 *
 * 这里读的是**未验签**的 payload（jwt.decode），只看 aud/iss/tokenUse 三个标签位，
 * 不信任任何其它字段；真正的验签仍在下面用 JWT_SECRET 完成。
 * aud/iss 是小程序令牌签发时写死的（见 middleware/miniAuth.js 与 services/miniAccountService.js），
 * Web 令牌从 authController 签发，不含这些字段。
 */
function isMiniToken(token) {
  try {
    const p = jwt.decode(token);
    if (!p || typeof p !== 'object') return false;
    return p.tokenUse === 'mini' || p.aud === MINI_TOKEN_AUDIENCE || p.iss === MINI_TOKEN_ISSUER;
  } catch (e) {
    return false;
  }
}

// ⚠️ 状态码口径（2026-09-18 起统一）：鉴权失败 = **HTTP 401 + 信封 code 401** 双写。
// 此前这里返回 HTTP 200，而同文件 requireAdmin 返回 HTTP 403 —— 同一文件两套口径，
// 导致 Nginx 访问日志 / APM / 安全监控无法从状态码识别未授权访问（暴力破解与越权
// 尝试完全不可观测）。改动同时覆盖了前端 request.js 的 error 分支与冒烟断言。
function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return unauthorized(res, '未登录，请先登录');
  }

  // 小程序令牌一律不得进入 Web 鉴权链路（§41.1 追加禁止项之一）
  if (isMiniToken(token)) {
    return unauthorized(res, '登录凭证类型不匹配，请使用 Web 端账号登录');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return unauthorized(res, '登录已过期，请重新登录');
  }
}

// 管理员角色校验（S4）：必须先经过 auth，req.user.role === 'admin' 才放行
function requireAdmin(req, res, next) {
  if (!req.user) {
    return unauthorized(res, '未登录，请先登录');
  }
  if (req.user.role !== 'admin') {
    return forbidden(res, '无权限执行此操作，需要管理员角色');
  }
  next();
}

module.exports = auth;
module.exports.requireAdmin = requireAdmin;

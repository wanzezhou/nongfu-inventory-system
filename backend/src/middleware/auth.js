const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('../utils/response');

// 安全要求：密钥必须来自环境变量，缺失时启动即失败（见 app.js 的 assertJwtSecret）
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('环境变量 JWT_SECRET 未配置，拒绝启动。请在 backend/.env 中设置强随机密钥。');
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

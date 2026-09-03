const jwt = require('jsonwebtoken');

// 安全要求：密钥必须来自环境变量，缺失时启动即失败（见 app.js 的 assertJwtSecret）
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('环境变量 JWT_SECRET 未配置，拒绝启动。请在 backend/.env 中设置强随机密钥。');
}

function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.json({ code: 401, message: '未登录，请先登录', data: null });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.json({ code: 401, message: '登录已过期，请重新登录', data: null });
  }
}

module.exports = auth;

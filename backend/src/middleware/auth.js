const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'nongfu_inventory_secret_2026';

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

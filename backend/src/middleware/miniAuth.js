const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'nongfu_inventory_secret_2026';

function miniAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ code: 401, message: '请先登录', data: null });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.source !== 'mini') {
      return res.json({ code: 401, message: '无效的凭证', data: null });
    }
    req.miniUser = {
      id: decoded.id,
      openid: decoded.openid,
      role: decoded.role,
      targetId: decoded.targetId,
      phone: decoded.phone
    };
    next();
  } catch (e) {
    return res.json({ code: 401, message: '登录已过期，请重新登录', data: null });
  }
}

module.exports = { miniAuth };

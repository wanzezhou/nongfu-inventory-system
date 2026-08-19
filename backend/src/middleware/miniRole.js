function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.miniUser) {
      return res.json({ code: 401, message: '请先登录', data: null });
    }
    if (!roles.includes(req.miniUser.role)) {
      return res.json({ code: 403, message: '无权访问此功能', data: null });
    }
    next();
  };
}

module.exports = { requireRole };

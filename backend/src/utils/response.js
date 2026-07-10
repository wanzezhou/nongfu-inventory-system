// 成功响应
function success(res, data = null, message = 'success') {
  res.json({
    code: 200,
    message: message,
    data: data
  });
}

// 失败响应
function error(res, message = 'error', code = 500) {
  res.status(code).json({
    code: code,
    message: message,
    data: null
  });
}

// 分页响应
function pagination(res, list = [], total = 0, page = 1, pageSize = 10, message = 'success') {
  res.json({
    code: 200,
    message: message,
    data: {
      list: list,
      total: total,
      page: page,
      pageSize: pageSize
    }
  });
}

module.exports = {
  success,
  error,
  pagination
};

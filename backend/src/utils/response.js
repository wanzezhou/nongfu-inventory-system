// 统一响应出口
// ===========================================================================
// 铁律：所有 HTTP 出口都走这里，不要散落裸 res.json（会形成第二套响应语义）。
//
// 生产环境的安全约定（2026-09-18 代码审查 #14 / 历史 S7）：
//   5xx 的 message 一律替换为固定文案。
//   原因：controller 的 catch 普遍写成 `error(res, 'xx失败')`，
//   MySQL / fs 的 err.message 会带表名、列名、SQL 片段、文件绝对路径与库名。
//   替换后原文明细仍然由各 controller 的 console.error 记录，排查不受影响。
//   ⚠️ 4xx 不动：4xx 的文案是业务文案（bizFail 的 err.message、参数校验、范围非法等），
//   属设计输出，不是内部细节。
const IS_PROD = process.env.NODE_ENV === 'production';

const INTERNAL_ERROR_TEXT = '服务器内部错误，请稍后重试或联系管理员';

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
  const status = Number(code) || 500;
  let safeMessage = message;

  if (IS_PROD && status >= 500) {
    safeMessage = INTERNAL_ERROR_TEXT;
    // 明细只进日志：出参被替换时必须留下可排查的痕迹
    if (message && message !== INTERNAL_ERROR_TEXT) {
      console.error('[error] 已屏蔽内部错误详情出参:', message);
    }
  }

  res.status(status).json({
    code: status,
    message: safeMessage,
    data: null
  });
}

// 未登录 / 登录已过期：**HTTP 401 + 信封 code 401** 双写
// 2026-09-18 起统一（此前为 HTTP 200 + code 401，导致 Nginx/APM 无法从状态码识别未授权访问）
function unauthorized(res, message = '未登录，请先登录') {
  res.status(401).json({
    code: 401,
    message: message,
    data: null
  });
}

// 已登录但无权限：**HTTP 403 + 信封 code 403** 双写
function forbidden(res, message = '无权限执行此操作') {
  res.status(403).json({
    code: 403,
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
  unauthorized,
  forbidden,
  pagination,
  IS_PROD,
  INTERNAL_ERROR_TEXT
};

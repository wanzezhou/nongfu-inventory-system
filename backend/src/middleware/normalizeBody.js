// 请求体命名归一化中间件（D7）
// 约定：后端 body 视角统一 camelCase；历史蛇形键（product_id / unit_price 等）在此一次性转换，
// 各 controller 不再写 `body.xxx_yyy || body.xxxYyy` 双命名判定。
// 仅处理 JSON/urlencoded 解析出的纯对象，深层递归（含数组内对象），深度限 6 防御异常结构。
// 注意：multer 的 multipart body 在路由内才解析，不经本中间件（导入接口的表单字段请用驼峰）。
const SNAKE_KEY_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function snakeToCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Buffer.isBuffer(value) || value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeValue(value, depth) {
  if (depth >= 6 || !isPlainObject(value) && !Array.isArray(value)) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeValue(value[i], depth + 1);
    return value;
  }
  for (const key of Object.keys(value)) {
    const converted = normalizeValue(value[key], depth + 1);
    if (SNAKE_KEY_RE.test(key)) {
      const camel = snakeToCamel(key);
      delete value[key];
      // 驼峰键已存在时不覆盖（以显式驼峰为准）
      if (!(camel in value)) value[camel] = converted;
    } else {
      value[key] = converted;
    }
  }
  return value;
}

module.exports = function normalizeBody(req, res, next) {
  if (req.body && isPlainObject(req.body)) {
    normalizeValue(req.body, 0);
  }
  next();
};

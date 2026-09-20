// 格式化工具（金额 / 时间 / 展示类）
// ===========================================================================
// ⚠️ 这里**只做展示格式化，不做业务计算**：
//    文档 §19.2 / §41 明确「在小程序侧自算营收 / 订单总额 / 实付金额」是禁止项。
//    金额一律直接展示服务端返回值，本文件只负责补符号、千分位、小数位。
// ===========================================================================

/** 金额：保留 2 位小数（服务端已 round2，这里只保证展示位数） */
function money(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0.00';
  return v.toFixed(2);
}

/** 积分数：整数展示（1 元 = 1 积分；积分落库为 decimal，这里按需保留小数） */
function points(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** 带符号的流水金额：正向 +、负向 −（符号来自服务端计算的 signedAmount） */
function signedPoints(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  const abs = points(Math.abs(v));
  return (v >= 0 ? '+' : '−') + abs;
}

/** 千分位（用于管理员仪表盘的大额展示） */
function thousands(n) {
  const s = money(n);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [int, dec] = body.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + withSep + (dec ? '.' + dec : '');
}

/** 微信开发者工具里 new Date('2026-09-20 10:00:00') 在 iOS 上会 NaN —— 统一替换分隔符 */
function toDate(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  const s = String(input)
    .replace(/-/g, '/')
    .replace('T', ' ')
    .replace(/\.\d+Z?$/, '');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 日期时间：YYYY-MM-DD HH:mm */
function dateTime(input) {
  const d = toDate(input);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 日期：YYYY-MM-DD */
function dateOnly(input) {
  const d = toDate(input);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / YYYY-MM-DD */
function fromNow(input) {
  const d = toDate(input);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 48 * 60 * 60 * 1000) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return dateOnly(d);
}

/** 手机号脱敏（后端已脱敏，这里兜底展示层） */
function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone);
  if (s.indexOf('*') >= 0) return s; // 已是脱敏态
  if (s.length <= 4) return s;
  if (s.length <= 7) return s.slice(0, 2) + '****' + s.slice(-2);
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 把后端返回的相对图片路径拼成绝对地址（库里不写域名，见后端 catalogController 注释） */
function imageUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const { API_ORIGIN } = require('../config/index');
  return API_ORIGIN + (path.startsWith('/') ? path : '/' + path);
}

/** 商品占位图（无图时用纯色块 + 首字，避免引用不存在的本地图片资源） */
function productInitial(name) {
  if (!name) return '水';
  return String(name).trim().charAt(0);
}

/** 流水方向 → 颜色语义（正向=红/负向=灰，与仓库「红涨绿跌」的国内习惯一致） */
function amountClass(signed) {
  return Number(signed) >= 0 ? 'amount-in' : 'amount-out';
}

module.exports = {
  money,
  points,
  signedPoints,
  thousands,
  dateTime,
  dateOnly,
  fromNow,
  maskPhone,
  imageUrl,
  productInitial,
  amountClass,
  toDate
};

// 小程序全局配置 —— 单一只读常量源
// ===========================================================================
// ⚠️ 这里**只放编译期常量**，不放任何密钥：
//    WX_APPID / WX_SECRET / WX_MCHID / WX_API_V3_KEY 等一律只在后端（文档 §26：
//    「只能存在服务端安全配置中，不能打包进入小程序」）。小程序包里出现任何密钥
//    都等于公开——反编译即可取得。
// ===========================================================================

/** 后端 API 根地址
 *  ⚠️ 微信开发者工具中调试：需在「详情 → 本地设置」勾选「不校验合法域名」。
 *     正式发布前必须改为**已在小程序后台备案的 https 域名**（文档 §46 技术侧清单：
 *     「配置服务器 HTTPS / 配置小程序 request 合法域名」）。
 */
const API_ORIGIN = 'http://localhost:3000';

/** 接口前缀（与后端 routes/miniRoutes.js 的挂载点一致） */
const API_PREFIX = '/api/mini';

/** 角色常量（与后端 constants/mini.js 的 MINI_ROLES 保持一致） */
const ROLES = {
  ADMIN: 'admin',
  SALESMAN: 'salesman',
  STATION: 'station'
};

/** 角色中文名 */
const ROLE_LABEL = {
  [ROLES.ADMIN]: '管理员',
  [ROLES.SALESMAN]: '业务员',
  [ROLES.STATION]: '直营水站'
};

/**
 * 履约方式（与后端 FULFILLMENT_TYPE 一致）
 *
 * ⚠️ 自提（PICKUP）已于 2026-09-20 业务下线，前后端一并移除 —— 这里只剩配送。
 *    与后端保持**同一份取值集合**很重要：前端多一个值不会报错，只会静静地
 *    发出一条服务端必拒的请求让用户吃 400。
 */
const FULFILLMENT = {
  DELIVERY: 'DELIVERY'
};

/** 业务员订货场景（与后端 ORDER_SCENE 一致） */
const ORDER_SCENE = {
  SELF_PURCHASE: 'SELF_PURCHASE',
  CUSTOMER_ORDER: 'CUSTOMER_ORDER'
};

/** 订单列表筛选（§31：业务员与水站的筛选项不同，由 role 决定渲染哪个集合）
 *  ⚠️ 自提下线（2026-09-20）后「待自提」页签已移除，两套集合都与后端
 *     orderController 的 `STATUS_FILTERS` 一一对应 —— 加/减页签要两侧同时改。 */
const STATUS_FILTERS_SALESMAN = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING_STOCK', label: '待备货' },
  { key: 'DELIVERING', label: '配送中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'CANCELED', label: '已取消' }
];
const STATUS_FILTERS_STATION = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING_STOCK', label: '待备货' },
  { key: 'DELIVERING', label: '配送中' },
  { key: 'COMPLETED', label: '已完成' },
  { key: 'REFUNDED', label: '已退款' }
];

/** 钱包主体类型中文名（后端 owner_type 的展示映射） */
const WALLET_OWNER_LABEL = {
  SALESMAN: '业务员',
  STATION: '直营水站'
};

/** 本地存储键（集中定义，避免各页面拼字符串拼错） */
const STORAGE_KEYS = {
  TOKEN: 'mini_token',
  ME: 'mini_me',
  CART: 'mini_cart',
  PENDING_IDEM: 'mini_pending_idem',
  LAST_PHONE: 'mini_last_phone'
};

/** 请求超时（毫秒） */
const REQUEST_TIMEOUT = 15000;

module.exports = {
  API_ORIGIN,
  API_PREFIX,
  ROLES,
  ROLE_LABEL,
  FULFILLMENT,
  ORDER_SCENE,
  STATUS_FILTERS_SALESMAN,
  STATUS_FILTERS_STATION,
  WALLET_OWNER_LABEL,
  STORAGE_KEYS,
  REQUEST_TIMEOUT
};

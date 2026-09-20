// 登录态与身份（文档 §4 / §21.1）
// ===========================================================================
// 设计要点：
//   ① 身份与权限**由服务端下发**（/mini/me 的 role + permissions），
//      前端不做「角色 → 能干什么」的硬编码判断（否则两边会分叉）。
//   ② 令牌只在 storage，不缓存 openid/手机号明文（后端也已脱敏，见 §54）。
//   ③ 禁用状态的透出：后端在禁用后仍允许 GET，并在 /me 里回传 blocked，
//      前端据此显示横幅并**禁用写操作入口**（§22.5：禁用只拦写，不拦读历史）。
// ===========================================================================
const req = require('./request');
const { STORAGE_KEYS, ROLES } = require('../config/index');

/** 内存中的身份缓存（避免每次进页面都请求 /me） */
let meCache = null;

/** 读取本地缓存的身份（冷启动时先用缓存渲染，再后台刷新） */
function getCachedMe() {
  if (meCache) return meCache;
  try {
    const cached = wx.getStorageSync(STORAGE_KEYS.ME);
    if (cached && cached.account) {
      meCache = cached;
      return meCache;
    }
  } catch (e) {
    // 读缓存失败按未登录处理
  }
  return null;
}

function setMe(me) {
  meCache = me || null;
  try {
    if (me) wx.setStorageSync(STORAGE_KEYS.ME, me);
    else wx.removeStorageSync(STORAGE_KEYS.ME);
  } catch (e) {
    // 写缓存失败不影响本次会话（内存里已有）
  }
}

/** 是否已登录（仅看本地令牌，不保证服务端仍认可） */
function hasToken() {
  return !!req.getToken();
}

/**
 * 拉取并缓存身份信息（GET /mini/me）
 * @param {boolean} silent
 * @returns {Promise<object|null>} 未登录/失败返回 null
 */
async function fetchMe(silent = true) {
  if (!hasToken()) {
    setMe(null);
    return null;
  }
  try {
    const me = await req.get('/me', null, { silent });
    setMe(me);
    return me;
  } catch (e) {
    // 401 已由请求层处理（清 token + 跳登录）
    if (e.code !== 401) {
      // 网络类失败：保留旧缓存，让页面仍可渲染，但**不伪造身份**
      console.warn('[auth] 获取身份失败：', e.message);
    } else {
      setMe(null);
    }
    return null;
  }
}

/** 当前身份（同步读缓存） */
function me() {
  return getCachedMe();
}

/** 当前角色 */
function role() {
  const m = getCachedMe();
  return m && m.account ? m.account.role : null;
}

/** 角色中文名 */
function roleLabel() {
  const { ROLE_LABEL } = require('../config/index');
  return ROLE_LABEL[role()] || '未知身份';
}

/** 是否被禁用（禁用后仍可读历史，但写操作入口需隐藏/禁用） */
function isBlocked() {
  const m = getCachedMe();
  return !!(m && m.blocked);
}

function blockedMessage() {
  const m = getCachedMe();
  return m && m.blocked ? m.blocked.message : '';
}

/** 服务端下发的权限表（缺省一律 false —— 安全默认，不给前端留「以为是开的」空间） */
function permissions() {
  const m = getCachedMe();
  return (
    (m && m.permissions) || {
      canOrder: false,
      canUseWallet: false,
      canSellWithCustomPrice: false,
      canUseWaterTicket: false,
      canViewAdminDashboard: false
    }
  );
}

/**
 * 页面登录守卫：未登录 → 跳登录页
 * 用法：在页面 onShow 里 `if (!auth.ensureLogin()) return;`
 */
function ensureLogin() {
  if (hasToken()) return true;
  wx.reLaunch({ url: '/pages/login/index' });
  return false;
}

/** 登出：通知服务端记审计（失败也不阻断），再清本地 */
async function logout() {
  try {
    await req.post('/auth/logout', {}, { silent: true });
  } catch (e) {
    // 服务端登出失败不阻断本地登出：令牌本就无状态，清掉即失效
    console.warn('[auth] 服务端登出失败：', e.message);
  }
  req.clearToken();
  setMe(null);
}

module.exports = {
  hasToken,
  fetchMe,
  me,
  role,
  roleLabel,
  isBlocked,
  blockedMessage,
  permissions,
  ensureLogin,
  logout,
  setMe,
  ROLES
};

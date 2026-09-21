// 统一请求层（文档 §21.1.2 / §22.5）
// ===========================================================================
// 约定（来自后端实现，必须对齐）：
//   ① 响应信封统一 { code, message, data }；HTTP 状态码与信封 code 双写。
//   ② 鉴权失败 = **HTTP 401 + code 401**（2026-09-18 起统一，此前是 HTTP 200 + code 401）。
//      → 因此 401 判断必须在 **error/fail 分支**处理，不能只看 response.data.code。
//   ③ 令牌**滑动续期**：后端在令牌过半生命周期时通过响应头 `X-Mini-Token` 下发新令牌，
//      本层自动保存（文档 §4.5.1「短令牌 + 刷新机制」）。
//   ④ 失败分支**绝不返回伪造数据**（仓库红线 R1）：接口失败就抛错，由页面渲染空态/错误态。
// ===========================================================================
const { API_ORIGIN, API_PREFIX, STORAGE_KEYS, REQUEST_TIMEOUT } = require('../config/index');

/** 是否正在跳登录页（避免多个并发 401 触发多次跳转） */
let redirectingToLogin = false;

function getToken() {
  try {
    return wx.getStorageSync(STORAGE_KEYS.TOKEN) || '';
  } catch (e) {
    return '';
  }
}

function setToken(token) {
  try {
    wx.setStorageSync(STORAGE_KEYS.TOKEN, token || '');
    return true;
  } catch (e) {
    return false;
  }
}

function clearToken() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.TOKEN);
    wx.removeStorageSync(STORAGE_KEYS.ME);
  } catch (e) {
    // 清缓存失败不阻断登出流程
  }
}

/** 401 统一处理：清令牌 + 跳登录页（后端 §22.5 要求前端据此清 token 跳登录） */
function handleUnauthorized(message) {
  clearToken();
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  const pages = getCurrentPages();
  const current = pages.length ? pages[pages.length - 1].route : '';
  // 已经在登录页就不重复跳
  if (current && current.indexOf('pages/login/index') >= 0) {
    redirectingToLogin = false;
    return;
  }
  wx.reLaunch({
    url: '/pages/login/index',
    complete() {
      redirectingToLogin = false;
    }
  });
  if (message) {
    wx.showToast({ title: message, icon: 'none', duration: 2500 });
  }
}

/** 轻提示（统一走这里，避免各页面自己拼 toast 文案） */
function toast(message, icon) {
  if (!message) return;
  wx.showToast({ title: String(message).slice(0, 40), icon: icon || 'none', duration: 2200 });
}

/**
 * 核心请求
 * @param {object} opts
 *   - url      : '/wallet' —— 相对 API_PREFIX 的路径
 *   - method   : GET / POST / ...
 *   - data     : 请求体（后端全局 normalizeBody 会做蛇形→驼峰，故这里**一律传驼峰**）
 *   - auth     : 是否带令牌（默认 true）
 *   - silent   : true 时不弹 toast（由调用方自己处理错误展示）
 *   - loading  : 是否显示 loading（默认 GET 不显示、写操作显示）
 * @returns {Promise<any>} 成功时 resolve 信封里的 data
 */
function request(opts) {
  const {
    url,
    method = 'GET',
    data = null,
    auth = true,
    silent = false,
    loading = method !== 'GET',
    loadingText = '处理中'
  } = opts;

  return new Promise((resolve, reject) => {
    if (loading) wx.showLoading({ title: loadingText, mask: true });

    const header = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (auth && token) header.Authorization = 'Bearer ' + token;

    wx.request({
      url: API_ORIGIN + API_PREFIX + url,
      method,
      data: data || undefined,
      header,
      timeout: REQUEST_TIMEOUT,
      success(res) {
        // ③ 滑动续期：后端在需要时下发新令牌（注意要显式暴露头，否则取不到）
        const renewed = res.header && (res.header['X-Mini-Token'] || res.header['x-mini-token']);
        if (renewed) setToken(renewed);

        const body = res.data || {};
        if (res.statusCode === 401 || body.code === 401) {
          handleUnauthorized(body.message || '登录已过期，请重新登录');
          return reject(Object.assign(new Error(body.message || '未登录'), { code: 401, handled: true }));
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 200) {
          return resolve(body.data);
        }
        // 其余一律视为失败：把后端业务文案透出（后端 4xx 的 message 是设计输出）
        const err = new Error(body.message || `请求失败（${res.statusCode}）`);
        err.code = body.code || res.statusCode;
        err.httpStatus = res.statusCode;
        if (!silent) toast(err.message);
        return reject(err);
      },
      fail(err) {
        // ⚠️ 网络失败**不返回任何数据**（红线 R1：不用假数据兜底）
        const message = /timeout/i.test(err.errMsg || '') ? '网络超时，请检查服务是否已启动' : '网络异常，请稍后重试';
        const e = new Error(message);
        e.code = 'NETWORK_ERROR';
        if (!silent) toast(message);
        reject(e);
      },
      complete() {
        if (loading) wx.hideLoading();
      }
    });
  });
}

const get = (url, params, opts) => {
  let qs = '';
  if (params) {
    const parts = [];
    Object.keys(params).forEach(k => {
      const v = params[k];
      if (v !== undefined && v !== null && v !== '') {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
      }
    });
    if (parts.length) qs = '?' + parts.join('&');
  }
  return request(Object.assign({ url: url + qs, method: 'GET' }, opts || {}));
};
const post = (url, data, opts) => request(Object.assign({ url, method: 'POST', data }, opts || {}));
// Phase 8b 管理员写操作（支出等）需要 PUT / DELETE —— 补上语义化封装，
// 避免各页面直接手写 method 字符串（拼错时表现为「接口 404」这种难查的现象）
const put = (url, data, opts) => request(Object.assign({ url, method: 'PUT', data }, opts || {}));
const del = (url, data, opts) => request(Object.assign({ url, method: 'DELETE', data }, opts || {}));

module.exports = {
  request,
  get,
  post,
  put,
  del,
  getToken,
  setToken,
  clearToken,
  toast,
  handleUnauthorized,
  API_ORIGIN,
  API_PREFIX
};

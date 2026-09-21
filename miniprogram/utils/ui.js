// 页面公共行为（tabBar 选中态 / 登录守卫 / 导航 / 二次确认）
// ===========================================================================
// 抽出来的原因：这些逻辑每页都要做一遍，各页各写一份必然出现
// 「有的页面忘了清角标」「有的页面忘了守卫」这类不一致。
// ===========================================================================
const auth = require('./auth');
const req = require('./request');

/** 设置自定义 tabBar 的选中项（自定义 tabBar 不会自动同步，必须页面自己调） */
function syncTabBar(page, path) {
  if (typeof page.getTabBar !== 'function') return;
  const bar = page.getTabBar();
  if (!bar) return;
  bar.setSelectedByPath(path);
  if (typeof bar.refresh === 'function') bar.refresh();
}

/**
 * 页面 onShow 的统一前置：
 *   - 登录守卫（未登录 → 跳登录页）
 *   - 刷新身份（含禁用状态）
 * @returns {Promise<object|null>} 身份对象；null 表示已被跳转/失败
 */
async function pageReady(page, options = {}) {
  const { needLogin = true, silent = true } = options;
  if (needLogin && !auth.hasToken()) {
    wx.reLaunch({ url: '/pages/login/index' });
    return null;
  }
  if (!auth.hasToken()) return null;
  return auth.fetchMe(silent);
}

/** 二次确认（Promise 风格，便于 async 页面使用） */
function confirm(title, content, confirmText) {
  return new Promise(resolve => {
    wx.showModal({
      title: title || '提示',
      content: content || '',
      confirmText: confirmText || '确定',
      confirmColor: '#c8102e',
      success(res) {
        resolve(!!res.confirm);
      },
      fail() {
        resolve(false);
      }
    });
  });
}

/**
 * 带输入的确认（Promise 风格）——用于「必须留下原因」的撤销类操作（如作废入库单）
 *
 * @returns {Promise<string|null>} 用户填写的文本（已 trim）；取消或留空返回 null
 *
 * ⚠️ 为什么不用两段式（先问确认、再单独问原因）：撤销类操作只有**一次**决策机会，
 *    拆成两步会让用户在第二步放弃时误以为已经作废（而其实什么都没发生）。
 * ⚠️ 留空即视为取消：撤销原因是要进审计与台账的，空原因等于没有可追溯性。
 */
function prompt(title, placeholder) {
  return new Promise(resolve => {
    wx.showModal({
      title: title || '请输入',
      editable: true,
      placeholderText: placeholder || '',
      confirmText: '确定',
      confirmColor: '#c8102e',
      success(res) {
        const text = String((res && res.content) || '').trim();
        resolve(res && res.confirm && text ? text : null);
      },
      fail() {
        resolve(null);
      }
    });
  });
}

/** 页面内导航（非 tab 页用 navigateTo） */
function navTo(url) {
  wx.navigateTo({
    url,
    fail() {
      // 页面栈超限（最多 10 层）时降级为 redirect，避免静默无反应
      wx.redirectTo({ url });
    }
  });
}

/** 跳 tab 页 */
function switchTab(url) {
  wx.switchTab({ url });
}

/** 统一错误处理：把 err.message 展示出来；401 已由请求层处理 */
function showError(err, fallback) {
  const msg = (err && err.message) || fallback || '操作失败，请稍后重试';
  if (err && err.code === 401) return; // 已在跳登录，不再提示
  wx.showToast({ title: String(msg).slice(0, 40), icon: 'none', duration: 2400 });
}

/** 从后端返回的配置里取提示文案（避免前端再维护一份文案） */
function apiMessage(key, fallback) {
  const app = getApp();
  const cfg = app && app.globalData ? app.globalData.apiConfig : null;
  const messages = cfg && cfg.messages ? cfg.messages : {};
  return messages[key] || fallback || '';
}

/** 是否需要展示「禁用」横幅（禁用后读仍可用，但写入口要禁用） */
function blockedBanner() {
  if (!auth.isBlocked()) return '';
  return auth.blockedMessage() || '账号已被禁用，请联系管理员';
}

module.exports = {
  syncTabBar,
  pageReady,
  confirm,
  prompt,
  navTo,
  switchTab,
  showError,
  apiMessage,
  blockedBanner,
  request: req
};

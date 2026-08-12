const KEY_TOKEN = 'mini_token';
const KEY_ROLE  = 'mini_role';
const KEY_USER  = 'mini_userInfo';

function setToken(t) { wx.setStorageSync(KEY_TOKEN, t); }
function getToken()  { return wx.getStorageSync(KEY_TOKEN) || ''; }
function clearToken(){ wx.removeStorageSync(KEY_TOKEN); }

function setRole(r) { wx.setStorageSync(KEY_ROLE, r); }
function getRole()  { return wx.getStorageSync(KEY_ROLE) || ''; }
function clearRole(){ wx.removeStorageSync(KEY_ROLE); }

function setUserInfo(info) { wx.setStorageSync(KEY_USER, info || {}); }
function getUserInfo()     { return wx.getStorageSync(KEY_USER) || {}; }
function clearUserInfo()   { wx.removeStorageSync(KEY_USER); }

function hasRole(allowRoles) {
  const r = getRole();
  return Array.isArray(allowRoles) ? allowRoles.includes(r) : allowRoles === r;
}

module.exports = {
  setToken, getToken, clearToken,
  setRole,  getRole,  clearRole,
  setUserInfo, getUserInfo, clearUserInfo,
  hasRole
};

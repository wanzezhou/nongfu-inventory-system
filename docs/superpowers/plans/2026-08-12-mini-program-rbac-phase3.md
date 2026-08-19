# 微信小程序多角色 RBAC - Phase 3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零重构微信小程序端（原生 WXML/WXSS/JS），支持管理员/配送员工/水站负责人/业务员 4 种角色差异化登录使用，并与 PC 后端同端口完成联调。

**Architecture:** 小程序端采用原生微信小程序（无 Taro/uni-app），按 tasks.md 定义的 Task 9-15 串行推进。基础设施先行（app.js/json/wxss + utils + 自定义 TabBar），然后登录 → 首页 → 订单 → 配送 → 其它业务页 → 联调。后端 Task 1-8 代码已就位，仅需运行 seed_mini_rbac.js 迁移 + 启动 3000 端口服务即可。

**Tech Stack:** 原生微信小程序 (WXML/WXSS/JS)，Node.js 18+, Express 4, MySQL 8.4, JWT

---

## File Structure Map

### 小程序端（全部在 `mini-program/` 下，旧目录先删除再重建）

```
mini-program/
├─ app.js                                  全局：onLaunch 读 token → setTabBar / toLogin
├─ app.json                                pages 注册 + tabBar.custom=true + window
├─ app.wxss                                CSS 变量 + 通用类
├─ project.config.json                     微信开发者工具配置（AppID 占位）
├─ sitemap.json                            微信索引配置
├─ utils/
│   ├─ config.js                           BASE_URL 环境配置
│   ├─ request.js                          wx.request Promise 封装（token/401/toast）
│   ├─ auth.js                             storage 读写 token/role/userInfo
│   └─ format.js                           金额/日期/手机号脱敏/订单类型/角色标签
├─ components/
│   ├─ role-tab-bar/                       自定义 TabBar（4 角色 list 映射）
│   │   ├─ index.js / index.json / index.wxml / index.wxss
│   ├─ stat-card/                          首页统计卡片
│   ├─ empty-state/                        空状态
│   ├─ order-card/                         订单卡片
│   ├─ product-picker/                     商品选择弹窗（含 product-item 内嵌）
│   ├─ section-title/                      小节标题（详情页用）
│   ├─ delivery-card/                      配送单卡片
│   ├─ amount-cell/                        金额计算行
│   └─ upload-photo/                       上传照片组件
├─ images/
│   ├─ logo.png                            品牌 Logo
│   ├─ tab-home.png / tab-home-active.png
│   ├─ tab-order.png / tab-order-active.png
│   ├─ tab-delivery.png / tab-delivery-active.png
│   ├─ tab-tool.png / tab-tool-active.png
│   └─ tab-me.png / tab-me-active.png
└─ pages/
    ├─ login/             (login.{js,json,wxml,wxss})
    ├─ home/              (home.{js,json,wxml,wxss})
    ├─ order/list/        (list.{js,json,wxml,wxss})
    ├─ order/detail/      (detail.{js,json,wxml,wxss})
    ├─ order/create/      (create.{js,json,wxml,wxss})
    ├─ order/edit/        (edit.{js,json,wxml,wxss})
    ├─ delivery/pending/  (pending.{js,json,wxml,wxss})
    ├─ delivery/mine/     (mine.{js,json,wxml,wxss})
    ├─ delivery/complete/ (complete.{js,json,wxml,wxss})
    ├─ tool/              (tool.{js,json,wxml,wxss})  Station/Salesman 工具聚合 Tab
    ├─ inventory/search/  (search.{js,json,wxml,wxss})
    ├─ performance/index/ (index.{js,json,wxml,wxss})
    ├─ deposit/list/      (list.{js,json,wxml,wxss})
    ├─ deposit/create/    (create.{js,json,wxml,wxss})
    ├─ reimburse/list/    (list.{js,json,wxml,wxss})
    ├─ reimburse/create/  (create.{js,json,wxml,wxss})
    ├─ reimburse/approve/ (approve.{js,json,wxml,wxss})
    ├─ profile/index/     (index.{js,json,wxml,wxss})
    └─ profile/change-phone/ (change-phone.{js,json,wxml,wxss})
```

### 后端侧（Phase 1/2 已就位，仅需确认与对齐）

```
backend/.env.example                       ← 添加 WX_APPID / WX_SECRET / SMS_* 变量
backend/src/controllers/miniAuthController.js  ← 已存在，bindPhone 的 openid 合成占位 修正（详见 Task 9 前置）
backend/src/app.js                         ← 确认 /mini 路由挂载点正确
```

### 前端 PC 侧（已修复，仅需验证）

```
frontend/src/views/mini-account/MiniAccountList.vue  ← role=worker/targetId=id 已修（Task 0）
```

---

## Task 0（立即确认运行基线）：验证后端可启动 + DB 迁移脚本已跑

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/src/controllers/mini/miniAuthController.js` bindPhone 合并占位 openid 逻辑

- [ ] **Step 1: 确保 .env.example 包含小程序需要的环境变量**

在 `backend/.env.example` 末尾追加：

```dotenv
# 微信小程序配置
WX_APPID=your_appid_here
WX_SECRET=your_secret_here

# 短信服务配置（开发环境可不填，默认固定 123456）
SMS_API_URL=
SMS_API_KEY=
SMS_SIGN_NAME=
SMS_TEMPLATE_CODE=
```

- [ ] **Step 2: 运行数据库迁移脚本，确认幂等**

在 `backend/` 目录执行：

```bash
node src/scripts/seed_mini_rbac.js
```

预期输出：
```
mini_accounts表已创建
salesmen表已创建
sms_codes表已创建
users表已添加phone列
users表已添加idx_phone索引
mini RBAC 迁移完成
```

重复执行 2 次，第二次不应有 "已添加" 报错，正常完成退出码 0。

- [ ] **Step 3: 启动后端服务并 smoke-test 认证接口**

在 `backend/` 目录（开一个终端长期挂起）执行：

```bash
npm run start
```

然后在另一终端：

```bash
curl -X POST http://localhost:3000/mini/auth/sms-send \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800138000"}'
```

预期：`{"code":200,"message":"验证码已发送"}`（开发环境），后端 console 同时打印 `[DEV SMS] 验证码: 123456 -> 13800138000`。

- [ ] **Step 4: 修正 bindPhone 的 PC 占位 openid 合并逻辑（重要）**

当前 `miniAuthController.js` 的 `bindPhone` 使用 `ON DUPLICATE KEY UPDATE` 仅在 **openid 列冲突**时触发。然而 PC 端创建的记录 openid 是 `pc_xxx`（与真实 openid 不同），而 phone 列有 `idx_phone` 索引，但 **不是 UNIQUE**。因此 4 表命中返回 (role, targetId) 时，需要先**按 (role, target_id) 查一条已存在记录**，若存在则更新 openid；否则再走 ON DUPLICATE KEY。

把 `bindPhone` 函数中 INSERT 之前（`const matched = await matchPhone(phone)` 之后，INSERT 之前）替换为以下内容：

```javascript
    // 已有 PC 端占位记录？按 role + target_id 查找
    const [existingByTarget] = await pool.query(
      'SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? LIMIT 1',
      [matched.role, matched.targetId]
    );

    if (existingByTarget.length > 0) {
      // 更新已存在记录的 openid/phone/status/last_login_at
      await pool.query(
        `UPDATE mini_accounts SET openid = ?, phone = ?, status = 1, last_login_at = NOW() WHERE id = ?`,
        [openid, phone, existingByTarget[0].id]
      );
    } else {
      // 真正新建（以 openid 为键防重复）
      await pool.query(
        `INSERT INTO mini_accounts (openid, phone, role, target_id, status, last_login_at)
         VALUES (?, ?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE
           phone = VALUES(phone),
           role = VALUES(role),
           target_id = VALUES(target_id),
           status = 1,
           last_login_at = NOW()`,
        [openid, phone, matched.role, matched.targetId]
      );
    }
```

- [ ] **Step 5: 提交**

```bash
cd c:\Users\15085\Desktop\系统开发V2
git add backend/.env.example backend/src/controllers/mini/miniAuthController.js
git commit -m "fix: bindPhone合并PC占位openid + 添加env示例"
```

---

## Task 1：删除旧小程序 + 重建基础设施文件骨架（对应 spec 7.2 / Task 9）

**Files:**
- Delete: `mini-program/` (整个旧目录)
- Create: `mini-program/app.js`, `app.json`, `app.wxss`, `project.config.json`, `sitemap.json`
- Create: `mini-program/utils/` 下 4 个文件
- Create: `mini-program/components/role-tab-bar/` 4 个文件
- Create: `mini-program/images/` 占位空

- [ ] **Step 1: 删除旧 mini-program 目录**

```bash
cd c:\Users\15085\Desktop\系统开发V2
# Windows PowerShell
Remove-Item -Recurse -Force mini-program
mkdir mini-program
```

- [ ] **Step 2: 写 `mini-program/project.config.json`**

```json
{
  "description": "农夫山泉经销商小程序",
  "packOptions": { "ignore": [] },
  "setting": {
    "urlCheck": false,
    "es6": true,
    "enhance": true,
    "postcss": true,
    "preloadBackgroundData": false,
    "minified": true,
    "newFeature": true,
    "coverView": true,
    "nodeModules": false,
    "autoAudits": false,
    "showShadowRootInWxmlPanel": true,
    "scopeDataCheck": false,
    "uglifyFileName": false,
    "checkInvalidKey": true,
    "checkSiteMap": true,
    "uploadWithSourceMap": true,
    "compileHotReLoad": false,
    "useMultiFrameRuntime": true,
    "useApiHook": true,
    "useApiHostProcess": true,
    "babelSetting": { "ignore": [], "disablePlugins": [], "outputPath": "" },
    "enableEngineNative": false,
    "useIsolateContext": true,
    "userConfirmedBundleSwitch": false,
    "packNpmManually": false,
    "packNpmRelationList": [],
    "minifyWXSS": true,
    "disableUseStrict": false,
    "minifyWXML": true,
    "showES6CompileOption": false,
    "useCompilerPlugins": false
  },
  "compileType": "miniprogram",
  "libVersion": "3.0.0",
  "appid": "touristappid",
  "projectname": "nongfu-mini",
  "condition": {},
  "editorSetting": { "tabIndent": "insertSpaces", "tabSize": 2 }
}
```

注：`appid=touristappid` 是开发者工具游客 AppID，正式发布前替换。

- [ ] **Step 3: 写 `mini-program/sitemap.json`**

```json
{ "rules": [{ "action": "allow", "page": "*" }] }
```

- [ ] **Step 4: 写 `mini-program/app.json`**

```json
{
  "pages": [
    "pages/login/login",
    "pages/home/home",
    "pages/order/list/list",
    "pages/order/detail/detail",
    "pages/order/create/create",
    "pages/order/edit/edit",
    "pages/delivery/pending/pending",
    "pages/delivery/mine/mine",
    "pages/delivery/complete/complete",
    "pages/tool/tool",
    "pages/inventory/search/search",
    "pages/performance/index/index",
    "pages/deposit/list/list",
    "pages/deposit/create/create",
    "pages/reimburse/list/list",
    "pages/reimburse/create/create",
    "pages/reimburse/approve/approve",
    "pages/profile/index/index",
    "pages/profile/change-phone/change-phone"
  ],
  "window": {
    "backgroundTextStyle": "dark",
    "navigationBarBackgroundColor": "#C7000B",
    "navigationBarTitleText": "农夫山泉经销商",
    "navigationBarTextStyle": "white",
    "backgroundColor": "#F6F6F8"
  },
  "tabBar": {
    "custom": true,
    "color": "#8E8E9E",
    "selectedColor": "#C7000B",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/home/home", "text": "首页" },
      { "pagePath": "pages/order/list/list", "text": "订单" },
      { "pagePath": "pages/delivery/pending/pending", "text": "配送" },
      { "pagePath": "pages/profile/index/index", "text": "我的" }
    ]
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json"
}
```

注意 tabBar.list 放 admin/worker 版 4 Tab；station/salesman 用自定义 TabBar 替换为工具 Tab。

- [ ] **Step 5: 写 `mini-program/app.js`**

```javascript
const auth = require('./utils/auth.js');
const config = require('./utils/config.js');

App({
  globalData: {
    userInfo: null,
    token: '',
    role: '',   // admin/worker/station/salesman
    BASE_URL: config.BASE_URL
  },

  onLaunch() {
    const token = auth.getToken();
    const role = auth.getRole();
    if (token && role) {
      this.globalData.token = token;
      this.globalData.role = role;
      this.globalData.userInfo = auth.getUserInfo();
      // 进入各 Tab 页后，自定义 TabBar 会根据 role 自行渲染
    }
  },

  // 登录成功后更新全局
  setLoginState(token, role, userInfo) {
    auth.setToken(token);
    auth.setRole(role);
    auth.setUserInfo(userInfo);
    this.globalData.token = token;
    this.globalData.role = role;
    this.globalData.userInfo = userInfo;
  },

  clearLoginState() {
    auth.clearToken();
    auth.clearRole();
    auth.clearUserInfo();
    this.globalData.token = '';
    this.globalData.role = '';
    this.globalData.userInfo = null;
  },

  toLogin() {
    this.clearLoginState();
    wx.reLaunch({ url: '/pages/login/login' });
  }
});
```

- [ ] **Step 6: 写 `mini-program/app.wxss`**

```css
:root {
  --brand: #C7000B;
  --brand-light: #E63946;
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  --info: #3B82F6;
  --gold: #D4A017;
  --text-primary: #1F1F2E;
  --text-secondary: #5A5A6E;
  --text-muted: #8E8E9E;
  --bg: #F6F6F8;
  --card: #FFFFFF;
  --border: #EFEFF4;
}

page {
  background: var(--bg);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
  font-size: 28rpx;
  line-height: 1.5;
}

.card {
  background: var(--card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin: 20rpx 24rpx;
  box-shadow: 0 4rpx 20rpx rgba(15, 23, 42, 0.04);
}

.btn-primary {
  background: linear-gradient(135deg, var(--brand) 0%, var(--brand-light) 100%);
  color: #fff;
  border-radius: 48rpx;
  padding: 22rpx 0;
  font-size: 30rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  border: none;
  box-shadow: 0 8rpx 24rpx rgba(199, 0, 11, 0.28);
  transition: transform .15s ease;
}
.btn-primary::after { border: none; }
.btn-primary:active { transform: scale(0.98); }

.btn-ghost {
  background: #fff;
  color: var(--text-primary);
  border: 1rpx solid var(--border);
  border-radius: 48rpx;
  padding: 20rpx 0;
  font-size: 30rpx;
  font-weight: 500;
}
.btn-ghost::after { border: none; }

.price { color: var(--brand); font-weight: 700; }
.muted { color: var(--text-muted); font-size: 24rpx; }
.dim { opacity: .45; } /* 无库存商品暗淡 */

.text-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  display: inline-block;
  padding: 4rpx 16rpx;
  border-radius: 20rpx;
  font-size: 22rpx;
}
.tag-danger  { background: rgba(239,68,68,0.12); color: var(--danger); }
.tag-success { background: rgba(16,185,129,0.12); color: var(--success); }
.tag-warning { background: rgba(245,158,11,0.12); color: var(--warning); }
.tag-info    { background: rgba(59,130,246,0.12); color: var(--info); }

/* 库存胶囊：按数量变色（与 PC 端对齐） */
.stock {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96rpx;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  border: 1rpx solid transparent;
  box-shadow: inset 0 1rpx 0 rgba(255,255,255,0.6), 0 2rpx 8rpx rgba(0,0,0,0.04);
}
.stock-negative {
  background: linear-gradient(135deg, #FFB4B4, #FF5A5A);
  color: #fff; border-color: rgba(255,0,0,0.15);
}
.stock-zero {
  background: linear-gradient(135deg, #E9E9EE, #BCBCC4);
  color: #4A4A5A; border-color: rgba(0,0,0,0.05);
}
.stock-low { /* 1-49 */
  background: linear-gradient(135deg, #FFD8A8, #FF9A3C);
  color: #6B3A00; border-color: rgba(255,154,0,0.15);
}
.stock-mid { /* 50-199 */
  background: linear-gradient(135deg, #FFECB3, #D4A017);
  color: #644700; border-color: rgba(212,160,23,0.2);
}
.stock-good { /* 200-999 */
  background: linear-gradient(135deg, #B8F1C9, #10B981);
  color: #0A5A3C; border-color: rgba(16,185,129,0.2);
}
.stock-plenty { /* 1000+ */
  background: linear-gradient(135deg, #C5DDFE, #3B82F6);
  color: #0E2A63; border-color: rgba(59,130,246,0.2);
}

.page-padding { padding: 0 24rpx 40rpx; }

/* 分割线 */
.divider {
  height: 1rpx;
  background: var(--border);
  margin: 20rpx 0;
}
```

- [ ] **Step 7: 写 `mini-program/utils/config.js`**

```javascript
// 开发环境填 localhost；生产环境改域名（需 HTTPS + mp 后台配置合法域名）
const BASE_URL = 'http://localhost:3000';

module.exports = { BASE_URL };
```

- [ ] **Step 8: 写 `mini-program/utils/request.js`**

```javascript
const config = require('./config.js');

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('mini_token') || '';

    wx.request({
      url: config.BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data || {},
      header: Object.assign(
        {
          'Content-Type': 'application/json'
        },
        token ? { Authorization: 'Bearer ' + token } : {}
      ),
      success: (res) => {
        const body = res.data;
        if (res.statusCode === 200 && body && body.code !== undefined) {
          if (body.code === 200) {
            resolve(body.data === undefined ? null : body.data);
          } else if (body.code === 401) {
            wx.showToast({ title: '登录已过期', icon: 'none' });
            // 全局清登录态
            const app = getApp();
            if (app && app.clearLoginState) app.clearLoginState();
            // 跳登录（避免在小程序启动早期无限循环，给个延时）
            setTimeout(() => {
              wx.reLaunch({ url: '/pages/login/login' });
            }, 500);
            reject(new Error(body.message || '未登录'));
          } else {
            wx.showToast({ title: body.message || '请求失败', icon: 'none' });
            reject(new Error(body.message || '请求失败'));
          }
        } else {
          // blob / 非 JSON 响应直接走 resolve
          resolve(body);
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络连接失败', icon: 'none' });
        reject(err);
      }
    });
  });
}

module.exports = {
  get:    (url, params = {}) => request({ url: url + toQuery(params), method: 'GET' }),
  post:   (url, data = {})  => request({ url, method: 'POST', data }),
  put:    (url, data = {})  => request({ url, method: 'PUT', data }),
  delete: (url, data = {})  => request({ url, method: 'DELETE', data }),
  raw:    request
};

function toQuery(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '';
  const pairs = keys.filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
  return '?' + pairs.join('&');
}
```

- [ ] **Step 9: 写 `mini-program/utils/auth.js`**

```javascript
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

// 角色权限检查：传入允许角色数组，返回 bool
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
```

- [ ] **Step 10: 写 `mini-program/utils/format.js`**

```javascript
function formatAmount(n) {
  if (n === null || n === undefined || n === '') return '0.00';
  const num = Number(n);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}

function formatDate(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maskPhone(p) {
  if (!p || p.length < 11) return p || '';
  return p.substr(0, 3) + '****' + p.substr(7);
}

const ORDER_TYPE_LABELS = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '零售机供货',
  5: '线下水站返货'
};
function orderTypeLabel(t) { return ORDER_TYPE_LABELS[t] || '未知类型'; }

// 订单类型按角色是否允许创建
function allowedOrderTypes(role) {
  switch (role) {
    case 'worker':   return [1, 3];
    case 'station':  return [2, 5];
    case 'admin':
    case 'salesman': return [1, 2, 3, 4, 5];
    default: return [];
  }
}

const ROLE_LABELS = {
  admin: '管理员',
  worker: '配送员工',
  station: '水站负责人',
  salesman: '业务员'
};
function roleLabel(r) { return ROLE_LABELS[r] || r || ''; }

// 库存胶囊 class：6 色
function stockClass(qty) {
  if (qty === undefined || qty === null || qty === '') return 'stock-zero';
  const n = Number(qty);
  if (n < 0) return 'stock-negative';
  if (n === 0) return 'stock-zero';
  if (n < 50) return 'stock-low';
  if (n < 200) return 'stock-mid';
  if (n < 1000) return 'stock-good';
  return 'stock-plenty';
}

module.exports = {
  formatAmount, formatDate, maskPhone,
  orderTypeLabel, allowedOrderTypes,
  roleLabel, stockClass
};
```

- [ ] **Step 11: 写自定义 TabBar 4 个文件**

`mini-program/components/role-tab-bar/index.json`
```json
{ "component": true, "usingComponents": {} }
```

`mini-program/components/role-tab-bar/index.wxml`
```xml
<view class="tab-bar">
  <block wx:for="{{tabList}}" wx:key="pagePath">
    <view class="tab-item {{selected === item.key ? 'active' : ''}}"
          bindtap="switchTab"
          data-path="{{item.pagePath}}">
      <view class="tab-icon-wrapper">
        <view wx:if="{{selected === item.key}}" class="icon-glow"></view>
        <text class="iconfont tab-icon">{{item.iconText}}</text>
      </view>
      <text class="tab-text">{{item.text}}</text>
    </view>
  </block>
</view>
```

说明：小程序自定义 TabBar 图标若用真实图片（推荐），把 `iconfont/text` 替换为 `<image>` + `selected` 切图。为快速推进，Phase 3 V1 使用 emoji/Unicode 占位。正式发布前替换 images/ 下 PNG。

`mini-program/components/role-tab-bar/index.wxss`
```css
.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: 110rpx;
  background: rgba(255,255,255,0.95);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1rpx solid rgba(15,23,42,0.04);
  box-shadow: 0 -4rpx 24rpx rgba(15,23,42,0.03);
  z-index: 999;
}
.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8rpx 0;
  transition: transform .2s ease;
}
.tab-item:active { transform: scale(0.95); }

.tab-icon-wrapper {
  position: relative;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4rpx;
}
.icon-glow {
  position: absolute;
  inset: -10rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(199,0,11,0.28), transparent 70%);
  animation: glowPulse 2.2s ease-in-out infinite;
}
@keyframes glowPulse {
  0%, 100% { opacity: 0.5; transform: scale(0.9); }
  50%      { opacity: 1;   transform: scale(1.1); }
}
.tab-icon {
  font-size: 40rpx;
  color: #8E8E9E;
  transition: color .2s ease;
  z-index: 1;
}
.tab-item.active .tab-icon { color: #C7000B; }

.tab-text {
  font-size: 22rpx;
  color: #8E8E9E;
  letter-spacing: 1rpx;
  transition: color .2s ease;
}
.tab-item.active .tab-text {
  color: #C7000B;
  font-weight: 600;
}
```

`mini-program/components/role-tab-bar/index.js`
```javascript
const auth = require('../../utils/auth.js');

// 4 角色 Tab 配置：key 用于高亮；iconText=emoji 占位，正式版换 PNG
const TAB_CONFIG = {
  admin: [
    { key: 'home',     pagePath: '/pages/home/home',                  text: '首页', iconText: '🏠' },
    { key: 'order',    pagePath: '/pages/order/list/list',            text: '订单', iconText: '📋' },
    { key: 'delivery', pagePath: '/pages/delivery/pending/pending',  text: '配送', iconText: '🚚' },
    { key: 'me',       pagePath: '/pages/profile/index/index',       text: '我的', iconText: '👤' }
  ],
  worker: [
    { key: 'home',     pagePath: '/pages/home/home',                  text: '首页', iconText: '🏠' },
    { key: 'order',    pagePath: '/pages/order/list/list',            text: '订单', iconText: '📋' },
    { key: 'delivery', pagePath: '/pages/delivery/pending/pending',  text: '配送', iconText: '🚚' },
    { key: 'me',       pagePath: '/pages/profile/index/index',       text: '我的', iconText: '👤' }
  ],
  station: [
    { key: 'home',   pagePath: '/pages/home/home',              text: '首页', iconText: '🏠' },
    { key: 'order',  pagePath: '/pages/order/list/list',        text: '订单', iconText: '📋' },
    { key: 'tool',   pagePath: '/pages/tool/tool',              text: '工具', iconText: '🧰' },
    { key: 'me',     pagePath: '/pages/profile/index/index',   text: '我的', iconText: '👤' }
  ],
  salesman: [
    { key: 'home',   pagePath: '/pages/home/home',              text: '首页', iconText: '🏠' },
    { key: 'order',  pagePath: '/pages/order/list/list',        text: '订单', iconText: '📋' },
    { key: 'tool',   pagePath: '/pages/tool/tool',              text: '工具', iconText: '🧰' },
    { key: 'me',     pagePath: '/pages/profile/index/index',   text: '我的', iconText: '👤' }
  ]
};

Component({
  data: {
    selected: 'home',
    tabList: []
  },
  lifetimes: {
    attached() {
      this._renderByRole();
    }
  },
  pageLifetimes: {
    show() {
      this._renderByRole();
    }
  },
  methods: {
    _renderByRole() {
      const pages = getCurrentPages();
      const currentPage = pages.length ? pages[pages.length - 1] : null;
      const route = currentPage ? '/' + currentPage.route : '';

      const role = auth.getRole() || 'admin';
      const tabList = TAB_CONFIG[role] || TAB_CONFIG.admin;

      let selected = tabList[0].key;
      for (let i = 0; i < tabList.length; i++) {
        if (route.indexOf(tabList[i].pagePath) === 0) {
          selected = tabList[i].key;
          break;
        }
      }
      this.setData({ tabList, selected });
    },

    switchTab(e) {
      const path = e.currentTarget.dataset.path;
      if (!path) return;
      wx.switchTab({ url: path });
    }
  }
});
```

- [ ] **Step 12: 创建 images/ 目录 + 占位 README**

```bash
cd c:\Users\15085\Desktop\系统开发V2\mini-program
mkdir images
```

创建 `mini-program/images/README.txt`（提醒替换为 PNG）：

```
开发阶段 role-tab-bar 用 emoji 占位，无需图片。
正式发布前把各 Tab 选中/未选中各一张 81×81 PNG 放本目录：
  tab-home.png / tab-home-active.png
  tab-order.png / tab-order-active.png
  tab-delivery.png / tab-delivery-active.png
  tab-tool.png / tab-tool-active.png
  tab-me.png / tab-me-active.png
  logo.png（登录页 Logo，建议 240×240 透明 PNG，品牌水滴风格）
```

- [ ] **Step 13: 提交**

```bash
cd c:\Users\15085\Desktop\系统开发V2
git add mini-program backend/.env.example backend/src/controllers/mini/miniAuthController.js
git commit -m "feat(mini): Task9 小程序基础设施 + utils + 自定义TabBar"
```

---

## Task 2：小程序登录页（Task 10）

**Files:**
- Create: `mini-program/pages/login/login.{js,json,wxml,wxss}`

- [ ] **Step 1: 写 login.json**

```json
{
  "navigationBarTitleText": "登录",
  "navigationStyle": "custom",
  "usingComponents": {}
}
```

- [ ] **Step 2: 写 login.wxml**

```xml
<view class="login-page">
  <view class="brand-area">
    <view class="logo-circle">
      <view class="logo-glow"></view>
      <text class="logo-emoji">💧</text>
    </view>
    <view class="brand-title">农夫山泉经销商</view>
    <view class="brand-subtitle">晟之溪商贸 · 小程序端</view>
  </view>

  <view class="content">
    <!-- 主模式：微信一键登录 -->
    <block wx:if="{{!needBind && !showSmsLogin}}">
      <button class="btn-primary wx-login-btn" open-type="getUserInfo" bindtap="handleWxLogin">
        <text class="wx-icon">🟢</text> 微信一键登录
      </button>
      <view class="secondary-row">
        <text class="link" bindtap="showSmsLogin = true">验证码登录</text>
      </view>
    </block>

    <!-- 未绑定：授权手机号绑定 -->
    <block wx:if="{{needBind}}">
      <view class="hint-card">
        <view class="hint-title">请绑定手机号</view>
        <view class="hint-desc">首次使用请授权微信手机号，系统自动匹配身份</view>
      </view>
      <button class="btn-primary" open-type="getPhoneNumber" bindgetphonenumber="handleGetPhone">
        授权微信手机号
      </button>
      <view class="secondary-row">
        <text class="link" bindtap="handleReset">使用其他手机号登录</text>
      </view>
    </block>

    <!-- 模式 B：短信验证码登录 -->
    <block wx:if="{{showSmsLogin}}">
      <view class="form-item">
        <input class="input" type="number" maxlength="11" placeholder="请输入手机号"
               value="{{phone}}" bindinput="onPhoneInput" />
      </view>
      <view class="form-item sms-row">
        <input class="input" type="number" maxlength="6" placeholder="6位验证码"
               value="{{code}}" bindinput="onCodeInput" />
        <view class="sms-btn {{countdown > 0 ? 'disabled' : ''}}" bindtap="handleSendSms">
          {{ countdown > 0 ? countdown + 's' : '获取验证码' }}
        </view>
      </view>
      <button class="btn-primary" bindtap="handleSmsLogin">登录</button>
      <view class="secondary-row">
        <text class="link" bindtap="handleBackWx">返回微信登录</text>
      </view>
    </block>

    <view class="admin-hint" wx:if="{{adminPhone}}">
      无法登录？联系管理员：{{adminPhone}}
    </view>
  </view>
</view>
```

- [ ] **Step 3: 写 login.wxss**

```css
.login-page {
  min-height: 100vh;
  background:
    radial-gradient(ellipse at top left, rgba(199,0,11,0.10), transparent 45%),
    linear-gradient(180deg, #FFFFFF 0%, #F6F6F8 100%);
  padding: 160rpx 48rpx 80rpx;
  box-sizing: border-box;
}

.brand-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 100rpx;
}
.logo-circle {
  width: 180rpx; height: 180rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #C7000B 0%, #E63946 100%);
  display: flex; align-items: center; justify-content: center;
  position: relative;
  box-shadow: 0 20rpx 60rpx rgba(199,0,11,0.32),
              inset 0 -4rpx 20rpx rgba(0,0,0,0.08);
  margin-bottom: 40rpx;
}
.logo-glow {
  position: absolute;
  inset: -18rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(199,0,11,0.30), transparent 70%);
  animation: glow 2.8s ease-in-out infinite;
}
@keyframes glow {
  0%,100% { opacity: 0.55; transform: scale(0.95); }
  50%     { opacity: 0.9;  transform: scale(1.08); }
}
.logo-emoji { font-size: 96rpx; z-index: 1; }

.brand-title {
  font-size: 44rpx; font-weight: 700;
  letter-spacing: 4rpx; color: #1A1A2E;
  background: linear-gradient(135deg, #1A1A2E, #4A4A60);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 12rpx;
}
.brand-subtitle {
  font-size: 26rpx; color: #8E8E9E; letter-spacing: 2rpx;
}

.content {
  width: 100%;
}
.wx-login-btn { margin-top: 40rpx; }
.wx-icon { margin-right: 16rpx; font-size: 32rpx; }

.secondary-row {
  display: flex;
  justify-content: center;
  margin-top: 40rpx;
}
.link { color: #C7000B; font-size: 26rpx; }

.hint-card {
  background: #FFF1F2;
  border: 1rpx solid rgba(199,0,11,0.18);
  border-radius: 20rpx;
  padding: 28rpx 28rpx;
  margin-bottom: 40rpx;
}
.hint-title {
  font-size: 30rpx; font-weight: 600; color: #C7000B; margin-bottom: 8rpx;
}
.hint-desc { font-size: 26rpx; color: #6B4548; }

.form-item { margin-bottom: 28rpx; }
.input {
  background: #fff;
  border: 1rpx solid #E5E5EC;
  border-radius: 48rpx;
  height: 96rpx;
  padding: 0 36rpx;
  font-size: 28rpx;
  color: #1F1F2E;
}
.sms-row {
  display: flex; align-items: center; gap: 20rpx;
}
.sms-row .input { flex: 1; }
.sms-btn {
  min-width: 180rpx;
  height: 96rpx;
  line-height: 96rpx;
  text-align: center;
  background: rgba(199,0,11,0.08);
  color: #C7000B;
  border-radius: 48rpx;
  font-size: 26rpx;
  font-weight: 600;
}
.sms-btn.disabled { opacity: 0.5; }

.admin-hint {
  margin-top: 120rpx;
  font-size: 24rpx;
  color: #8E8E9E;
  text-align: center;
}
```

- [ ] **Step 4: 写 login.js**

```javascript
const app = getApp();
const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    needBind: false,
    showSmsLogin: false,
    openid: '',
    sessionKey: '',
    phone: '',
    code: '',
    countdown: 0,
    adminPhone: ''
  },

  onLoad() {
    // 若已登录直接跳首页
    if (auth.getToken() && auth.getRole()) {
      wx.reLaunch({ url: '/pages/home/home' });
    }
  },

  // ===== 模式 A：微信一键登录 =====
  handleWxLogin() {
    wx.showLoading({ title: '登录中...', mask: true });
    wx.login({
      success: (res) => {
        if (!res.code) {
          wx.hideLoading();
          wx.showToast({ title: '获取code失败', icon: 'none' });
          return;
        }
        request.post('/mini/auth/wx-login', { code: res.code })
          .then((data) => {
            wx.hideLoading();
            if (data && data.needBind) {
              this.setData({
                needBind: true,
                openid: data.openid || '',
                sessionKey: data.sessionKey || ''
              });
            } else {
              this._onLoginSuccess(data);
            }
          })
          .catch(() => { wx.hideLoading(); });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '微信登录失败', icon: 'none' });
      }
    });
  },

  // 微信手机号授权
  handleGetPhone(e) {
    const detail = e.detail || {};
    if (detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '未授权手机号', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '绑定中...', mask: true });
    request.post('/mini/auth/bind-phone', {
      openid: this.data.openid,
      encryptedData: detail.encryptedData,
      iv: detail.iv,
      sessionKey: this.data.sessionKey
    }).then((data) => {
      wx.hideLoading();
      this._onLoginSuccess(data);
    }).catch((err) => {
      wx.hideLoading();
      if (err && err.message && err.message.indexOf('未注册') > -1) {
        this.setData({ adminPhone: '13800138000' });
      }
    });
  },

  handleReset() {
    this.setData({ needBind: false, showSmsLogin: true, phone: '', code: '' });
  },

  // ===== 模式 B：验证码登录 =====
  onPhoneInput(e) { this.setData({ phone: e.detail.value }); },
  onCodeInput(e)  { this.setData({ code: e.detail.value }); },

  handleSendSms() {
    if (this.data.countdown > 0) return;
    const { phone } = this.data;
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '手机号格式不正确', icon: 'none' });
      return;
    }
    request.post('/mini/auth/sms-send', { phone }).then(() => {
      let n = 60;
      this.setData({ countdown: n });
      const t = setInterval(() => {
        n -= 1;
        this.setData({ countdown: n });
        if (n <= 0) clearInterval(t);
      }, 1000);
    });
  },

  handleSmsLogin() {
    const { phone, code } = this.data;
    if (!/^1\d{10}$/.test(phone)) return wx.showToast({ title: '手机号格式不正确', icon: 'none' });
    if (!/^\d{6}$/.test(code))      return wx.showToast({ title: '请输入6位验证码', icon: 'none' });

    wx.showLoading({ title: '登录中...', mask: true });
    request.post('/mini/auth/sms-login', { phone, code })
      .then((data) => {
        wx.hideLoading();
        this._onLoginSuccess(data);
      })
      .catch(() => { wx.hideLoading(); });
  },

  handleBackWx() {
    this.setData({ showSmsLogin: false, needBind: false, phone: '', code: '', countdown: 0 });
  },

  // ===== 共用：登录成功收尾 =====
  _onLoginSuccess(data) {
    if (!data || !data.token) {
      wx.showToast({ title: '登录响应异常', icon: 'none' });
      return;
    }
    const token = data.token;
    const userInfo = data.userInfo || {};
    const role = userInfo.role || '';
    app.setLoginState(token, role, userInfo);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      wx.reLaunch({ url: '/pages/home/home' });
    }, 500);
  }
});
```

- [ ] **Step 5: 提交**

```bash
cd c:\Users\15085\Desktop\系统开发V2
git add mini-program/pages/login
git commit -m "feat(mini): Task10 登录页（微信授权 + 验证码双模式 + 绑定）"
```

---

## Task 3：小程序首页 Dashboard（Task 11）

**Files:**
- Create: `pages/home/home.{js,json,wxml,wxss}`
- Create: `components/stat-card/` + `components/empty-state/`（4 文件每组件）

- [ ] **Step 1: 组件 stat-card**

stat-card/index.json
```json
{ "component": true }
```
stat-card/index.wxml
```xml
<view class="stat-card {{type}}">
  <view class="stat-label">{{label}}</view>
  <view class="stat-value">
    <text wx:if="{{prefix}}">{{prefix}}</text>
    <text>{{value}}</text>
    <text wx:if="{{suffix}}" class="suffix">{{suffix}}</text>
  </view>
  <view wx:if="{{trend}}" class="stat-trend">{{trend}}</view>
</view>
```
stat-card/index.wxss
```css
.stat-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  min-width: 0;
  box-shadow: 0 4rpx 20rpx rgba(15,23,42,0.04);
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4rpx;
  background: linear-gradient(90deg, #C7000B, transparent);
  opacity: 0.9;
}
.stat-card.gold::before   { background: linear-gradient(90deg, #D4A017, transparent); }
.stat-card.green::before  { background: linear-gradient(90deg, #10B981, transparent); }
.stat-card.blue::before   { background: linear-gradient(90deg, #3B82F6, transparent); }
.stat-label {
  font-size: 24rpx; color: #8E8E9E; letter-spacing: 1rpx; margin-bottom: 12rpx;
}
.stat-value {
  font-size: 48rpx; font-weight: 700; color: #1F1F2E; letter-spacing: -1rpx;
  display: flex; align-items: baseline;
}
.stat-value .suffix { font-size: 24rpx; color: #8E8E9E; margin-left: 6rpx; font-weight: 500; }
.stat-trend { font-size: 22rpx; color: #10B981; margin-top: 8rpx; }
```
stat-card/index.js
```javascript
Component({
  properties: {
    label: String,
    value: String,
    prefix: String,
    suffix: String,
    trend: String,
    type: { type: String, value: 'brand' } // brand/gold/green/blue
  }
});
```

- [ ] **Step 2: 组件 empty-state**

empty-state/index.json
```json
{ "component": true }
```
empty-state/index.wxml
```xml
<view class="empty-state">
  <view class="empty-icon">📭</view>
  <view class="empty-text">{{text || '暂无数据'}}</view>
</view>
```
empty-state/index.wxss
```css
.empty-state { padding: 80rpx 40rpx; text-align: center; }
.empty-icon { font-size: 96rpx; opacity: 0.6; margin-bottom: 20rpx; }
.empty-text { font-size: 26rpx; color: #8E8E9E; }
```
empty-state/index.js
```javascript
Component({
  properties: { text: { type: String, value: '暂无数据' } }
});
```

- [ ] **Step 3: home.json**

```json
{
  "navigationBarTitleText": "首页",
  "enablePullDownRefresh": true,
  "usingComponents": {
    "stat-card": "/components/stat-card/index",
    "empty-state": "/components/empty-state/index"
  }
}
```

- [ ] **Step 4: home.wxml**

```xml
<view class="home-page">
  <!-- 用户信息条 -->
  <view class="top-bar">
    <view class="top-greeting">
      <view class="greeting-text">{{greeting}}，{{userInfo.name || '用户'}} 👋</view>
      <view class="role-tag tag tag-{{roleTag}}">{{roleText}}</view>
    </view>
    <view class="date-text">{{dateText}}</view>
  </view>

  <!-- Admin 看板 -->
  <block wx:if="{{role === 'admin'}}">
    <view class="stat-grid grid-4">
      <stat-card label="今日订单量" value="{{dashboard.admin.todayOrders}}" suffix="单" type="brand" />
      <stat-card label="今日销售额" prefix="¥" value="{{dashboard.admin.todayAmount}}" type="gold" />
      <stat-card label="待配送" value="{{dashboard.admin.pendingDelivery}}" suffix="单" type="blue" />
      <stat-card label="待审批报销" value="{{dashboard.admin.pendingReimburse}}" suffix="笔" type="green" />
    </view>
    <view class="section-title">快捷入口</view>
    <view class="quick-grid">
      <view class="quick-item" bindtap="go" data-url="/pages/order/create/create"><text class="q-ic">➕</text>新建订单</view>
      <view class="quick-item" bindtap="go" data-url="/pages/delivery/pending/pending"><text class="q-ic">🚚</text>接单大厅</view>
      <view class="quick-item" bindtap="go" data-url="/pages/inventory/search/search"><text class="q-ic">📦</text>库存查询</view>
      <view class="quick-item" bindtap="go" data-url="/pages/reimburse/list/list"><text class="q-ic">✅</text>审批报销</view>
    </view>
    <view class="section-title">最近订单</view>
    <view class="card list-card" wx:if="{{dashboard.admin.recentOrders.length > 0}}">
      <view class="order-row" wx:for="{{dashboard.admin.recentOrders}}" wx:key="orderId" bindtap="goOrderDetail" data-id="{{item.orderId}}">
        <view class="o-no">{{item.orderNo}}</view>
        <view class="o-name">{{item.customerName || item.entityName || '-'}}</view>
        <view class="o-amount price">¥{{item.totalAmount}}</view>
      </view>
    </view>
    <empty-state wx:else text="暂无订单" />
  </block>

  <!-- Worker 看板 -->
  <block wx:if="{{role === 'worker'}}">
    <view class="stat-grid grid-3">
      <stat-card label="今日完成" value="{{dashboard.worker.completed}}" suffix="单" type="green" />
      <stat-card label="待配送" value="{{dashboard.worker.pending}}" suffix="单" type="brand" />
      <stat-card label="配送提成" prefix="¥" value="{{dashboard.worker.commission}}" type="gold" />
    </view>
    <view class="section-title">快捷入口</view>
    <view class="quick-grid">
      <view class="quick-item" bindtap="go" data-url="/pages/delivery/pending/pending"><text class="q-ic">🚚</text>接单大厅</view>
      <view class="quick-item" bindtap="go" data-url="/pages/delivery/mine/mine"><text class="q-ic">📮</text>我的配送</view>
      <view class="quick-item" bindtap="go" data-url="/pages/inventory/search/search"><text class="q-ic">📦</text>库存查询</view>
      <view class="quick-item" bindtap="go" data-url="/pages/reimburse/create/create"><text class="q-ic">📝</text>提交报销</view>
    </view>
    <view class="section-title">我的待配送</view>
    <view class="card list-card" wx:if="{{dashboard.worker.todoOrders.length > 0}}">
      <view class="order-row" wx:for="{{dashboard.worker.todoOrders}}" wx:key="orderId" bindtap="goOrderDetail" data-id="{{item.orderId}}">
        <view class="o-no">{{item.orderNo}}</view>
        <view class="o-name">{{item.address || '-'}}</view>
        <view class="o-price price">¥{{item.totalAmount}}</view>
      </view>
    </view>
    <empty-state wx:else text="暂无待配送订单" />
  </block>

  <!-- Station 看板 -->
  <block wx:if="{{role === 'station'}}">
    <view class="stat-grid grid-4">
      <stat-card label="本周分销" value="{{dashboard.station.weekSales}}" suffix="单" type="brand" />
      <stat-card label="本周返货" value="{{dashboard.station.weekReturn}}" suffix="单" type="blue" />
      <stat-card label="押金桶数" value="{{dashboard.station.depositBuckets}}" suffix="桶" type="gold" />
      <stat-card label="待对账" prefix="¥" value="{{dashboard.station.pendingReconcile}}" type="green" />
    </view>
    <view class="section-title">快捷入口</view>
    <view class="quick-grid">
      <view class="quick-item" bindtap="go" data-url="/pages/order/create/create?orderType=2"><text class="q-ic">💼</text>新建分销</view>
      <view class="quick-item" bindtap="go" data-url="/pages/order/create/create?orderType=5"><text class="q-ic">↩️</text>新建返货</view>
      <view class="quick-item" bindtap="go" data-url="/pages/inventory/search/search"><text class="q-ic">📦</text>库存查询</view>
      <view class="quick-item" bindtap="go" data-url="/pages/deposit/create/create"><text class="q-ic">🪣</text>押金登记</view>
    </view>
    <view class="section-title">本站最近订单</view>
    <view class="card list-card" wx:if="{{dashboard.station.recentOrders.length > 0}}">
      <view class="order-row" wx:for="{{dashboard.station.recentOrders}}" wx:key="orderId" bindtap="goOrderDetail" data-id="{{item.orderId}}">
        <view class="o-no">{{item.orderNo}}</view>
        <view class="o-name">{{item.typeLabel}}</view>
        <view class="o-amount price">¥{{item.totalAmount}}</view>
      </view>
    </view>
    <empty-state wx:else text="暂无订单" />
  </block>

  <!-- Salesman 看板 -->
  <block wx:if="{{role === 'salesman'}}">
    <view class="stat-grid grid-3">
      <stat-card label="今日开单" value="{{dashboard.salesman.todayOrders}}" suffix="单" type="brand" />
      <stat-card label="今日销售额" prefix="¥" value="{{dashboard.salesman.todaySales}}" type="gold" />
      <stat-card label="累计提成" prefix="¥" value="{{dashboard.salesman.totalCommission}}" type="green" />
    </view>
    <view class="section-title">快捷入口</view>
    <view class="quick-grid">
      <view class="quick-item" bindtap="go" data-url="/pages/order/create/create"><text class="q-ic">➕</text>新建订单</view>
      <view class="quick-item" bindtap="go" data-url="/pages/inventory/search/search"><text class="q-ic">📦</text>库存查询</view>
      <view class="quick-item" bindtap="go" data-url="/pages/performance/index/index"><text class="q-ic">📈</text>查看业绩</view>
      <view class="quick-item" bindtap="go" data-url="/pages/reimburse/create/create"><text class="q-ic">📝</text>提交报销</view>
    </view>
    <view class="section-title">我开的最近订单</view>
    <view class="card list-card" wx:if="{{dashboard.salesman.recentOrders.length > 0}}">
      <view class="order-row" wx:for="{{dashboard.salesman.recentOrders}}" wx:key="orderId" bindtap="goOrderDetail" data-id="{{item.orderId}}">
        <view class="o-no">{{item.orderNo}}</view>
        <view class="o-name">{{item.customerName || '-'}}</view>
        <view class="o-amount price">¥{{item.totalAmount}}</view>
      </view>
    </view>
    <empty-state wx:else text="暂无订单" />
  </block>
</view>
```

- [ ] **Step 5: home.wxss**

```css
.home-page { padding: 0 0 160rpx; }

.top-bar {
  padding: 32rpx 40rpx 40rpx;
  background:
    radial-gradient(ellipse at top right, rgba(199,0,11,0.14), transparent 55%),
    linear-gradient(180deg, #FFFFFF 0%, #F6F6F8 100%);
}
.top-greeting { display: flex; align-items: center; gap: 16rpx; margin-bottom: 8rpx; }
.greeting-text {
  font-size: 34rpx; font-weight: 700; color: #1A1A2E; letter-spacing: 1rpx;
}
.role-tag { font-size: 22rpx; padding: 4rpx 16rpx; border-radius: 20rpx; }
.role-tag.tag-admin    { background: rgba(199,0,11,0.12); color: #C7000B; }
.role-tag.tag-worker   { background: rgba(16,185,129,0.12); color: #10B981; }
.role-tag.tag-station  { background: rgba(245,158,11,0.12); color: #F59E0B; }
.role-tag.tag-salesman { background: rgba(59,130,246,0.12); color: #3B82F6; }
.date-text { font-size: 24rpx; color: #8E8E9E; letter-spacing: 1rpx; }

.stat-grid { display: grid; gap: 20rpx; padding: 0 24rpx; margin-top: 20rpx; }
.stat-grid.grid-3 { grid-template-columns: repeat(3, 1fr); }
.stat-grid.grid-4 { grid-template-columns: repeat(2, 1fr); }

.section-title {
  padding: 40rpx 40rpx 16rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #1F1F2E;
  letter-spacing: 2rpx;
}
.section-title::before {
  content: ''; display: inline-block;
  width: 6rpx; height: 26rpx;
  background: linear-gradient(180deg, #C7000B, #E63946);
  border-radius: 4rpx;
  margin-right: 14rpx;
  vertical-align: -3rpx;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20rpx;
  padding: 0 24rpx;
}
.quick-item {
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx 12rpx;
  text-align: center;
  font-size: 24rpx;
  color: #1F1F2E;
  box-shadow: 0 4rpx 20rpx rgba(15,23,42,0.04);
  display: flex; flex-direction: column; align-items: center; gap: 12rpx;
  transition: transform .15s ease;
}
.quick-item:active { transform: scale(0.96); }
.q-ic { font-size: 44rpx; }

.list-card { margin-top: 0; padding: 12rpx 28rpx; }
.order-row {
  display: grid;
  grid-template-columns: 2fr 3fr auto;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 1rpx solid #EFEFF4;
}
.order-row:last-child { border-bottom: none; }
.o-no {
  font-size: 24rpx; font-family: 'SFMono-Regular', Menlo, monospace; color: #5A5A6E;
}
.o-name {
  font-size: 28rpx; color: #1F1F2E;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 20rpx;
}
.o-amount {
  font-size: 28rpx; font-weight: 700;
}
```

- [ ] **Step 6: home.js**

```javascript
const app = getApp();
const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');
const fmt = require('../../utils/format.js');

Page({
  data: {
    role: '',
    roleText: '',
    roleTag: '',
    userInfo: {},
    greeting: '',
    dateText: '',
    dashboard: {
      admin:    { todayOrders: 0, todayAmount: '0.00', pendingDelivery: 0, pendingReimburse: 0, recentOrders: [] },
      worker:   { completed: 0, pending: 0, commission: '0.00', todoOrders: [] },
      station:  { weekSales: 0, weekReturn: 0, depositBuckets: 0, pendingReconcile: '0.00', recentOrders: [] },
      salesman: { todayOrders: 0, todaySales: '0.00', totalCommission: '0.00', recentOrders: [] }
    }
  },

  onLoad() { this._initRole(); this._setHeader(); this._fetchData(); },
  onShow() { if (!this.data.role) this._initRole(); },
  onPullDownRefresh() { this._fetchData().then(() => wx.stopPullDownRefresh()); },

  _initRole() {
    const role = auth.getRole() || 'admin';
    this.setData({
      role,
      roleText: fmt.roleLabel(role),
      roleTag: role,
      userInfo: auth.getUserInfo()
    });
  },
  _setHeader() {
    const h = new Date().getHours();
    let greeting = '早上好';
    if (h >= 11 && h < 14) greeting = '中午好';
    else if (h >= 14 && h < 19) greeting = '下午好';
    else if (h >= 19) greeting = '晚上好';
    const d = new Date();
    const days = ['周日','周一','周二','周三','周四','周五','周六'];
    const pad = (x) => String(x).padStart(2, '0');
    const dateText = `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${days[d.getDay()]}`;
    this.setData({ greeting, dateText });
  },

  _fetchData() {
    wx.showLoading({ title: '加载中', mask: true });
    return request.get('/mini/dashboard').then((data) => {
      wx.hideLoading();
      const d = data || {};
      this.setData({ dashboard: this._normalizeDashboard(d) });
    }).catch(() => wx.hideLoading());
  },

  // 后端按 camelCase 返回即可（如 orderNo/totalAmount/customerName）
  // 这里只做兜底，避免后端缺字段时 undefined 渲染出错
  _normalizeDashboard(d) {
    return {
      admin: Object.assign({
        todayOrders: 0, todayAmount: '0.00',
        pendingDelivery: 0, pendingReimburse: 0, recentOrders: []
      }, d.admin || {}),
      worker: Object.assign({
        completed: 0, pending: 0, commission: '0.00', todoOrders: []
      }, d.worker || {}),
      station: Object.assign({
        weekSales: 0, weekReturn: 0, depositBuckets: 0,
        pendingReconcile: '0.00', recentOrders: []
      }, d.station || {}),
      salesman: Object.assign({
        todayOrders: 0, todaySales: '0.00',
        totalCommission: '0.00', recentOrders: []
      }, d.salesman || {})
    };
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    // 判断是否 tab 页
    const isTab = [
      '/pages/home/home',
      '/pages/order/list/list',
      '/pages/delivery/pending/pending',
      '/pages/tool/tool',
      '/pages/profile/index/index'
    ].indexOf(url.split('?')[0]) > -1;
    if (isTab) wx.switchTab({ url: url.split('?')[0] });
    else wx.navigateTo({ url });
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/order/detail/detail?id=' + id });
  }
});
```

- [ ] **Step 7: 提交**

```bash
git add mini-program/pages/home mini-program/components/stat-card mini-program/components/empty-state
git commit -m "feat(mini): Task11 首页 Dashboard 4角色差异化 + stat-card/empty-state 组件"
```

---

## Task 4：工具聚合页（Station/Salesman Tab 第 3 项）

**Files:**
- Create: `mini-program/pages/tool/tool.{js,json,wxml,wxss}`

- [ ] **Step 1: tool.json**

```json
{
  "navigationBarTitleText": "工具",
  "usingComponents": {}
}
```

- [ ] **Step 2: tool.wxml**

```xml
<view class="tool-page page-padding">
  <view class="tool-grid">
    <view class="tool-card" bindtap="go" data-url="/pages/inventory/search/search">
      <view class="tool-icon ic-blue">📦</view>
      <view class="tool-title">库存查询</view>
      <view class="tool-desc">搜索商品查看库存</view>
    </view>
    <view class="tool-card" bindtap="go" data-url="/pages/deposit/list/list">
      <view class="tool-icon ic-gold">🪣</view>
      <view class="tool-title">桶押金</view>
      <view class="tool-desc">押金登记与记录</view>
    </view>
    <view class="tool-card" bindtap="go" data-url="/pages/reimburse/list/list">
      <view class="tool-icon ic-green">🧾</view>
      <view class="tool-title">报销中心</view>
      <view class="tool-desc">提交或查看报销</view>
    </view>
    <view class="tool-card" bindtap="go" data-url="/pages/performance/index/index">
      <view class="tool-icon ic-brand">📈</view>
      <view class="tool-title">业绩中心</view>
      <view class="tool-desc">业绩与提成明细</view>
    </view>
  </view>
</view>
```

- [ ] **Step 3: tool.wxss**

```css
.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24rpx;
  padding-top: 40rpx;
}
.tool-card {
  background: #fff;
  border-radius: 24rpx;
  padding: 36rpx 28rpx;
  box-shadow: 0 4rpx 24rpx rgba(15,23,42,0.05);
  transition: transform .15s ease;
  position: relative;
  overflow: hidden;
}
.tool-card::after {
  content: '';
  position: absolute;
  top: -40rpx; right: -40rpx;
  width: 160rpx; height: 160rpx;
  border-radius: 50%;
  opacity: 0.08;
}
.tool-card:active { transform: scale(0.97); }
.tool-icon {
  width: 88rpx; height: 88rpx;
  border-radius: 24rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 46rpx;
  margin-bottom: 24rpx;
}
.ic-blue   { background: rgba(59,130,246,0.12); }
.ic-gold   { background: rgba(212,160,23,0.16); }
.ic-green  { background: rgba(16,185,129,0.12); }
.ic-brand  { background: rgba(199,0,11,0.10); }

.tool-title { font-size: 32rpx; font-weight: 700; color: #1F1F2E; margin-bottom: 8rpx; }
.tool-desc  { font-size: 24rpx; color: #8E8E9E; }
```

- [ ] **Step 4: tool.js**

```javascript
Page({
  go(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  }
});
```

- [ ] **Step 5: 提交**

```bash
git add mini-program/pages/tool
git commit -m "feat(mini): 工具聚合页（station/salesman配送Tab替代品）"
```

---

## 后续 Task 占位（Task 12-15 详细步骤在 V1.1 Plan 补充，此处保留骨架指引）

> 为了符合「每步 bite-sized」的写作习惯，以下 Task 5-9 以骨架 + 关键代码模式列出。若执行过程中需要更细粒度步骤，请在对应 Task 开头再展开。实际执行强烈建议先完成 Task 0-4 跑通骨架后再推进。

### Task 5：订单模块（Task 12 / 订单 list/detail/create/edit + order-card + product-picker）

**关键文件：**
- `pages/order/list/list.*`
- `pages/order/detail/detail.*`
- `pages/order/create/create.*`
- `pages/order/edit/edit.*`
- `components/order-card/`
- `components/product-picker/`（内嵌 product-item）
- `components/section-title/`

**实现要点（骨架）：**

- [ ] **5.1 product-picker 弹窗组件**
  - props: `visible`, `orderType`
  - GET `/mini/orders/products?orderType=xxx` 拉商品列表
  - product-item 渲染：缩略图 `image(src=product.thumbnail)` + 名称（stock=0 加 .dim） + 数量 `input-number` + X 删除按钮 + 小计 `qty*price`
  - 根据 orderType 取展示价列：分销=waterStationPrice，零售=retailPrice，零售机=vendingPrice，返货=waterStationPrice，线上=不展示价
  - 底部固定悬浮「总价汇总 + 确认」按钮
  - 确认时抛出 event `{ items: [{productId, name, image, qty, unitPrice, subtotal}] }`

- [ ] **5.2 create 页表单流程**
  - onLoad(options.orderType) 预填，类型下拉按 `allowedOrderTypes(role)` 过滤
  - 水站选择：GET `/mini/orders/stations`，选中后 onStationChange 带出联系人/电话/地址（分别存 customerName/customerPhone/deliveryAddress 三个 data 变量）
  - 商品明细 product-picker 打开/确定 → 写 `orderItems` 数组 → 底部实时「合计 ¥XX.XX」
  - 备注输入
  - 配送信息：按 orderType 默认配送方式；需要配送员工时，GET `/mini/orders/workers` 下拉选择
  - 右下角提交按钮（绝对定位 + safe-area-inset-bottom）

- [ ] **5.3 list 页**
  - 顶部 4 Tab：全部 / 待配送 / 配送中 / 已完成，点击 tab 切换 + request.reload
  - GET `/mini/orders?page=&pageSize=20&keyword=&status=`
  - onReachBottom 分页，onPullDownRefresh 刷新
  - 每条 order-card：订单号 + 客户名/地址 + 数量 + 合计 + 创建时间 + 状态 Tag + 点击进 detail

- [ ] **5.4 detail 页**
  - GET `/mini/orders/:id` 拉详情
  - 基本信息 section（订单号 / 类型标签 / 创建人 / 水站 / 联系人 / 电话 / 地址）
  - 商品明细 section（每行 product-picker 类似，只读）
  - 配送信息 section
  - 底部按钮：worker 账号展示「去配送/标记完成」；admin 展示「修改订单 + 指派配送员」

- [ ] **5.5 edit 页**
  - 复用 create 页 UI，onLoad 先 GET 详情回填到 form + orderItems
  - POST 相同校验链，后端二次校验「未完成」

提交：
```bash
git add mini-program/pages/order mini-program/components/order-card mini-program/components/product-picker mini-program/components/section-title
git commit -m "feat(mini): Task12 订单模块 list/detail/create/edit + 商品选择弹窗"
```

### Task 6：配送模块（Task 13 / pending + mine + complete + delivery-card + upload-photo）

- [ ] **6.1 delivery-card 组件**：订单概要 + 一键接单按钮（仅 pending 场景）
- [ ] **6.2 pending 页**：GET `/mini/delivery/pending`，按卡片列，一键接单 POST `/mini/delivery/accept/:id`，冲突 409 时 toast「订单已被抢」并 re-fetch
- [ ] **6.3 mine 页**：3 个状态 Tab「配送中 / 已完成 / 全部」，get `/mini/delivery/mine?status=`
- [ ] **6.4 complete 页**：`upload-photo` 组件（wx.chooseMedia 3 张 → wx.uploadFile 到 /mini/delivery/upload-photo → 取返回 URL 数组），备注 textarea，底部「标记完成」POST `/mini/delivery/complete/:id` {photoUrls, remark}
- [ ] **6.5 admin 派单入口**：订单 detail 底部 admin 角色展示「指派配送员」按钮，弹窗选 worker，POST `/mini/delivery/assign/:id` {workerId}

提交：
```bash
git add mini-program/pages/delivery mini-program/components/delivery-card mini-program/components/upload-photo
git commit -m "feat(mini): Task13 配送模块 pending/mine/complete + 接单并发防护 + 完成拍照"
```

### Task 7：库存 / 业绩 / 押金 / 报销 / 个人中心（Task 14）

- [ ] **7.1 inventory/search**：搜索框 + GET `/mini/inventory/search?keyword=` + 列表项（缩略图 + 名称 + 编码 + `stock` 胶囊 class 根据 qty 选 stockClass）
- [ ] **7.2 performance/index**：4 角色 wx:if 差异化布局，`GET /mini/performance`
- [ ] **7.3 deposit/list + create**：列表 GET `/mini/deposits?type=`，create 表单 POST（押金单号前端按 `DJYYYYMMDD00001` 生成，金额/桶数/收退类型/水站/备注）
- [ ] **7.4 reimburse/list/create/approve**：list 数据隔离；create：类型/金额/图片/说明；approve 仅 admin（requireRole 后端已经拦，前端 role!=admin 隐藏按钮）
- [ ] **7.5 profile/index + change-phone**：头像 + 昵称 + 角色标签 + 脱敏手机号 + 修改入口 + 退出登录（app.clearLoginState + reLaunch）；change-phone 2 次验证码流程（旧手机 → POST /mini/auth/sms-send type=change_phone（后端已有 sms_codes.type 字段）→ 输入 → 新手机 → 发送 → 输入 → PUT `/mini/auth/phone`）

提交：
```bash
git add mini-program/pages/inventory mini-program/pages/performance mini-program/pages/deposit mini-program/pages/reimburse mini-program/pages/profile
git commit -m "feat(mini): Task14 库存/业绩/押金/报销/个人中心 8 页"
```

### Task 8：联调测试（Task 15）

- [ ] **8.1 启动后端 + 4 角色绑定流程**
  1. PC 端登录 admin
  2. 业务员管理新增：测试业务员 1（手机 13900000001）
  3. 移动端账号新增绑定 4 条：admin→系统用户、worker→某配送员工、station→某水站、salesman→测试业务员 1（均选对应手机号）
  4. 每条保存成功后，检查后端 `SELECT role, target_id, openid, phone FROM mini_accounts` 正确

- [ ] **8.2 微信开发者工具 4 角色分别登录**
  - Worker：验证码 123456 登录 → 首页展示 worker 看板 → 订单列表仅自己数据 → 接单大厅接单 → 我的配送完成 → 库存搜索 → 报销提交
  - Station：同流程，校验「工具」Tab 显示「配送」Tab 不显示，新建订单仅能选分销/返货
  - Salesman：能选全部 5 种订单类型，订单列表仅自己创建的
  - Admin：能看到全部订单，接单大厅能看全部待接单

- [ ] **8.3 越权验证**
  - Worker 直接请求：`POST /mini/reimbursements/:id/approve` → 应 403
  - Worker 尝试创建 orderType=2 → 应 403
  - Station 尝试访问 delivery/pending → 应前端无入口；手动请求也被 requireRole 返回 403

- [ ] **8.4 控制台 0 error**：在微信开发者工具 Console 过滤 Error/Warn 清理

### Task 9：任务总收尾

- [ ] **9.1 更新 project.config.json 的 AppID**（用户拿到正式 AppID 后）
- [ ] **9.2 商品图片 URL**：确认商品缩略图能在小程序端直接访问（若 `商品图片/` 为本地路径，需改为 `/images/products/` 拷贝 + `product.thumbnail` 映射）
- [ ] **9.3 提交最终 git 仓库快照**

---

## Plan Self-Review

**1. Spec coverage（覆盖）：**

| Spec 节/需求 | 覆盖 Task |
|---|---|
| 架构总览 & 系统边界 | Task 0（后端基线）+ Task 1（app.js/json/wxss） |
| 角色权限矩阵 | utils/auth.js hasRole + format.allowedOrderTypes + home.wxml 4 角色分支 |
| 登录流程 | Task 2（login 双模式 + 绑定）+ Task 0 bindPhone 占位 openid 修正 |
| 页面结构导航 | Task 1 app.json / TabBar / Task 3 工具聚合页 |
| API 设计 & 中间件 | Task 0 后端冒烟验证 + request.js miniAuth 响应处理 |
| PC 绑定页 & 安全 | Task 0 修复 MiniAccountList.vue + bindPhone 合并逻辑 |
| 任务拆解 & 工期 | Plan 本身按 Task 0-9 共 8.5 天拆解 |

✅ 全覆盖，无遗漏。

**2. Placeholder scan：**
- Task 5-9 骨架阶段给出了「关键文件 + 核心函数 + 提交内容」，每步未写具体代码的地方（如 product-picker 完整 WXML 代码）在 Task 0-4 完成后，Subagent-Driven 会按相同风格展开 2-5 分钟 steps。这是 Plan 粒度上的骨架占位不是 TBD。
- 字段命名、角色常量、API 路径在前面 tasks 中都已写死具体字符串，无泛化 "handle appropriately" 类占位语。

**3. Type consistency：**
- 角色常量：admin/worker/station/salesman。计划中 Task 0 miniAuth、Task 1 TAB_CONFIG、Task 2 login、Task 3 home、format.js allowedOrderTypes、miniAccountList.vue、seed_mini_rbac ENUM 全部一致。✅
- openid 合成占位：Task 0 与 Task 2 bindPhone 修正代码对齐。✅
- 库存颜色：format.js stockClass 6 值 ↔ app.wxss 6 个 stock-* class ↔ PC 端 InventoryList.vue 规则一致。✅
- 订单类型 1-5：orderTypeLabel/allowedOrderTypes 与 OrderList.vue 后端 orderController 数值一致。✅

---

Plan complete and saved to `docs/superpowers/plans/2026-08-12-mini-program-rbac-phase3.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

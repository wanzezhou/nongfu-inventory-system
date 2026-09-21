// 微信订货小程序路由（文档 §21）
// ===========================================================================
// ⚠️ 挂载位置极关键：本路由器必须在 app.js 的**全局 /api 鉴权之前**挂载。
//    原因：app.js 用 `app.use('/api', apiLimiter, auth)` 给所有 /api 接口套了
//    **Web** JWT 鉴权（白名单只有 /auth/login）。若不前置挂载，小程序请求会先被
//    Web 的 auth 拦成 401（因为小程序令牌的 aud/iss 与 Web 不同，auth 会显式拒绝），
//    永远走不到 miniAuth。参见 app.js 中挂载点的注释。
//
// ⚠️ 路由注册顺序（§21.1.1 第 3 条 / 仓库既有陷阱）：
//    **具体路径必须写在通配 `/:param` 之前，否则会被吞掉。**
//    本文件刻意按「静态段 → 动态段」排列，并在每处注明原因：
//      /products/categories  在 /products/:id      之前
//      /water-tickets/summary 在（无冲突，但同族前置）
//      /orders/:id/cancel    在 /orders/:id        之前
//      /wallet/admin/overview、/wallet/admin/adjust 在 /wallet/admin/:walletId/... 之前
//      /admin/expenses/options 在 /admin/expenses/:id 之前（Phase 8b 各域同理）
//
// ⚠️ 鉴权分层：
//    public    ：登录/绑定/公开配置（无需令牌）
//    miniAuth  ：需要有效小程序令牌（每请求查库校验 status，§4.5.1）
//    +active   ：写接口额外要求主体启用（禁用后返回 401，§22.5）
//    +admin    ：管理员专用（requireMiniAdmin，**不复用** Web 的 requireAdmin，§22.4）
// ===========================================================================
const express = require('express');
const rateLimit = require('express-rate-limit');

const miniAuth = require('../middleware/miniAuth');
const { requireMiniActive, requireMiniAdmin, requireMiniRole } = require('../middleware/miniAuth');
const { error } = require('../utils/response');
const { MINI_ROLES } = require('../constants/mini');

const authCtrl = require('../controllers/mini/authController');
const catalogCtrl = require('../controllers/mini/catalogController');
const orderCtrl = require('../controllers/mini/orderController');
const walletCtrl = require('../controllers/mini/walletController');
const ticketCtrl = require('../controllers/mini/waterTicketController');
const homeCtrl = require('../controllers/mini/homeController');
const adminCtrl = require('../controllers/mini/adminController');
// Phase 8b 管理员写操作：按业务域分文件（controllers/mini/admin/*），逐域追加
const adminExpenseCtrl = require('../controllers/mini/admin/expenseController');
const adminIncomeCtrl = require('../controllers/mini/admin/incomeController');

const router = express.Router();

// 小程序登录限流：15 分钟最多 20 次（比 Web 登录宽松一点，因为小程序会静默重试；
// 但仍要防暴力枚举手机号）。⚠️ 与 app.js 的 loginLimiter（Web 登录 10/15min）分开计数，
// 否则连跑冒烟会互相挤爆配额。
const miniLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '登录尝试过于频繁，请稍后再试', data: null }
});

// 常规小程序接口限流：每 IP 每分钟 120 次
const miniApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 429, message: '请求过于频繁，请稍后再试', data: null }
});

router.use(miniApiLimiter);

// ── 公开段（无需令牌）─────────────────────────────────────────────────────────
// GET /api/mini/config —— 登录页用它判断「微信登录是否已配置」「能否用本地开发登录」
router.get('/config', authCtrl.publicConfig);

router.post('/auth/login', miniLoginLimiter, authCtrl.login);
router.post('/auth/bind', miniLoginLimiter, authCtrl.bind);
// 本地开发登录（默认关闭，须显式设置 MINI_DEV_LOGIN=1；见 controller 注释）
router.post('/auth/dev-login', miniLoginLimiter, authCtrl.devLogin);

// ── 以下全部需要有效小程序令牌 ────────────────────────────────────────────────
router.use(miniAuth);

router.post('/auth/logout', authCtrl.logout);
router.get('/me', authCtrl.me);

// ── 首页聚合（§28/§29/§30）────────────────────────────────────────────────────
router.get('/home', homeCtrl.getHome);

// ── 商城（§21.2）──────────────────────────────────────────────────────────────
// ⚠️ /products/categories 必须早于 /products/:id
router.get('/products/categories', catalogCtrl.listCategories);
router.get('/products', catalogCtrl.listProducts);
router.get('/products/:id', catalogCtrl.getProductById);

// ── 业务员历史成交价（§21.3 / §8.6）───────────────────────────────────────────
router.get('/customer-history', requireMiniRole(MINI_ROLES.SALESMAN), orderCtrl.getCustomerHistory);

// ── 订单（§21.4）─────────────────────────────────────────────────────────────
// 写接口挂 requireMiniActive：禁用后持有效令牌下单必须被拒（HTTP 401，§44.11 ④）
router.post('/orders', requireMiniActive, orderCtrl.createOrder);
// ⚠️ /orders/:id/cancel 与 /orders/:id/refund 必须早于 /orders/:id
router.post('/orders/:id/cancel', requireMiniActive, orderCtrl.cancelOrder);
router.post('/orders/:id/refund', requireMiniActive, orderCtrl.refundOrder);
router.get('/orders', orderCtrl.listOrders);
router.get('/orders/:id', orderCtrl.getOrderById);

// ── 钱包（§21.5）─────────────────────────────────────────────────────────────
// ⚠️ 管理员子路由必须早于普通钱包路由里的动态段
router.get('/wallet/admin/overview', requireMiniAdmin, walletCtrl.adminOverview);
router.post('/wallet/admin/adjust', requireMiniAdmin, requireMiniActive, walletCtrl.adminAdjust);
router.get('/wallet/admin/:walletId/transactions', requireMiniAdmin, walletCtrl.adminWalletTransactions);

// 钱包读接口对普通用户开放（禁用后「历史只读」仍可用，§22.5）
router.get('/wallet', walletCtrl.getWallet);
router.get('/wallet/transactions', walletCtrl.getTransactions);
// 充值是写接口（Phase 6，本期返回「未开通」），仍挂 requireMiniActive 保持口径一致
router.post('/wallet/recharge', requireMiniActive, walletCtrl.recharge);

// ── 水票（§21.7）─────────────────────────────────────────────────────────────
router.get('/water-tickets/summary', requireMiniRole(MINI_ROLES.STATION), ticketCtrl.getWaterTicketSummary);
router.get('/water-tickets', requireMiniRole(MINI_ROLES.STATION), ticketCtrl.listWaterTickets);

// ── 管理员只读仪表盘（§21.8 / §28 / Phase 8a）────────────────────────────────
router.get('/admin/dashboard', requireMiniAdmin, adminCtrl.getDashboard);

// ── 管理员写操作（§5.3 / §43 Phase 8b，逐域验收）──────────────────────────────
//
// ⚠️ 8b 的**分层口径**（每个域都必须一致，别逐域换写法）：
//     读接口：requireMiniAdmin
//     写接口：requireMiniAdmin + requireMiniActive
//             （前者校验「是不是管理员」，后者校验「账号/主体是否被禁用」——
//               两者缺一不可：管理员账号同样可以被禁用，§22.5 禁用只拦写）
//     写接口还必须在**事务内**落审计（§40），见各域 controller。
//
// ── 域 1/17：支出/费用 ────────────────────────────────────────────────────────
// ⚠️ `/admin/expenses/options` 必须早于 `/admin/expenses/:id`
//    （当前只有 PUT/DELETE 带 :id，尚无 GET /:id；仍按仓库惯例静态段前置，
//      否则将来补 GET /:id 时 options 会被静默吞掉 —— 这类 bug 只在运行时暴露）
router.get('/admin/expenses/options', requireMiniAdmin, adminExpenseCtrl.getFormOptions);
router.get('/admin/expenses', requireMiniAdmin, adminExpenseCtrl.listExpenses);
router.get('/admin/expenses/:id', requireMiniAdmin, adminExpenseCtrl.getExpenseById);
router.post('/admin/expenses', requireMiniAdmin, requireMiniActive, adminExpenseCtrl.createExpense);
router.put('/admin/expenses/:id', requireMiniAdmin, requireMiniActive, adminExpenseCtrl.updateExpense);
router.delete('/admin/expenses/:id', requireMiniAdmin, requireMiniActive, adminExpenseCtrl.deleteExpense);

// ── 域 2/17：收入 ────────────────────────────────────────────────────────────
// ⚠️ 与支出域同构（含静态段前置）。两域是**一组**：改一处务必同时看另一处 ——
//    它们的记账方向**相反**（收入 +、支出 −），是最容易只改对一半的地方。
router.get('/admin/incomes/options', requireMiniAdmin, adminIncomeCtrl.getFormOptions);
router.get('/admin/incomes', requireMiniAdmin, adminIncomeCtrl.listIncomes);
router.get('/admin/incomes/:id', requireMiniAdmin, adminIncomeCtrl.getIncomeById);
router.post('/admin/incomes', requireMiniAdmin, requireMiniActive, adminIncomeCtrl.createIncome);
router.put('/admin/incomes/:id', requireMiniAdmin, requireMiniActive, adminIncomeCtrl.updateIncome);
router.delete('/admin/incomes/:id', requireMiniAdmin, requireMiniActive, adminIncomeCtrl.deleteIncome);

// ── 兜底 404 ─────────────────────────────────────────────────────────────────
// ⚠️ 必须显式兜底：否则未匹配的 /api/mini/* 会**落到 app.js 的全局 /api 鉴权**上，
//    返回「未登录」401 —— 把「接口不存在」伪装成「鉴权失败」，
//    排障时会往错误方向查（且会让 §22.4 的隔离验证出现假阳性）。
router.use((req, res) => {
  // 走统一响应出口，不裸 res.json（仓库红线 R7）
  error(res, '小程序接口不存在', 404);
});

module.exports = router;

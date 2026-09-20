// 小程序入口
// ===========================================================================
// 职责：
//   ① 冷启动时把本地身份交给购物车（购物车按主体隔离，见 utils/cart.js）
//   ② 提供全局只读的 apiConfig（业务常量下发给前端，避免前后端各维护一份枚举）
//   ③ 不做任何业务数据的预取 —— 首页数据由 pages/home 自己拉，
//      避免启动时打一堆请求把冷启动拖慢（文档 §43 Phase 1 的垂直链路原则）。
// ===========================================================================
const auth = require('./utils/auth');
const cart = require('./utils/cart');
const req = require('./utils/request');

App({
  globalData: {
    /** 后端下发的公开配置（GET /mini/config）：是否开启开发登录、是否已配置微信登录等
     *  ⚠️ 2026-09-20 自提下线后，`pickupConfigured` 已不在该响应中（原用于判断自提选项是否可用）。 */
    apiConfig: null,
    /** 启动时间，便于排查 */
    launchedAt: Date.now()
  },

  onLaunch() {
    // 身份缓存 → 购物车隔离键
    const me = auth.me();
    if (me && me.account) {
      cart.setOwner(`${me.account.role}:${me.account.targetId}`);
    }

    // 拉一次公开配置（免鉴权，失败也不阻断启动）
    req
      .get('/config', null, { auth: false, silent: true })
      .then(cfg => {
        this.globalData.apiConfig = cfg;
      })
      .catch(e => {
        // ⚠️ 配置拉不到时**不伪造默认值**（红线 R1）：
        //    登录页会因为拿不到 devLoginEnabled 而只展示微信登录入口。
        console.warn('[app] 读取公开配置失败：', e.message);
      });
  },

  onShow() {
    // 从后台回到前台时刷新一次身份：这样「管理员在 Web 端禁用了账号」能在
    // 下次回前台时被发现（配合后端的每请求查库校验，写操作本来就会被拦）
    if (auth.hasToken()) {
      auth.fetchMe(true).then(me => {
        if (me && me.account) {
          cart.setOwner(`${me.account.role}:${me.account.targetId}`);
        }
      });
    }
  }
});

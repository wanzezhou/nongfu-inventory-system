// 自定义 tabBar
// ===========================================================================
// 为什么用自定义 tabBar（而不是原生 tabBar）：
//   文档 §5.1 / §5.2 / §5.3 给三类角色定义了**不同的**页面结构：
//     业务员：首页 / 商城 / 购物车 / 我的
//     直营水站：首页 / 订货商城 / 购物车 / 积分 / 我的
//     管理员：首页（仪表盘）/ 我的
//   原生 tabBar 的 list 是静态的、三角色共用一套，无法按角色裁剪。
//   自定义 tabBar 可以在运行时按角色渲染不同的项（app.json 里仍保留 5 项 list，
//   因为 `wx.switchTab` 只能跳到 list 里声明过的页面）。
//
// 图标：用内联 SVG data URI（见 index.wxss）。
//   ⚠️ 这样**不需要任何二进制图片资源**（png/ico 在代码评审里不可读、
//      也要额外维护两套尺寸），且颜色随主题改一处即可。
// ===========================================================================
const auth = require('../utils/auth');
const cart = require('../utils/cart');
const { ROLES } = require('../config/index');

/** 每类角色的 tab 定义（顺序即展示顺序；最多 5 项 —— 微信对 tabBar 项数有上限） */
const TABS = {
  [ROLES.SALESMAN]: [
    { key: 'home', text: '首页', path: '/pages/home/index' },
    { key: 'mall', text: '商城', path: '/pages/mall/index' },
    { key: 'cart', text: '购物车', path: '/pages/cart/index', badge: 'cart' },
    { key: 'mine', text: '我的', path: '/pages/mine/index' }
  ],
  [ROLES.STATION]: [
    { key: 'home', text: '首页', path: '/pages/home/index' },
    { key: 'mall', text: '订货商城', path: '/pages/mall/index' },
    { key: 'cart', text: '购物车', path: '/pages/cart/index', badge: 'cart' },
    { key: 'wallet', text: '积分', path: '/pages/wallet/index' },
    { key: 'mine', text: '我的', path: '/pages/mine/index' }
  ],
  [ROLES.ADMIN]: [
    // 管理员端本期为只读（Phase 8a）：首页即仪表盘，不提供购物车/积分入口
    { key: 'home', text: '仪表盘', path: '/pages/home/index' },
    { key: 'mine', text: '我的', path: '/pages/mine/index' }
  ]
};

Component({
  data: {
    selected: 0,
    list: [],
    cartCount: 0
  },

  lifetimes: {
    attached() {
      this.refresh();
      // 购物车变更 → 角标刷新
      this._offCart = cart.onCartChange(s => {
        this.setData({ cartCount: s.count });
      });
      this.setData({ cartCount: cart.summary().count });
    },
    detached() {
      if (this._offCart) this._offCart();
    }
  },

  pageLifetimes: {
    show() {
      // 角色可能在别处变了（重新登录），每次显示时重算
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const role = auth.role();
      // ⚠️ 未登录时**不渲染任何 tab**（而不是渲染业务员 tab）：
      //    否则登录页下方会显示一排点不动的入口，且会误导用户以为已登录。
      const list = role ? TABS[role] || TABS[ROLES.SALESMAN] : [];
      this.setData({ list, cartCount: cart.summary().count });
      // 通知页面当前 tab 集合的 key 顺序（页面据此定位 selected）
      return list;
    },

    /** 页面 onShow 里调用：wx.switchTab 到目标页 */
    setSelectedByPath(fullPath) {
      const list = this.data.list;
      for (let i = 0; i < list.length; i++) {
        if (list[i].path === fullPath) {
          this.setData({ selected: i });
          return;
        }
      }
    },

    onTap(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item) return;
      if (index === this.data.selected) return;
      wx.switchTab({ url: item.path });
    }
  }
});

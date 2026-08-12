const auth = require('../../utils/auth.js');

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

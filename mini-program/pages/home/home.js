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
      admin: { todayOrders: 0, todayAmount: '0.00', pendingDelivery: 0, pendingReimburse: 0, recentOrders: [] },
      worker: { completed: 0, pending: 0, commission: '0.00', todoOrders: [] },
      station: { weekSales: '0.00', weekReturn: '0.00', depositBuckets: 0, pendingReconcile: '0.00', recentOrders: [] },
      salesman: { todayOrders: 0, todaySales: '0.00', totalCommission: '0.00', recentOrders: [] }
    }
  },

  onLoad() {
    this._initRole();
    this._setHeader();
    this._fetchData();
  },

  onShow() {
    if (!this.data.role) this._initRole();
  },

  onPullDownRefresh() {
    this._fetchData().then(() => wx.stopPullDownRefresh());
  },

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
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const pad = (x) => String(x).padStart(2, '0');
    const dateText = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${days[d.getDay()]}`;
    this.setData({ greeting, dateText });
  },

  _fetchData() {
    wx.showLoading({ title: '加载中', mask: true });
    return request.get('/mini/dashboard')
      .then((data) => {
        wx.hideLoading();
        this.setData({ dashboard: this._normalizeDashboard(data || {}) });
      })
      .catch(() => wx.hideLoading());
  },

  // 后端 /mini/dashboard 按角色平铺返回当前角色数据，这里映射到各角色看板字段
  _normalizeDashboard(d) {
    const dash = {
      admin: { todayOrders: 0, todayAmount: '0.00', pendingDelivery: 0, pendingReimburse: 0, recentOrders: [] },
      worker: { completed: 0, pending: 0, commission: '0.00', todoOrders: [] },
      station: { weekSales: '0.00', weekReturn: '0.00', depositBuckets: 0, pendingReconcile: '0.00', recentOrders: [] },
      salesman: { todayOrders: 0, todaySales: '0.00', totalCommission: '0.00', recentOrders: [] }
    };
    const role = d.role || this.data.role;

    if (role === 'admin') {
      dash.admin = {
        todayOrders: d.todayOrders || 0,
        todayAmount: fmt.formatAmount(d.todaySales),
        pendingDelivery: d.pendingDelivery || 0,
        pendingReimburse: d.pendingApprovals || 0,
        recentOrders: d.recentOrders || []
      };
    } else if (role === 'worker') {
      dash.worker = {
        completed: d.todayCompleted || 0,
        pending: d.todayPending || 0,
        commission: fmt.formatAmount(d.todayDeliveryFee),
        todoOrders: (d.pendingOrders || []).map(o => Object.assign({}, o, { address: o.customerAddress }))
      };
    } else if (role === 'station') {
      dash.station = {
        weekSales: fmt.formatAmount(d.weekDistribAmount),
        weekReturn: fmt.formatAmount(d.weekReturnAmount),
        depositBuckets: d.depositBarrels || 0,
        pendingReconcile: fmt.formatAmount(d.pendingReconcile),
        recentOrders: d.recentOrders || []
      };
    } else if (role === 'salesman') {
      dash.salesman = {
        todayOrders: d.todayOrders || 0,
        todaySales: fmt.formatAmount(d.todaySales),
        totalCommission: fmt.formatAmount(d.monthCommission),
        recentOrders: d.recentOrders || []
      };
    }
    return dash;
  },

  go(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
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

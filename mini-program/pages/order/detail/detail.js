const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');

const DELIVERY_TYPE_LABELS = { 1: '自有员工配送', 2: '水站配送', 3: '无需配送' };
const STATUS_MAP = {
  0: { text: '待配送', cls: 'warning' },
  1: { text: '配送中', cls: 'info' },
  2: { text: '已完成', cls: 'success' }
};

Page({
  data: {
    id: '',
    order: null,
    statusText: '',
    statusClass: '',
    deliveryTypeText: '',
    role: '',
    canEdit: false,
    canDeliver: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '', role: auth.getRole() || '' });
    this._fetch();
  },

  _fetch() {
    wx.showLoading({ title: '加载中', mask: true });
    request.get('/mini/orders/' + this.data.id)
      .then((order) => {
        wx.hideLoading();
        const st = STATUS_MAP[order.orderStatus] || { text: '未知', cls: 'default' };
        const role = this.data.role;
        const status = Number(order.orderStatus);
        // worker 角色：待配送/配送中 → 去配送；其余角色：待处理 → 修改订单
        const canDeliver = role === 'worker' && (status === 0 || status === 1);
        const canEdit = role !== 'worker' && status === 0;
        this.setData({
          order,
          statusText: st.text,
          statusClass: st.cls,
          deliveryTypeText: DELIVERY_TYPE_LABELS[order.deliveryType] || '未知',
          canEdit,
          canDeliver
        });
      })
      .catch(() => wx.hideLoading());
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/order/edit/edit?id=' + this.data.id });
  },

  goDeliver() {
    wx.navigateTo({ url: '/pages/delivery/complete/complete?id=' + this.data.id });
  }
});

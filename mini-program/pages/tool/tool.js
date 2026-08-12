const auth = require('../../utils/auth.js');

Page({
  data: {
    role: '',
    tools: []
  },

  onShow() {
    const role = auth.getRole() || 'admin';
    this._renderTools(role);
  },

  _renderTools(role) {
    const tools = [
      { url: '/pages/inventory/search/search', icon: '📦', label: '库存查询', desc: '全商品实时库存' },
      { url: '/pages/performance/index/index', icon: '📈', label: '业绩查看', desc: '我的业绩数据' }
    ];
    if (role === 'station') {
      tools.push(
        { url: '/pages/deposit/list/list', icon: '🪣', label: '押金记录', desc: '本站押金明细' },
        { url: '/pages/deposit/create/create', icon: '➕', label: '押金登记', desc: '收/退桶押金' },
        { url: '/pages/reimburse/create/create', icon: '📝', label: '提交报销', desc: '费用报销申请' }
      );
    } else {
      tools.push(
        { url: '/pages/deposit/create/create', icon: '➕', label: '押金登记', desc: '收/退桶押金' },
        { url: '/pages/reimburse/list/list', icon: '🧾', label: '报销管理', desc: '我的报销记录' },
        { url: '/pages/reimburse/create/create', icon: '📝', label: '提交报销', desc: '费用报销申请' }
      );
    }
    this.setData({ role, tools });
  },

  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  }
});

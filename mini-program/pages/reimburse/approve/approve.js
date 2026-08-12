const request = require('../../../utils/request.js');
const fmt = require('../../../utils/format.js');

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 50,
    total: 0,
    loading: false,
    finished: false,
    // 审批面板
    panelVisible: false,
    panelMode: 'approve', // approve | reject
    currentId: null,
    approvedAmount: '',
    remark: '',
    submitting: false
  },

  onShow() {
    this._fetch(true);
  },

  onPullDownRefresh() {
    this._fetch(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this._fetch(false);
  },

  _fetch(reset) {
    if (this.data.loading) return Promise.resolve();
    if (!reset && this.data.finished) return Promise.resolve();

    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });

    return request.get('/mini/reimbursements', { page, pageSize: this.data.pageSize, status: 0 })
      .then((res) => {
        const list = (res.list || []).map(it => Object.assign({}, it, {
          amountText: '¥' + fmt.formatAmount(it.amount),
          desc: it.description || ''
        }));
        const total = res.total || 0;
        const merged = reset ? list : this.data.list.concat(list);
        this.setData({
          list: merged,
          total,
          page: page + 1,
          loading: false,
          finished: merged.length >= total
        });
      })
      .catch(() => this.setData({ loading: false }));
  },

  onApprove(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.list.find(x => x.id === id);
    if (!it) return;
    this.setData({
      panelVisible: true,
      panelMode: 'approve',
      currentId: id,
      approvedAmount: String(it.amount),
      remark: ''
    });
  },

  onReject(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      panelVisible: true,
      panelMode: 'reject',
      currentId: id,
      approvedAmount: '',
      remark: ''
    });
  },

  onAmount(e) { this.setData({ approvedAmount: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  closePanel() {
    if (this.data.submitting) return;
    this.setData({ panelVisible: false });
  },

  noop() {},

  confirmAction() {
    if (this.data.submitting) return;
    const status = this.data.panelMode === 'approve' ? 2 : 3;

    const payload = { status, remark: this.data.remark.trim() };
    if (status === 2) {
      const amount = parseFloat(this.data.approvedAmount);
      if (isNaN(amount) || amount < 0) { wx.showToast({ title: '请输入正确批复金额', icon: 'none' }); return; }
      payload.approvedAmount = amount;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    request.put('/mini/reimbursements/' + this.data.currentId + '/approve', payload)
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false, panelVisible: false });
        wx.showToast({ title: '审批成功', icon: 'success' });
        this._fetch(true);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});

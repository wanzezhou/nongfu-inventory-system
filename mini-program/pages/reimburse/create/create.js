const request = require('../../utils/request.js');

Page({
  data: {
    types: [
      { value: '交通费', label: '交通费' },
      { value: '餐费', label: '餐费' },
      { value: '物料费', label: '物料费' },
      { value: '通讯费', label: '通讯费' },
      { value: '其他', label: '其他' }
    ],
    typeIndex: -1,
    type: '',
    amount: '',
    description: '',
    remark: '',
    submitting: false
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value);
    const t = this.data.types[idx];
    if (!t) return;
    this.setData({ typeIndex: idx, type: t.value });
  },

  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onDescription(e) { this.setData({ description: e.detail.value }); },
  onRemark(e) { this.setData({ remark: e.detail.value }); },

  submit() {
    if (this.data.submitting) return;
    if (!this.data.type) { wx.showToast({ title: '请选择报销类型', icon: 'none' }); return; }
    const amount = parseFloat(this.data.amount);
    if (isNaN(amount) || amount <= 0) { wx.showToast({ title: '请输入正确金额', icon: 'none' }); return; }
    if (!this.data.description.trim()) { wx.showToast({ title: '请填写报销说明', icon: 'none' }); return; }

    const payload = {
      type: this.data.type,
      amount,
      description: this.data.description.trim(),
      remark: this.data.remark.trim()
    };

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    request.post('/mini/reimbursements', payload)
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '提交成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});

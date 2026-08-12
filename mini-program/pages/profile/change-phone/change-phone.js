const request = require('../../utils/request.js');
const auth = require('../../utils/auth.js');

Page({
  data: {
    phone: '',
    submitting: false
  },

  onPhone(e) {
    this.setData({ phone: e.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const phone = this.data.phone.trim();
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...', mask: true });
    request.put('/mini/auth/update-phone', { phone })
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        // 同步本地缓存中的手机号
        const u = auth.getUserInfo() || {};
        auth.setUserInfo(Object.assign({}, u, { phone }));
        wx.showToast({ title: '修改成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  }
});

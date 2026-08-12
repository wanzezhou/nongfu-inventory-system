const config = require('../../../utils/config.js');
const request = require('../../../utils/request.js');
const auth = require('../../../utils/auth.js');

Page({
  data: {
    id: '',
    order: null,
    photoUrls: [],
    remark: '',
    submitting: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
    this._loadOrder();
  },

  _loadOrder() {
    wx.showLoading({ title: '加载中', mask: true });
    request.get('/mini/orders/' + this.data.id)
      .then((order) => {
        wx.hideLoading();
        this.setData({ order });
      })
      .catch(() => wx.hideLoading());
  },

  onPhotosChange(e) {
    this.setData({ photoUrls: e.detail.urls || [] });
  },

  onRemark(e) {
    this.setData({ remark: e.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const urls = this.data.photoUrls;
    if (urls.length === 0) {
      wx.showToast({ title: '请上传配送完成照片', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '上传中...', mask: true });

    this._uploadAll(urls.slice(), [])
      .then((uploaded) => {
        wx.showLoading({ title: '提交中...', mask: true });
        return request.post('/mini/delivery/complete/' + this.data.id, {
          photoUrl: uploaded[0] || '',
          remark: this.data.remark.trim()
        });
      })
      .then(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '配送完成', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  _uploadAll(paths, results) {
    if (paths.length === 0) return Promise.resolve(results);
    const filePath = paths.shift();
    return this._uploadOne(filePath).then((url) => {
      results.push(url);
      return this._uploadAll(paths, results);
    });
  },

  _uploadOne(filePath) {
    return new Promise((resolve, reject) => {
      const token = auth.getToken();
      wx.uploadFile({
        url: config.BASE_URL + '/mini/delivery/upload-photo',
        filePath,
        name: 'file',
        header: token ? { Authorization: 'Bearer ' + token } : {},
        success: (res) => {
          try {
            const body = JSON.parse(res.data);
            if (body.code === 200 && body.data && body.data.url) {
              resolve(body.data.url);
            } else {
              wx.showToast({ title: body.message || '上传失败', icon: 'none' });
              reject(new Error(body.message || 'upload fail'));
            }
          } catch (e) {
            reject(e);
          }
        },
        fail: (err) => {
          wx.showToast({ title: '上传失败', icon: 'none' });
          reject(err);
        }
      });
    });
  }
});

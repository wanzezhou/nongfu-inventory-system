const request = require('../../../utils/request.js');
const config = require('../../../utils/config.js');

let uidSeq = 0;

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
    submitting: false,
    attachments: [] // { uid, url (本地/远程), uploading, progress, serverUrl, tempPath }
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

  // 选择图片（本地）
  chooseImages() {
    const remain = 9 - this.data.attachments.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传9张', icon: 'none' });
      return;
    }
    const self = this;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        const files = res.tempFiles || [];
        const list = [...self.data.attachments];
        for (const f of files) {
          uidSeq += 1;
          list.push({
            uid: 'u_' + Date.now() + '_' + uidSeq,
            url: f.tempFilePath,
            tempPath: f.tempFilePath,
            uploading: false,
            progress: 0,
            serverUrl: ''
          });
        }
        self.setData({ attachments: list }, () => {
          // 立即上传新增的
          const newItems = list.slice(self.data.attachments.length - files.length);
          newItems.forEach(item => self._uploadOne(item.uid));
        });
      },
      fail(err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      }
    });
  },

  // 上传单张
  _uploadOne(uid) {
    const self = this;
    const idx = this.data.attachments.findIndex(a => a.uid === uid);
    if (idx < 0) return;
    const item = this.data.attachments[idx];
    if (!item || !item.tempPath || item.serverUrl) return;

    const update = (patch) => {
      const list = [...self.data.attachments];
      list[idx] = Object.assign({}, list[idx], patch);
      self.setData({ attachments: list });
    };

    update({ uploading: true, progress: 0 });

    const token = wx.getStorageSync('mini_token') || '';
    const uploadTask = wx.uploadFile({
      url: config.BASE_URL + '/mini/reimbursements/upload-attachment',
      filePath: item.tempPath,
      name: 'file',
      header: token ? { Authorization: 'Bearer ' + token } : {},
      success(res) {
        try {
          const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (res.statusCode === 200 && body && body.code === 200 && body.data && body.data.url) {
            update({
              uploading: false,
              progress: 100,
              serverUrl: body.data.url,
              url: body.data.url // 替换为服务器 URL
            });
          } else {
            update({ uploading: false, progress: 0 });
            wx.showToast({
              title: (body && body.message) || '上传失败',
              icon: 'none'
            });
          }
        } catch (e) {
          update({ uploading: false, progress: 0 });
          wx.showToast({ title: '上传响应解析失败', icon: 'none' });
        }
      },
      fail() {
        update({ uploading: false, progress: 0 });
        wx.showToast({ title: '网络异常，上传失败', icon: 'none' });
      }
    });

    uploadTask.onProgressUpdate((p) => {
      if (p && typeof p.progress === 'number') {
        update({ progress: p.progress });
      }
    });
  },

  // 预览图片
  previewImage(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.attachments;
    const item = list[idx];
    if (!item) return;
    const urls = list.map(a => a.url);
    wx.previewImage({
      current: item.url,
      urls
    });
  },

  // 删除附件
  removeAttach(e) {
    const idx = e.currentTarget.dataset.index;
    const list = [...this.data.attachments];
    list.splice(idx, 1);
    this.setData({ attachments: list });
  },

  submit() {
    if (this.data.submitting) return;
    if (!this.data.type) { wx.showToast({ title: '请选择报销类型', icon: 'none' }); return; }
    const amount = parseFloat(this.data.amount);
    if (isNaN(amount) || amount <= 0) { wx.showToast({ title: '请输入正确金额', icon: 'none' }); return; }
    if (!this.data.description.trim()) { wx.showToast({ title: '请填写报销说明', icon: 'none' }); return; }

    // 检查附件是否还在上传中
    const uploading = this.data.attachments.some(a => a.uploading);
    if (uploading) {
      wx.showToast({ title: '附件上传中，请稍候', icon: 'none' });
      return;
    }

    const attachmentUrls = this.data.attachments
      .map(a => a.serverUrl || '')
      .filter(Boolean);

    const payload = {
      type: this.data.type,
      amount,
      description: this.data.description.trim(),
      remark: this.data.remark.trim(),
      attachmentUrls
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

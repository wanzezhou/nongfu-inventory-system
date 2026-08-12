Component({
  properties: {
    maxCount: { type: Number, value: 3 }
  },
  data: {
    previews: []
  },
  methods: {
    chooseImage() {
      const remaining = this.data.maxCount - this.data.previews.length;
      if (remaining <= 0) {
        wx.showToast({ title: '最多' + this.data.maxCount + '张', icon: 'none' });
        return;
      }
      wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['camera', 'album'],
        success: (res) => {
          const files = res.tempFiles || [];
          const paths = files.map(f => f.tempFilePath);
          this.setData({ previews: this.data.previews.concat(paths) }, () => this._emit());
        }
      });
    },
    removeImage(e) {
      const idx = e.currentTarget.dataset.index;
      const previews = this.data.previews.slice();
      previews.splice(idx, 1);
      this.setData({ previews }, () => this._emit());
    },
    previewImage(e) {
      const idx = e.currentTarget.dataset.index;
      wx.previewImage({ urls: this.data.previews, current: this.data.previews[idx] });
    },
    _emit() {
      this.triggerEvent('change', { urls: this.data.previews });
    }
  }
});

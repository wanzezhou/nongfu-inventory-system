const STATUS_MAP = {
  0: { text: '待配送', cls: 'warning' },
  1: { text: '配送中', cls: 'info' },
  2: { text: '已完成', cls: 'success' }
};

Component({
  properties: {
    order: { type: Object, value: {} }
  },
  data: {
    statusText: '未知',
    statusClass: 'default'
  },
  observers: {
    'order.orderStatus'(status) {
      const s = STATUS_MAP[status] || { text: '未知', cls: 'default' };
      this.setData({ statusText: s.text, statusClass: s.cls });
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.order.id || this.data.order.orderNo });
    }
  }
});

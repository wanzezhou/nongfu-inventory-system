Component({
  properties: {
    order: { type: Object, value: {} },
    showAccept: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.order.orderId });
    },
    onAccept() {
      this.triggerEvent('accept', { id: this.data.order.orderId });
    }
  }
});

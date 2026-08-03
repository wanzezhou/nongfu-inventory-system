Page({
  data: {
    order: null
  },

  onLoad: function (options) {
    try {
      const orderStr = options.order || '{}';
      const order = JSON.parse(decodeURIComponent(orderStr));
      // 确保所有价格都有格式化字符串
      if (order) {
        order.totalAmountStr = order.totalAmountStr || (Math.round((order.totalAmount || 0) * 100) / 100).toFixed(2);
        order.orderAmountStr = order.orderAmountStr || (Math.round((order.orderAmount || 0) * 100) / 100).toFixed(2);
        order.deliveryFeeStr = order.deliveryFeeStr || (Math.round((order.deliveryFee || 0) * 100) / 100).toFixed(2);
        if (order.items) {
          order.items.forEach(item => {
            item.unitPriceStr = item.unitPriceStr || (Math.round((item.unitPrice || 0) * 100) / 100).toFixed(2);
            item.subtotalStr = item.subtotalStr || (Math.round((item.subtotal || 0) * 100) / 100).toFixed(2);
          });
        }
      }
      this.setData({
        order: order
      });
    } catch (e) {
      console.error('解析订单信息失败', e);
      this.setData({
        order: null
      });
    }
  },

  // 继续下单
  newOrder: function () {
    wx.redirectTo({
      url: '/pages/order/order'
    });
  },

  // 修改订单
  editOrder: function () {
    const order = this.data.order;
    if (!order) return;

    // 将订单数据传回订单编辑页面
    const orderStr = encodeURIComponent(JSON.stringify({
      orderNo: order.orderNo,
      orderType: order.orderType,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      creatorId: order.creatorId,
      stationId: order.stationId,
      remark: order.remark,
      items: order.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        spec: item.spec,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: item.subtotal
      }))
    }));

    wx.redirectTo({
      url: `/pages/order/order?edit=1&order=${orderStr}`
    });
  },

  // 分享订单
  shareOrder: function () {
    if (!this.data.order) return;

    const order = this.data.order;
    const itemsText = order.items.map(item =>
      `${item.productName} × ${item.quantity}`
    ).join('\n');

    const shareText = `订单编号：${order.orderNo}\n` +
      `客户：${order.customerName}\n` +
      `金额：¥${order.totalAmountStr}\n\n` +
      `商品明细：\n${itemsText}`;

    wx.setClipboardData({
      data: shareText,
      success: () => {
        wx.showToast({
          title: '订单信息已复制',
          icon: 'success'
        });
      }
    });
  }
});

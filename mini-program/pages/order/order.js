const BASE_URL = 'http://localhost:3000/api';

Page({
  data: {
    form: {
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      remark: ''
    },
    orderItems: [],
    products: [],
    filteredProducts: [],
    searchKeyword: '',
    showPicker: false,
    submitting: false,
    orderAmount: 0,
    deliveryFee: 0,
    totalAmount: 0,
    workers: [],
    workerNames: [],
    selectedWorkerIndex: -1,
    selectedCreatorId: null,
    stations: [],
    stationNames: [],
    selectedStationIndex: -1,
    selectedStationId: null,
    orderTypeNames: ['线上平台销售', '线下水站分销', '线下零售', '零售机供货', '线下水站返货'],
    orderTypeValues: [1, 2, 3, 4, 5],
    selectedOrderTypeIndex: 2,
    selectedOrderType: 3,
    editMode: false,
    editingOrder: null
  },

  onLoad: function (options) {
    // 检查是否为编辑模式
    if (options && options.edit === '1' && options.order) {
      try {
        const orderData = JSON.parse(decodeURIComponent(options.order));
        this.setData({
          editMode: true,
          editingOrder: orderData
        });
      } catch (e) {
        console.error('解析编辑订单数据失败', e);
      }
    }
    this.loadProducts();
    this.loadWorkers();
    this.loadStations();
  },

  loadProducts: function () {
    wx.request({
      url: `${BASE_URL}/orders/products/mini`,
      method: 'GET',
      success: (res) => {
        if (res.data && res.data.code === 200) {
          const orderType = this.data.selectedOrderType;
          const products = res.data.data.map(p => {
            p.displayPrice = this.getPriceByType(p, orderType);
            return p;
          });
          this.setData({
            products: products,
            filteredProducts: products
          }, () => {
            // 商品加载完成后，如果是编辑模式，恢复订单数据
            if (this.data.editMode && this.data.editingOrder) {
              this.restoreEditOrder();
            }
          });
        } else {
          wx.showToast({
            title: '加载商品失败',
            icon: 'none'
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '网络请求失败',
          icon: 'none'
        });
      }
    });
  },

  loadWorkers: function () {
    wx.request({
      url: `${BASE_URL}/orders/workers/mini`,
      method: 'GET',
      success: (res) => {
        if (res.data && res.data.code === 200) {
          const workers = res.data.data || [];
          this.setData({
            workers: workers,
            workerNames: workers.map(w => w.name + (w.phone ? ` (${w.phone})` : ''))
          }, () => {
            // 编辑模式下恢复创建人索引
            if (this.data.editMode && this.data.editingOrder && this.data.editingOrder.creatorId) {
              this.restoreWorkerIndex(this.data.editingOrder.creatorId);
            }
          });
        } else {
          wx.showToast({
            title: '加载员工失败',
            icon: 'none'
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '加载员工失败',
          icon: 'none'
        });
      }
    });
  },

  onWorkerChange: function (e) {
    const index = parseInt(e.detail.value);
    const worker = this.data.workers[index];
    this.setData({
      selectedWorkerIndex: index,
      selectedCreatorId: worker ? worker.id : null
    });
  },

  loadStations: function () {
    wx.request({
      url: `${BASE_URL}/orders/stations/mini`,
      method: 'GET',
      success: (res) => {
        if (res.data && res.data.code === 200) {
          const stations = res.data.data || [];
          this.setData({
            stations: stations,
            stationNames: stations.map(s => s.name)
          }, () => {
            // 编辑模式下恢复水站索引
            if (this.data.editMode && this.data.editingOrder && this.data.editingOrder.stationId) {
              this.restoreStationIndex(this.data.editingOrder.stationId);
            }
          });
        }
      },
      fail: () => {
        console.error('获取水站列表失败');
      }
    });
  },

  onStationChange: function (e) {
    const index = parseInt(e.detail.value);
    const station = this.data.stations[index];
    if (station) {
      this.setData({
        selectedStationIndex: index,
        selectedStationId: station.id,
        'form.customerName': station.name,
        'form.customerPhone': station.phone,
        'form.customerAddress': station.address
      });
    }
  },

  onOrderTypeChange: function (e) {
    const index = parseInt(e.detail.value);
    const orderType = this.data.orderTypeValues[index];
    const products = this.data.products.map(p => {
      p.displayPrice = this.getPriceByType(p, orderType);
      return p;
    });
    const filteredProducts = this.data.filteredProducts.map(p => {
      p.displayPrice = this.getPriceByType(p, orderType);
      return p;
    });
    const updates = {
      selectedOrderTypeIndex: index,
      selectedOrderType: orderType,
      products: products,
      filteredProducts: filteredProducts
    };
    // 切换到非水站类型时，清除水站选择和自动带出的信息
    if (orderType !== 2 && orderType !== 5) {
      updates.selectedStationIndex = -1;
      updates.selectedStationId = null;
      updates['form.customerName'] = '';
      updates['form.customerPhone'] = '';
      updates['form.customerAddress'] = '';
    }
    this.setData(updates);
    // 如果已有商品，需要重新计算价格
    if (this.data.orderItems.length > 0) {
      this.recalculatePrices();
    }
  },

  recalculatePrices: function () {
    const orderType = this.data.selectedOrderType;
    const orderItems = this.data.orderItems.map(item => {
      const product = this.data.products.find(p => p.id === item.productId);
      if (product) {
        const newPrice = this.getPriceByType(product, orderType);
        item.unitPrice = newPrice;
        item.subtotal = newPrice * item.quantity;
      }
      return item;
    });
    this.calculateTotal(orderItems);
  },

  getPriceByType: function (product, orderType) {
    switch (Number(orderType)) {
      case 1: return product.purchasePrice || 0;
      case 2: return product.wholesalePrice || 0;
      case 3: return product.retailPrice || 0;
      case 4: return product.purchasePrice || 0;
      case 5: return product.purchasePrice || 0;
      default: return product.retailPrice || 0;
    }
  },

  getDeliveryFeeByType: function (product, orderType) {
    switch (Number(orderType)) {
      case 1: return product.workerRetailDeliveryFee || 0;
      case 2: return product.workerWholesaleDeliveryFee || 0;
      case 3: return product.workerRetailDeliveryFee || 0;
      case 4: return product.workerMachineDeliveryFee || 0;
      case 5: return product.workerWholesaleDeliveryFee || 0;
      default: return product.workerRetailDeliveryFee || 0;
    }
  },

  // 恢复编辑订单数据
  restoreEditOrder: function () {
    const order = this.data.editingOrder;
    if (!order) return;

    const updates = {};

    // 1. 恢复订单类型
    if (order.orderType) {
      const typeIndex = this.data.orderTypeValues.indexOf(Number(order.orderType));
      if (typeIndex >= 0) {
        updates.selectedOrderTypeIndex = typeIndex;
        updates.selectedOrderType = Number(order.orderType);
        // 更新商品显示价格
        const products = this.data.products.map(p => {
          p.displayPrice = this.getPriceByType(p, Number(order.orderType));
          return p;
        });
        updates.products = products;
        updates.filteredProducts = products;
      }
    }

    // 2. 恢复表单信息
    if (order.customerName !== undefined) {
      updates['form.customerName'] = order.customerName || '';
    }
    if (order.customerPhone !== undefined) {
      updates['form.customerPhone'] = order.customerPhone || '';
    }
    if (order.customerAddress !== undefined) {
      updates['form.customerAddress'] = order.customerAddress || '';
    }
    if (order.remark !== undefined) {
      updates['form.remark'] = order.remark || '';
    }

    // 3. 恢复商品项（使用编辑时的单价，不重新计算）
    if (order.items && order.items.length > 0) {
      const orderItems = order.items.map(item => {
        const product = this.data.products.find(p => p.id === item.productId);
        return {
          id: Date.now() + Math.random(),
          productId: item.productId,
          productName: item.productName || (product ? product.name : ''),
          spec: item.spec || (product ? product.spec : ''),
          unitPrice: item.unitPrice || 0,
          quantity: item.quantity || 1,
          subtotal: item.subtotal || (item.unitPrice || 0) * (item.quantity || 1)
        };
      });
      updates.orderItems = orderItems;
    }

    this.setData(updates, () => {
      // 恢复商品项后重新计算总价
      if (updates.orderItems) {
        this.calculateTotal(updates.orderItems);
      }
      // 尝试恢复水站索引（如果水站数据已加载）
      if (this.data.stations.length > 0 && order.stationId) {
        this.restoreStationIndex(order.stationId);
      }
      // 尝试恢复创建人索引（如果员工数据已加载）
      if (this.data.workers.length > 0 && order.creatorId) {
        this.restoreWorkerIndex(order.creatorId);
      }
    });
  },

  // 恢复水站选择索引
  restoreStationIndex: function (stationId) {
    const index = this.data.stations.findIndex(s => s.id === stationId);
    if (index >= 0) {
      const station = this.data.stations[index];
      this.setData({
        selectedStationIndex: index,
        selectedStationId: stationId,
        'form.customerName': this.data.form.customerName || station.name,
        'form.customerPhone': this.data.form.customerPhone || station.phone,
        'form.customerAddress': this.data.form.customerAddress || station.address
      });
    }
  },

  // 恢复创建人选择索引
  restoreWorkerIndex: function (creatorId) {
    const index = this.data.workers.findIndex(w => w.id === creatorId);
    if (index >= 0) {
      this.setData({
        selectedWorkerIndex: index,
        selectedCreatorId: creatorId
      });
    }
  },

  onCustomerNameInput: function (e) {
    this.setData({
      'form.customerName': e.detail.value
    });
  },

  onCustomerPhoneInput: function (e) {
    this.setData({
      'form.customerPhone': e.detail.value
    });
  },

  onCustomerAddressInput: function (e) {
    this.setData({
      'form.customerAddress': e.detail.value
    });
  },

  onRemarkInput: function (e) {
    this.setData({
      'form.remark': e.detail.value
    });
  },

  showProductPicker: function () {
    if (this.data.products.length === 0) {
      this.loadProducts();
    }
    this.setData({
      showPicker: true,
      searchKeyword: '',
      filteredProducts: this.data.products
    });
  },

  hideProductPicker: function () {
    this.setData({
      showPicker: false
    });
  },

  preventBubble: function () {
    return;
  },

  onSearchInput: function (e) {
    const keyword = e.detail.value.trim().toLowerCase();
    const products = this.data.products;
    let filtered = products;
    if (keyword) {
      filtered = products.filter(p =>
        (p.name && p.name.toLowerCase().includes(keyword)) ||
        (p.spec && p.spec.toLowerCase().includes(keyword))
      );
    }
    this.setData({
      searchKeyword: keyword,
      filteredProducts: filtered
    });
  },

  selectProduct: function (e) {
    const productId = e.currentTarget.dataset.id;
    const product = this.data.products.find(p => p.id === productId);
    if (!product) return;

    const orderItems = this.data.orderItems.slice();
    const existingItem = orderItems.find(item => item.productId === productId);
    const orderType = this.data.selectedOrderType;

    if (existingItem) {
      if (product.stock <= 0 && orderType !== 5) {
        wx.showToast({
          title: '库存不足',
          icon: 'none'
        });
        return;
      }
      if (orderType === 5 || existingItem.quantity < product.stock) {
        existingItem.quantity++;
        existingItem.subtotal = existingItem.unitPrice * existingItem.quantity;
      } else {
        wx.showToast({
          title: '库存不足',
          icon: 'none'
        });
        return;
      }
    } else {
      if (product.stock <= 0 && orderType !== 5) {
        wx.showToast({
          title: '库存不足',
          icon: 'none'
        });
        return;
      }
      const unitPrice = this.getPriceByType(product, orderType);
      const newItem = {
        id: Date.now(),
        productId: product.id,
        productName: product.name,
        spec: product.spec,
        unitPrice: unitPrice,
        quantity: 1,
        subtotal: unitPrice
      };
      orderItems.push(newItem);
    }

    this.hideProductPicker();
    this.calculateTotal(orderItems);
  },

  increaseQty: function (e) {
    const index = e.currentTarget.dataset.index;
    const orderItems = this.data.orderItems.slice();
    const item = orderItems[index];
    const product = this.data.products.find(p => p.id === item.productId);
    const orderType = this.data.selectedOrderType;
    if (orderType === 5 || (product && item.quantity < product.stock)) {
      item.quantity++;
      item.subtotal = item.unitPrice * item.quantity;
      this.calculateTotal(orderItems);
    } else {
      wx.showToast({
        title: '库存不足',
        icon: 'none'
      });
    }
  },

  decreaseQty: function (e) {
    const index = e.currentTarget.dataset.index;
    const orderItems = this.data.orderItems.slice();
    const item = orderItems[index];
    if (item.quantity > 1) {
      item.quantity--;
      item.subtotal = item.unitPrice * item.quantity;
      this.calculateTotal(orderItems);
    }
  },

  onQtyInput: function (e) {
    const index = e.currentTarget.dataset.index;
    const value = parseInt(e.detail.value);
    if (value && value > 0) {
      const orderItems = this.data.orderItems.slice();
      const item = orderItems[index];
      const product = this.data.products.find(p => p.id === item.productId);
      const orderType = this.data.selectedOrderType;
      if (orderType === 5 || !product || value <= product.stock) {
        item.quantity = value;
        item.subtotal = item.unitPrice * item.quantity;
      } else {
        item.quantity = product ? product.stock : 1;
        item.subtotal = item.unitPrice * item.quantity;
        wx.showToast({
          title: '库存不足',
          icon: 'none'
        });
      }
      this.calculateTotal(orderItems);
    }
  },

  onPriceInput: function (e) {
    const index = e.currentTarget.dataset.index;
    const value = parseFloat(e.detail.value);
    const orderItems = this.data.orderItems.slice();
    const item = orderItems[index];
    if (!isNaN(value) && value >= 0) {
      item.unitPrice = value;
      item.subtotal = item.unitPrice * item.quantity;
      this.calculateTotal(orderItems);
    }
  },

  removeItem: function (e) {
    const index = e.currentTarget.dataset.index;
    const orderItems = this.data.orderItems.slice();
    orderItems.splice(index, 1);
    this.calculateTotal(orderItems);
  },

  calculateTotal: function (orderItems) {
    let orderAmount = 0;
    let deliveryFee = 0;
    const orderType = this.data.selectedOrderType;

    orderItems.forEach(item => {
      item.subtotalStr = (Math.round(item.subtotal * 100) / 100).toFixed(2);
      orderAmount += item.subtotal;
      const product = this.data.products.find(p => p.id === item.productId);
      if (product) {
        deliveryFee += this.getDeliveryFeeByType(product, orderType) * item.quantity;
      }
    });

    const totalAmount = orderAmount + deliveryFee;
    this.setData({
      orderItems: orderItems,
      orderAmount: orderAmount,
      orderAmountStr: (Math.round(orderAmount * 100) / 100).toFixed(2),
      deliveryFee: deliveryFee,
      deliveryFeeStr: (Math.round(deliveryFee * 100) / 100).toFixed(2),
      totalAmount: totalAmount,
      totalAmountStr: (Math.round(totalAmount * 100) / 100).toFixed(2)
    });
  },

  submitOrder: function () {
    const { form, orderItems, selectedCreatorId, selectedOrderType, selectedOrderTypeIndex, selectedStationId } = this.data;

    if (!selectedCreatorId) {
      wx.showToast({
        title: '请选择创建人',
        icon: 'none'
      });
      return;
    }

    // 水站分销/返货时需选择水站
    if ((selectedOrderType === 2 || selectedOrderType === 5) && !selectedStationId) {
      wx.showToast({
        title: '请选择水站',
        icon: 'none'
      });
      return;
    }

    if (selectedOrderType !== 2 && selectedOrderType !== 5) {
      if (!form.customerName.trim()) {
        wx.showToast({
          title: '请输入客户姓名',
          icon: 'none'
        });
        return;
      }

      if (!form.customerPhone.trim()) {
        wx.showToast({
          title: '请输入联系电话',
          icon: 'none'
        });
        return;
      }
    }

    if (orderItems.length === 0) {
      wx.showToast({
        title: '请添加商品',
        icon: 'none'
      });
      return;
    }

    this.setData({
      submitting: true
    });

    const items = orderItems.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    }));

    wx.request({
      url: `${BASE_URL}/orders/mini`,
      method: 'POST',
      data: {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerAddress: form.customerAddress,
        items: items,
        remark: form.remark,
        createdBy: selectedCreatorId,
        orderType: selectedOrderType,
        stationId: (selectedOrderType === 2 || selectedOrderType === 5) ? selectedStationId : null
      },
      success: (res) => {
        if (res.data && res.data.code === 200) {
          const orderNo = res.data.data?.orderNo || '';
          const totalAmount = res.data.data?.totalAmount || 0;

          const creatorName = this.data.selectedWorkerIndex >= 0
            ? this.data.workers[this.data.selectedWorkerIndex].name
            : '';
          const orderTypeName = this.data.orderTypeNames[selectedOrderTypeIndex];
          const orderInfo = {
            orderNo: orderNo,
            orderType: selectedOrderType,
            orderTypeName: orderTypeName,
            customerName: form.customerName,
            customerPhone: form.customerPhone,
            customerAddress: form.customerAddress,
            creatorId: selectedCreatorId,
            creatorName: creatorName,
            stationId: (selectedOrderType === 2 || selectedOrderType === 5) ? selectedStationId : null,
            remark: form.remark,
            createTime: this.formatDateTime(new Date()),
            orderAmount: this.data.orderAmount,
            orderAmountStr: this.data.orderAmount.toFixed(2),
            deliveryFee: this.data.deliveryFee,
            deliveryFeeStr: this.data.deliveryFee.toFixed(2),
            totalAmount: totalAmount,
            totalAmountStr: totalAmount.toFixed(2),
            items: this.data.orderItems.map(item => ({
              ...item,
              unitPriceStr: (Math.round(item.unitPrice * 100) / 100).toFixed(2),
              subtotalStr: (Math.round(item.subtotal * 100) / 100).toFixed(2)
            }))
          };

          const orderStr = encodeURIComponent(JSON.stringify(orderInfo));

          wx.redirectTo({
            url: `/pages/success/success?order=${orderStr}`
          });
        } else {
          wx.showToast({
            title: res.data?.message || '提交失败',
            icon: 'none'
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '网络请求失败',
          icon: 'none'
        });
      },
      complete: () => {
        this.setData({
          submitting: false
        });
      }
    });
  },

  resetForm: function () {
    this.setData({
      form: {
        customerName: '',
        customerPhone: '',
        customerAddress: '',
        remark: ''
      },
      orderItems: [],
      orderAmount: 0,
      deliveryFee: 0,
      totalAmount: 0,
      selectedWorkerIndex: -1,
      selectedCreatorId: null,
      selectedStationIndex: -1,
      selectedStationId: null,
      selectedOrderTypeIndex: 2,
      selectedOrderType: 3
    });
  },

  formatDateTime: function (date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
});
const fmt = require('../../utils/format.js');
const request = require('../../utils/request.js');

Component({
  properties: {
    visible: { type: Boolean, value: false },
    orderType: { type: Number, value: 0 },
    // 外部已选商品（编辑回显用），打开时预填
    externalItems: { type: Array, value: [] }
  },
  data: {
    products: [],
    displayProducts: [],
    selected: [],
    keyword: '',
    showPrice: false,
    priceLabel: '',
    defaultPriceField: '',
    totalAmount: '0.00'
  },
  observers: {
    visible(v) {
      if (v) {
        this._applyTypeConfig();
        this.setData({ keyword: '' });
        if (this.data.products.length === 0) this._loadProducts();
        const ext = this.data.externalItems;
        if (ext && ext.length > 0) {
          this.setData({ selected: ext.map(s => Object.assign({}, s)) }, () => this._calcTotal());
        } else {
          this.setData({ selected: [] }, () => this._calcTotal());
        }
      }
    },
    'orderType'() {
      this._applyTypeConfig();
    },
    'keyword'() {
      this._refreshDisplay();
    }
  },
  methods: {
    noop() {},

    _applyTypeConfig() {
      const t = Number(this.data.orderType);
      let showPrice = false;
      let priceLabel = '';
      let defaultPriceField = '';
      // 线上销售(1)/零售机供货(4)/水站返货(5)：不展示价格列
      // 水站分销(2)：展示分销价；线下零售(3)：展示零售价
      if (t === 2) {
        showPrice = true;
        priceLabel = '分销价';
        defaultPriceField = 'wholesalePrice';
      } else if (t === 3) {
        showPrice = true;
        priceLabel = '零售价';
        defaultPriceField = 'retailPrice';
      }
      this.setData({ showPrice, priceLabel, defaultPriceField }, () => this._refreshDisplay());
    },

    _loadProducts() {
      request.get('/mini/orders/products')
        .then((list) => {
          this.setData({ products: list || [] }, () => this._refreshDisplay());
        })
        .catch(() => {});
    },

    _refreshDisplay() {
      const kw = (this.data.keyword || '').trim();
      const list = this.data.products.filter(p =>
        !kw || (p.name && p.name.indexOf(kw) > -1) || (p.spec && p.spec.indexOf(kw) > -1)
      );
      const show = this.data.showPrice;
      const field = this.data.defaultPriceField;
      const display = list.map(p => Object.assign({}, p, {
        stockCls: fmt.stockClass(p.stock),
        priceText: show ? (p[field] || 0) : ''
      }));
      this.setData({ displayProducts: display });
    },

    onSearch(e) {
      this.setData({ keyword: e.detail.value });
    },

    addItem(e) {
      const idx = e.currentTarget.dataset.index;
      const p = this.data.displayProducts[idx];
      if (!p) return;
      if (p.stock <= 0) {
        wx.showToast({ title: '该商品无库存', icon: 'none' });
        return;
      }
      const selected = this.data.selected.slice();
      const found = selected.find(s => s.productId === p.id);
      if (found) {
        found.qty = (found.qty || 0) + 1;
      } else {
        selected.push({
          productId: p.id,
          name: p.name,
          image: p.image || '',
          qty: 1,
          unitPrice: Number(p[this.data.defaultPriceField]) || 0,
          subtotal: 0,
          stock: p.stock,
          workerRetailDeliveryFee: Number(p.workerRetailDeliveryFee) || 0,
          workerWholesaleDeliveryFee: Number(p.workerWholesaleDeliveryFee) || 0,
          workerMachineDeliveryFee: Number(p.workerMachineDeliveryFee) || 0,
          totalDeliveryFee: Number(p.totalDeliveryFee) || 0,
          distributionDeliveryFee: Number(p.distributionDeliveryFee) || 0
        });
      }
      this.setData({ selected }, () => this._calcTotal());
    },

    removeItem(e) {
      const idx = e.currentTarget.dataset.index;
      const selected = this.data.selected.slice();
      selected.splice(idx, 1);
      this.setData({ selected }, () => this._calcTotal());
    },

    incQty(e) {
      const idx = e.currentTarget.dataset.index;
      const selected = this.data.selected.slice();
      selected[idx].qty = (selected[idx].qty || 0) + 1;
      this.setData({ selected }, () => this._calcTotal());
    },

    decQty(e) {
      const idx = e.currentTarget.dataset.index;
      const selected = this.data.selected.slice();
      const q = (selected[idx].qty || 0) - 1;
      if (q <= 0) selected.splice(idx, 1);
      else selected[idx].qty = q;
      this.setData({ selected }, () => this._calcTotal());
    },

    onQtyInput(e) {
      const idx = e.currentTarget.dataset.index;
      const selected = this.data.selected.slice();
      const v = parseInt(e.detail.value, 10);
      selected[idx].qty = isNaN(v) || v < 0 ? 0 : v;
      this.setData({ selected }, () => this._calcTotal());
    },

    onPriceInput(e) {
      const idx = e.currentTarget.dataset.index;
      const selected = this.data.selected.slice();
      const v = parseFloat(e.detail.value);
      selected[idx].unitPrice = isNaN(v) ? 0 : v;
      this.setData({ selected }, () => this._calcTotal());
    },

    _calcTotal() {
      const selected = this.data.selected;
      let total = 0;
      selected.forEach((s) => {
        s.subtotal = Number((s.qty || 0) * (s.unitPrice || 0));
        total += s.subtotal;
      });
      this.setData({ selected, totalAmount: fmt.formatAmount(total) });
    },

    confirm() {
      if (this.data.selected.length === 0) {
        wx.showToast({ title: '请选择商品', icon: 'none' });
        return;
      }
      const items = this.data.selected.map(s => ({
        productId: s.productId,
        name: s.name,
        image: s.image,
        qty: s.qty,
        unitPrice: s.unitPrice,
        subtotal: s.subtotal,
        stock: s.stock,
        workerRetailDeliveryFee: s.workerRetailDeliveryFee,
        workerWholesaleDeliveryFee: s.workerWholesaleDeliveryFee,
        workerMachineDeliveryFee: s.workerMachineDeliveryFee,
        totalDeliveryFee: s.totalDeliveryFee,
        distributionDeliveryFee: s.distributionDeliveryFee
      }));
      this.triggerEvent('confirm', { items });
    },

    close() {
      this.triggerEvent('close');
    }
  }
});

// 商品 · 新增 / 编辑（管理员 · 文档 §5.3「商品」/ §43 Phase 8b 第 3 域）
// ===========================================================================
// ⚠️ 本页承载一条**业务闸门**：业务员端能不能卖某个商品，完全取决于这里
//    「允许业务员下单」开关 + 最低成交价（§8.5 两个条件的与）。所以：
//
//   ① 开启开关时最低价**必填**。允许"开了但没填"就等于制造一个
//      界面上显示已开启、业务员端却买不了的静默失效开关（后端也会拒这种组合）。
//   ② 最低价 > 零售价 是个自相矛盾的配置：业务员不手填成交价时会回退按零售价下单，
//      于是无论怎么下单都被拒 —— 商品永远卖不出去，而界面看起来一切正常。前端提前拦。
//
//   ③ 价格/配送费共 9 个字段用字段数组渲染（见 wxml），本页只按 key 取值，
//      不重复写 9 段类似的 setData —— 手写时「label 与字段对不上」不会报错，只会静静写错价格。
//
//   ④ 幂等键在「用户点保存的那一刻」生成并持久化；失败**不释放**，原地重试复用同一个键。
//
//   ⑤ 图片走 wx.uploadFile（见 utils/request.upload）。上传成功后拿到的是
//      **站内相对路径**，直接存进 image_url；显示时由 fmt.imageUrl 拼域名。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const fmt = require('../../utils/format');
const idem = require('../../utils/idempotency');
const { ROLES } = require('../../config/index');

/** 价格字段（key 与后端 camelCase 入参一一对应） */
const PRICE_FIELDS = [
  { key: 'purchasePrice', label: '进货价' },
  { key: 'wholesalePrice', label: '批发价' },
  { key: 'retailPrice', label: '参考零售价' },
  { key: 'machinePrice', label: '零售机供货价' }
];

/** 配送费字段 */
const FEE_FIELDS = [
  { key: 'totalDeliveryFee', label: '总包配送费' },
  { key: 'distributionDeliveryFee', label: '分销配送费' },
  { key: 'workerRetailDeliveryFee', label: '工人零售配送费' },
  { key: 'workerWholesaleDeliveryFee', label: '工人水站配送费' },
  { key: 'workerMachineDeliveryFee', label: '工人零售机配送费' }
];

/** 与后端 multer limits.fileSize 保持一致（5MB）—— 前端先拦一次，避免白传一遍大图 */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** 选图（包成 Promise：wx.chooseMedia 的回调风格在小程序里更稳，不依赖 Promise 化支持） */
function chooseImageFile() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        resolve((res.tempFiles && res.tempFiles[0]) || null);
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

Page({
  data: {
    priceFields: PRICE_FIELDS,
    feeFields: FEE_FIELDS,
    isEdit: false,
    productId: '',
    form: {
      productCode: '',
      productName: '',
      specification: '',
      unit: '',
      category: '',
      purchasePrice: '',
      wholesalePrice: '',
      retailPrice: '',
      machinePrice: '',
      totalDeliveryFee: '',
      distributionDeliveryFee: '',
      workerRetailDeliveryFee: '',
      workerWholesaleDeliveryFee: '',
      workerMachineDeliveryFee: '',
      salesmanMinPrice: '',
      imageUrl: ''
    },
    salesmanEnabled: false,
    statusOn: true,
    imageFull: '',
    imageInitial: '水',
    categoryOptions: ['（暂无已有类别）'],
    categoryIndex: 0,
    submitting: false,
    loadError: '',
    blocked: ''
  },

  onLoad(options) {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    const isAdmin = role === ROLES.ADMIN;
    const id = options && options.id ? String(options.id) : '';
    this.setData({
      blocked: ui.blockedBanner(),
      isEdit: !!id,
      productId: id,
      loadError: isAdmin ? '' : '当前身份不是管理员，无权编辑商品'
    });
    if (!isAdmin) return;
    this.loadCategories();
    if (id) this.loadDetail(id);
  },

  /** 类别选项（后端 DISTINCT；失败不阻断 —— 表单里还有「新类别」输入框可以直接写） */
  async loadCategories() {
    try {
      const res = await ui.request.get('/admin/products/options', null, { silent: true });
      const categories = (res && res.categories) || [];
      if (categories.length) {
        this.setData({ categoryOptions: categories });
      }
    } catch (e) {
      // 静默：类别拉不到只是少一个下拉，不影响编辑
    }
  },

  async loadDetail(id) {
    try {
      const p = await ui.request.get(`/admin/products/${id}`, null, { silent: true });
      const form = Object.assign({}, this.data.form, {
        productCode: p.productCode || '',
        productName: p.productName || '',
        specification: p.specification || '',
        unit: p.unit || '',
        category: p.category || '',
        purchasePrice: String(p.purchasePrice === undefined ? '' : p.purchasePrice),
        wholesalePrice: String(p.wholesalePrice === undefined ? '' : p.wholesalePrice),
        retailPrice: String(p.retailPrice === undefined ? '' : p.retailPrice),
        machinePrice: String(p.machinePrice === undefined ? '' : p.machinePrice),
        totalDeliveryFee: String(p.totalDeliveryFee === undefined ? '' : p.totalDeliveryFee),
        distributionDeliveryFee: String(p.distributionDeliveryFee === undefined ? '' : p.distributionDeliveryFee),
        workerRetailDeliveryFee: String(p.workerRetailDeliveryFee === undefined ? '' : p.workerRetailDeliveryFee),
        workerWholesaleDeliveryFee: String(
          p.workerWholesaleDeliveryFee === undefined ? '' : p.workerWholesaleDeliveryFee
        ),
        workerMachineDeliveryFee: String(p.workerMachineDeliveryFee === undefined ? '' : p.workerMachineDeliveryFee),
        salesmanMinPrice:
          p.salesmanMinPrice === null || p.salesmanMinPrice === undefined ? '' : String(p.salesmanMinPrice),
        // ⚠️ 图片原值必须在表单里带着走：后端是**部分更新**，若本页不提交 imageUrl 就保持原值，
        //    但一旦提交了空值就会把图清掉 —— 带着原值最稳（用户没换图时原样回传）。
        imageUrl: p.imageUrl || ''
      });
      const idx = this.data.categoryOptions.indexOf(form.category);
      this.setData({
        form,
        salesmanEnabled: Number(p.salesmanMiniEnabled) === 1,
        statusOn: Number(p.status) === 1,
        imageFull: fmt.imageUrl(p.imageUrl),
        imageInitial: fmt.productInitial(form.productName),
        categoryIndex: idx >= 0 ? idx : 0
      });
    } catch (e) {
      this.setData({ loadError: e.message || '商品详情加载失败' });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    const patch = {};
    patch['form.' + field] = value;
    // 名称变化时同步占位图首字（无图时的视觉占位）
    if (field === 'productName') patch.imageInitial = fmt.productInitial(value);
    this.setData(patch);
  },

  onCategoryChange(e) {
    const idx = Number(e.detail.value);
    const category = this.data.categoryOptions[idx] || '';
    this.setData({ 'form.category': category, categoryIndex: idx });
  },

  onSalesmanEnabledChange(e) {
    this.setData({ salesmanEnabled: !!e.detail.value });
  },

  onStatusChange(e) {
    this.setData({ statusOn: !!e.detail.value });
  },

  async onChooseImage() {
    if (this.data.submitting) return;
    let file = null;
    try {
      file = await chooseImageFile();
    } catch (e) {
      return; // 用户取消选图，不提示
    }
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      ui.showError(new Error('图片不能超过 5MB，请压缩或裁剪后重试'));
      return;
    }
    try {
      const data = await ui.request.upload(file.tempFilePath, {
        url: '/admin/products/upload-image',
        silent: true
      });
      // 后端只回**相对路径**（不写死域名），显示时统一由 fmt.imageUrl 拼接
      this.setData({ 'form.imageUrl': data.path, imageFull: fmt.imageUrl(data.path) });
      wx.showToast({ title: '图片已上传', icon: 'success' });
    } catch (e) {
      ui.showError(e, '图片上传失败');
    }
  },

  onClearImage() {
    // 只清表单值；真正删除库里引用发生在保存时（用户取消保存则什么都不会变）
    this.setData({ 'form.imageUrl': '', imageFull: '' });
  },

  onPreviewImage() {
    if (!this.data.imageFull) return;
    wx.previewImage({ urls: [this.data.imageFull] });
  },

  /** 前端预校验（与后端 validateSalesmanConfig 同口径；真正的边界仍在服务端） */
  validate() {
    const f = this.data.form;
    if (!String(f.productCode || '').trim()) return '商品编码不能为空';
    if (!String(f.productName || '').trim()) return '商品名称不能为空';

    for (const item of PRICE_FIELDS.concat(FEE_FIELDS)) {
      const raw = f[item.key];
      if (raw === '' || raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (isNaN(n) || n < 0) return `${item.label}必须为不小于 0 的数字`;
    }

    const minRaw = f.salesmanMinPrice;
    if (this.data.salesmanEnabled) {
      if (minRaw === '' || minRaw === null || minRaw === undefined) {
        return '开启「允许业务员下单」时必须填写最低成交价（否则业务员端仍无法下单）';
      }
      const min = Number(minRaw);
      if (isNaN(min) || min <= 0) return '最低成交价必须为大于 0 的数字';
      const retailRaw = f.retailPrice;
      if (retailRaw !== '' && retailRaw !== null && retailRaw !== undefined) {
        const retail = Number(retailRaw);
        if (!isNaN(retail) && min > retail) {
          return `最低成交价（${min}）不能高于参考零售价（${retail}），否则该商品永远卖不出去`;
        }
      }
    }
    return null;
  },

  buildPayload() {
    const f = this.data.form;
    return {
      productCode: String(f.productCode || '').trim(),
      productName: String(f.productName || '').trim(),
      specification: f.specification,
      unit: f.unit,
      category: f.category,
      purchasePrice: f.purchasePrice,
      wholesalePrice: f.wholesalePrice,
      retailPrice: f.retailPrice,
      machinePrice: f.machinePrice,
      totalDeliveryFee: f.totalDeliveryFee,
      distributionDeliveryFee: f.distributionDeliveryFee,
      workerRetailDeliveryFee: f.workerRetailDeliveryFee,
      workerWholesaleDeliveryFee: f.workerWholesaleDeliveryFee,
      workerMachineDeliveryFee: f.workerMachineDeliveryFee,
      // 空串 → 后端转 null（无图）
      imageUrl: String(f.imageUrl || '').trim(),
      status: this.data.statusOn ? 1 : 0,
      salesmanMiniEnabled: this.data.salesmanEnabled ? 1 : 0,
      // 开关关闭时也照原值提交：留着值，下次开启不必重填（后端只在开启时校验最低价）
      salesmanMinPrice: f.salesmanMinPrice
    };
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const err = this.validate();
    if (err) {
      ui.showError(new Error(err));
      return;
    }
    if (auth.isBlocked()) {
      ui.showError(new Error(ui.blockedBanner()));
      return;
    }

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const payload = this.buildPayload();
    const scope = this.data.isEdit ? 'UPDATE_PRODUCT' : 'CREATE_PRODUCT';
    // 幂等键：同一份内容的重试复用同一个键；内容改了则换新键（否则后端判「同键不同参数」而 400）
    const keyPayload = this.data.isEdit ? Object.assign({ id: this.data.productId }, payload) : payload;
    const clientRequestId = idem.acquireKey({ scope, ownerKey, payload: keyPayload });

    this.setData({ submitting: true });
    try {
      if (this.data.isEdit) {
        await ui.request.put(`/admin/products/${this.data.productId}`, Object.assign({ clientRequestId }, payload), {
          silent: true
        });
      } else {
        await ui.request.post('/admin/products', Object.assign({ clientRequestId }, payload), { silent: true });
      }
      idem.releaseKey();
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      // ⚠️ 失败**不释放幂等键**：原地重试必须复用同一个键，否则会真的建出两个商品
      ui.showError(e, '保存失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDisable() {
    if (this.data.submitting) return;
    const ok = await ui.confirm(
      '停用该商品？',
      '停用后业务员与水站端立即看不到该商品，历史订单不受影响。可再次编辑并打开「启用」恢复。',
      '停用'
    );
    if (!ok) return;

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({
      scope: 'DISABLE_PRODUCT',
      ownerKey,
      payload: { id: this.data.productId }
    });

    this.setData({ submitting: true });
    try {
      // 幂等键走查询参数：DELETE 的请求体并非所有客户端都会保留（后端两种都收）
      await ui.request.del(
        `/admin/products/${this.data.productId}?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        null,
        { silent: true }
      );
      idem.releaseKey();
      wx.showToast({ title: '已停用', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      ui.showError(e, '停用失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  }
});

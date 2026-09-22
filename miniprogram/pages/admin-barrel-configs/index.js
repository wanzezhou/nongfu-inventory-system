// 桶型配置（回桶 · 管理员 · Phase 8b 第 16 域）
// ===========================================================================
// ⚠️ 这是**跨端联动**的配置：押金登记时会校验「桶型存在且已启用」——
//    所以改价/停用/删除的效果，最终体现在「还能不能登记这个桶型」上。
// ⚠️ 有押金流水的桶型**只能停用不能删**（服务端判据）：删了会让历史押金指向一个
//    不存在的桶型（数据悬挂），台账再也算不平。页面把这条规则写在按钮旁边，
//    让用户在点删除之前就知道会遇到什么。
// ⚠️ 新增用两次输入（名称 → 价格）而不是一个表单页：桶型只有两个字段，
//    为它单开一个页面会让「新增一个桶型」变成三步操作。
const ui = require('../../utils/ui');
const fmt = require('../../utils/format');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: { list: [], loading: false, busy: false, loadError: '' },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch();
  },

  onShow() {
    if (this.data.list.length) this.fetch();
  },

  onPullDownRefresh() {
    this.fetch().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/barrels/configs', null, { silent: true });
      this.setData({
        list: (res.list || []).map(function (c) {
          return Object.assign({}, c, { priceText: fmt.money(c.depositPrice) });
        })
      });
    } catch (e) {
      this.setData({ loadError: e.message || '桶型配置加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  idemKey(scope, payload) {
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    return idem.acquireKey({ scope: scope, ownerKey: ownerKey, payload: payload });
  },

  async onAdd() {
    if (this.data.busy) return;
    const name = await ui.prompt('新增桶型', '桶型名称，如「18.9L 桶」');
    if (!name) return;
    const priceStr = await ui.prompt('新增桶型', '押金单价（元）');
    if (!priceStr) return;
    const price = Number(priceStr);
    if (!(price >= 0)) {
      this.setData({ loadError: '押金单价不能为负' });
      return;
    }
    this.setData({ busy: true, loadError: '' });
    const payload = { barrelType: name, depositPrice: price, sortOrder: 0 };
    const key = this.idemKey('CREATE_BARREL_CONFIG', payload);
    try {
      await ui.request.post('/admin/barrels/configs', Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已新增', icon: 'success' });
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '新增失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onEditPrice(e) {
    if (this.data.busy) return;
    const item = e.currentTarget.dataset.item;
    const priceStr = await ui.prompt('修改押金单价 · ' + item.barrelType, '新的押金单价（元）');
    if (!priceStr) return;
    const price = Number(priceStr);
    if (!(price >= 0)) {
      this.setData({ loadError: '押金单价不能为负' });
      return;
    }
    this.setData({ busy: true, loadError: '' });
    const payload = {
      barrelType: item.barrelType,
      depositPrice: price,
      status: item.status ? 1 : 0,
      sortOrder: item.sortOrder
    };
    const key = this.idemKey('UPDATE_BARREL_CONFIG', Object.assign({ id: item.id }, payload));
    try {
      await ui.request.put('/admin/barrels/configs/' + item.id, Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '保存失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onToggleStatus(e) {
    if (this.data.busy) return;
    const item = e.currentTarget.dataset.item;
    const nextStatus = item.status ? 0 : 1;
    const ok = await ui.confirm(
      nextStatus ? '启用该桶型？' : '停用该桶型？',
      nextStatus
        ? '启用后可在登记押金时选择「' + item.barrelType + '」。'
        : '停用后**不能**再登记该桶型的押金（历史押金与在押数量不受影响）。',
      nextStatus ? '启用' : '停用'
    );
    if (!ok) return;
    this.setData({ busy: true, loadError: '' });
    const payload = {
      barrelType: item.barrelType,
      depositPrice: item.depositPrice,
      status: nextStatus,
      sortOrder: item.sortOrder
    };
    const key = this.idemKey('UPDATE_BARREL_CONFIG', Object.assign({ id: item.id }, payload));
    try {
      await ui.request.put('/admin/barrels/configs/' + item.id, Object.assign({ clientRequestId: key }, payload), {
        silent: true
      });
      idem.releaseKey();
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '操作失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  async onRemove(e) {
    if (this.data.busy) return;
    const item = e.currentTarget.dataset.item;
    const ok = await ui.confirm(
      '删除桶型「' + item.barrelType + '」？',
      '只有**从未产生过押金流水**的桶型能删除；有流水的会被服务端拒绝并提示改用停用。',
      '删除'
    );
    if (!ok) return;
    this.setData({ busy: true, loadError: '' });
    const key = this.idemKey('DELETE_BARREL_CONFIG', { id: item.id });
    try {
      await ui.request.del('/admin/barrels/configs/' + item.id + '?clientRequestId=' + encodeURIComponent(key), null, {
        silent: true
      });
      idem.releaseKey();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '删除失败' });
    } finally {
      this.setData({ busy: false });
    }
  }
});

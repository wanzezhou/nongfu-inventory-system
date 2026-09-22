// 系统设置（管理员 · Phase 8b 第 17 域）
// 目前只有一项：销售单打印使用的店长（所有订单类型共用同一位）。
// ⚠️ 为什么值得放到手机上：打印出来的联系电话是**给客户回拨**的 ——
//    配错了要等客户打不通才发现。换人后应当立刻能改，而不是回电脑前。
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');

Page({
  data: {
    current: null,
    managers: [],
    managerLabels: [],
    managerIndex: 0,
    loading: false,
    submitting: false,
    loadError: ''
  },

  onLoad() {
    if (!ui.pageReady(this, { requireRole: 'admin' })) return;
    this.fetch();
  },

  async fetch() {
    this.setData({ loading: true, loadError: '' });
    try {
      const res = await ui.request.get('/admin/settings/options', null, { silent: true });
      const managers = res.storeManagers || [];
      let idx = 0;
      for (let i = 0; i < managers.length; i++) if (managers[i].workerId === (res.current || {}).workerId) idx = i;
      this.setData({
        current: res.current,
        managers: managers,
        managerLabels: managers.map(function (m) {
          return m.workerName + (m.phoneMasked ? '（' + m.phoneMasked + '）' : '');
        }),
        managerIndex: idx
      });
    } catch (e) {
      this.setData({ loadError: e.message || '系统设置加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onManagerChange(e) {
    this.setData({ managerIndex: Number(e.detail.value) });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const m = this.data.managers[this.data.managerIndex];
    if (!m) {
      this.setData({ loadError: '请选择店长（若列表为空，请先建一位在职店长）' });
      return;
    }
    const ok = await ui.confirm(
      '设置打印店长？',
      '销售单打印的「店长联系电话」将改为「' + m.workerName + '」，**所有订单类型**共用这一位。',
      '确认设置'
    );
    if (!ok) return;
    this.setData({ submitting: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const key = idem.acquireKey({
      scope: 'UPDATE_SETTING',
      ownerKey: ownerKey,
      payload: { setting: 'print_manager_worker_id', workerId: m.workerId }
    });
    try {
      const r = await ui.request.put(
        '/admin/settings/print-manager',
        { clientRequestId: key, workerId: m.workerId },
        { silent: true }
      );
      idem.releaseKey();
      await ui.confirm('已保存', '当前打印店长：' + r.workerName + '（' + r.phoneMasked + '）', '知道了');
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '保存失败' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onClear() {
    if (this.data.submitting) return;
    const ok = await ui.confirm(
      '清除设置？',
      '清除后回退为「第一位在职店长」（系统自动选，不固定到具体某人）。',
      '清除'
    );
    if (!ok) return;
    this.setData({ submitting: true, loadError: '' });
    const me = auth.me();
    const ownerKey = me.account.role + ':' + (me.account.targetId || 'self');
    const key = idem.acquireKey({
      scope: 'UPDATE_SETTING',
      ownerKey: ownerKey,
      payload: { setting: 'print_manager_worker_id', workerId: null }
    });
    try {
      const r = await ui.request.put(
        '/admin/settings/print-manager',
        { clientRequestId: key, workerId: null },
        { silent: true }
      );
      idem.releaseKey();
      await ui.confirm('已清除', '当前回退为：' + r.workerName + '（' + r.sourceLabel + '）', '知道了');
      this.fetch();
    } catch (e) {
      this.setData({ loadError: e.message || '清除失败' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});

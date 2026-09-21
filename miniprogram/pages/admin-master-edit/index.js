// 主数据 新增 / 编辑（管理员 · Phase 8b 第 4~7 域）
// ===========================================================================
// 一套页面覆盖供应商/员工/水站/机台，字段与分组来自 config/masterData.js。
//
// ⚠️ 四条约定：
//   ① **幂等键在点保存那一刻生成**（§23.1）—— 移动端弱网重试极常见，没有它一次重试
//      就是两条档案。失败**不释放**幂等键，原地重试复用同一个。
//   ② **部分更新语义**：本页会把所有字段连同原值一起提交（表单里都有），
//      所以不涉及"哪些字段没传"；但后端是部分更新，将来若做局部的快捷编辑要注意。
//   ③ 删除的返回里带 `mode`：`hard` = 真删了、`soft` = 因有引用转为停用。
//      **必须把这个区别告诉用户** —— 否则管理员会以为"删掉了"而实际只是停用，
//      之后又在列表里看到它（还以为是删除失败）。
//   ④ 前端校验与后端同口径，但**不是安全边界**：真正的边界在服务端。
// ===========================================================================
const ui = require('../../utils/ui');
const auth = require('../../utils/auth');
const idem = require('../../utils/idempotency');
const { ROLES } = require('../../config/index');
const { DOMAINS, optionLabel } = require('../../config/masterData');

Page({
  data: {
    domainKey: 'supplier',
    domain: DOMAINS.supplier,
    isEdit: false,
    recordId: '',
    groups: [],
    form: {},
    statusOn: true,
    submitting: false,
    loadError: '',
    blocked: ''
  },

  onLoad(options) {
    const me = auth.me();
    const role = me && me.account ? me.account.role : '';
    const key = options && options.type && DOMAINS[options.type] ? options.type : 'supplier';
    const domain = DOMAINS[key];
    const id = options && options.id ? String(options.id) : '';

    const isAdmin = role === ROLES.ADMIN;
    this.setData({
      blocked: ui.blockedBanner(),
      domainKey: key,
      domain,
      isEdit: !!id,
      recordId: id,
      loadError: isAdmin ? '' : '当前身份不是管理员，无权编辑主数据'
    });
    wx.setNavigationBarTitle({ title: (id ? '编辑' : '新建') + domain.label });
    if (!isAdmin) return;

    // 初始化空表单（所有字段先给空串，保证 input 是受控的）
    const form = {};
    for (const g of domain.groups) {
      for (const f of g.fields) form[f.key] = '';
    }
    this.setData({ form, groups: this.buildGroups(domain, form) });

    if (id) this.loadDetail(id);
  },

  /** 重建 groups：给 picker 补 optionLabels / display / index（数据变了就必须重建） */
  buildGroups(domain, form) {
    return domain.groups.map(g => ({
      title: g.title,
      fields: g.fields.map(f => {
        const item = Object.assign({}, f);
        if (f.type === 'picker') {
          const options = f.options || [];
          item.optionLabels = options.map(o => o.label);
          const v = form[f.key];
          const idx = options.findIndex(o => String(o.value) === String(v));
          item.index = idx >= 0 ? idx : 0;
          item.display = v === '' || v === null || v === undefined ? '请选择' : optionLabel(options, v);
        }
        return item;
      })
    }));
  },

  async loadDetail(id) {
    try {
      const row = await ui.request.get(this.data.domain.routes.detail.replace(':id', id), null, { silent: true });
      const form = Object.assign({}, this.data.form);
      for (const k of Object.keys(form)) {
        const v = row[k];
        form[k] = v === null || v === undefined ? '' : String(v);
      }
      this.setData({
        form,
        groups: this.buildGroups(this.data.domain, form),
        statusOn: Number(row.status) === 1
      });
    } catch (e) {
      this.setData({ loadError: e.message || `${this.data.domain.label}详情加载失败` });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = {};
    patch['form.' + field] = e.detail.value;
    this.setData(patch);
  },

  onPickerChange(e) {
    const field = e.currentTarget.dataset.field;
    const options = (this.findField(this.data.domain, field) || {}).options || [];
    const idx = Number(e.detail.value);
    const chosen = options[idx];
    if (!chosen) return;
    const form = Object.assign({}, this.data.form, { [field]: String(chosen.value) });
    // 重建 groups 以刷新 display（picker 的显示文本不是双向绑定的）
    this.setData({ form, groups: this.buildGroups(this.data.domain, form) });
  },

  findField(domain, key) {
    for (const g of domain.groups) {
      const f = g.fields.find(x => x.key === key);
      if (f) return f;
    }
    return null;
  },

  onStatusChange(e) {
    this.setData({ statusOn: !!e.detail.value });
  },

  /** 前端预校验（与后端 validate 同口径；真正的边界在服务端） */
  validate() {
    const domain = this.data.domain;
    const form = this.data.form;
    for (const g of domain.groups) {
      for (const f of g.fields) {
        const raw = form[f.key];
        const empty = raw === '' || raw === null || raw === undefined;
        if (f.required && empty) return `${f.label}不能为空`;
        if (empty) continue;
        if (f.type === 'digit') {
          const n = Number(raw);
          if (isNaN(n)) return `${f.label}必须是数字`;
          if (n < 0) return `${f.label}不能为负数`;
        }
        if (f.type === 'picker' && f.options) {
          const ok = f.options.some(o => String(o.value) === String(raw));
          if (!ok) return `${f.label}取值不合法`;
        }
      }
    }
    return null;
  },

  buildPayload() {
    const payload = {};
    for (const g of this.data.domain.groups) {
      for (const f of g.fields) {
        payload[f.key] = this.data.form[f.key];
      }
    }
    payload.status = this.data.statusOn ? 1 : 0;
    return payload;
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
    const SCOPE = this.data.domainKey.toUpperCase(); // SUPPLIER / WORKER / STATION / MACHINE
    const scope = (this.data.isEdit ? 'UPDATE_' : 'CREATE_') + SCOPE;
    const keyPayload = this.data.isEdit ? Object.assign({ id: this.data.recordId }, payload) : payload;
    const clientRequestId = idem.acquireKey({ scope, ownerKey, payload: keyPayload });

    this.setData({ submitting: true });
    try {
      if (this.data.isEdit) {
        await ui.request.put(
          this.data.domain.routes.update.replace(':id', this.data.recordId),
          Object.assign({ clientRequestId }, payload),
          { silent: true }
        );
      } else {
        await ui.request.post(this.data.domain.routes.create, Object.assign({ clientRequestId }, payload), {
          silent: true
        });
      }
      idem.releaseKey();
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      // ⚠️ 失败**不释放幂等键**：原地重试复用同一个，否则会真的建出两条档案
      ui.showError(e, '保存失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  },

  async onDisable() {
    if (this.data.submitting) return;
    const ok = await ui.confirm(
      `停用该${this.data.domain.label}？`,
      '没有任何关联数据时会真正删除；存在历史单据等引用时只会转为「停用」保留，具体结果以返回提示为准。',
      '停用'
    );
    if (!ok) return;

    const me = auth.me();
    const ownerKey = `${me.account.role}:${me.account.targetId || 'self'}`;
    const clientRequestId = idem.acquireKey({
      scope: 'DISABLE_' + this.data.domainKey.toUpperCase(),
      ownerKey,
      payload: { id: this.data.recordId }
    });

    this.setData({ submitting: true });
    try {
      // 幂等键走查询参数：DELETE 的请求体并非所有客户端都会保留（后端两种都收）
      const res = await ui.request.del(
        this.data.domain.routes.remove.replace(':id', this.data.recordId) +
          `?clientRequestId=${encodeURIComponent(clientRequestId)}`,
        null,
        { silent: true }
      );
      idem.releaseKey();
      // ⚠️ 把 hard / soft 的区别明确告诉用户（见文件头第 ③ 条）
      const mode = res && res.mode;
      wx.showModal({
        title: mode === 'soft' ? '已转为停用' : '已删除',
        content:
          mode === 'soft'
            ? `该${this.data.domain.label}存在关联数据，已停用保留（未真正删除）。历史数据可正常追溯。`
            : `该${this.data.domain.label}已删除。`,
        showCancel: false,
        success() {
          wx.navigateBack();
        }
      });
    } catch (e) {
      ui.showError(e, '操作失败，请稍后重试');
    } finally {
      this.setData({ submitting: false });
    }
  }
});

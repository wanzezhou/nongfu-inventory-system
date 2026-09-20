// 登录 / 绑定页（文档 §4.4 首次登录绑定流程）
// ===========================================================================
// 正常流程（§4.4）：
//   wx.login → 服务端换 openid → getPhoneNumber 拿微信实名手机号
//          → 服务端按手机号匹配 workers/sub_stations/users → 绑定 → 签发令牌
//
// ⚠️ 本页**不做角色选择**（§4.4 末句「禁止用户自行选择角色」）：
//    角色完全由「手机号匹配到哪张业务表」在服务端决定。
//    下面那个「本地开发登录」是**开发期通道**（后端 MINI_DEV_LOGIN=1 才开放），
//    它同样不允许自由选角色，role 只用于在**已匹配到的多条真实记录**里消歧
//    —— 当前库里 users.phone 与 sub_stations.phone 确有重号（真实数据特征）。
// ===========================================================================
const req = require('../../utils/request');
const auth = require('../../utils/auth');
const cart = require('../../utils/cart');
const { STORAGE_KEYS } = require('../../config/index');

Page({
  data: {
    loading: false,
    /** 后端下发的公开配置：决定是否展示开发登录入口 */
    apiConfig: null,
    mode: 'wx', // wx = 微信登录 | dev = 本地开发登录
    phone: '',
    roleOptions: [
      { value: '', label: '自动匹配（默认）' },
      { value: 'salesman', label: '业务员' },
      { value: 'station', label: '直营水站' },
      { value: 'admin', label: '管理员' }
    ],
    roleIndex: 0,
    errorMessage: '',
    /** 绑定票据（未匹配到身份时后端下发，用于补授权手机号后继续绑定） */
    bindTicket: ''
  },

  onLoad() {
    this.loadConfig();
  },

  onShow() {
    // 已登录则直接进首页（避免用户返回到登录页）
    if (auth.hasToken()) {
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  async loadConfig() {
    try {
      const cfg = await req.get('/config', null, { auth: false, silent: true });
      this.setData({
        apiConfig: cfg,
        // 未配置微信登录且开启了开发登录 → 默认切到开发登录，避免用户点半天没反应
        mode: !cfg.wxLoginConfigured && cfg.devLoginEnabled ? 'dev' : 'wx'
      });
      if (!cfg.wxLoginConfigured) {
        this.setData({
          errorMessage: cfg.devLoginEnabled
            ? '后端未配置 WX_APPID / WX_SECRET，微信登录不可用；请使用下方「本地开发登录」。'
            : '后端未配置微信小程序登录（缺少 WX_APPID / WX_SECRET），请联系管理员。'
        });
      }
    } catch (e) {
      // 配置拉不到时**不伪造**，只提示（红线 R1）
      this.setData({ errorMessage: '无法连接后端服务，请确认后端已启动：cd backend && node src/app.js' });
    }
  },

  switchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, errorMessage: '' });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onRoleChange(e) {
    this.setData({ roleIndex: Number(e.detail.value) });
  },

  /** 微信登录：wx.login → 服务端；若已绑定直接签发令牌，否则回传 bindTicket 再补手机号 */
  async onWxLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, errorMessage: '' });
    try {
      // ① wx.login 拿 code（服务端换 openid，前端拿不到也不需要 openid）
      const code = await this.wxLogin();
      // ② 没有 bindTicket 时说明是首次；先不申请手机号，让用户明确点击「授权手机号」
      const res = await req.post('/auth/login', { code }, { auth: false, silent: true });
      if (res.status === 'OK') {
        this.afterLogin(res);
        return;
      }
      if (res.status === 'NEED_BIND') {
        this.setData({ bindTicket: res.bindTicket || '' });
        wx.showModal({
          title: '需要绑定身份',
          content: res.message || '请授权微信手机号以完成身份绑定',
          confirmText: '去授权',
          confirmColor: '#c8102e',
          success: m => {
            if (m.confirm) this.requestPhoneAndBind(code);
          }
        });
        return;
      }
      this.setData({ errorMessage: '登录返回异常，请稍后重试' });
    } catch (e) {
      this.setData({ errorMessage: e.message || '登录失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 用 button open-type=getPhoneNumber 的 code 完成绑定并登录（一次到位） */
  async onGetPhoneNumber(e) {
    const phoneCode = e.detail && e.detail.code;
    if (!phoneCode) {
      // 用户拒绝授权：按文档 §54「授权被拒绝时功能要有降级提示，不得静默失败或反复弹窗」
      this.setData({ errorMessage: '未获得手机号授权，无法完成身份绑定。可稍后重试或联系管理员。' });
      return;
    }
    this.setData({ loading: true, errorMessage: '' });
    try {
      let res;
      if (this.data.bindTicket) {
        // 已经换过 openid（有票据）→ 走绑定接口
        res = await req.post(
          '/auth/bind',
          { bindTicket: this.data.bindTicket, phoneCode },
          { auth: false, silent: true }
        );
      } else {
        // 直接用 code + phoneCode 一次性完成（后端 login 支持带 phoneCode）
        const code = await this.wxLogin();
        res = await req.post('/auth/login', { code, phoneCode }, { auth: false, silent: true });
      }
      if (res && res.token) {
        this.afterLogin(res);
      } else {
        this.setData({ errorMessage: (res && res.message) || '绑定失败，请稍后重试' });
      }
    } catch (e) {
      this.setData({ errorMessage: e.message || '绑定失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 本地开发登录（仅后端 MINI_DEV_LOGIN=1 时可用） */
  async onDevLogin() {
    if (this.data.loading) return;
    const phone = String(this.data.phone || '').trim();
    if (!/^\d{6,20}$/.test(phone)) {
      this.setData({ errorMessage: '请输入用于匹配身份的完整手机号（须与后台维护的一致）' });
      return;
    }
    this.setData({ loading: true, errorMessage: '' });
    try {
      const role = this.data.roleOptions[this.data.roleIndex].value;
      const res = await req.post('/auth/dev-login', { phone, role: role || undefined }, { auth: false, silent: true });
      if (res && res.token) {
        try {
          wx.setStorageSync(STORAGE_KEYS.LAST_PHONE, phone);
        } catch (err) {
          // 记不住手机号不影响登录
        }
        this.afterLogin(res);
      } else {
        this.setData({ errorMessage: (res && res.message) || '登录失败' });
      }
    } catch (e) {
      this.setData({ errorMessage: e.message || '登录失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** wx.login 的 Promise 封装 */
  wxLogin() {
    return new Promise((resolve, reject) => {
      wx.login({
        success(res) {
          if (res.code) resolve(res.code);
          else reject(new Error('微信登录失败：未取到 code'));
        },
        fail() {
          reject(new Error('微信登录失败，请检查网络后重试'));
        }
      });
    });
  },

  /** 登录成功后的统一收尾：存令牌 → 拉身份 → 同步购物车归属 → 进首页 */
  async afterLogin(res) {
    req.setToken(res.token);
    const me = await auth.fetchMe(false);
    if (!me || !me.account) {
      this.setData({ errorMessage: '登录成功但读取身份失败，请重试' });
      return;
    }
    // 购物车按主体隔离（换账号不能看到别人购物车）
    cart.setOwner(`${me.account.role}:${me.account.targetId}`);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/home/index' });
    }, 400);
  }
});

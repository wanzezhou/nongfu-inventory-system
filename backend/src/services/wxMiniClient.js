// 微信小程序开放接口客户端（文档 §4.4 登录流程 / §13 / §26）
// ===========================================================================
// 使用 Node 原生 https，**不引入新依赖**（后端 package.json 无 http 客户端库）。
//
// ⚠️ 安全红线（§26）：
//   WX_APPID / WX_SECRET（以及 Phase 6 的 WX_MCHID / WX_API_V3_KEY / WX_PRIVATE_KEY /
//   WX_CERT_SERIAL_NO）**只能存在服务端安全配置中，不能打包进小程序**。
//   本文件只读 process.env，不落盘、不回传。
//
// ⚠️ 未配置时**不降级、不伪造**：返回明确的 CONFIG_MISSING 错误，
//    由上层转成「微信登录未配置」的业务提示。绝不回退到某个默认 openid
//    （那会让所有人都登进同一个账号，属 §41 级别的越权面）。
// ===========================================================================
const https = require('https');

// 微信开放接口基址。可用 WX_API_BASE 覆盖（便于联调/沙箱），默认官方地址。
const WX_API_BASE = process.env.WX_API_BASE || 'https://api.weixin.qq.com';
const REQUEST_TIMEOUT_MS = 8000;

/** 配置是否就绪（不打印任何密钥内容） */
function isConfigured() {
  return Boolean(process.env.WX_APPID && process.env.WX_SECRET);
}

/** 配置缺失错误的统一构造 */
function configMissingError() {
  const e = new Error('微信小程序登录未配置（缺少 WX_APPID / WX_SECRET），请在后端 .env 中配置');
  e.business = true;
  e.code = 'WX_CONFIG_MISSING';
  return e;
}

/** 微信侧返回业务错误的统一构造（errcode/errmsg 是微信给的安全信息，可对外转述） */
function wxError(errcode, errmsg) {
  const e = new Error(`微信接口返回错误 ${errcode}: ${errmsg || ''}`.trim());
  e.business = true;
  e.code = 'WX_API_ERROR';
  e.wxErrcode = errcode;
  return e;
}

/** GET JSON（带超时；非 2xx 或非 JSON 一律抛错，不返回半成品） */
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(WX_API_BASE + pathname);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Accept: 'application/json' }
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            // ⚠️ 不把 body 直接当错误抛给客户端（可能含内部细节），只记日志
            console.error('[wxMiniClient] 微信接口 HTTP 异常:', res.statusCode, body.slice(0, 200));
            return reject(
              Object.assign(new Error('微信接口不可用，请稍后重试'), { business: true, code: 'WX_HTTP_ERROR' })
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error('[wxMiniClient] 微信接口返回非 JSON:', body.slice(0, 200));
            reject(
              Object.assign(new Error('微信接口返回格式异常，请稍后重试'), { business: true, code: 'WX_BAD_RESPONSE' })
            );
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('微信接口超时，请稍后重试'), { business: true, code: 'WX_TIMEOUT' }));
    });
    req.on('error', e => {
      if (e.business) return reject(e);
      console.error('[wxMiniClient] 请求微信接口失败:', e.code || e.message);
      reject(Object.assign(new Error('微信接口不可用，请稍后重试'), { business: true, code: 'WX_NETWORK_ERROR' }));
    });
    req.end();
  });
}

/** POST JSON */
function postJson(pathname, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(WX_API_BASE + pathname);
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Accept: 'application/json'
        }
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error('[wxMiniClient] 微信接口 HTTP 异常:', res.statusCode, body.slice(0, 200));
            return reject(
              Object.assign(new Error('微信接口不可用，请稍后重试'), { business: true, code: 'WX_HTTP_ERROR' })
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            console.error('[wxMiniClient] 微信接口返回非 JSON:', body.slice(0, 200));
            reject(
              Object.assign(new Error('微信接口返回格式异常，请稍后重试'), { business: true, code: 'WX_BAD_RESPONSE' })
            );
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('微信接口超时，请稍后重试'), { business: true, code: 'WX_TIMEOUT' }));
    });
    req.on('error', e => {
      if (e.business) return reject(e);
      console.error('[wxMiniClient] 请求微信接口失败:', e.code || e.message);
      reject(Object.assign(new Error('微信接口不可用，请稍后重试'), { business: true, code: 'WX_NETWORK_ERROR' }));
    });
    req.write(data);
    req.end();
  });
}

/**
 * code2session：wx.login 的 code → openid / session_key（文档 §4.4 流程第 1~2 步）
 *
 * ⚠️ session_key 只在服务端使用，**绝不回传前端**（§4.4 / §54）。
 * @returns {Promise<{openid:string, unionid:string|null, sessionKey:string}>}
 */
async function code2session(code) {
  if (!isConfigured()) throw configMissingError();
  if (!code || typeof code !== 'string') {
    throw Object.assign(new Error('缺少微信登录 code'), { business: true, code: 'WX_CODE_MISSING' });
  }
  const qs = new URLSearchParams({
    appid: process.env.WX_APPID,
    secret: process.env.WX_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  }).toString();

  const data = await getJson(`/sns/jscode2session?${qs}`);
  if (data.errcode) throw wxError(data.errcode, data.errmsg);
  if (!data.openid) throw Object.assign(new Error('微信未返回 openid'), { business: true, code: 'WX_NO_OPENID' });

  return {
    openid: data.openid,
    unionid: data.unionid || null,
    sessionKey: data.session_key || null
  };
}

// ── access_token 缓存（内存；stable_token 有效期 7200s）──────────────────────
let tokenCache = { token: null, expiresAt: 0 };

/**
 * 取接口调用凭证（stable_token）
 * ⚠️ 只放内存，不落盘、不进日志。
 */
async function getAccessToken() {
  if (!isConfigured()) throw configMissingError();
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  const data = await postJson('/cgi-bin/stable_token', {
    grant_type: 'client_credential',
    appid: process.env.WX_APPID,
    secret: process.env.WX_SECRET
  });
  if (data.errcode) throw wxError(data.errcode, data.errmsg);
  if (!data.access_token) {
    throw Object.assign(new Error('微信未返回 access_token'), { business: true, code: 'WX_NO_TOKEN' });
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 7200) * 1000
  };
  return tokenCache.token;
}

/**
 * 用 getPhoneNumber 的动态 code 换取微信实名手机号（文档 §4.4 流程第 3 步）
 *
 * ⚠️ 隐私口径（§54）：手机号属个人信息，**最小必要**使用 —— 这里只用于
 *    首次登录时匹配 workers / sub_stations，以及订单联系；不在日志里打印完整号码。
 * @returns {Promise<{phone:string, countryCode:string|null}>}
 */
async function getPhoneNumber(phoneCode) {
  if (!isConfigured()) throw configMissingError();
  if (!phoneCode || typeof phoneCode !== 'string') {
    throw Object.assign(new Error('缺少手机号授权 code'), { business: true, code: 'WX_PHONE_CODE_MISSING' });
  }
  const token = await getAccessToken();
  const data = await postJson(`/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
    code: phoneCode
  });
  if (data.errcode) throw wxError(data.errcode, data.errmsg);
  const info = data.phone_info || {};
  const phone = info.purePhoneNumber || info.phoneNumber || null;
  if (!phone) {
    throw Object.assign(new Error('微信未返回手机号'), { business: true, code: 'WX_NO_PHONE' });
  }
  return { phone: String(phone), countryCode: info.countryCode || null };
}

module.exports = {
  isConfigured,
  code2session,
  getPhoneNumber,
  getAccessToken,
  configMissingError
};

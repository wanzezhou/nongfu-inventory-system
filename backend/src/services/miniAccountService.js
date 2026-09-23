// 小程序账号服务：微信登录 / 手机号绑定 / 令牌签发（文档 §4.1 ~ §4.6、§51）
// ===========================================================================
// 登录流程（§4.4，文档明确要求按此顺序）：
//   wx.login()
//       ↓
//   服务端换取 openid              ← wxMiniClient.code2session
//       ↓
//   小程序获取微信实名手机号        ← getPhoneNumber 动态 code
//       ↓
//   服务端按手机号匹配现有业务员/直营水站
//       ↓
//   生成 mini_accounts 绑定
//       ↓
//   签发 JWT（**小程序专用密钥 + 独立 aud/iss**）
//
// ⚠️ 关键约束：
//   ① **禁止用户自行选择角色**（§4.4 末句）。角色完全由「手机号匹配到哪张业务表」决定，
//      请求体里带 role 一律忽略（dev-login 是唯一例外，且仅本地开发可用）。
//   ② openid 属个人信息（§54）：**只存服务端，不对外展示、不回传前端**。
//      因此首次登录未绑定时，回传的是一张 5 分钟有效的 bindTicket（内含 openid，服务端验签），
//      而不是 openid 明文。令牌 payload 里同样**不含 openid**。
//   ③ 一个水站一个微信账号（§4.6）：靠 mini_accounts 的 uk_role_active 唯一索引兜底，
//      不靠应用层「先查再插」——那是竞态漏洞。
//   ④ 手机号无法唯一匹配时**不猜**：返回明确原因，由管理员在后台处理（§4.4 原文）。
// ===========================================================================
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const wxMiniClient = require('./wxMiniClient');
const { ensureWallet, writeAuditLog, businessError } = require('./walletService');
const {
  MINI_ROLES,
  ROLE_TO_OWNER_TYPE,
  MINI_TOKEN_AUDIENCE,
  MINI_TOKEN_ISSUER,
  MINI_TOKEN_TTL,
  AUDIT_ACTION,
  EMPLOYEE_TYPE
} = require('../constants/mini');

const MINI_JWT_SECRET = process.env.JWT_SECRET_MINI;
if (!MINI_JWT_SECRET) {
  throw new Error('环境变量 JWT_SECRET_MINI 未配置，拒绝启动。小程序令牌必须与 Web 令牌隔离（文档 §51）。');
}

/** bindTicket 有效期：5 分钟（只够走完一次绑定，减少 openid 暴露窗口） */
const BIND_TICKET_TTL = '5m';
const BIND_TICKET_USE = 'mini-bind';

// ── 令牌 ─────────────────────────────────────────────────────────────────────
/**
 * 签发小程序令牌（§51.1）
 * payload = { miniAccountId, role, targetId, buyerType }（文档指定的形状）
 * ⚠️ 不含 openid / 手机号 —— 令牌在前端可被解出，个人信息不进令牌。
 */
function signMiniToken(account) {
  const buyerType =
    account.buyer_type ||
    (account.role === MINI_ROLES.SALESMAN ? 'SALESMAN' : account.role === MINI_ROLES.STATION ? 'STATION' : null);
  return jwt.sign(
    {
      tokenUse: 'mini',
      miniAccountId: account.id,
      role: account.role,
      targetId: account.target_id,
      buyerType
    },
    MINI_JWT_SECRET,
    {
      expiresIn: MINI_TOKEN_TTL,
      audience: MINI_TOKEN_AUDIENCE,
      issuer: MINI_TOKEN_ISSUER
    }
  );
}

/** 签发绑定票据（仅用于「已拿到 openid 但尚未绑定」的中间态） */
function signBindTicket(openid, unionid) {
  return jwt.sign({ tokenUse: BIND_TICKET_USE, openid, unionid: unionid || null }, MINI_JWT_SECRET, {
    expiresIn: BIND_TICKET_TTL,
    audience: MINI_TOKEN_AUDIENCE,
    issuer: MINI_TOKEN_ISSUER
  });
}

function verifyBindTicket(ticket) {
  try {
    const p = jwt.verify(ticket, MINI_JWT_SECRET, {
      audience: MINI_TOKEN_AUDIENCE,
      issuer: MINI_TOKEN_ISSUER
    });
    if (p.tokenUse !== BIND_TICKET_USE || !p.openid) return null;
    return p;
  } catch (e) {
    return null;
  }
}

// ── 账号查询 ─────────────────────────────────────────────────────────────────
async function findByOpenid(conn, openid) {
  const [rows] = await conn.execute(
    `SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, last_login_at
       FROM mini_accounts WHERE openid = ?`,
    [openid]
  );
  return rows.length ? rows[0] : null;
}

async function findById(conn, id) {
  const [rows] = await conn.execute(
    `SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, last_login_at, created_at
       FROM mini_accounts WHERE id = ?`,
    [id]
  );
  return rows.length ? rows[0] : null;
}

/**
 * 手机号脱敏（§54：「最小必要 …… 列表展示建议脱敏」）
 * ⚠️ 这条不只是「建议」的落地：手机号属个人信息，出现在接口响应里就会被小程序端缓存、
 *    被日志采集、被截图外传。展示层只需要能认出「是不是我的号」，不需要完整号码。
 *    真正需要完整号码的场景（下单联系人）由用户当次输入，不由接口回吐。
 */
function maskPhone(phone) {
  if (!phone) return null;
  const s = String(phone);
  if (s.length <= 4) return s;
  if (s.length <= 7) return `${s.slice(0, 2)}****${s.slice(-2)}`;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 主体名称与状态（用于 /me 展示、以及登录时的启用校验） */
async function loadSubject(conn, role, targetId) {
  if (role === MINI_ROLES.SALESMAN) {
    const [rows] = await conn.execute(
      'SELECT worker_id AS id, worker_name AS name, phone, status FROM workers WHERE worker_id = ?',
      [targetId]
    );
    return rows.length ? { ...rows[0], phone: maskPhone(rows[0].phone), type: 'SALESMAN' } : null;
  }
  if (role === MINI_ROLES.STATION) {
    const [rows] = await conn.execute(
      'SELECT station_id AS id, station_name AS name, phone, address, contact_name, status FROM sub_stations WHERE station_id = ?',
      [targetId]
    );
    return rows.length ? { ...rows[0], phone: maskPhone(rows[0].phone), type: 'STATION' } : null;
  }
  if (role === MINI_ROLES.ADMIN) {
    const [rows] = await conn.execute('SELECT id, display_name AS name, phone FROM users WHERE id = ?', [targetId]);
    // users 表没有 status 列，管理员视为恒启用；启用与否由 mini_accounts.status 控制
    return rows.length
      ? { id: String(rows[0].id), name: rows[0].name, phone: maskPhone(rows[0].phone), status: 1, type: 'ADMIN' }
      : null;
  }
  return null;
}

/**
 * 手机号 → 主体匹配（§4.2 / §4.3 / §4.4）
 *
 * 业务员：workers.employee_type = EMPLOYEE_TYPE.SALESMAN（业务员并入员工管理，不单独维护 salesmen 主数据）
 * 直营水站：sub_stations.station_id
 * 管理员：users.role = 'admin'（小程序管理员无独立档案，绑定 Web 用户）
 *
 * ⚠️ 跨表比较注意 collation：workers / users / sub_stations 三张表的字符集不完全一致
 *    （仓库既有陷阱：workers 与 salesmen 归档表 collation 不同，需显式 COLLATE）。
 *    这里用**参数化查询逐表比较**，不做跨表 JOIN，从根上避开该问题。
 *
 * @returns {Promise<Array<{role:string,targetId:string,name:string,status:number}>>} 全部匹配项
 */
async function matchSubjectsByPhone(conn, phone) {
  const matches = [];

  const [workers] = await conn.execute(
    `SELECT worker_id AS id, worker_name AS name, status FROM workers
      WHERE phone = ? AND employee_type = ? ORDER BY worker_id ASC`,
    [phone, EMPLOYEE_TYPE.SALESMAN]
  );
  for (const w of workers) {
    matches.push({ role: MINI_ROLES.SALESMAN, targetId: w.id, name: w.name, status: Number(w.status) });
  }

  const [stations] = await conn.execute(
    `SELECT station_id AS id, station_name AS name, status FROM sub_stations
      WHERE phone = ? ORDER BY station_id ASC`,
    [phone]
  );
  for (const s of stations) {
    matches.push({ role: MINI_ROLES.STATION, targetId: s.id, name: s.name, status: Number(s.status) });
  }

  const [users] = await conn.execute(
    `SELECT id, display_name AS name FROM users WHERE phone = ? AND role = 'admin' ORDER BY id ASC`,
    [phone]
  );
  for (const u of users) {
    matches.push({ role: MINI_ROLES.ADMIN, targetId: String(u.id), name: u.name, status: 1 });
  }

  return matches;
}

// ── 绑定 ─────────────────────────────────────────────────────────────────────
/**
 * 完成绑定：openid + 手机号 → mini_accounts 行
 *
 * @param {object} conn
 * @param {object} p { openid, unionid, phone, nickname, avatarUrl, roleHint?(仅 dev), actorType }
 */
async function bindAccount(conn, { openid, unionid, phone, nickname, avatarUrl, roleHint = null, actorType = 'MINI' }) {
  if (!phone) throw businessError('缺少手机号，无法完成绑定');

  const matches = await matchSubjectsByPhone(conn, phone);
  const usable = roleHint ? matches.filter(m => m.role === roleHint) : matches;

  if (usable.length === 0) {
    throw businessError('未找到与该手机号匹配的业务员 / 直营水站 / 管理员，请联系管理员在后台绑定');
  }
  if (usable.length > 1) {
    // ⚠️ 不猜、不取第一条：手机号无法唯一匹配时由管理员处理（§4.4）
    const desc = usable.map(m => `${m.name}(${m.role})`).join('、');
    throw businessError(`该手机号匹配到多条记录（${desc}），无法自动绑定，请联系管理员处理`);
  }

  const subject = usable[0];
  if (Number(subject.status) !== 1) {
    throw businessError('绑定主体已停用，无法绑定，请联系管理员');
  }

  // 是否已被别的微信账号占用（应用层先查一次，给出可读提示；唯一索引仍会兜底并发）
  const [occupied] = await conn.execute(
    `SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? AND status = 1`,
    [subject.role, subject.targetId]
  );
  if (occupied.length) {
    throw businessError('该主体已绑定其他微信账号，请先在后台解绑或停用原账号');
  }

  let accountId;
  try {
    const [result] = await conn.execute(
      `INSERT INTO mini_accounts (openid, union_id, phone, role, target_id, nickname, avatar_url, status, last_login_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [openid, unionid || null, phone, subject.role, subject.targetId, nickname || null, avatarUrl || null]
    );
    accountId = result.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // 两种情况：openid 已绑定过，或 uk_role_active 命中（并发下的「一个水站一个微信账号」）
      const opened = await findByOpenid(conn, openid);
      if (opened) return { account: opened, subject, created: false };
      throw businessError('该主体已绑定其他微信账号，请先在后台解绑或停用原账号');
    }
    throw e;
  }

  // 钱包跟随主体开立：⚠️ 若该主体此前绑定过（钱包已存在），ensureWallet 会**复用**它 ——
  // 这正是 §44.11 ⑥ 要求的「解绑后换新微信账号绑定同一水站，钱包余额随 station_id 保持连续」。
  const ownerType = ROLE_TO_OWNER_TYPE[subject.role];
  if (ownerType) {
    await ensureWallet(conn, { ownerType, ownerId: subject.targetId, ownerName: subject.name });
  }

  await writeAuditLog(conn, {
    action: AUDIT_ACTION.BIND,
    actorType,
    actorId: openid ? `openid:${String(openid).slice(0, 8)}***` : null,
    targetType: 'MINI_ACCOUNT',
    targetId: String(accountId),
    detail: {
      role: subject.role,
      targetId: subject.targetId,
      subjectName: subject.name,
      phoneTail: String(phone).slice(-4)
    }
  });

  const account = await findById(conn, accountId);
  return { account, subject, created: true };
}

/**
 * 登录（§4.4）：已绑定的直接签发令牌；未绑定的回传 bindTicket 让前端去申请手机号
 * @returns {Promise<object>} 见下方 return
 */
async function loginWithWxCode({ code, phoneCode, nickname, avatarUrl }) {
  const session = await wxMiniClient.code2session(code);
  const conn = await pool.getConnection();
  try {
    const account = await findByOpenid(conn, session.openid);

    // 已有绑定
    if (account) {
      await assertAccountUsable(conn, account);
      await conn.execute('UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?', [account.id]);
      const subject = await loadSubject(conn, account.role, account.target_id);
      return {
        status: 'OK',
        token: signMiniToken(account),
        account: publicAccount(account, subject)
      };
    }

    // 未绑定：带手机号 code 则一次性完成绑定
    if (phoneCode) {
      const { phone } = await wxMiniClient.getPhoneNumber(phoneCode);
      await conn.beginTransaction();
      try {
        const bound = await bindAccount(conn, {
          openid: session.openid,
          unionid: session.unionid,
          phone,
          nickname,
          avatarUrl
        });
        await conn.execute('UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?', [bound.account.id]);
        await conn.commit();
        return {
          status: 'OK',
          token: signMiniToken(bound.account),
          account: publicAccount(bound.account, bound.subject),
          bound: bound.created
        };
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    }

    // 未绑定且还没拿到手机号 → 只回传 bindTicket（不暴露 openid）
    return {
      status: 'NEED_BIND',
      bindTicket: signBindTicket(session.openid, session.unionid),
      reason: 'PHONE_REQUIRED',
      message: '请授权微信手机号完成身份绑定'
    };
  } finally {
    conn.release();
  }
}

/** 用 bindTicket + 手机号 code 完成绑定 */
async function bindWithTicket({ bindTicket, phoneCode, nickname, avatarUrl }) {
  const ticket = verifyBindTicket(bindTicket);
  if (!ticket) throw businessError('绑定票据已失效，请重新登录');

  const { phone } = await wxMiniClient.getPhoneNumber(phoneCode);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    try {
      const bound = await bindAccount(conn, {
        openid: ticket.openid,
        unionid: ticket.unionid,
        phone,
        nickname,
        avatarUrl
      });
      await conn.execute('UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?', [bound.account.id]);
      await conn.commit();
      const subject = await loadSubject(conn, bound.account.role, bound.account.target_id);
      return { token: signMiniToken(bound.account), account: publicAccount(bound.account, subject) };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  } finally {
    conn.release();
  }
}

/**
 * 本地开发登录通道（**默认关闭**）
 *
 * ⚠️ 为什么存在：微信登录依赖真实 WX_APPID / WX_SECRET，且 wx.login 的 code
 *    只能在真机/开发者工具换取。没有它，「在微信开发者工具里跑起来」这件事在
 *    资质就绪前无法完成（§13.8 已把「不受开发进度控制的最长外部依赖」单列出来）。
 *
 * ⚠️ 边界（刻意收紧，避免变成资产安全缺口）：
 *   ① 必须显式设置 MINI_DEV_LOGIN=1 才可用，**默认关闭**；
 *   ② 仍然要求手机号能匹配到**真实存在的**业务员 / 水站 / 管理员 —— 不创建任何假数据；
 *   ③ 不做角色自由选择：role 只用于在**已匹配到的多条**真实记录里消歧
 *      （现状库中 users.phone 与 sub_stations.phone 确有重号，属真实数据特征）；
 *   ④ 生产环境必须移除该环境变量。
 */
async function devLogin({ phone, role }) {
  if (process.env.MINI_DEV_LOGIN !== '1') throw businessError('本地开发登录未开启');
  if (!phone) throw businessError('缺少手机号');

  const conn = await pool.getConnection();
  try {
    // 已绑定的直接给令牌；未绑定的用合成 openid 建立绑定（合成值带 dev_ 前缀，便于识别清理）
    const [existing] = await conn.execute(
      `SELECT id, openid, union_id, phone, role, target_id, nickname, avatar_url, status, last_login_at
         FROM mini_accounts WHERE phone = ? AND status = 1 ORDER BY id ASC LIMIT 1`,
      [phone]
    );

    if (existing.length) {
      const account = existing[0];
      await assertAccountUsable(conn, account);
      await conn.execute('UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?', [account.id]);
      const subject = await loadSubject(conn, account.role, account.target_id);
      return { token: signMiniToken(account), account: publicAccount(account, subject), devLogin: true };
    }

    await conn.beginTransaction();
    try {
      // 用确定性合成 openid（dev_ + 手机号）而不是随机值：同一手机号重复登录得到同一账号，
      // 不会每次都新建 mini_accounts 行。
      const syntheticOpenid = `dev_${phone}`;
      const bound = await bindAccount(conn, {
        openid: syntheticOpenid,
        unionid: null,
        phone,
        nickname: '本地开发账号',
        avatarUrl: null,
        roleHint: role || null,
        actorType: 'DEV'
      });
      await conn.execute('UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?', [bound.account.id]);
      await conn.commit();
      const subject = await loadSubject(conn, bound.account.role, bound.account.target_id);
      return { token: signMiniToken(bound.account), account: publicAccount(bound.account, subject), devLogin: true };
    } catch (e) {
      await conn.rollback();
      throw e;
    }
  } finally {
    conn.release();
  }
}

/**
 * 登录可用性校验（§4.5）：
 *   禁止新登录 —— 账号停用、或绑定主体停用，都不允许**新登录**。
 *   （注意与「禁用后持旧令牌读历史」的区别：那是 miniAuth 的 requireMiniActive 负责的读/写分离）
 */
async function assertAccountUsable(conn, account) {
  if (Number(account.status) !== 1) {
    const e = new Error('账号已被禁用，如有疑问请联系管理员');
    e.business = true;
    e.httpStatus = 401;
    throw e;
  }
  const subject = await loadSubject(conn, account.role, account.target_id);
  if (!subject) {
    const e = new Error('绑定的主体不存在，请联系管理员重新绑定');
    e.business = true;
    e.httpStatus = 401;
    throw e;
  }
  if (Number(subject.status) !== 1) {
    const e = new Error('绑定的主体已被停用，如有疑问请联系管理员');
    e.business = true;
    e.httpStatus = 401;
    throw e;
  }
}

/** 对外可见的账号信息（**不含 openid / union_id / session_key**，§54） */
function publicAccount(account, subject) {
  return {
    id: account.id,
    role: account.role,
    targetId: account.target_id,
    phoneTail: account.phone ? String(account.phone).slice(-4) : null,
    nickname: account.nickname || null,
    avatarUrl: account.avatar_url || null,
    status: Number(account.status),
    subjectName: subject ? subject.name : null,
    subjectCode: subject ? subject.id : null,
    lastLoginAt: account.last_login_at || null
  };
}

/** /api/mini/me 用：账号 + 主体 + 钱包 */
async function getAccountProfile(conn, accountId) {
  const account = await findById(conn, accountId);
  if (!account) return null;
  const subject = await loadSubject(conn, account.role, account.target_id);
  return { account: publicAccount(account, subject), subject };
}

module.exports = {
  signMiniToken,
  verifyBindTicket,
  findByOpenid,
  findById,
  loadSubject,
  matchSubjectsByPhone,
  bindAccount,
  loginWithWxCode,
  bindWithTicket,
  devLogin,
  getAccountProfile,
  publicAccount,
  maskPhone
};

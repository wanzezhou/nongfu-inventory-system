const jwt = require('jsonwebtoken');
const { pool } = require('../../config/db');
const wechat = require('../../utils/wechat');
const sms = require('../../utils/sms');

const JWT_SECRET = process.env.JWT_SECRET || 'nongfu_inventory_secret_2026';
const JWT_EXPIRES = '7d';

// 根据角色和 targetId 获取显示名称
async function getDisplayName(role, targetId) {
  let tableName, idField, nameField;
  switch (role) {
    case 'admin':    tableName = 'users';       idField = 'id';          nameField = 'display_name';  break;
    case 'worker':   tableName = 'workers';     idField = 'worker_id';   nameField = 'worker_name';   break;
    case 'station':  tableName = 'sub_stations'; idField = 'station_id'; nameField = 'station_name'; break;
    case 'salesman': tableName = 'salesmen';    idField = 'salesman_id'; nameField = 'salesman_name'; break;
    default: return null;
  }
  const [rows] = await pool.query(
    `SELECT ${nameField} AS name FROM ${tableName} WHERE ${idField} = ?`,
    [targetId]
  );
  return rows.length > 0 ? rows[0].name : null;
}

// 根据手机号匹配四个业务表，返回角色、targetId、名称
async function matchPhone(phone) {
  // users
  let [rows] = await pool.query(
    'SELECT id, display_name AS name FROM users WHERE phone = ?',
    [phone]
  );
  if (rows.length > 0) return { role: 'admin', targetId: String(rows[0].id), name: rows[0].name };

  // workers
  [rows] = await pool.query(
    'SELECT worker_id, worker_name AS name FROM workers WHERE phone = ?',
    [phone]
  );
  if (rows.length > 0) return { role: 'worker', targetId: rows[0].worker_id, name: rows[0].name };

  // sub_stations
  [rows] = await pool.query(
    'SELECT station_id, station_name AS name FROM sub_stations WHERE phone = ?',
    [phone]
  );
  if (rows.length > 0) return { role: 'station', targetId: rows[0].station_id, name: rows[0].name };

  // salesmen
  [rows] = await pool.query(
    'SELECT salesman_id, salesman_name AS name FROM salesmen WHERE phone = ?',
    [phone]
  );
  if (rows.length > 0) return { role: 'salesman', targetId: rows[0].salesman_id, name: rows[0].name };

  return null;
}

// 签发 JWT
function signToken(account) {
  return jwt.sign(
    {
      id: account.id,
      openid: account.openid,
      role: account.role,
      targetId: account.target_id,
      phone: account.phone,
      source: 'mini'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

// 微信登录
async function wxLogin(req, res) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.json({ code: 400, message: '缺少微信登录 code', data: null });
    }

    const { openid, sessionKey, unionid } = await wechat.code2session(code);

    const [rows] = await pool.query(
      'SELECT * FROM mini_accounts WHERE openid = ? AND status = 1',
      [openid]
    );

    if (rows.length > 0) {
      const account = rows[0];
      // 更新最后登录时间
      await pool.query(
        'UPDATE mini_accounts SET last_login_at = NOW() WHERE id = ?',
        [account.id]
      );

      const name = await getDisplayName(account.role, account.target_id);
      const token = signToken(account);

      return res.json({
        code: 200,
        message: '登录成功',
        data: {
          token,
          needBind: false,
          userInfo: {
            role: account.role,
            name,
            phone: account.phone,
            avatar: account.avatar_url
          }
        }
      });
    }

    // 未绑定，返回需要绑定手机号
    return res.json({
      code: 200,
      data: {
        needBind: true,
        openid,
        sessionKey,
        message: '请绑定手机号'
      }
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '微信登录失败: ' + error.message,
      data: null
    });
  }
}

// 绑定手机号
async function bindPhone(req, res) {
  try {
    const { openid, encryptedData, iv, sessionKey } = req.body;
    if (!openid || !encryptedData || !iv || !sessionKey) {
      return res.json({ code: 400, message: '缺少必要参数', data: null });
    }

    const decrypted = wechat.decryptData(sessionKey, encryptedData, iv);
    const phone = decrypted.phoneNumber || decrypted.purePhoneNumber;

    if (!phone) {
      return res.json({ code: 400, message: '无法获取手机号', data: null });
    }

    const matched = await matchPhone(phone);
    if (!matched) {
      return res.json({
        code: 404,
        message: '该手机号未注册，请联系管理员',
        data: { adminPhone: '13800138000' }
      });
    }

    // 已有 PC 端占位记录？按 role + target_id 查找
    const [existingByTarget] = await pool.query(
      'SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? LIMIT 1',
      [matched.role, matched.targetId]
    );

    if (existingByTarget.length > 0) {
      // 更新已存在记录的 openid/phone/status/last_login_at
      await pool.query(
        `UPDATE mini_accounts SET openid = ?, phone = ?, status = 1, last_login_at = NOW() WHERE id = ?`,
        [openid, phone, existingByTarget[0].id]
      );
    } else {
      // 真正新建（以 openid 为键防重复）
      await pool.query(
        `INSERT INTO mini_accounts (openid, phone, role, target_id, status, last_login_at)
         VALUES (?, ?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE
           phone = VALUES(phone),
           role = VALUES(role),
           target_id = VALUES(target_id),
           status = 1,
           last_login_at = NOW()`,
        [openid, phone, matched.role, matched.targetId]
      );
    }

    // 查回记录以获取 id
    const [rows] = await pool.query(
      'SELECT * FROM mini_accounts WHERE openid = ?',
      [openid]
    );
    const account = rows[0];
    const token = signToken(account);

    return res.json({
      code: 200,
      message: '绑定成功',
      data: {
        token,
        userInfo: {
          role: matched.role,
          name: matched.name,
          phone
        }
      }
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '绑定手机号失败: ' + error.message,
      data: null
    });
  }
}

// 发送短信验证码
async function sendSms(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.json({ code: 400, message: '请输入手机号', data: null });
    }

    // 60 秒内已发送且未使用，限流
    const [recent] = await pool.query(
      'SELECT id FROM sms_codes WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) AND used = 0 ORDER BY id DESC LIMIT 1',
      [phone]
    );
    if (recent.length > 0) {
      return res.json({
        code: 429,
        message: '验证码发送过于频繁，请60秒后再试',
        data: null
      });
    }

    // 30 分钟内未使用的验证码达到 5 条以上，锁定
    const [failed] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM sms_codes WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE) AND used = 0',
      [phone]
    );
    if (failed[0].cnt >= 5) {
      return res.json({
        code: 429,
        message: '操作过于频繁，请30分钟后再试',
        data: null
      });
    }

    const code = sms.generateCode();

    await pool.query(
      `INSERT INTO sms_codes (phone, code, type, expires_at, used)
       VALUES (?, ?, 'login', DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0)`,
      [phone, code]
    );

    await sms.sendSmsCode(phone, code);

    return res.json({
      code: 200,
      message: '验证码已发送',
      data: null
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '发送验证码失败: ' + error.message,
      data: null
    });
  }
}

// 短信验证码登录
async function smsLogin(req, res) {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) {
      return res.json({ code: 400, message: '请输入手机号和验证码', data: null });
    }

    // 校验验证码
    const [codeRows] = await pool.query(
      'SELECT id FROM sms_codes WHERE phone = ? AND code = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
      [phone, code]
    );
    if (codeRows.length === 0) {
      return res.json({
        code: 400,
        message: '验证码错误或已过期',
        data: null
      });
    }

    // 标记验证码已使用
    await pool.query('UPDATE sms_codes SET used = 1 WHERE id = ?', [codeRows[0].id]);

    // 匹配手机号
    const matched = await matchPhone(phone);
    if (!matched) {
      return res.json({
        code: 404,
        message: '该手机号未注册，请联系管理员',
        data: null
      });
    }

    // 短信登录无 openid，使用合成值（openid 列 NOT NULL UNIQUE）
    const syntheticOpenid = `sms_${phone}`;

    await pool.query(
      `INSERT INTO mini_accounts (openid, phone, role, target_id, status, last_login_at)
       VALUES (?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         phone = VALUES(phone),
         role = VALUES(role),
         target_id = VALUES(target_id),
         status = 1,
         last_login_at = NOW()`,
      [syntheticOpenid, phone, matched.role, matched.targetId]
    );

    const [rows] = await pool.query(
      'SELECT * FROM mini_accounts WHERE openid = ?',
      [syntheticOpenid]
    );
    const account = rows[0];
    const token = signToken(account);

    return res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        userInfo: {
          role: matched.role,
          name: matched.name,
          phone
        }
      }
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '短信登录失败: ' + error.message,
      data: null
    });
  }
}

// 获取当前用户信息
async function getMe(req, res) {
  try {
    const miniUser = req.miniUser;

    // 查询 mini_accounts 获取头像、昵称、手机号
    const [accRows] = await pool.query(
      'SELECT id, role, target_id, phone, avatar_url, nickname FROM mini_accounts WHERE id = ?',
      [miniUser.id]
    );
    if (accRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在', data: null });
    }
    const account = accRows[0];

    const name = await getDisplayName(account.role, account.target_id);

    // station 角色返回 stationName
    let stationName = null;
    if (account.role === 'station') {
      stationName = name;
    }

    return res.json({
      code: 200,
      message: 'success',
      data: {
        id: account.id,
        role: account.role,
        targetId: account.target_id,
        name,
        phone: account.phone,
        avatar: account.avatar_url,
        stationName
      }
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '获取用户信息失败: ' + error.message,
      data: null
    });
  }
}

// 更新手机号
async function updatePhone(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.json({ code: 400, message: '请输入手机号', data: null });
    }

    await pool.query(
      'UPDATE mini_accounts SET phone = ? WHERE id = ?',
      [phone, req.miniUser.id]
    );

    return res.json({
      code: 200,
      message: '手机号更新成功',
      data: null
    });
  } catch (error) {
    return res.json({
      code: 500,
      message: '更新手机号失败: ' + error.message,
      data: null
    });
  }
}

// 退出登录（JWT 无状态，直接返回成功）
async function logout(req, res) {
  return res.json({
    code: 200,
    message: '退出成功',
    data: null
  });
}

module.exports = {
  wxLogin,
  bindPhone,
  sendSms,
  smsLogin,
  getMe,
  updatePhone,
  logout
};

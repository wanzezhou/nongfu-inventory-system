const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { success, error, unauthorized } = require('../utils/response');

// ⚠️ 不提供 fallback 默认值：密钥缺失时必须在启动阶段就失败，而不是悄悄用一个
// 公开的默认值签发 token（历史缺陷 S2）。与 middleware/auth.js 同一口径。
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('环境变量 JWT_SECRET 未配置，拒绝启动。请在 backend/.env 中设置强随机密钥。');
}
const JWT_EXPIRES = '7d';

// 登录
async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return error(res, '用户名和密码不能为空', 400);
    }

    // 显式列出字段，不用 SELECT *（列变更时隐式耦合，且会拖多余的网络与内存）
    const [rows] = await pool.query(
      'SELECT id, username, password, display_name, role FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return unauthorized(res, '用户名或密码错误');
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return unauthorized(res, '用户名或密码错误');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    return success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      }
    }, '登录成功');
  } catch (err) {
    // 明细只进日志，不出参（生产环境由 response.error 统一屏蔽 5xx 文案）
    console.error('登录失败:', err);
    return error(res, '登录失败，请稍后重试', 500);
  }
}

// 验证token
async function getProfile(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, display_name, role FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return error(res, '用户不存在', 404);
    }

    const user = rows[0];
    return success(res, {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role
    });
  } catch (err) {
    console.error('获取用户信息失败:', err);
    return error(res, '获取用户信息失败，请稍后重试', 500);
  }
}

// 修改密码
async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return error(res, '请输入旧密码和新密码', 400);
    }

    const [rows] = await pool.query(
      'SELECT id, password FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return error(res, '用户不存在', 404);
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return error(res, '旧密码错误', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.user.id]
    );

    return success(res, null, '密码修改成功');
  } catch (err) {
    console.error('修改密码失败:', err);
    return error(res, '修改密码失败，请稍后重试', 500);
  }
}

module.exports = {
  login,
  getProfile,
  changePassword
};

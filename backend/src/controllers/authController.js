const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'nongfu_inventory_secret_2026';
const JWT_EXPIRES = '7d';

// 登录
async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ code: 400, message: '用户名和密码不能为空', data: null });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.json({ code: 401, message: '用户名或密码错误', data: null });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.json({ code: 401, message: '用户名或密码错误', data: null });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.json({ code: 500, message: '服务器内部错误', data: null });
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
      return res.json({ code: 404, message: '用户不存在', data: null });
    }

    const user = rows[0];
    res.json({
      code: 200,
      message: 'success',
      data: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('获取用户信息失败:', error);
    res.json({ code: 500, message: '服务器内部错误', data: null });
  }
}

// 修改密码
async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.json({ code: 400, message: '请输入旧密码和新密码', data: null });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.json({ code: 404, message: '用户不存在', data: null });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.json({ code: 400, message: '旧密码错误', data: null });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, req.user.id]
    );

    res.json({ code: 200, message: '密码修改成功', data: null });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.json({ code: 500, message: '服务器内部错误', data: null });
  }
}

module.exports = {
  login,
  getProfile,
  changePassword
};

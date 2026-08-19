const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

async function seedUser() {
  try {
    // 创建用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
        password VARCHAR(255) NOT NULL COMMENT '密码(bcrypt加密)',
        display_name VARCHAR(50) NOT NULL COMMENT '显示名称',
        role VARCHAR(20) NOT NULL DEFAULT 'admin' COMMENT '角色',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表'
    `);
    console.log('users表已创建');

    const hashedPassword = await bcrypt.hash('admin123', 10);

    await pool.query(
      `INSERT INTO users (username, password, display_name, role)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password = VALUES(password), display_name = VALUES(display_name)`,
      ['admin', hashedPassword, '管理员', 'admin']
    );

    console.log('默认管理员账户已创建: admin / admin123');
    process.exit(0);
  } catch (error) {
    console.error('创建用户失败:', error.message);
    process.exit(1);
  }
}

seedUser();

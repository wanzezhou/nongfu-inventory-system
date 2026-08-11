const { pool } = require('../config/db');

async function seedMiniRbac() {
  try {
    // 1. 创建 mini_accounts 表（小程序账号绑定表）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mini_accounts (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        openid        VARCHAR(64)  UNIQUE NOT NULL  COMMENT '微信openid',
        union_id      VARCHAR(64)  DEFAULT NULL     COMMENT '微信unionid(可选)',
        phone         VARCHAR(20)  DEFAULT NULL     COMMENT '手机号',
        role          ENUM('admin','worker','station','salesman') NOT NULL COMMENT '角色',
        target_id     VARCHAR(50)  DEFAULT NULL     COMMENT '关联实体ID',
        nickname      VARCHAR(50)  DEFAULT NULL     COMMENT '微信昵称',
        avatar_url    VARCHAR(500) DEFAULT NULL     COMMENT '微信头像URL',
        status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
        last_login_at DATETIME     DEFAULT NULL     COMMENT '最后登录时间',
        created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_openid (openid),
        INDEX idx_phone (phone),
        INDEX idx_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序账号绑定表'
    `);
    console.log('mini_accounts表已创建');

    // 2. 创建 salesmen 表（业务员表）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salesmen (
        salesman_id      VARCHAR(50) PRIMARY KEY     COMMENT '业务员ID',
        salesman_name    VARCHAR(50) NOT NULL        COMMENT '姓名',
        phone            VARCHAR(20) DEFAULT NULL    COMMENT '手机号',
        commission_rate  DECIMAL(5,2) DEFAULT 0.00   COMMENT '提成比例(%)',
        status           TINYINT NOT NULL DEFAULT 1  COMMENT '1在职 0离职',
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_phone (phone),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业务员表'
    `);
    console.log('salesmen表已创建');

    // 3. 创建 sms_codes 表（短信验证码表）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sms_codes (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        phone       VARCHAR(20) NOT NULL             COMMENT '手机号',
        code        VARCHAR(6)  NOT NULL             COMMENT '验证码',
        type        VARCHAR(20) DEFAULT 'login'      COMMENT 'login=登录 change_phone=换绑',
        expires_at  DATETIME    NOT NULL             COMMENT '过期时间(默认5分钟)',
        used        TINYINT     DEFAULT 0            COMMENT '0未使用 1已使用',
        created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone (phone),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='短信验证码表'
    `);
    console.log('sms_codes表已创建');

    // 4. 为 users 表添加 phone 列（幂等处理）
    const [columnRows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['users', 'phone']
    );

    if (columnRows.length === 0) {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN phone VARCHAR(20) DEFAULT NULL COMMENT '手机号' AFTER display_name
      `);
      console.log('users表已添加phone列');
    } else {
      console.log('users表phone列已存在，跳过');
    }

    // 5. 为 users 表添加 idx_phone 索引（幂等处理）
    const [indexRows] = await pool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      ['users', 'idx_phone']
    );

    if (indexRows.length === 0) {
      await pool.query(`ALTER TABLE users ADD INDEX idx_phone (phone)`);
      console.log('users表已添加idx_phone索引');
    } else {
      console.log('users表idx_phone索引已存在，跳过');
    }

    // 6. 为 mini_accounts 表添加 username 列（幂等处理）
    const [usernameColumnRows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['mini_accounts', 'username']
    );

    if (usernameColumnRows.length === 0) {
      await pool.query(`
        ALTER TABLE mini_accounts
        ADD COLUMN username VARCHAR(50) DEFAULT NULL COMMENT '登录账号' AFTER phone
      `);
      console.log('mini_accounts表已添加username列');
    } else {
      console.log('mini_accounts表username列已存在，跳过');
    }

    // 7. 为 mini_accounts 表添加 password_hash 列（幂等处理）
    const [passwordHashColumnRows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['mini_accounts', 'password_hash']
    );

    if (passwordHashColumnRows.length === 0) {
      await pool.query(`
        ALTER TABLE mini_accounts
        ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL COMMENT 'bcrypt密码哈希' AFTER username
      `);
      console.log('mini_accounts表已添加password_hash列');
    } else {
      console.log('mini_accounts表password_hash列已存在，跳过');
    }

    // 8. 为 mini_accounts.username 添加 UNIQUE 索引 idx_username（幂等处理）
    const [usernameIndexRows] = await pool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      ['mini_accounts', 'idx_username']
    );

    if (usernameIndexRows.length === 0) {
      await pool.query(`ALTER TABLE mini_accounts ADD UNIQUE INDEX idx_username (username)`);
      console.log('mini_accounts表已添加idx_username索引');
    } else {
      console.log('mini_accounts表idx_username索引已存在，跳过');
    }

    // 6. 为 mini_accounts 表添加 username 列（幂等）
    const [usernameCol] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['mini_accounts', 'username']
    );
    if (usernameCol.length === 0) {
      await pool.query(`
        ALTER TABLE mini_accounts
        ADD COLUMN username VARCHAR(50) DEFAULT NULL COMMENT '登录账号' AFTER phone
      `);
      console.log('mini_accounts表已添加username列');
    } else {
      console.log('mini_accounts表username列已存在，跳过');
    }

    // 7. 为 mini_accounts 表添加 password_hash 列（幂等）
    const [pwdCol] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      ['mini_accounts', 'password_hash']
    );
    if (pwdCol.length === 0) {
      await pool.query(`
        ALTER TABLE mini_accounts
        ADD COLUMN password_hash VARCHAR(255) DEFAULT NULL COMMENT 'bcrypt密码哈希' AFTER username
      `);
      console.log('mini_accounts表已添加password_hash列');
    } else {
      console.log('mini_accounts表password_hash列已存在，跳过');
    }

    // 8. 为 mini_accounts.username 添加 UNIQUE 索引 idx_username（幂等）
    const [usernameIdx] = await pool.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      ['mini_accounts', 'idx_username']
    );
    if (usernameIdx.length === 0) {
      await pool.query(`ALTER TABLE mini_accounts ADD UNIQUE INDEX idx_username (username)`);
      console.log('mini_accounts表已添加idx_username唯一索引');
    } else {
      console.log('mini_accounts表idx_username索引已存在，跳过');
    }

    console.log('mini RBAC 迁移完成');
    process.exit(0);
  } catch (error) {
    console.error('mini RBAC 迁移失败:', error.message);
    process.exit(1);
  }
}

seedMiniRbac();

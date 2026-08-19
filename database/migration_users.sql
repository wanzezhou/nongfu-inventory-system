-- 用户表
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `password` VARCHAR(255) NOT NULL COMMENT '密码(bcrypt加密)',
  `display_name` VARCHAR(50) NOT NULL COMMENT '显示名称',
  `role` VARCHAR(20) NOT NULL DEFAULT 'admin' COMMENT '角色: admin/user',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';

-- 插入默认管理员账户 (密码: admin123)
INSERT INTO `users` (`username`, `password`, `display_name`, `role`)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMy.MrqK3u5BH3qP1Dg3qF8x6QKZdJxKrK', '管理员', 'admin')
ON DUPLICATE KEY UPDATE `username` = `username`;

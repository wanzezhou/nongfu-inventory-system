// ============================================================================
// pm2 进程配置 —— 农夫山泉经销商进销存系统后端
//
// 用法：
//   pm2 start /opt/nongfu/deploy/ecosystem.config.js
//   pm2 save && pm2 startup
//
// ⚠️ 核心要点：cwd 必须是 backend 目录。
//    后端用 require('dotenv').config() 加载 .env，dotenv 是按**当前工作目录**找文件的；
//    cwd 不对 → .env 读不到 → 数据库连不上 / JWT_SECRET_MINI 缺失拒绝启动。
// ============================================================================

module.exports = {
  apps: [
    {
      name: 'nongfu-api',
      script: 'src/app.js',
      cwd: '/opt/nongfu/backend',

      // ⚠️ 单实例 fork 模式，不要改成 cluster：
      //   后端在内存里维护登录/接口限流计数（express-rate-limit 默认内存存储），
      //   多实例会让限流窗口各自为政；优雅关闭逻辑也按单进程设计。
      instances: 1,
      exec_mode: 'fork',

      // 内存占用超过 500M 自动重启，防止长期运行内存泄漏拖垮小内存机器
      max_memory_restart: '500M',

      // 崩溃自动重启
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 3000,

      // 优雅关闭信号（app.js 里监听了 SIGINT/SIGTERM 做连接池回收）
      kill_timeout: 12000,

      env: {
        NODE_ENV: 'production',
        // ⚠️ 时区务必显式指定：所有「按日期统计」的口径都依赖它
        TZ: 'Asia/Shanghai'
      },

      // 日志（⚠️ 目录要先建好：mkdir -p /var/log/nongfu）
      out_file: '/var/log/nongfu/api-out.log',
      error_file: '/var/log/nongfu/api-error.log',
      merge_logs: true,
      time: true,

      // 日志按天切割，保留 14 天，单文件超过 20M 也切
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_size: '20M',
      retain: 14
    }
  ]
};

// 执行回桶管理模块数据库迁移（幂等）
// 用法：在 backend 目录下运行 node scripts/migrate_barrel_module.js
const fs = require('fs')
const path = require('path')
const { pool } = require('../src/config/db')

const sqlFile = path.join(__dirname, '../../database/migration_barrel_module.sql')

async function run() {
  let sql = fs.readFileSync(sqlFile, 'utf8')
  // 先按行剥离注释（-- 开头），再按分号拆分语句
  const cleaned = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
  const statements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  for (const stmt of statements) {
    try {
      await pool.execute(stmt)
      console.log('OK:', stmt.slice(0, 60).replace(/\s+/g, ' '))
    } catch (err) {
      // 幂等：表/列/索引已存在时忽略
      if (/already exists|Duplicate|1050|1060|1061/i.test(err.message)) {
        console.log('SKIP (已存在):', stmt.slice(0, 60).replace(/\s+/g, ' '))
      } else {
        throw err
      }
    }
  }
  console.log('回桶管理迁移完成')
  await pool.end()
}

run().catch(err => {
  console.error('迁移失败:', err.message)
  process.exit(1)
})

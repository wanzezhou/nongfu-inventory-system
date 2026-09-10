/**
 * 视觉 token 门禁检查（DESIGN.md 配套）
 * ============================================
 * 用途：扫描前端视图层的硬编码色值，防止「token 体系回潮」（2026-09-09 起）。
 *
 * 规则（对应根目录 DESIGN.md）：
 *  - 禁止在 <style> 块 / 模板内联样式中写硬编码 hex 色值，必须使用语义 token
 *    （--text / --border / --primary / --el-color-* 等，见 frontend/src/style.css）。
 *  - 豁免 1：<script> 区整体跳过 —— ECharts canvas 不支持 CSS var()，图表配置
 *    需要字面色值（须与 token 色值保持一致，注释中标注）。
 *  - 豁免 2：SVG 属性（fill/stroke/stop-color）跳过 —— SVG 属性不支持 var()。
 *  - 豁免 3：纯黑 #000 / 纯白 #fff 字面量允许（阴影、遮罩等中性色无语义 token）。
 *
 * 运行：node scripts/check_frontend_tokens.js（backend 目录下执行，或任意目录）
 * 退出码：0 = 通过；1 = 存在违规（CI/冒烟流程可用退出码判断）。
 */
const fs = require('fs')
const path = require('path')

const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src')

// 允许的字面量（小写、展开为 6 位后比较）
const ALLOW = new Set(['#000000', '#ffffff'])

// SVG 中不支持 var() 的表现属性（按属性名豁免其取值中的 hex）
const SVG_ATTR_RE = /\b(?:fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*"(#[0-9A-Fa-f]{3,8})"/g
// <script> 区整体豁免
const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/g
// 通用 hex（3/4/6/8 位）
const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g

function expandHex(h) {
  const s = h.toLowerCase()
  if (s.length === 4) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return s.slice(0, 7)
}

/** 扫一段文本，返回违规行 [{ line, hex }] */
function scanText(text) {
  // 先抹掉豁免区（保留换行结构以维持行号）
  let masked = text.replace(SCRIPT_RE, (m) => m.replace(/[^\n]/g, ' '))
  masked = masked.replace(SVG_ATTR_RE, (m) => m.replace(/#/g, ' '))
  const violations = []
  const lines = masked.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEX_RE)
    if (!m) continue
    for (const raw of m) {
      if (!ALLOW.has(expandHex(raw))) {
        violations.push({ line: i + 1, hex: raw })
      }
    }
  }
  return violations
}

function collectFiles(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) collectFiles(p, exts, out)
    else if (exts.includes(path.extname(name))) out.push(p)
  }
  return out
}

const vueFiles = collectFiles(FRONTEND_SRC, ['.vue'])
// style.css 是 token 定义源文件（:root 变量本身即字面色值），属豁免对象
const cssFiles = [
  ...collectFiles(path.join(FRONTEND_SRC, 'styles'), ['.css']),
].filter((f) => fs.existsSync(f))

let total = 0
const report = []
for (const f of [...vueFiles, ...cssFiles]) {
  const text = fs.readFileSync(f, 'utf-8')
  const vs = scanText(text)
  if (vs.length) {
    total += vs.length
    report.push({ file: path.relative(path.dirname(FRONTEND_SRC), f), vs })
  }
}

if (total === 0) {
  console.log('✓ 视觉 token 门禁检查通过：视图层无违规硬编码色值')
  process.exit(0)
}

console.error(`✗ 视觉 token 门禁检查失败：发现 ${total} 处硬编码色值（应改用语义 token，见 frontend/src/style.css 与根目录 DESIGN.md）\n`)
for (const { file, vs } of report) {
  for (const { line, hex } of vs) {
    console.error(`  ${file}:${line}  ${hex}`)
  }
}
console.error('\n处理方式：改用 var(--token)；若位于 <script>（ECharts）或 SVG 属性中属于豁免范围，请确认本条扫描位置是否误判。')
process.exit(1)

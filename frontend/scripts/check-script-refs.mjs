/**
 * 前端静态检查：`<script setup>` 里引用了**未声明**的 `.value` 标识符
 * ---------------------------------------------------------------------------
 * 为什么需要它：Vue 模板能直接访问 props，但 **script 里不能** ——
 *   例 `defineProps(...)` 只赋给 `const props`，脚本中写 `moduleTitle.value` 会抛
 *   ReferenceError，表现为「点了按钮毫无反应（连确认框都不弹）」。
 *   这类错误 `@vue/compiler-sfc` 编译、`vite build`、token 门禁**全都查不出来**，
 *   只在真实点击时才炸 —— 机台管理页「删除」按钮就是这么坏的（2026-09-17 修）。
 *
 * 用法：node frontend/scripts/check-script-refs.mjs
 *   退出码非 0 表示存在可疑引用（需人工确认后修掉）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
// 本脚本位于 frontend/scripts/，故其上一级即前端工程根（不依赖 cwd）
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 已知全局 / 组合式 API 上下文，不作为「未声明」处理
const WHITELIST = new Set([
  'window',
  'document',
  'globalThis',
  'console',
  'Math',
  'JSON',
  'Object',
  'Array',
  'Number',
  'String',
  'Boolean',
  'Date',
  'Promise',
  'Set',
  'Map',
  'Symbol',
  'RegExp',
  'props',
  'attrs',
  'slots',
  'emit',
  'expose'
])

function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

/** 去掉块注释与行注释 —— 否则注释里写的示例（如「别写 moduleTitle.value」）会被误报 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ')
}

/** 从解构片段里抽出绑定的标识符（支持 a、a: b、a = 1、...rest） */
function addDestructured(target, group) {
  group.split(',').forEach(part => {
    const seg = part.trim()
    if (!seg) return
    const right = seg.includes(':') ? seg.split(':').slice(1).join(':') : seg
    const id = right
      .split('=')[0]
      .trim()
      .replace(/^\.\.\./, '')
    if (/^[A-Za-z_$][\w$]*$/.test(id)) target.add(id)
  })
}

export function findUndeclaredValueRefs(raw) {
  const code = stripComments(raw)
  const declared = new Set()
  const scan = (re, fn) => {
    let m
    while ((m = re.exec(code))) fn(m)
  }

  scan(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, m => declared.add(m[1]))
  scan(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g, m => addDestructured(declared, m[1]))
  scan(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g, m => addDestructured(declared, m[1]))
  scan(/\bfunction\s+([A-Za-z_$][\w$]*)/g, m => declared.add(m[1]))
  scan(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g, m => declared.add(m[1]))
  scan(/\bimport\s*\{([^}]*)\}\s*from/g, m => addDestructured(declared, m[1]))
  scan(/(?:async\s+)?function\s*[A-Za-z_$]*\s*\(([^)]*)\)\s*\{/g, m => addDestructured(declared, m[1]))
  scan(/\(([^()]*)\)\s*=>/g, m => addDestructured(declared, m[1]))

  // 只取「行首/分隔符后」的 x.value（排除 a.b.value 这种属性链）
  const used = new Set()
  scan(/(?<![.\w$])([A-Za-z_$][\w$]*)\.value\b/g, m => used.add(m[1]))

  return [...used].filter(n => !declared.has(n) && !WHITELIST.has(n))
}

/** 自测：确保检查器本身既不漏报也不因注释而误报 */
function selfTest() {
  const cases = [
    {
      name: '抓未声明引用',
      code: 'const props = defineProps({ a: String })\nconst x = ref(1)\nx.value\nfoo.value\n',
      expect: ['foo']
    },
    {
      name: '注释里的示例不算',
      code: '// 别写 moduleTitle.value\n/* bar.value */\nconst x = ref(1)\nx.value\n',
      expect: []
    },
    {
      name: '解构/参数/导入正确识别',
      code: "import { ref } from 'vue'\nconst { a: b } = props\nconst f = (row) => row.value\nconst g = ref(0)\ng.value\nb.value\n",
      expect: []
    },
    { name: '属性链不误判（a.value.k.value 只应看 a）', code: 'const o = ref({})\no.value.k.value\n', expect: [] }
  ]
  let bad = 0
  for (const c of cases) {
    const got = findUndeclaredValueRefs(c.code).sort().join(',')
    const want = [...c.expect].sort().join(',')
    const okCase = got === want
    if (!okCase) bad++
    console.log(`  ${okCase ? '✅' : '❌'} ${c.name}${okCase ? '' : `  → 期望 [${want}] 实得 [${got}]`}`)
  }
  console.log(bad === 0 ? '\n自测通过 ✓' : `\n自测失败 ${bad} 项 ✗`)
  process.exit(bad === 0 ? 0 : 1)
}

function main() {
  // ⚠️ 本检查需要前端依赖树里的 @vue/compiler-sfc（解析 SFC）。
  //    缺依赖时**必须显式失败并说清原因**——绝不可静默跳过：
  //    静默跳过 = CI 全绿但实际一行没查（假绿灯），比红更危险。
  //    2026-09-18：CI 的 static-gates job 因从不安装前端依赖，以原始
  //    MODULE_NOT_FOUND 堆栈报错，从日志上分不清「环境缺依赖」还是「代码有问题」，
  //    该 job 因此从上线起**永远不可能变绿**。
  let sfc
  try {
    sfc = require(path.join(FRONTEND, 'node_modules', '@vue', 'compiler-sfc'))
  } catch (e) {
    console.error('✗ 缺少依赖 @vue/compiler-sfc —— 本检查无法执行。')
    console.error('  安装：cd frontend && npm ci')
    console.error(`  原始错误：${e.message}`)
    process.exit(2) // 2 = 环境未就绪（区别于 1 = 确实查到可疑引用）
  }
  const files = walk(path.join(FRONTEND, 'src')).filter(f => f.endsWith('.vue'))
  let hits = 0
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    let descriptor
    try {
      descriptor = sfc.parse(src, { filename: path.basename(f) }).descriptor
    } catch (e) {
      continue
    }
    const code = [descriptor.scriptSetup?.content || '', descriptor.script?.content || ''].join('\n')
    if (!code.trim()) continue
    const missing = findUndeclaredValueRefs(code)
    if (missing.length) {
      hits++
      console.log(`⚠️ ${path.relative(FRONTEND, f)}  → 可能未声明: ${missing.join(', ')}`)
    }
  }
  if (hits === 0) {
    console.log(`✓ 前端脚本引用检查通过：${files.length} 个 .vue 中未发现「未声明的 .value 引用」`)
    process.exit(0)
  }
  console.log(`\n✗ 命中 ${hits} 个文件（模板里可用 props，脚本里必须 props.xxx）`)
  process.exit(1)
}

// Windows 下需用 pathToFileURL 比较（直接拼 file:// 会因斜杠数不一致而失配）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--selftest')) selfTest()
  else main()
}

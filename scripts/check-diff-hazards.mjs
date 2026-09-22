#!/usr/bin/env node
/**
 * 增量红线扫描器（G2 机器门禁）
 * =====================================================================
 * 为什么需要它：直接对全仓跑刚上线的 lint 规则，第一天就会有大量历史存量
 * 告警。若因此把闸门设成"全绿才可合并"，团队会在第二天把闸门关掉。
 *
 * 本脚本的策略是 **只对「本次改动新增的行」判定** ——
 *   - 历史存量：只统计、不阻断（作为基线数字供逐周收紧）
 *   - 本次新增：违规即失败
 * 这样闸门从第一天起就可执行，且存量不会因新代码的加入而变差（棘轮效应）。
 *
 * 规则来源：docs/代码审查标准.md 第三章（通用红线 R1–R7）
 *          每条规则都指向一次真实事故或历史缺陷，不要添加"通用最佳实践"。
 *
 * 用法：
 *   node scripts/check-diff-hazards.mjs              # 对比 origin/master，只判新增行
 *   node scripts/check-diff-hazards.mjs --base master
 *   node scripts/check-diff-hazards.mjs --all         # 全仓基线统计（始终退出 0）
 *   node scripts/check-diff-hazards.mjs --staged      # 只看暂存区（pre-commit 用）
 *
 * 豁免：在同一行写 `hazard-allow: <原因>` 注释即可豁免（必须写原因，便于评审追溯）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── 扫描范围：只扫业务源码，不扫配置/文档/脚本自身 ──────────────────
const INCLUDE = [/^backend\/src\/.*\.js$/, /^frontend\/src\/.*\.(js|vue)$/];
const SKIP = [/node_modules/, /\.min\.js$/, /^docs\//, /^\.github\//, /^scripts\//];

/** 红线规则。level: 'error' 阻断；'warn' 仅记录 */
const RULES = [
  {
    id: 'R1',
    level: 'error',
    name: 'mock/假数据兜底',
    // ⚠️ 2026-09-18 修正：原正则漏掉了 `generateProductMockData` —— 而它恰恰是本仓
    //   **唯一真实存在**的假数据兜底（OrderFormDialog 接口失败时伪造 15 个商品塞进下拉，
    //   用户会拿假商品开单）。专门为 F2 写的规则却没抓到 F2 的实例，属规则自身失效。
    //   补 `generate[A-Za-z]*Mock` 与 `Mock[A-Za-z]*Data` 两种驼峰写法。
    test: /generateMockData|generate[A-Za-z]*Mock|mockData|Mock[A-Za-z]*Data|mockList|mockOrders|mockProducts|fakeData|FAKE_/,
    why: '接口失败时把伪造数据塞进表格，用户会把测试假单当真实业务数据（历史缺陷 F2）'
  },
  {
    id: 'R2',
    level: 'error',
    name: '空 catch',
    test: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    why: '吞掉异常会让失败不可见，用户以为操作成功（历史缺陷 F1 的温床）'
  },
  {
    id: 'R2b',
    level: 'error',
    name: 'catch 中报成功',
    test: /catch[\s\S]*ElMessage\.success/,
    why: '操作失败却提示成功并关闭对话框，台账与实际脱节（历史缺陷 F1）',
    singleLineOnly: true
  },
  {
    id: 'R3',
    level: 'error',
    name: 'SELECT *',
    test: /select\s+\*\s+from/i,
    why: '拖网络与内存；列变更时隐式耦合（历史 37 处）'
  },
  {
    id: 'R4',
    level: 'error',
    name: '内部错误详情出参',
    // ⚠️ 2026-09-18 收窄（原文为 `(error|success|pagination)\(res\s*,[^)]*\.(message|stack)`）：
    //    原文把 `success(res, data, result.message)` 也判成"泄露内部错误详情" ——
    //    但 success 是 code:200 的成功出口，其 message 是服务层业务文案，
    //    结构上不可能携带内部错误，属**构造性误报**。门禁里的构造性误报会训练人忽略告警，
    //    最终让规则失效（本仓已有多次同类教训），故剔除 success / pagination。
    //    仍保留 error：服务层 result.message 有可能就是包装过的 err.message，
    //    这类必须在行内 `hazard-allow: <原因>` 显式豁免，评审可追溯。
    test: /error\(res\s*,[^)]*\.(message|stack)/,
    why: '把 err.message / stack 返回给客户端，泄露表结构、文件路径、库名（历史缺陷 S7）',
    onlyIn: [/^backend\//]
  },
  {
    id: 'R5',
    level: 'error',
    name: '硬编码取数上限',
    test: /(pageSize|page_size|limit|LIMIT)\s*[:=]\s*\d{3,}/,
    why: '超限即静默少算，属静默错数据（S1）。曾用 pageSize:500 拉其他支出明细、pageSize:100 拉商品下拉（本库 159 个商品 → 静默缺 59 个）',
    // ⚠️ 阈值定在 **3 位以上（≥100）**：2 位值（10 / 20 / 50）都是分页组件的常规页大小，
    //   不是「取数上限」。2026-09-18 修正前的正则 `\d{2,}` 会把 23 处正常分页默认值判红，
    //   与自身注释「前端分页组件的默认值（10）不在此列」自相矛盾 —— 误报会让规则迅速失去可信度。
    //   真实高风险取值就是 100 / 200 / 500 / 999 这一档，阈值 100 正好覆盖。
    // 正确做法：下拉/选项类数据走专用全量接口（/xxx/options、/xxx/all），不要借分页接口设上限。
    veto: /hazard-allow/
  },
  {
    id: 'R6',
    level: 'error',
    name: '硬编码服务地址',
    test: /https?:\/\/(localhost|127\.0\.0\.1):\d+/,
    why: '部署到服务器后前端全部请求 404（历史缺陷 S10）',
    onlyIn: [/^frontend\/src\//],
    veto: /\.env|VITE_|proxy|target/
  },
  {
    id: 'R7',
    level: 'warn',
    name: '裸 res.json（绕过统一响应工具）',
    test: /res\.json\s*\(/,
    why: '会造成第二套响应语义，含 HTTP 状态码口径分裂（本轮发现 #7）',
    onlyIn: [/^backend\//]
  },
  {
    id: 'R8',
    level: 'warn',
    name: '后端 console.log 残留',
    test: /console\.log\s*\(/,
    why: '后端应走正式日志（可观测性，本轮发现 #8）',
    onlyIn: [/^backend\//]
  },
  {
    id: 'R9',
    level: 'error',
    name: '疑似硬编码密钥',
    test: /(password|passwd|secret|token|api_?key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    why: '密钥硬编码（历史缺陷 S2：JWT 密钥曾带 fallback 并公开在 .env.example）',
    veto: /process\.env|import\.meta\.env|placeholder|your_|xxxx|示例|占位|localStorage/
  },
  {
    id: 'R10',
    level: 'warn',
    name: 'SELECT 缺少字段列表（SELECT 后紧跟反引号/变量）',
    test: /SELECT\s+\$\{/,
    why: '动态列名需确认来自服务端白名单，且优先显式列出字段',
    onlyIn: [/^backend\//]
  },
  {
    // 出处：2026-09-22 水票批次删除。SQL 是 `... WHERE issuance_id IN (${placeholders}) AND status = ?`，
    //       参数却写成 `[TICKET_STATUS.USED, ...ids]` —— 绑定错位成
    //       `issuance_id IN (2) AND status = 'WTI...'`，条件**恒不成立**（恒 0 行）。
    //       于是「批次内有已核销票则拒绝删除」这条守卫**完全失效**且长期无人发现：
    //       它不报错、不抛异常，只是永远放行 —— 属最难发现的一类缺陷（守卫写了却没生效）。
    //       行内单规则覆盖不到（SQL 与参数数组经常分作两行），故用 multi 同时看下一行。
    id: 'R11',
    level: 'error',
    name: 'SQL 占位符与参数数组顺序错位（会导致守卫恒不生效）',
    multi: (text, nextText, prevText = '') => {
      // 只认这个形态：同一句 SQL 里 `IN (${...})` 之后还有别的 `?`
      const m = /IN\s*\(\s*\$\{[^}]+\}\s*\)/.exec(text);
      if (!m || text.indexOf('?', m.index + m[0].length) === -1) return false;
      // 参数数组：优先取本行 SQL 之后的 `[...]`，否则取下一行行首的 `[...]`
      const inline = text.slice(m.index).match(/,\s*\[([^\]]*)\]/);
      const nextArr = nextText && nextText.match(/^\s*\[([^\]]*)\]/);
      const body = inline ? inline[1] : nextArr ? nextArr[1] : null;
      if (body === null) return false;
      // ⚠️ 判据必须按「IN 之前有几个 ?」定位，不能一律要求数组**首项**是展开：
      //    原判据默认 IN 在 SQL 最前面，于是
      //    `SET status = ?, used_at = ?, order_id = ? WHERE ticket_id IN (${...}) AND status = ?`
      //    配 `[USED, now, orderId, ...ids, UNUSED]`（**完全正确**的顺序）被误报
      //    （2026-09-22 实测）。误报会训练人忽略告警，等于让整条门禁失效。
      // ⚠️ SQL 跨行是常态（Prettier/printWidth）：IN 之前的 \`?\` 可能落在**上一行**。
      //    只在当前行数会得到 0 → 把 \`SET a=?, b=?, c=? WHERE id IN (\${...}) AND status=?\`
      //    这种**完全正确**的写法误报成「首项必须是展开」（2026-09-22 实测两轮才修对）。
      //    仅当上一行含 \`?\` 且**不含** \`IN (\${…})\` 时才拼接（避免把另一条语句的占位符算进来）。
      const head = prevText && /\?/.test(prevText) && !/IN\s*\(\s*\$\{/.test(prevText) ? prevText + '\n' : '';
      const placeholdersBefore = ((head + text.slice(0, m.index)).match(/\?/g) || []).length;
      const parts = body
        .split(',')
        .map(x => x.trim())
        .filter(x => x !== '');
      const target = parts[placeholdersBefore];
      if (!target) return false;
      return !target.startsWith('...');
    },
    why:
      'SQL 里 ? 的先后顺序决定参数绑定：`IN (${...})` 在前却把标量排在参数数组首位，' +
      '会绑定成 `IN (标量) AND x = 字符串`，条件恒不成立 → 守卫静默失效',
    onlyIn: [/^backend\//]
  }
];

// ── 工具函数 ────────────────────────────────────────────────────────
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isInScope(file) {
  if (SKIP.some(r => r.test(file))) return false;
  return INCLUDE.some(r => r.test(file));
}

/**
 * 解析 unified=0 的 diff，取出每个文件的新增行及其新行号。
 * 返回 Map<file, Array<{ line: number, text: string }>>
 */
function parseAddedLines(diffText) {
  const result = new Map();
  let currentFile = null;
  let newLineNo = 0;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ ')) {
      currentFile = raw
        .replace(/^\+\+\+ b\//, '')
        .replace(/^\+\+\+ /, '')
        .trim();
      continue;
    }
    if (raw.startsWith('@@')) {
      // @@ -a,b +c,d @@  → 取 +c 作为新文件起始行号
      const m = /\+(\d+)/.exec(raw);
      newLineNo = m ? Number(m[1]) - 1 : 0;
      continue;
    }
    if (!currentFile || !isInScope(currentFile)) continue;

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      newLineNo += 1;
      const text = raw.slice(1);
      if (!result.has(currentFile)) result.set(currentFile, []);
      result.get(currentFile).push({ line: newLineNo, text });
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // 删除行不占新行号
    } else if (raw.trim() !== '') {
      newLineNo += 1;
    }
  }
  return result;
}

/** 全仓模式：逐文件逐行扫描 */
function scanWorktree() {
  const files = git(['ls-files'])
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(isInScope);
  const map = new Map();
  for (const f of files) {
    let content;
    try {
      content = readFileSync(path.resolve(process.cwd(), f), 'utf8');
    } catch {
      continue;
    }
    map.set(
      f,
      content.split('\n').map((text, i) => ({ line: i + 1, text }))
    );
  }
  return map;
}

function checkLine(rule, file, text, prevText = '', nextText = '') {
  if (rule.onlyIn && !rule.onlyIn.some(r => r.test(file))) return false;
  if (rule.veto && rule.veto.test(text)) return false;
  // 豁免注释可在**本行或紧邻的上一行**。
  // ⚠️ 2026-09-18 补"上一行"：原实现只认同行，而 Prettier 会把过长的行尾注释
  //    移到下一行（printWidth 120），于是"加了豁免却依然被判红"——豁免机制被
  //    格式化器悄悄破坏，属最难排查的一类失效。允许写在独立上一行即可稳定生效。
  if (/hazard-allow/.test(text) || /hazard-allow/.test(prevText)) return false;
  if (/eslint-disable/.test(text)) return false;
  // 跳过纯注释行：注释里出现的示例/历史说明不构成违规
  // （例：ProductList.vue:396 用注释记录"http://localhost:3000..."这类历史脏数据）
  if (/^\s*(\/\/|\/\*|\*|<!--)/.test(text)) return false;
  // R11 这类需要跨行判断的规则走 multi（SQL 与参数数组常分作两行）
  if (rule.multi) return Boolean(rule.multi(text, nextText, prevText));
  return rule.test.test(text);
}

// ── 主流程 ──────────────────────────────────────────────────────────
function main() {
  const argv = process.argv.slice(2);
  const allMode = argv.includes('--all');
  const stagedMode = argv.includes('--staged');
  const baseIdx = argv.indexOf('--base');
  const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/master';

  let added;
  let modeLabel;

  if (allMode) {
    added = scanWorktree();
    modeLabel = '全仓基线统计（不阻断）';
  } else if (stagedMode) {
    const diff = git(['diff', '--cached', '--unified=0']);
    added = parseAddedLines(diff);
    modeLabel = '暂存区新增行（对比 HEAD）';
  } else {
    let diff;
    try {
      diff = git(['diff', '--unified=0', `${base}...HEAD`]);
    } catch {
      console.error(`⚠️  无法对比基线 ${base}，回退到暂存区模式。`);
      diff = git(['diff', '--cached', '--unified=0']);
    }
    added = parseAddedLines(diff);
    modeLabel = `本次改动新增行（对比 ${base}）`;
  }

  // 统计
  const violations = [];
  const stats = new Map();

  // 取某文件的上一行（用于豁免注释写在独立上一行的场景）。
  // 说明：读的是**工作区**文件。pre-commit 中本脚本排在格式化步骤之后，
  //       此时工作区与暂存区内容一致，行号因此可信。
  const lineCache = new Map();
  function prevLineOf(file, lineNo) {
    if (lineNo <= 1) return '';
    if (!lineCache.has(file)) {
      try {
        lineCache.set(file, readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/));
      } catch {
        lineCache.set(file, []);
      }
    }
    const arr = lineCache.get(file);
    return arr[lineNo - 2] || '';
  }

  /** 取某文件的下一行（R11 这类跨行规则用；同样读**工作区**文件） */
  function nextLineOf(file, lineNo) {
    if (!lineCache.has(file)) {
      try {
        lineCache.set(file, readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/));
      } catch {
        lineCache.set(file, []);
      }
    }
    const arr = lineCache.get(file);
    return arr[lineNo] || '';
  }

  for (const [file, lines] of added) {
    for (const { line, text } of lines) {
      for (const rule of RULES) {
        if (checkLine(rule, file, text, prevLineOf(file, line), nextLineOf(file, line))) {
          violations.push({ rule, file, line, text: text.trim() });
          const key = `${rule.id} ${rule.level}`;
          stats.set(key, (stats.get(key) || 0) + 1);
        }
      }
    }
  }

  const totalLines = [...added.values()].reduce((s, a) => s + a.length, 0);

  console.log('─'.repeat(72));
  console.log(`代码审查 · 增量红线扫描　模式：${modeLabel}`);
  console.log(`扫描 ${added.size} 个文件 / ${totalLines} 行`);
  console.log('─'.repeat(72));

  if (violations.length === 0) {
    console.log('✅ 未发现红线违规。');
    console.log('\n评分依据见 docs/代码审查标准.md 第三章；完整的静态检查请运行：');
    console.log('  npx eslint . && npx prettier --check .');
    return 0;
  }

  // 分组输出
  const byFile = new Map();
  for (const v of violations) {
    if (!byFile.has(v.file)) byFile.set(v.file, []);
    byFile.get(v.file).push(v);
  }

  for (const [file, list] of byFile) {
    console.log(`\n📄 ${file}`);
    for (const v of list) {
      const icon = v.rule.level === 'error' ? '🔴' : '🟡';
      console.log(`  ${icon} [${v.rule.id}] ${v.rule.name} · 第 ${v.line} 行`);
      console.log(`       ${v.text.length > 110 ? v.text.slice(0, 110) + '…' : v.text}`);
      console.log(`       ↳ ${v.rule.why}`);
    }
  }

  const errors = violations.filter(v => v.rule.level === 'error');

  console.log('\n' + '─'.repeat(72));
  console.log('汇总：');
  for (const [key, n] of [...stats.entries()].sort()) {
    console.log(`  ${key.padEnd(10)} ${n} 处`);
  }
  console.log('─'.repeat(72));

  if (allMode) {
    console.log(`\nℹ️  全仓基线：${violations.length} 处（其中 error 级 ${errors.length} 处）`);
    console.log('   此模式用于建立基线与逐周收紧，不阻断构建。');
    console.log('   请把该数字记录到 docs/项目概览.md，并制定收敛计划。');
    return 0;
  }

  if (errors.length > 0) {
    console.log(`\n❌ 本次改动引入 ${errors.length} 处 S1 红线违规，阻断合并。`);
    console.log('   修复建议见 docs/代码审查标准.md 第三、四章。');
    console.log('   确需豁免：在该行加注释 `hazard-allow: <原因>`（须写原因，评审可追溯）。');
    return 1;
  }

  console.log(`\n⚠️  本次改动有 ${violations.length} 处 warn 级提示，不阻断合并。`);
  console.log('   请确认这些告警是否属于本次改动应当处理的范围。');
  return 0;
}

process.exit(main());

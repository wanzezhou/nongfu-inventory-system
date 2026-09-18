/**
 * pre-commit 的「暂存文件 lint + 格式化」执行器
 * ============================================================================
 * 为什么不用 lint-staged（2026-09-18 的重要教训，务必先读）：
 *
 *   lint-staged 在执行前会 "Backing up original state"——通过 stash / 改写 ref
 *   来保存并还原索引状态。**在本项目所在的 Windows 环境下，这一步会挂死**。
 *   一旦外层进程被超时终止（SIGTERM），git 就被杀死在"已删除旧状态、还没写回新状态"
 *   的中间态，后果是**仓库被破坏**：
 *     ① refs/heads/* 与 packed-refs 消失，所有提交"不见了"；
 *     ② object pack 被删，历史对象丢失；
 *     ③ 第二次更直接：整个 .git/refs 目录被删掉，git 直接报 not a git repository。
 *   两次都靠动手前的 `git bundle create --all` 备份才恢复。
 *
 *   结论：**pre-commit 阶段绝不做任何会改写 git 状态的操作**。本脚本只做两件
 *   纯增量的事：读 git 的输出、写文件内容。没有 stash、没有备份、没有 ref 操作。
 *
 * 行为：
 *   1. 取暂存区文件（--diff-filter=ACM，不改动删除项）
 *   2. 按扩展名分流：js/mjs/cjs/vue → eslint；可格式化类型 → prettier --write
 *   3. prettier 改过的文件重新 `git add`，保证提交内容与文件一致
 *   4. eslint 有 error 则退出码 1（阻断提交）
 *
 * 用法：node scripts/precommit-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LINTABLE = /\.(js|mjs|cjs|vue)$/;
const FORMATTABLE = /\.(js|mjs|cjs|vue|json|yml|yaml|css|scss|html|md)$/;

function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ── 1. 暂存文件（NUL 分隔，避免中文/空格文件名被拆断）──────────────────
const diff = git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']);
if (diff.code !== 0) {
  console.error('✗ 无法读取暂存区：' + diff.err.trim());
  process.exit(1);
}
const staged = diff.out.split('\0').filter(Boolean);
if (!staged.length) {
  console.log('（暂存区为空，跳过）');
  process.exit(0);
}

const lintFiles = staged.filter(f => LINTABLE.test(f) && fs.existsSync(path.join(ROOT, f)));
const fmtFiles = staged.filter(f => FORMATTABLE.test(f) && fs.existsSync(path.join(ROOT, f)));

let failed = false;

// ── 2. ESLint（仅改动文件；阈值给足，存量 warning 不阻断）──────────────
const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
if (lintFiles.length) {
  if (!fs.existsSync(eslintBin)) {
    console.warn('⚠️  根目录工具链未安装（缺 eslint），已跳过 lint。启用方式：在仓库根目录执行 npm install');
  } else {
    console.log(`[pre-commit] ESLint ${lintFiles.length} 个文件…`);
    const r = node([eslintBin, '--max-warnings', '999', ...lintFiles]);
    if (r.out.trim()) console.log(r.out.trim());
    if (r.err.trim()) console.log(r.err.trim());
    if (r.code !== 0) {
      console.error('❌ ESLint 未通过：请修正后重新提交（项目红线规则见 docs/代码审查标准.md 第三章）。');
      failed = true;
    }
  }
}

// ── 3. Prettier（就地对改动文件格式化，然后重新 add）────────────────────
const prettierBin = path.join(ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (fmtFiles.length && fs.existsSync(prettierBin)) {
  console.log(`[pre-commit] Prettier ${fmtFiles.length} 个文件…`);
  const r = node([prettierBin, '--write', '--log-level', 'warn', ...fmtFiles]);
  if (r.out.trim()) console.log(r.out.trim());
  if (r.code === 0) {
    // 格式化结果必须回到暂存区，否则提交的是未格式化的旧内容 —— lint-staged 也做这件事，
    // 区别只是我们直接 add 具体文件，不碰任何 ref。
    const add = git(['add', '--', ...fmtFiles]);
    if (add.code !== 0) {
      console.error('✗ 格式化后重新暂存失败：' + add.err.trim());
      failed = true;
    }
  } else {
    console.error('✗ Prettier 执行失败：' + r.err.trim());
    failed = true;
  }
}

process.exit(failed ? 1 : 0);

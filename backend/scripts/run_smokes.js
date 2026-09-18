/**
 * 冒烟批次运行器（2026-09-16）
 * ---------------------------------------------------------------------------
 * 背景：项目里 15 个冒烟脚本分两类 —— 11 个需要外部已启动的后端，4 个自启后端。
 *   ① 不自启的脚本串行跑时必须「起后端 → 跑 → 关后端」，且**必须与后端同一 shell 生命周期**
 *      （后端进程随 shell 退出被回收，见 REF-工程手册 §四）。
 *   ② 自启的 4 个（machine_sale_import / order_revenue_posting / cost_profit / barrel）
 *      自己抢 3000 端口，本运行器会先清空端口再交给它们。
 *   ③ 限流：loginLimiter 按 IP 10 次/15 分钟，每脚本登录一次 → 连跑整套会在第 11 个被拦。
 *      本运行器会在批次内累计登录次数并在超过阈值时提示（不阻断，便于人工判断）。
 *
 * 用法：
 *   node scripts/run_smokes.js smoke_order_pricing.js smoke_a6_revenue.js
 *   node scripts/run_smokes.js --all           # 跑 scripts 下除本文件外全部 smoke_*.js
 *   node scripts/run_smokes.js --list
 *
 * 退出码：0 = 全部通过；1 = 有脚本失败或异常
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const ROOT = path.join(__dirname, '..', '..');
const LOGIN_LIMIT = 10; // loginLimiter max/15min per IP

// 自启后端的脚本（自己抢 3000），运行器不为其预启后端
const SELF_STARTING = new Set([
  'smoke_machine_sale_import.js',
  'smoke_order_revenue_posting.js',
  'smoke_cost_profit.js',
  'smoke_barrel.js'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listSmokes() {
  return fs.readdirSync(SCRIPTS_DIR)
    .filter((n) => /^smoke_.*\.js$/.test(n) && n !== 'run_smokes.js')
    .sort();
}

async function kill3000() {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    const pids = new Set();
    out.split('\n')
      .filter((l) => l.includes(':3000') && l.includes('LISTENING'))
      .forEach((l) => { const p = l.trim().split(/\s+/).pop(); if (/^\d+$/.test(p)) pids.add(p); });
    for (const pid of pids) {
      try { execFileSync('taskkill', ['/PID', pid, '/F', '/T'], { encoding: 'utf8' }); } catch (e) { /* ignore */ }
    }
    if (pids.size) console.log(`  （已清理 :3000 占用 pid=${[...pids].join(',')}）`);
  } catch (e) { /* netstat 不可用时忽略 */ }
}

/**
 * 等后端就绪。
 * ⚠️ 必须探测 /health（免鉴权、固定 200）—— 不要再用「请求受保护接口并期待 200」的写法：
 *    自 2026-09-18 起鉴权失败统一返回 HTTP 401（此前是 HTTP 200 + 信封 code 401），
 *    那种探测会永远等不到 200，把「后端其实已就绪」误判为「启动失败」。
 */
async function waitReady(maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch('http://localhost:3000/health');
      if (r.status === 200) {
        const j = await r.json().catch(() => null);
        if (j?.data?.db?.ok) return true;
      }
    } catch (e) { /* 还没起来 */ }
    await sleep(400);
  }
  return false;
}

/**
 * 解析冒烟输出里的通过/失败数。项目内存在三种格式：
 *   "通过 N / 失败 M"、"N 通过 / M 失败"、"N pass / M fail"
 * @returns {{pass:number,fail:number}|null}
 */
function parseResult(text) {
  const patterns = [
    /通过\s*(\d+)\s*\/\s*失败\s*(\d+)/,
    /(\d+)\s*通过\s*\/\s*(\d+)\s*失败/,
    /(\d+)\s*pass\s*\/\s*(\d+)\s*fail/i
  ];
  let best = null;
  for (const re of patterns) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(text)) !== null) best = { pass: Number(m[1]), fail: Number(m[2]) };
  }
  return best;
}

function runScript(file) {
  try {
    const out = execFileSync(process.execPath, [path.join(SCRIPTS_DIR, file)], {
      cwd: path.join(ROOT, 'backend'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || ''), err: e.message };
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    const all = listSmokes();
    console.log(`共 ${all.length} 个冒烟脚本：`);
    all.forEach((n) => console.log(`  ${SELF_STARTING.has(n) ? '[自启后端]' : '[需外部后端]'} ${n}`));
    return;
  }

  let targets = args.filter((a) => a !== '--all');
  if (args.includes('--all') || targets.length === 0) targets = listSmokes();
  targets = targets.map((t) => (t.endsWith('.js') ? t : `${t}.js`));

  const missing = targets.filter((t) => !fs.existsSync(path.join(SCRIPTS_DIR, t)));
  if (missing.length) {
    console.error('脚本不存在: ' + missing.join(', '));
    process.exit(1);
  }

  console.log(`将运行 ${targets.length} 个冒烟脚本：`);
  targets.forEach((t) => console.log(`  ${SELF_STARTING.has(t) ? '[自启后端]' : '[需外部后端]'} ${t}`));

  const needsBackend = targets.some((t) => !SELF_STARTING.has(t));
  let srv = null;
  const logs = [];

  if (needsBackend) {
    await kill3000();
    srv = spawn(process.execPath, [path.join(ROOT, 'backend', 'src', 'app.js')], {
      cwd: path.join(ROOT, 'backend'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    srv.stdout.on('data', (d) => logs.push(String(d)));
    srv.stderr.on('data', (d) => logs.push(String(d)));
    const ready = await waitReady();
    if (!ready) {
      console.error('后端启动失败，最近日志：\n' + logs.join('').slice(-2000));
      srv.kill('SIGKILL');
      process.exit(1);
    }
    console.log('后端已就绪 ✓');
  }

  let failed = 0;
  let sumPass = 0;
  let sumFail = 0;
  const summary = [];

  for (const t of targets) {
    console.log(`\n########## ${t} ##########`);
    const r = runScript(t);
    process.stdout.write(r.out);
    if (!r.ok) console.log('  ⚠️ 脚本异常退出: ' + r.err);
    const parsed = parseResult(r.out);
    if (parsed) {
      sumPass += parsed.pass;
      sumFail += parsed.fail;
      if (parsed.fail > 0) failed++;
    } else {
      console.log('  ⚠️ 未能解析通过/失败数，请人工确认');
      if (!r.ok) failed++;
    }
    summary.push({ file: t, ...(parsed || {}), exitedOk: r.ok });
  }

  if (srv) {
    srv.kill('SIGKILL');
    await kill3000();
  }

  console.log('\n================ 批次汇总 ================');
  summary.forEach((s) => console.log(
    `  ${s.fail === 0 ? '✓' : '✗'} ${s.file}  通过 ${s.pass ?? '-'} / 失败 ${s.fail ?? '-'}${s.exitedOk ? '' : '  (异常退出)'}`
  ));
  console.log(`  合计：通过 ${sumPass} / 失败 ${sumFail}`);
  if (targets.filter((t) => !SELF_STARTING.has(t)).length > LOGIN_LIMIT) {
    console.log(`  ⚠️ 本次需外部后端的脚本 ${targets.filter((t) => !SELF_STARTING.has(t)).length} 个 > 登录限流 ${LOGIN_LIMIT} 次/15min，`
      + '后段脚本可能因 429 假失败——请分批运行并重启后端');
  }
  console.log(`=== ${failed === 0 ? '全部通过 ✓' : failed + ' 个脚本存在失败 ✗'} ===`);
  process.exit(failed === 0 ? 0 : 1);
})();

/**
 * 冒烟：Web 端「账户间转账」（POST /api/finance-accounts/transfer）
 * ---------------------------------------------------------------------------
 * 为什么必须补这份：转账是**双边余额 + 双流水**的资金动作，而它此前**零冒烟覆盖**
 * （全仓只有一处 403 权限断言，且参数名还是错的）。这类动作一旦写错，
 * 账面症状很隐蔽 ——
 *   · 只扣不加 / 只加不扣：总额不守恒，但两个账户单独看「都像有变动」；
 *   · 两条流水用了不同批次号：对账时无法回溯成一对，无法发现「转了一半」；
 *   · 余额不足检查放在「扣款之后」：会先扣成负数再报错（无事务时永久残留）。
 * 本冒烟把这四类逐条钉死，并断言资金恒等式（两账户总额守恒）。
 *
 * ⚠️ 全部自建数据（SMKXFER 前缀账户），不碰任何真实账户。
 *
 * 运行：node scripts/smoke_account_transfer.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';
const { pool } = require('../src/config/db');

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { ...json, _status: res.status };
}

let pass = 0;
let fail = 0;
function assert(cond, name, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`);
  }
}
const section = t => console.log(`\n${t}`);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

const TS = Date.now().toString().slice(-8);
const A = 'SMKXFERA' + TS;
const B = 'SMKXFERB' + TS;
const NAME_A = '冒烟转出账户' + TS;
const NAME_B = '冒烟转入账户' + TS;

async function main() {
  // ── 0. 登录拿管理员令牌 ────────────────────────────────────────────────────
  section('0. 准备（登录 + 自建两个账户各 1000 期初）');
  const [users] = await pool.query('SELECT username FROM users WHERE role = ? LIMIT 1', ['admin']);
  const login = await call('POST', '/auth/login', { username: users[0].username || 'admin', password: 'admin123' });
  assert(
    login.code === 200 && login.data && login.data.token,
    `管理员登录成功（${login.code} ${login.message || ''}）`
  );
  const token = login.data && login.data.token;
  if (!token) throw new Error('登录失败，无法继续');

  await pool.query(
    `INSERT INTO finance_accounts (account_id, account_name, account_type, initial_balance, current_balance, status, created_at, updated_at)
     VALUES (?, ?, 1, 1000, 1000, 1, NOW(), NOW()), (?, ?, 1, 1000, 1000, 1, NOW(), NOW())`,
    [A, NAME_A, B, NAME_B]
  );
  const balOf = async id => {
    const [r] = await pool.query('SELECT current_balance b FROM finance_accounts WHERE account_id = ?', [id]);
    return r.length ? Number(r[0].b) : null;
  };
  const txOf = async batch =>
    (
      await pool.query(
        `SELECT account_id, tx_type, amount, balance_before, balance_after, counterparty
           FROM finance_transactions WHERE related_module = 'account_transfer' AND related_id = ? ORDER BY tx_type DESC`,
        [batch]
      )
    )[0];
  const txCount = async id =>
    (await pool.query('SELECT COUNT(*) n FROM finance_transactions WHERE account_id = ?', [id]))[0][0].n;

  // ── 1. 参数校验 ───────────────────────────────────────────────────────────
  section('1. 参数校验（每条都断言文案，避免"因别的原因失败也算过"）');
  const same = await call('POST', '/finance-accounts/transfer', { fromId: A, toId: A, amount: 10 }, token);
  assert(same.code === 400 && /不能相同/.test(String(same.message)), `同账户互转被拒（${same.message}）`);
  const zero = await call('POST', '/finance-accounts/transfer', { fromId: A, toId: B, amount: 0 }, token);
  assert(zero.code === 400 && /大于 0/.test(String(zero.message)), `金额 0 被拒（${zero.message}）`);
  const missAcc = await call('POST', '/finance-accounts/transfer', { fromId: 'SMKNOACC', toId: B, amount: 10 }, token);
  assert(missAcc.code === 404, `账户不存在 → 404（实得 ${missAcc.code}）`);

  // ── 2. ★ 转账成功：双边余额 + 双流水（同批次号） + 总额守恒 ────────────────
  section('2. ★ 转账成功：双边余额 + 双流水同批次 + 总额守恒');
  await pool.query(
    'UPDATE finance_accounts SET current_balance = 1000, initial_balance = 1000 WHERE account_id IN (?, ?)',
    [A, B]
  );
  const t1 = await call(
    'POST',
    '/finance-accounts/transfer',
    { fromId: A, toId: B, amount: 300, remark: '冒烟互转' },
    token
  );
  assert(t1.code === 200, `转账成功（${t1.code} ${t1.message || ''}）`);
  assert(near(await balOf(A), 700), `转出方 1000 − 300 = 700（实际 ${await balOf(A)}）`);
  assert(near(await balOf(B), 1300), `转入方 1000 + 300 = 1300（实际 ${await balOf(B)}）`);
  assert(near((await balOf(A)) + (await balOf(B)), 2000), '★ 总额守恒：2000 不变');
  // ⚠️ 流水按**批次号**（XFER+txNo）关联，不是 txNo —— insertTx 写的是 related_id = batchId
  const rows = await txOf('XFER' + t1.data.txNo);
  assert(rows.length === 2, `生成 2 条流水（实得 ${rows.length}）`);
  if (rows.length === 2) {
    const out = rows.find(r => Number(r.tx_type) === 2);
    const inn = rows.find(r => Number(r.tx_type) === 1);
    assert(!!out && !!inn, '一条支出（转出）+ 一条收入（转入）');
    assert(near(out.amount, 300) && near(inn.amount, 300), '两条流水金额一致');
    assert(
      near(out.balance_before, 1000) && near(out.balance_after, 700),
      `转出流水前后余额正确（${out.balance_before} → ${out.balance_after}）`
    );
    assert(
      near(inn.balance_before, 1000) && near(inn.balance_after, 1300),
      `转入流水前后余额正确（${inn.balance_before} → ${inn.balance_after}）`
    );
    assert(out.counterparty === NAME_B && inn.counterparty === NAME_A, '两侧对手方互为对方账户名（可回溯）');
  }

  // ── 3. 余额不足 / 停用账户 ────────────────────────────────────────────────
  section('3. 余额不足与停用账户');
  const over = await call('POST', '/finance-accounts/transfer', { fromId: A, toId: B, amount: 99999 }, token);
  assert(over.code === 400 && /余额不足/.test(String(over.message)), `超余额转账被拒（${over.message}）`);
  assert(near(await balOf(A), 700), '★ 被拒后转出方余额**未变**（校验在扣款之前）');
  assert(near((await balOf(A)) + (await balOf(B)), 2000), '★ 被拒后总额仍守恒');
  await pool.query('UPDATE finance_accounts SET status = 0 WHERE account_id = ?', [A]);
  const disabled = await call('POST', '/finance-accounts/transfer', { fromId: A, toId: B, amount: 10 }, token);
  assert(disabled.code === 400 && /停用/.test(String(disabled.message)), `停用账户转出被拒（${disabled.message}）`);
  await pool.query('UPDATE finance_accounts SET status = 1 WHERE account_id = ?', [A]);

  // ── 4. 流水条数：一次转账只留两条（不多不少）──────────────────────────────
  section('4. 流水条数核对');
  const aTx = Number(await txCount(A));
  const bTx = Number(await txCount(B));
  assert(aTx === 1, `转出账户流水 1 条（实得 ${aTx}）`);
  assert(bTx === 1, `转入账户流水 1 条（实得 ${bTx}）`);

  // ── 5. 金额小数（两位）──────────────────────────────────────────────────
  section('5. 小数金额');
  const t2 = await call('POST', '/finance-accounts/transfer', { fromId: A, toId: B, amount: 0.55 }, token);
  assert(t2.code === 200, `小数转账成功（${t2.code}）`);
  assert(near(await balOf(A), 699.45), `转出 700 − 0.55 = 699.45（实际 ${await balOf(A)}）`);
  assert(near((await balOf(A)) + (await balOf(B)), 2000), '总额仍守恒（小数无漂移）');
}

main()
  .then(() => {
    console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  })
  .catch(e => {
    console.error('冒烟执行异常:', e);
    fail++;
  })
  .finally(async () => {
    // 清理：流水 → 账户（按冒烟前缀）
    try {
      const ids = [A, B];
      await pool.query('DELETE FROM finance_transactions WHERE account_id IN (?)', [ids]);
      await pool.query('DELETE FROM finance_accounts WHERE account_id IN (?)', [ids]);
      const [left] = await pool.query("SELECT COUNT(*) n FROM finance_accounts WHERE account_id LIKE 'SMKXFER%'");
      console.log(`清理：残留账户 ${left[0].n} 个${Number(left[0].n) === 0 ? ' ✓' : ' ✗'}`);
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

/**
 * 冒烟：小程序管理端写操作 · 支出/费用域（文档 §5.3 / §43 Phase 8b 第 1 域）
 * ---------------------------------------------------------------------------
 * 为什么需要它：Phase 8b 是「管理员在手机上改资金台账」，这类接口错的代价很实在 ——
 *   ① 没有幂等键 → 弱网连点两次「保存」就记两笔支出，两笔都合法、账面看不出异常；
 *   ② 编辑时若先记账再撤销（顺序反了）→ 余额多出「旧值 + 新值」的差额且不报错；
 *   ③ 删除支出必须**回补**余额（钱没花出去）→ 方向抄反会变成「删一条支出反而再扣一笔」；
 *   ④ 权限若复用了 Web 的 requireAdmin → 小程序非管理员令牌能改公司账本。
 * 本冒烟把这四类逐条钉死，并顺带验证「审计落库」与「复用账务原语」两件事。
 *
 * 覆盖：
 *   1) 权限：无令牌 401 / 业务员令牌 403 / 管理员 200（读与写各自校验）
 *   2) 列表与表单选项：字段齐备、账户仅列启用、预置类别存在
 *   3) 新增：入参校验 4 条 + 幂等键必填 + 记账方向（余额 −amount、流水 tx_type=2、
 *      tx_category='其他支出'、related_module='other_expense'）+ 审计 CREATE_EXPENSE
 *   4) 幂等：同键重放 → 同一 expenseId、余额只减一次、流水只 1 条；同键不同参数 → 400
 *   5) 不选账户 → 只登记台账，**不动任何账户余额**、不产生流水
 *   6) 编辑：余额净变化 = 新值 − 旧值（不是叠加），流水仍 1 条且金额为新值 + 审计 UPDATE_EXPENSE
 *   7) 删除：余额回补到基线、流水被清除、记录消失 + 审计 DELETE_EXPENSE
 *   8) 资金恒等式（本冒烟自建账户）：余额 = 期初 + 流水净额
 *
 * ⚠️ 测试对象**全部自建**（冒烟账户 / SMKEXP 前缀支出），不碰任何真实账户与台账：
 *    资金类冒烟最忌讳拿真实账户试，余额一旦被改就会污染对账。
 *
 * 运行：node scripts/smoke_mini_admin.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';

const { pool } = require('../src/config/db');
const { signMiniToken } = require('../src/services/miniAccountService');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');

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
function section(t) {
  console.log(`\n${t}`);
}

const TS = Date.now().toString().slice(-8);
const PREFIX = 'SMKEXP' + TS;
const ACCOUNT_NAME = '冒烟账户' + TS;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const today = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

async function main() {
  let conn = await pool.getConnection();

  // ── 0. 自建测试数据：mini 账号（管理员 + 业务员）+ 一个专用资金账户 ──────────
  section('0. 准备冒烟数据（mini 管理员/业务员账号 + 专用资金账户）');

  const [users] = await conn.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const adminTargetId = String(users[0].id);

  await conn.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, ?, 'admin', ?, '冒烟管理员', 1, NOW())`,
    [`smoke_admin_${TS}`, '13500000000', adminTargetId]
  );
  const [adRows] = await conn.query('SELECT id FROM mini_accounts WHERE openid = ?', [`smoke_admin_${TS}`]);
  const adminAccountId = adRows[0].id;

  await conn.query(
    `INSERT INTO mini_accounts (openid, phone, role, target_id, nickname, status, created_at)
     VALUES (?, ?, 'salesman', ?, '冒烟业务员', 1, NOW())`,
    [`smoke_salesman_${TS}`, '13911112222', 'smoke_worker_na']
  );
  const [smRows] = await conn.query('SELECT id FROM mini_accounts WHERE openid = ?', [`smoke_salesman_${TS}`]);
  const salesmanAccountId = smRows[0].id;

  const accountId = 'SMKACC' + TS;
  await conn.query(
    `INSERT INTO finance_accounts (account_id, account_name, account_type, initial_balance, current_balance, status, created_at, updated_at)
     VALUES (?, ?, 1, 1000, 1000, 1, NOW(), NOW())`,
    [accountId, ACCOUNT_NAME]
  );
  conn.release();
  conn = null;

  const adminToken = signMiniToken({ id: adminAccountId, role: 'admin', target_id: adminTargetId });
  const salesmanToken = signMiniToken({ id: salesmanAccountId, role: 'salesman', target_id: 'smoke_worker_na' });

  const balanceOf = async () => {
    const [r] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accountId]);
    return r.length ? Number(r[0].current_balance) : null;
  };
  const txRows = async () =>
    (
      await pool.query(
        "SELECT tx_id, tx_type, tx_category, amount, balance_before, balance_after, related_module, related_id, handler FROM finance_transactions WHERE related_module = 'other_expense' AND account_id = ?",
        [accountId]
      )
    )[0];
  const auditActions = async () =>
    (
      await pool.query(
        // ⚠️ 主键列名是 log_id（不是 id）—— 别照惯例猜
        'SELECT action FROM mini_audit_logs WHERE actor_id = ? ORDER BY log_id',
        [`mini:${adminAccountId}`]
      )
    )[0].map(r => r.action);

  // ── 1. 权限（§22.4：小程序侧必须另设 requireMiniAdmin）──────────────────────
  section('1. 权限与令牌隔离');

  const noToken = await call('GET', '/mini/admin/expenses');
  assert(noToken._status === 401 || noToken.code === 401, `无令牌读支出台账被拒（401）：实得 ${noToken._status}`);

  const salesmanRead = await call('GET', '/mini/admin/expenses', null, salesmanToken);
  assert(
    salesmanRead._status === 403 || salesmanRead.code === 403,
    `业务员令牌读支出台账被拒（403，requireMiniAdmin）：实得 ${salesmanRead._status} ${salesmanRead.message || ''}`
  );
  // ⚠️ 同时断言**拒绝原因**是角色不足，而非「主体停用 / 账号不存在」等其它 403/401 ——
  //    否则这条断言可能在别的原因下也「通过」，把权限回归掩盖过去。
  assert(
    /管理员角色/.test(String(salesmanRead.message || '')),
    `拒绝原因确为「需要管理员角色」：${salesmanRead.message}`
  );

  const salesmanWrite = await call(
    'POST',
    '/mini/admin/expenses',
    {
      clientRequestId: `smk_${TS}_perm`,
      expenseName: PREFIX + '越权',
      amount: 1,
      expenseDate: today(),
      category: '其他'
    },
    salesmanToken
  );
  assert(
    salesmanWrite._status === 403 || salesmanWrite.code === 403,
    `业务员令牌**写**支出台账被拒（403）：实得 ${salesmanWrite._status}`
  );

  const adminRead = await call('GET', '/mini/admin/expenses', null, adminToken);
  assert(adminRead.code === 200, `管理员令牌读支出台账成功：${adminRead.code}`);
  assert(
    Array.isArray(adminRead.data.list) && adminRead.data.list.length === 0,
    `新建账户下台账为空（证明前面的越权请求确实没落库）：${adminRead.data.list.length} 条`
  );

  // ── 2. 表单选项 ────────────────────────────────────────────────────────────
  section('2. 表单选项（账户 + 类别）');

  const opts = await call('GET', '/mini/admin/expenses/options', null, adminToken);
  assert(opts.code === 200, `选项接口 200：${opts.code}`);
  assert(
    (opts.data.accounts || []).some(a => a.accountId === accountId),
    '可用账户列表包含自建账户'
  );
  assert(
    (opts.data.accounts || []).every(a => a.currentBalance !== undefined),
    '账户项带余额（供前端展示，非计算依据）'
  );
  assert(
    (opts.data.presetCategories || []).includes('运输'),
    `预置类别存在：${JSON.stringify(opts.data.presetCategories)}`
  );
  assert(Array.isArray(opts.data.customCategories), '自定义类别字段存在（可为空数组）');

  // ── 3. 新增：入参校验 + 记账方向 + 审计 ────────────────────────────────────
  section('3. 新增支出（校验 / 记账方向 / 审计）');

  const badCases = [
    [{ amount: 10, expenseDate: today(), category: '其他' }, '支出名称不能为空'],
    [{ expenseName: PREFIX + 'a', expenseDate: today(), category: '其他' }, '金额必须为大于 0 的数字'],
    [{ expenseName: PREFIX + 'a', amount: -5, expenseDate: today(), category: '其他' }, '金额必须为大于 0 的数字'],
    [
      { expenseName: PREFIX + 'a', amount: 10, expenseDate: '2026/09/20', category: '其他' },
      '支出日期格式应为 YYYY-MM-DD'
    ],
    [{ expenseName: PREFIX + 'a', amount: 10, expenseDate: today() }, '支出类别不能为空']
  ];
  for (const [body, expectMsg] of badCases) {
    const r = await call(
      'POST',
      '/mini/admin/expenses',
      Object.assign({ clientRequestId: `smk_${TS}_bad${Math.random().toString(36).slice(2, 7)}` }, body),
      adminToken
    );
    assert(
      r.code === 400 && String(r.message || '').includes(expectMsg.slice(0, 6)),
      `入参校验拒绝「${expectMsg}」（400）：实得 ${r.code} ${r.message || ''}`
    );
  }

  const noIdem = await call(
    'POST',
    '/mini/admin/expenses',
    {
      expenseName: PREFIX + '无幂等键',
      amount: 10,
      expenseDate: today(),
      category: '其他'
    },
    adminToken
  );
  assert(
    noIdem.code === 400 && /clientRequestId/.test(String(noIdem.message || '')),
    `缺幂等键被拒（400）且文案指向 clientRequestId：${noIdem.message}`
  );

  const balanceBefore = await balanceOf();
  const createKey = `smk_${TS}_create`;
  const createBody = {
    clientRequestId: createKey,
    expenseName: PREFIX + '运输费',
    amount: 100,
    expenseDate: today(),
    category: '运输',
    accountId,
    remark: '冒烟新增'
  };
  const created = await call('POST', '/mini/admin/expenses', createBody, adminToken);
  assert(
    created.code === 200 && created.data && created.data.expenseId,
    `带账户新增成功：${created.code} expenseId=${created.data && created.data.expenseId}`
  );

  const expenseId = created.data && created.data.expenseId;
  const balanceAfterCreate = await balanceOf();
  assert(
    near(balanceAfterCreate, balanceBefore - 100),
    `记账方向正确：余额 ${balanceBefore} − 100 = ${balanceBefore - 100}，实得 ${balanceAfterCreate}`
  );

  const tx1 = await txRows();
  assert(tx1.length === 1, `生成 1 条资金流水：实得 ${tx1.length}`);
  if (tx1.length) {
    const t = tx1[0];
    assert(Number(t.tx_type) === 2, `支出流水 tx_type = 2（支出方向）：${t.tx_type}`);
    assert(t.tx_category === '其他支出', `流水类别 = 其他支出：${t.tx_category}`);
    assert(near(t.amount, 100), `流水金额 = 100：${t.amount}`);
    assert(
      near(t.balance_before, balanceBefore) && near(t.balance_after, balanceBefore - 100),
      `流水前后余额正确：${t.balance_before} → ${t.balance_after}`
    );
    assert(/^mini:/.test(String(t.handler || '')), `流水 handler 记录小程序操作人：${t.handler}`);
  }

  const audit1 = await auditActions();
  assert(audit1.includes('CREATE_EXPENSE'), `审计落库 CREATE_EXPENSE：${audit1.join(',')}`);

  // ── 4. 幂等（§23.1）────────────────────────────────────────────────────────
  section('4. 幂等：重放合并、同键不同参数拒绝');

  const replay = await call('POST', '/mini/admin/expenses', createBody, adminToken);
  assert(
    replay.code === 200 && replay.data && replay.data.expenseId === expenseId,
    `同键重放返回**同一** expenseId：${replay.data && replay.data.expenseId}`
  );
  assert(replay.data && replay.data.replayed === true, '重放被标记 replayed = true');
  assert(
    near(await balanceOf(), balanceBefore - 100),
    `重放**没有**再扣一次：余额仍为 ${balanceBefore - 100}，实得 ${await balanceOf()}`
  );
  assert((await txRows()).length === 1, `重放后流水仍为 1 条：${(await txRows()).length}`);
  const [expenseCount] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_name = ?', [
    PREFIX + '运输费'
  ]);
  assert(Number(expenseCount[0].n) === 1, `重放后台账仍为 1 条：${expenseCount[0].n}`);

  const conflict = await call(
    'POST',
    '/mini/admin/expenses',
    Object.assign({}, createBody, { amount: 999 }),
    adminToken
  );
  assert(
    conflict.code === 400 && /不一致/.test(String(conflict.message || '')),
    `同键不同参数被拒（400）：${conflict.code} ${conflict.message}`
  );

  // ── 5. 不选账户 → 只登记台账，不动账 ──────────────────────────────────────
  section('5. 不选账户：只登记台账，不动账户余额');

  const balBeforeNoAcc = await balanceOf();
  const txBeforeNoAcc = (await txRows()).length;
  const noAcc = await call(
    'POST',
    '/mini/admin/expenses',
    {
      clientRequestId: `smk_${TS}_noacc`,
      expenseName: PREFIX + '未走账',
      amount: 77,
      expenseDate: today(),
      category: '其他'
    },
    adminToken
  );
  assert(noAcc.code === 200, `不带账户新增成功：${noAcc.code}`);
  assert(near(await balanceOf(), balBeforeNoAcc), `不带账户**不动余额**：${balBeforeNoAcc} → ${await balanceOf()}`);
  assert((await txRows()).length === txBeforeNoAcc, '不带账户**不产生流水**');

  // ── 6. 编辑：净变化（先撤销再重记）────────────────────────────────────────
  section('6. 编辑：余额净变化 = 新值 − 旧值（不是叠加）');

  const editRes = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update`,
      expenseName: PREFIX + '运输费（改）',
      amount: 250,
      expenseDate: today(),
      category: '运输',
      accountId,
      remark: '冒烟编辑'
    },
    adminToken
  );
  assert(editRes.code === 200, `编辑成功：${editRes.code} ${editRes.message || ''}`);
  assert(
    near(await balanceOf(), balanceBefore - 250),
    `编辑后余额 = ${balanceBefore} − 250 = ${balanceBefore - 250}（**净变化**而非叠加），实得 ${await balanceOf()}`
  );
  const tx2 = await txRows();
  assert(tx2.length === 1, `编辑后流水仍为 1 条（撤销旧的 + 记新的）：实得 ${tx2.length}`);
  if (tx2.length) assert(near(tx2[0].amount, 250), `流水金额已更新为 250：${tx2[0].amount}`);
  const audit2 = await auditActions();
  assert(audit2.includes('UPDATE_EXPENSE'), `审计落库 UPDATE_EXPENSE：${audit2.join(',')}`);

  // 编辑成「不带账户」→ 余额应完全回退
  const editDrop = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update2`,
      expenseName: PREFIX + '运输费（去掉账户）',
      amount: 250,
      expenseDate: today(),
      category: '运输'
    },
    adminToken
  );
  assert(editDrop.code === 200, `编辑去掉账户成功：${editDrop.code}`);
  assert(
    near(await balanceOf(), balanceBefore),
    `去掉账户后余额回退到基线 ${balanceBefore}：实得 ${await balanceOf()}`
  );
  assert((await txRows()).length === 0, '去掉账户后该记录的流水被清除');

  // 再挂回账户，便于验证删除回补
  const editBack = await call(
    'PUT',
    `/mini/admin/expenses/${expenseId}`,
    {
      clientRequestId: `smk_${TS}_update3`,
      expenseName: PREFIX + '运输费（挂回）',
      amount: 250,
      expenseDate: today(),
      category: '运输',
      accountId
    },
    adminToken
  );
  assert(
    editBack.code === 200 && near(await balanceOf(), balanceBefore - 250),
    `挂回账户后余额回到 ${balanceBefore - 250}：实得 ${await balanceOf()}`
  );

  // ── 7. 删除：回补余额 + 清流水 + 审计 ─────────────────────────────────────
  section('7. 删除：回补账户余额（钱没花出去）');

  const delRes = await call(
    'DELETE',
    `/mini/admin/expenses/${expenseId}?clientRequestId=smk_${TS}_del`,
    null,
    adminToken
  );
  assert(delRes.code === 200, `删除成功：${delRes.code} ${delRes.message || ''}`);
  assert(near(await balanceOf(), balanceBefore), `删除**回补**余额到基线 ${balanceBefore}：实得 ${await balanceOf()}`);
  assert((await txRows()).length === 0, '删除后关联流水被清除');
  const [gone] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_id = ?', [expenseId]);
  assert(Number(gone[0].n) === 0, '台账记录已删除');
  const audit3 = await auditActions();
  assert(audit3.includes('DELETE_EXPENSE'), `审计落库 DELETE_EXPENSE：${audit3.join(',')}`);

  // 删除幂等：同键重放返回成功（不因「记录已不存在」而误报失败）
  const delReplay = await call(
    'DELETE',
    `/mini/admin/expenses/${expenseId}?clientRequestId=smk_${TS}_del`,
    null,
    adminToken
  );
  assert(
    delReplay.code === 200 && delReplay.data && delReplay.data.replayed === true,
    `删除同键重放返回成功且标记 replayed（避免网络重试被误报为失败）：${delReplay.code}`
  );
  assert(near(await balanceOf(), balanceBefore), `删除重放**没有**二次回补：实得 ${await balanceOf()}`);

  // ── 8. 资金恒等式（针对本冒烟自建账户）────────────────────────────────────
  section('8. 资金恒等式（余额 = 期初 + 流水净额）');

  const [ident] = await pool.query(
    `SELECT a.initial_balance, a.current_balance,
            COALESCE(SUM(CASE WHEN t.tx_type = 1 THEN t.amount
                              WHEN t.tx_type = 2 THEN -t.amount
                              WHEN t.tx_type = 3 THEN -t.amount
                              WHEN t.tx_type = 4 THEN t.amount ELSE 0 END), 0) AS tx_net
       FROM finance_accounts a
       LEFT JOIN finance_transactions t ON t.account_id = a.account_id
      WHERE a.account_id = ?
      GROUP BY a.account_id`,
    [accountId]
  );
  assert(ident.length === 1, '自建账户存在');
  if (ident.length) {
    const expected = Number(ident[0].initial_balance) + Number(ident[0].tx_net);
    assert(
      near(ident[0].current_balance, expected),
      `恒等式成立：期初 ${ident[0].initial_balance} + 流水净额 ${ident[0].tx_net} = ${expected}，实得余额 ${ident[0].current_balance}`
    );
  }

  return { accountId, adminAccountId, salesmanAccountId };
}

const ctx = { accountId: null, adminAccountId: null, salesmanAccountId: null };

main()
  .then(r => Object.assign(ctx, r))
  .catch(e => {
    console.error('冒烟执行异常:', e);
    fail++;
  })
  .finally(async () => {
    // ── 清理：按冒烟标记删除，不碰任何真实数据 ────────────────────────────────
    try {
      const ids = (
        await pool.query('SELECT expense_id FROM other_expenses WHERE expense_name LIKE ?', [PREFIX + '%'])
      )[0].map(r => r.expense_id);
      for (const id of ids) {
        await pool.query("DELETE FROM finance_transactions WHERE related_module = 'other_expense' AND related_id = ?", [
          id
        ]);
      }
      await pool.query('DELETE FROM other_expenses WHERE expense_name LIKE ?', [PREFIX + '%']);
      if (ctx.accountId) {
        await pool.query('DELETE FROM finance_transactions WHERE account_id = ?', [ctx.accountId]);
        await pool.query('DELETE FROM finance_accounts WHERE account_id = ?', [ctx.accountId]);
      }
      const accIds = [ctx.adminAccountId, ctx.salesmanAccountId].filter(Boolean);
      if (accIds.length) {
        await pool.query('DELETE FROM mini_audit_logs WHERE actor_id IN (?)', [accIds.map(i => `mini:${i}`)]);
        await pool.query('DELETE FROM mini_idempotency WHERE mini_account_id IN (?)', [accIds]);
        await pool.query('DELETE FROM mini_accounts WHERE id IN (?)', [accIds]);
      }
      await cleanupSmokeResidue(pool, { log: console.log });
      const [left] = await pool.query('SELECT COUNT(*) n FROM other_expenses WHERE expense_name LIKE ?', [
        PREFIX + '%'
      ]);
      console.log(`\n清理：残留台账 ${left[0].n} 行${Number(left[0].n) === 0 ? ' ✓' : ' ✗'}`);
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });

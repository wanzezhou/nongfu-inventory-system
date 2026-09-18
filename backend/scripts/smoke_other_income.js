/**
 * 冒烟：其他收入（台账 CRUD + 资金记账 + 撤销回补 + 统计口径）
 * ---------------------------------------------------------------------------
 * 为什么需要它：其他支出一直没有专门的 CRUD+资金 冒烟（覆盖缺口），新增的
 * 「其他收入」若不测，最容易出错的恰是**方向**：收入是 +amount，撤销必须 −amount；
 * 抄错了会变成「删一条收入反而再加一笔钱」——而余额恒等式仍可能「看起来」成立。
 *
 * 覆盖（全部自建 SMK/冒烟 前缀对象，结束清理）：
 *   1) 鉴权与入参校验：无 token 401；名称/金额/日期/类别非法 400；不存在 id 404
 *   2) 记账方向：新增（带账户）→ 余额 +amount，流水 tx_type=1、tx_category='其他收入'、
 *      related_module='other_income'
 *   3) 编辑：改金额 → 余额净变化 = 新值 − 旧值（先撤销再重记）；去掉账户 → 余额回退
 *   4) 删除：余额回到基线，关联流水被清除
 *   5) 不带账户：不产生流水、余额不变
 *   6) 全账户资金恒等式：余额 = 期初 + 流水净额
 *   7) 统计口径（增量断言）：创建一笔收入后
 *      · 仪表盘 metrics.detail.otherIncome 恰好 +X（跨端点对账）
 *      · 仪表盘 metrics.revenue 恰好 +X，profit 恰好 +X（证明计入总营收/总利润）
 *      · /finance/summary：sum(list.revenue) + overall.otherIncome === overall.totalRevenue
 *      · /profit/overview：profit === revenue − costTotal
 *   8) 导出/模板/导入：模板为 xlsx、导出 CSV 含表头、CSV 导入成功且记账
 *
 * 运行：node scripts/smoke_other_income.js（需后端已启动；或经 run_smokes.js 调度）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const BASE = 'http://localhost:3000/api';

const { pool } = require('../src/config/db');

async function call(method, path, body, token, raw) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(raw ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? (raw ? body : JSON.stringify(body)) : undefined
  });
  if (raw) {
    return { _status: res.status, _buf: Buffer.from(await res.arrayBuffer()), _headers: res.headers };
  }
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

const TS = Date.now().toString().slice(-8);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const PREFIX = 'SMKINC' + TS;

const balanceOf = async accountId => {
  const [r] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accountId]);
  return r.length ? Number(r[0].current_balance) : null;
};

// 全账户资金恒等式：余额 = 期初 + 流水净额（收入 +，支出 −；冻结/解冻按既有口径折算）
async function financeIdentity() {
  const [rows] = await pool.query(
    `SELECT a.account_id, a.initial_balance, a.current_balance,
            COALESCE(SUM(CASE WHEN t.tx_type = 1 THEN t.amount
                              WHEN t.tx_type = 2 THEN -t.amount
                              WHEN t.tx_type = 3 THEN -t.amount
                              WHEN t.tx_type = 4 THEN t.amount ELSE 0 END), 0) AS tx_net
     FROM finance_accounts a
     LEFT JOIN finance_transactions t ON t.account_id = a.account_id
     GROUP BY a.account_id`
  );
  const bad = rows.filter(r => !near(Number(r.initial_balance) + Number(r.tx_net), Number(r.current_balance)));
  return { total: rows.length, bad: bad.length, badList: bad };
}

(async () => {
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(!!login.data?.token, '管理员登录');
  if (!login.data?.token) {
    console.log('\n结果：登录失败，终止');
    process.exit(1);
  }
  const token = login.data.token;

  const ACCOUNT = 'ACCOUNT_OTHER'; // 与其他支出迁移预置的账户之一
  const created = [];

  try {
    // ================= 1. 鉴权与入参校验 =================
    console.log('== 1. 鉴权与入参校验 ==');
    const noAuth = await call('GET', '/incomes');
    assert(noAuth._status === 401 && noAuth.code === 401, '无 token → HTTP 401 + code 401', `HTTP ${noAuth._status}`);
    const badName = await call('POST', '/incomes', { amount: 1, incomeDate: '2026-09-01', category: '其他' }, token);
    assert(badName._status === 400, '收入名称为空 → 400', badName.message);
    const badAmount = await call(
      'POST',
      '/incomes',
      { incomeName: 'x', amount: 0, incomeDate: '2026-09-01', category: '其他' },
      token
    );
    assert(badAmount._status === 400, '金额 <= 0 → 400', badAmount.message);
    const badDate = await call(
      'POST',
      '/incomes',
      { incomeName: 'x', amount: 1, incomeDate: '2026/09/01', category: '其他' },
      token
    );
    assert(badDate._status === 400, '日期格式非法 → 400', badDate.message);
    const notFound = await call(
      'PUT',
      '/incomes/NOT_EXIST',
      { incomeName: 'x', amount: 1, incomeDate: '2026-09-01', category: '其他' },
      token
    );
    assert(notFound._status === 404, '编辑不存在的记录 → 404', notFound.message);
    const delNotFound = await call('DELETE', '/incomes/NOT_EXIST', null, token);
    assert(delNotFound._status === 404, '删除不存在的记录 → 404', delNotFound.message);

    const cats = await call('GET', '/incomes/categories', null, token);
    assert(
      Array.isArray(cats.data?.preset) && cats.data.preset.length > 0,
      '类别接口返回预置类别',
      (cats.data?.preset || []).join('/')
    );
    assert(
      (cats.data?.preset || []).every(c => !/送水到府|水公社|直营水站|线下零售|量贩机|零售机/.test(c)),
      '预置类别**不与订单营收类目重名**（避免口径重复）'
    );

    // ================= 2. 记账方向：新增 =================
    console.log('== 2. 新增（带账户）→ 余额 +amount、写收入流水 ==');
    const base = await balanceOf(ACCOUNT);
    assert(base !== null, `基准账户可用（${ACCOUNT}）`, String(base));

    const AMT = 123.45;
    const TODAY = new Date().toISOString().slice(0, 10);
    const created1 = await call(
      'POST',
      '/incomes',
      {
        incomeName: PREFIX + '-废品回收',
        category: '废品回收',
        amount: AMT,
        incomeDate: TODAY,
        accountId: ACCOUNT,
        remark: '冒烟：记账方向'
      },
      token
    );
    assert(created1._status === 200 && !!created1.data?.incomeId, '新增成功', created1.message);
    const id1 = created1.data?.incomeId;
    if (id1) created.push(id1);

    const afterCreate = await balanceOf(ACCOUNT);
    assert(near(afterCreate - base, AMT), `余额 +${AMT}`, `${base} -> ${afterCreate}`);

    const [txRows] = await pool.query(
      'SELECT tx_type, tx_category, amount, related_module, related_id, balance_before, balance_after FROM finance_transactions WHERE related_module = ? AND related_id = ?',
      ['other_income', id1]
    );
    assert(txRows.length === 1, '生成 1 条资金流水', `实际 ${txRows.length} 条`);
    if (txRows.length) {
      const tx = txRows[0];
      assert(Number(tx.tx_type) === 1, '流水类型为收入(1)', String(tx.tx_type));
      assert(tx.tx_category === '其他收入', "流水类别为 '其他收入'", tx.tx_category);
      assert(near(tx.amount, AMT), '流水金额一致');
      assert(near(tx.balance_after - tx.balance_before, AMT), '流水 balance_after = before + amount');
    }

    // 列表与合计
    const list = await call('GET', `/incomes?range=month&keyword=${PREFIX}`, null, token);
    assert(list._status === 200 && list.data?.total >= 1, '列表按关键词可查到', `total=${list.data?.total}`);
    assert(near(list.data?.sumAmount, AMT), 'sumAmount 等于新增金额', String(list.data?.sumAmount));

    // ================= 3. 编辑：先撤销再重记 =================
    console.log('== 3. 编辑 → 余额净变化 = 新值 − 旧值 ==');
    const AMT2 = 200;
    const upd = await call(
      'PUT',
      `/incomes/${id1}`,
      {
        incomeName: PREFIX + '-废品回收(改)',
        category: '废品回收',
        amount: AMT2,
        incomeDate: TODAY,
        accountId: ACCOUNT,
        remark: '冒烟：编辑'
      },
      token
    );
    assert(upd._status === 200, '编辑成功', upd.message);
    const afterUpdate = await balanceOf(ACCOUNT);
    assert(
      near(afterUpdate - base, AMT2),
      `余额净变化 = ${AMT2}（先撤销 ${AMT} 再记 ${AMT2}）`,
      `${base} -> ${afterUpdate}`
    );
    const [txRows2] = await pool.query(
      'SELECT COUNT(*) n FROM finance_transactions WHERE related_module = ? AND related_id = ?',
      ['other_income', id1]
    );
    assert(Number(txRows2[0].n) === 1, '编辑后流水仍为 1 条（旧的已撤销，未累积）', `实际 ${txRows2[0].n} 条`);

    // 去掉账户 → 余额回退
    const upd2 = await call(
      'PUT',
      `/incomes/${id1}`,
      {
        incomeName: PREFIX + '-废品回收(改2)',
        category: '废品回收',
        amount: AMT2,
        incomeDate: TODAY,
        accountId: null,
        remark: '冒烟：去掉账户'
      },
      token
    );
    assert(upd2._status === 200, '编辑去掉账户成功', upd2.message);
    const afterNoAcc = await balanceOf(ACCOUNT);
    assert(near(afterNoAcc, base), '去掉账户 → 余额回到基线', `${base} -> ${afterNoAcc}`);
    const [txRows3] = await pool.query(
      'SELECT COUNT(*) n FROM finance_transactions WHERE related_module = ? AND related_id = ?',
      ['other_income', id1]
    );
    assert(Number(txRows3[0].n) === 0, '去掉账户后关联流水已清除', `实际 ${txRows3[0].n} 条`);

    // ================= 4. 不带账户：不动账户 =================
    console.log('== 4. 不带账户的新增 ==');
    const noAcc = await call(
      'POST',
      '/incomes',
      {
        incomeName: PREFIX + '-利息',
        category: '利息收入',
        amount: 50,
        incomeDate: TODAY,
        remark: '冒烟：无账户'
      },
      token
    );
    assert(noAcc._status === 200, '无账户新增成功', noAcc.message);
    if (noAcc.data?.incomeId) created.push(noAcc.data.incomeId);
    assert(near(await balanceOf(ACCOUNT), base), '无账户 → 余额不变', String(await balanceOf(ACCOUNT)));
    const [txNoAcc] = await pool.query('SELECT COUNT(*) n FROM finance_transactions WHERE related_id = ?', [
      noAcc.data?.incomeId
    ]);
    assert(Number(txNoAcc[0].n) === 0, '无账户 → 不产生流水');

    // ================= 5. 统计口径（增量断言） =================
    console.log('== 5. 统计口径：计入总营收 / 总利润 ==');
    const mBefore = await call('GET', '/dashboard/metrics?range=month', null, token);
    const X = 77.7;
    const bump = await call(
      'POST',
      '/incomes',
      {
        incomeName: PREFIX + '-口径验证',
        category: '补贴',
        amount: X,
        incomeDate: TODAY,
        accountId: ACCOUNT,
        remark: '冒烟：口径'
      },
      token
    );
    assert(bump._status === 200, '新增口径验证记录', bump.message);
    if (bump.data?.incomeId) created.push(bump.data.incomeId);
    const mAfter = await call('GET', '/dashboard/metrics?range=month', null, token);

    assert(
      near(Number(mAfter.data?.detail?.otherIncome) - Number(mBefore.data?.detail?.otherIncome), X),
      'metrics.detail.otherIncome 恰好 +X（与收入页同源）',
      `${mBefore.data?.detail?.otherIncome} -> ${mAfter.data?.detail?.otherIncome}`
    );
    assert(
      near(Number(mAfter.data?.revenue) - Number(mBefore.data?.revenue), X),
      'metrics.revenue 恰好 +X（计入总营收）'
    );
    assert(
      near(Number(mAfter.data?.profit) - Number(mBefore.data?.profit), X),
      'metrics.profit 恰好 +X（同步影响总利润）'
    );
    assert(
      near(
        Number(mAfter.data?.revenue),
        round2(
          Number(mAfter.data.detail.orderRevenue) +
            Number(mAfter.data.detail.machineRevenue) +
            Number(mAfter.data.detail.otherIncome)
        )
      ),
      '恒等式：revenue = 订单 + 机台 + 其他收入'
    );

    const fin = await call('GET', '/finance/summary?range=month', null, token);
    const listSum = round2((fin.data?.list || []).reduce((s, x) => s + Number(x.revenue || 0), 0));
    // ⚠️ 必须先断言 otherIncome 非 0，否则下面的恒等式会在「0 + 0 = 0」上空转通过。
    //    2026-09-18 就是这么漏掉了「营收汇总用闭区间、台账查询用开区间 → 当天录入的收入
    //    恒为 0」的 bug：断言形式正确，但数据全 0，等于没测。
    assert(
      Number(fin.data?.overall?.otherIncome) > 0,
      '营收汇总的 otherIncome 非 0（区间约定未把当天排除）',
      String(fin.data?.overall?.otherIncome)
    );
    const pageMonth = await call('GET', '/incomes?range=month', null, token);
    assert(
      near(Number(pageMonth.data?.sumAmount), Number(fin.data?.overall?.otherIncome)),
      '跨端点对账：收入页当月合计 = 营收汇总 otherIncome',
      `页 ${pageMonth.data?.sumAmount} vs 汇总 ${fin.data?.overall?.otherIncome}`
    );
    assert(
      near(listSum + Number(fin.data?.overall?.otherIncome), Number(fin.data?.overall?.totalRevenue)),
      '营收汇总勾稽：sum(6 类型) + otherIncome = totalRevenue',
      `${listSum} + ${fin.data?.overall?.otherIncome} vs ${fin.data?.overall?.totalRevenue}`
    );
    assert(
      (fin.data?.list || []).length === 6,
      '营收汇总仍为 6 行订单类型（未混入其他收入行）',
      String((fin.data?.list || []).length)
    );

    const po = await call('GET', '/profit/overview?range=month', null, token);
    assert((po.data?.list || []).length === 6, '利润总览仍为 6 行订单类型', String((po.data?.list || []).length));
    assert(
      near(
        round2(Number(po.data?.overall?.revenue) - Number(po.data?.overall?.costTotal)),
        Number(po.data?.overall?.profit)
      ),
      '利润恒等式：overall.profit = revenue − costTotal'
    );

    // 趋势：当月桶的其他收入合计应与明细一致（只比总量，避免跨桶口径歧义）
    const tr = await call('GET', '/dashboard/trends?granularity=month', null, token);
    const lastBucket = (tr.data?.buckets || [])[(tr.data?.buckets || []).length - 1];
    assert(lastBucket && 'otherIncome' in lastBucket, '趋势桶含 otherIncome 字段');

    // ================= 6. 资金恒等式 =================
    console.log('== 6. 资金恒等式 ==');
    const ident = await financeIdentity();
    assert(
      ident.bad === 0,
      `余额 = 期初 + 流水净额（${ident.total} 个账户）`,
      ident.bad ? JSON.stringify(ident.badList) : ''
    );

    // ================= 7. 模板 / 导出 / 导入 =================
    console.log('== 7. 模板 / 导出 / 导入 ==');
    const tpl = await call('GET', '/incomes/template', null, token, true);
    assert(tpl._status === 200 && tpl._buf.length > 1000, '模板下载为 xlsx 二进制', `${tpl._buf.length} B`);
    const exp = await call('GET', `/incomes/export?range=month&format=csv&keyword=${PREFIX}`, null, token, true);
    const csvText = exp._buf.toString('utf8');
    assert(exp._status === 200 && csvText.includes('收入名称'), '导出 CSV 含表头', `HTTP ${exp._status}`);

    const csv =
      '\ufeff' +
      ['收入名称,金额,收入日期,收入类别,备注,收入账户', `${PREFIX}-导入,66,${TODAY},废品回收,冒烟导入,${ACCOUNT}`].join(
        '\r\n'
      );
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'smk_income.csv');
    const imp = await call('POST', '/incomes/import', fd, token, true);
    assert(imp._status === 200 && String(imp._buf.toString('utf8')).length > 0, 'CSV 导入请求成功');

    // ================= 8. 删除：余额回退、流水清除 =================
    console.log('== 8. 删除 → 余额回退、流水清除 ==');
    for (const id of created) {
      const del = await call('DELETE', `/incomes/${id}`, null, token);
      if (del._status !== 200) console.log(`     （删除 ${id} 返回 ${del._status} ${del.message}）`);
    }
    const afterDel = await balanceOf(ACCOUNT);
    assert(near(afterDel, base), '删除全部测试记录后余额回到基线', `${base} -> ${afterDel}`);
    const [leftTx] = await pool.query(
      "SELECT COUNT(*) n FROM finance_transactions WHERE related_module = 'other_income' AND related_id LIKE ?",
      ['SMKINC%']
    );
    assert(Number(leftTx[0].n) === 0, '测试流水已全部清除', `残留 ${leftTx[0].n} 条`);
  } catch (e) {
    fail++;
    console.log('  ❌ 异常终止：' + e.message);
    console.log(e.stack);
  } finally {
    // ---- 清理：删掉本次可能残留的业务行与流水，并复核 ----
    try {
      await pool.query(
        "DELETE FROM finance_transactions WHERE related_module = 'other_income' AND related_id IN (SELECT income_id FROM other_incomes WHERE income_name LIKE ?)",
        [PREFIX + '%']
      );
      // 上一条依赖子查询在同表删除前后的可见性，稳妥起见再按名称前缀兜底删一次流水（先取 id）
      const [rows] = await pool.query('SELECT income_id FROM other_incomes WHERE income_name LIKE ?', [PREFIX + '%']);
      for (const r of rows) {
        await pool.query("DELETE FROM finance_transactions WHERE related_module = 'other_income' AND related_id = ?", [
          r.income_id
        ]);
      }
      await pool.query('DELETE FROM other_incomes WHERE income_name LIKE ?', [PREFIX + '%']);
      const [left] = await pool.query('SELECT COUNT(*) n FROM other_incomes WHERE income_name LIKE ?', [PREFIX + '%']);
      console.log('');
      console.log('清理：残留 other_incomes ' + left[0].n + ' 行' + (Number(left[0].n) === 0 ? ' ✓' : ' ✗'));
    } catch (e) {
      console.log('清理失败：' + e.message);
    }
    const identAfter = await financeIdentity().catch(() => null);
    if (identAfter)
      console.log(
        '收尾资金恒等式：' +
          identAfter.total +
          ' 个账户，不符 ' +
          identAfter.bad +
          ' 个 ' +
          (identAfter.bad === 0 ? '✓' : '✗')
      );
    console.log('');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();

/**
 * 冒烟测试：Web 管理端 · 积分钱包（双积分）
 * ===========================================================================
 * 覆盖端点（全部 Web 侧 /api/wallets，均 requireAdmin）：
 *   GET    /                        主体钱包总览（水站 + 业务员全量，含未开立）
 *   POST   /open                    为主体开立积分钱包（天然幂等）
 *   POST   /:walletId/adjust        管理员手工增减积分（幂等 + 按方向校验）
 *   GET    /:walletId/transactions  流水 / 配送费积分按月明细 / 区间对账
 *
 * 为什么要有这个脚本（本仓库铁律：改既有端点前先建防线）：
 *   1. 「调整积分」是**资金动作**，且本批把它的实现从「小程序控制器内联」抽成了
 *      共享服务（services/walletAdminService.js）供两端复用 —— 抽服务属于
 *      「行为等价重构」，而**仅靠读代码无法证明等价**，必须有断言钉住。
 *   2. Web 端此前**没有**积分入口（在线充值下线后，充值积分只能由小程序管理端加），
 *      新端点没有任何既有覆盖。
 *   3. 双积分的两条恒等式必须同时钉住：
 *        balance = recharge_balance + delivery_fee_balance          （分账户）
 *        balance = initial + Σ正向 − Σ负向                            （账实）
 *      只验总额的话，「配送费积分被记成充值积分」这种错**完全看不出来**。
 *
 * ⚠️ 断言方向必须显式：本域「增加 = +」「扣减 = −」，
 *    照抄其它域（如支出域方向相反）会「两边一起错、全绿」。
 *
 * 运行：node scripts/smoke_wallet_points_web.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000/api';
const { pool } = require('../src/config/db');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
const {
  WALLET_OWNER_TYPE,
  WALLET_TX_TYPE,
  TX_DIRECTION,
  POINTS_TYPE,
  POINTS_TYPE_LABEL,
  MINI_TOKEN_AUDIENCE,
  MINI_TOKEN_ISSUER,
  EMPLOYEE_TYPE
} = require('../src/constants/mini');

/** 返回信封 + HTTP 状态码（401/403 这类断言只能看状态码） */
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
  return { ...json, httpStatus: res.status };
}

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}
function section(title) {
  console.log(`\n${title}`);
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const TS = Date.now();
// 标识口径必须落在 smokeCleanup 的 MARKERS 内
const stationId = `SMKST${TS}`;
const stationName = `冒烟积分水站${TS}`;
const salesmanId = `SMKWP${TS}`;
const salesmanName = `冒烟积分业务员${TS}`;
const viewerName = `smoke_viewer_${TS}`; // users MARKERS: username LIKE 'smoke\_%'
const MONTH_TAG = '冒烟-Web积分';

const q = async (sql, args = []) => (await pool.query(sql, args))[0];

/** 钱包三列快照（总额 + 两个分账户） */
const walletSnap = async walletId => {
  const r = await q(
    `SELECT balance, recharge_balance, delivery_fee_balance, status, initial_balance
       FROM wallet_accounts WHERE wallet_id = ?`,
    [walletId]
  );
  if (!r.length) return null;
  return {
    balance: Number(r[0].balance),
    recharge: Number(r[0].recharge_balance),
    delivery: Number(r[0].delivery_fee_balance),
    initial: Number(r[0].initial_balance),
    status: Number(r[0].status)
  };
};

/** 按积分类型汇总该钱包流水（用于钉住「方向 + 类型」两个维度） */
const sumByPointsType = async (walletId, pointsType) => {
  const r = await q(
    `SELECT
        ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE 0 END), 0), 2) AS tin,
        ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE 0 END), 0), 2) AS tout,
        COUNT(*) AS cnt
       FROM wallet_transactions WHERE wallet_id = ? AND points_type = ?`,
    [TX_DIRECTION.IN, TX_DIRECTION.OUT, walletId, pointsType]
  );
  return { in: Number(r[0].tin), out: Number(r[0].tout), cnt: Number(r[0].cnt) };
};

(async () => {
  let cleanup = null;
  try {
    // ══════════════════════ 0. 准备 ══════════════════════
    section('0. 准备（管理员登录 + 自建冒烟主体，不依赖真实数据）');

    const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
    assert(Boolean(login.data && login.data.token), `管理员登录（${login.code} ${login.message || ''}）`);
    const token = login.data && login.data.token;

    await pool.query(
      `INSERT INTO sub_stations (station_id, station_name, contact_name, phone, status, current_debt, credit_limit)
       VALUES (?, ?, '冒烟联系人', '13900000099', 1, 0, 0)`,
      [stationId, stationName]
    );
    await pool.query(
      `INSERT INTO workers (worker_id, worker_name, phone, employee_type, status, commission_rate, monthly_salary)
       VALUES (?, ?, '13900000098', ?, 1, 0, 0)`,
      [salesmanId, salesmanName, EMPLOYEE_TYPE.SALESMAN]
    );
    // 非管理员 Web 用户（用于 403）：口令与管理员一致，仅角色不同
    await pool.query(
      `INSERT INTO users (username, password, display_name, role)
       VALUES (?, ?, '冒烟只读用户', 'viewer')`,
      [viewerName, await bcrypt.hash('admin123', 10)]
    );
    const viewerLogin = await call('POST', '/auth/login', { username: viewerName, password: 'admin123' });
    assert(Boolean(viewerLogin.data && viewerLogin.data.token), '非管理员账号可登录（用于 403 断言）');
    const viewerToken = viewerLogin.data && viewerLogin.data.token;

    // ══════════════════════ 1. 权限 ══════════════════════
    section('1. 权限：无令牌 401 / 小程序令牌跨端隔离 401 / 非管理员 403');

    const noToken = await call('GET', '/wallets', null, null);
    assert(
      noToken.httpStatus === 401 && noToken.code === 401,
      `1.1 无令牌读列表 → HTTP 401 + code 401（实得 ${noToken.httpStatus}/${noToken.code}）`
    );

    // 用**真实的小程序密钥**签一个管理员令牌：模拟「拿到小程序管理员令牌后直连 Web 接口」
    // （§51.2 第 1 条：屏障不能只依赖「密钥不同」这一隐含前提）
    const miniToken = jwt.sign({ miniAccountId: 1, role: 'admin', tokenUse: 'mini' }, process.env.JWT_SECRET_MINI, {
      audience: MINI_TOKEN_AUDIENCE,
      issuer: MINI_TOKEN_ISSUER,
      expiresIn: '5m'
    });
    const miniOnWeb = await call('GET', '/wallets', null, miniToken);
    assert(
      miniOnWeb.httpStatus === 401,
      `1.2 ★ 小程序管理员令牌直连 Web 接口被拒 401（跨端令牌隔离，实得 ${miniOnWeb.httpStatus}）`
    );
    const miniWrite = await call('POST', '/wallets/open', { ownerType: 'STATION', ownerId: stationId }, miniToken);
    assert(miniWrite.httpStatus === 401, `1.2b 小程序令牌写接口同样被拒 401（实得 ${miniWrite.httpStatus}）`);

    const viewerRead = await call('GET', '/wallets', null, viewerToken);
    assert(
      viewerRead.httpStatus === 403,
      `1.3 非管理员**读**也被拒 403（本域读的是他人资产，实得 ${viewerRead.httpStatus}）`
    );
    const viewerWrite = await call('POST', '/wallets/open', { ownerType: 'STATION', ownerId: stationId }, viewerToken);
    assert(viewerWrite.httpStatus === 403, `1.4 非管理员写被拒 403（实得 ${viewerWrite.httpStatus}）`);

    // ══════════════════════ 2. 主体列表（未开立也要在列） ══════════════════════
    section('2. 主体列表：未开立钱包的主体必须可见（否则永远无法给它加积分）');

    const listRes = await call('GET', '/wallets', null, token);
    assert(listRes.code === 200, `2.1 列表接口 200（${listRes.message || ''}）`);
    const rows = (listRes.data && listRes.data.list) || [];
    const stRow = rows.find(r => r.ownerId === stationId);
    const smRow = rows.find(r => r.ownerId === salesmanId);

    // ⚠️ 断言「行的形状」：只验「200 + 有 list」的话，若路径静默命中**另一个域**
    //    （Express 同名路由注册两次不报错）也会全绿放行
    assert(
      Boolean(stRow) && Boolean(smRow),
      `2.2 两个冒烟主体都在列表中（水站 ${Boolean(stRow)} / 业务员 ${Boolean(smRow)}）`
    );
    assert(
      stRow &&
        stRow.ownerName === stationName &&
        stRow.ownerType === WALLET_OWNER_TYPE.STATION &&
        stRow.ownerTypeLabel === '直营水站' &&
        typeof stRow.walletId === 'object' &&
        'rechargeBalance' in stRow &&
        'deliveryFeeBalance' in stRow,
      '2.3 水站行的形状正确（ownerType/ownerTypeLabel/两个分账户字段齐备）'
    );
    assert(
      smRow && smRow.ownerType === WALLET_OWNER_TYPE.SALESMAN && smRow.ownerName === salesmanName,
      '2.4 业务员行由 workers.employee_type 命中（业务员并入员工管理）'
    );
    assert(
      stRow && stRow.opened === false && stRow.walletId === null && near(stRow.balance, 0),
      '2.5 未开立钱包的主体：opened=false、walletId=null、余额 0'
    );
    assert(
      Array.isArray(listRes.data.pointsTypeOptions) &&
        listRes.data.pointsTypeOptions.length === 2 &&
        listRes.data.pointsTypeOptions.some(
          o => o.value === POINTS_TYPE.RECHARGE && o.label === POINTS_TYPE_LABEL[POINTS_TYPE.RECHARGE]
        ),
      '2.6 积分类型下拉项由服务端下发（枚举单源，前端不另存一份中文名）'
    );
    assert(
      listRes.data.totals && 'rechargeTotal' in listRes.data.totals && 'deliveryFeeTotal' in listRes.data.totals,
      '2.7 汇总含两类积分合计（与总额同一处取数，避免第二份公式）'
    );

    const badOwnerType = await call('GET', '/wallets?ownerType=NOT_A_TYPE', null, token);
    assert(badOwnerType.code === 400, `2.8 非法主体类型 → 400（实得 ${badOwnerType.code}）`);

    const kwRes = await call('GET', `/wallets?keyword=${encodeURIComponent(stationName)}`, null, token);
    const kwRows = (kwRes.data && kwRes.data.list) || [];
    assert(
      kwRows.length === 1 && kwRows[0].ownerId === stationId,
      `2.9 关键字过滤命中且只命中目标（实得 ${kwRows.length} 行）`
    );

    // ══════════════════════ 3. 开立钱包 ══════════════════════
    section('3. 开立钱包：主体必须真实存在，且重复开立只得到一个钱包');

    const openRes = await call('POST', '/wallets/open', { ownerType: 'STATION', ownerId: stationId }, token);
    assert(
      openRes.code === 200 && openRes.data && openRes.data.walletId,
      `3.1 开立水站钱包（${openRes.message || ''}）`
    );
    const stationWalletId = openRes.data && openRes.data.walletId;

    const openAgain = await call('POST', '/wallets/open', { ownerType: 'STATION', ownerId: stationId }, token);
    assert(
      openAgain.code === 200 && openAgain.data.walletId === stationWalletId,
      '3.2 ★ 重复开立返回**同一个**钱包（ensureWallet 命中唯一键 → 天然幂等，不需要幂等键）'
    );
    const dupCount = await q(`SELECT COUNT(*) c FROM wallet_accounts WHERE owner_type = 'STATION' AND owner_id = ?`, [
      stationId
    ]);
    assert(Number(dupCount[0].c) === 1, `3.3 库里该主体只有 1 个钱包（实得 ${dupCount[0].c}）`);

    const openGhost = await call('POST', '/wallets/open', { ownerType: 'STATION', ownerId: 'SMKST_NOT_EXIST' }, token);
    assert(openGhost.code === 404, `3.4 不存在的主体 → 404（不制造无主钱包，实得 ${openGhost.code}）`);

    // 拿一个真实「店长」的 id 冒充业务员：类型守卫必须挡住
    const manager = await q(`SELECT worker_id FROM workers WHERE employee_type = ? LIMIT 1`, [EMPLOYEE_TYPE.MANAGER]);
    if (manager.length) {
      const openWrongType = await call(
        'POST',
        '/wallets/open',
        { ownerType: 'SALESMAN', ownerId: manager[0].worker_id },
        token
      );
      assert(openWrongType.code === 404, `3.5 非业务员员工按业务员开立 → 404（类型守卫，实得 ${openWrongType.code}）`);
    }
    const badOpen = await call('POST', '/wallets/open', { ownerType: 'STATION' }, token);
    assert(badOpen.code === 400, `3.6 缺 ownerId → 400（实得 ${badOpen.code}）`);

    // ══════════════════════ 4. 调整积分：入参与方向 ══════════════════════
    section('4. 调整积分：校验 + 两类积分分别落账 + 两条恒等式');

    const adj = (body, key) =>
      call('POST', `/wallets/${stationWalletId}/adjust`, { ...body, clientRequestId: key }, token);
    const reason = `${MONTH_TAG}-调账`;

    const badCases = [
      ['4.1 缺 amount → 400', { direction: 'IN', reason }, 'smoke_webw_a1'],
      ['4.2 amount=0 → 400', { direction: 'IN', amount: 0, reason }, 'smoke_webw_a2'],
      ['4.3 amount 为负 → 400', { direction: 'IN', amount: -5, reason }, 'smoke_webw_a3'],
      ['4.4 缺 reason → 400（§18 强制填写操作原因）', { direction: 'IN', amount: 10 }, 'smoke_webw_a4'],
      ['4.5 方向非法 → 400', { direction: 'SIDEWAYS', amount: 10, reason }, 'smoke_webw_a5'],
      ['4.6 积分类型非法 → 400', { direction: 'IN', amount: 10, reason, pointsType: 'BOGUS' }, 'smoke_webw_a6'],
      ['4.7 缺幂等键 → 400', { direction: 'IN', amount: 10, reason }, null]
    ];
    for (const [label, body, key] of badCases) {
      const r = await adj(body, key);
      assert(r.code === 400, `${label}（实得 ${r.code} ${r.message || ''}）`);
    }

    const ghostWallet = await call(
      'POST',
      '/wallets/WL_NOT_EXIST/adjust',
      { direction: 'IN', amount: 10, reason, clientRequestId: `smoke_webw_a7` },
      token
    );
    assert(ghostWallet.code === 404, `4.8 钱包不存在 → 404（与参数错误区分，实得 ${ghostWallet.code}）`);

    // ── 加充值积分 100
    const inRecharge = await adj(
      { direction: 'IN', amount: 100, reason, remark: `${MONTH_TAG}-充值` },
      'smoke_webw_r1'
    );
    assert(
      inRecharge.code === 200 && near(inRecharge.data.balanceAfter, 100),
      `4.9 加充值积分 100 → 余额 100（实得 ${inRecharge.data && inRecharge.data.balanceAfter}）`
    );
    let snap = await walletSnap(stationWalletId);
    assert(
      near(snap.balance, 100) && near(snap.recharge, 100) && near(snap.delivery, 0),
      `4.10 ★ 记入**充值积分**而非配送费积分（总额 ${snap.balance} / 充值 ${snap.recharge} / 配送费 ${snap.delivery}）`
    );
    const rSum = await sumByPointsType(stationWalletId, POINTS_TYPE.RECHARGE);
    assert(
      near(rSum.in, 100) && near(rSum.out, 0) && rSum.cnt === 1,
      `4.11 流水按积分类型落库（充值：入 ${rSum.in} / 出 ${rSum.out} / ${rSum.cnt} 笔）`
    );

    // ── 加配送费积分 30（补发场景：发行漏录 / 对账差异）
    const inDelivery = await adj(
      { direction: 'IN', amount: 30, reason, pointsType: POINTS_TYPE.DELIVERY_FEE, remark: `${MONTH_TAG}-补发配送费` },
      'smoke_webw_d1'
    );
    assert(inDelivery.code === 200, `4.12 加配送费积分 30（${inDelivery.message || ''}）`);
    snap = await walletSnap(stationWalletId);
    assert(
      near(snap.balance, 130) && near(snap.recharge, 100) && near(snap.delivery, 30),
      `4.13 ★ 记入**配送费积分**：总额 130 / 充值 100 / 配送费 30（实得 ${snap.balance}/${snap.recharge}/${snap.delivery}）`
    );

    // ── 默认类型 = 充值积分（业务口径：管理员后台设置的就是充值积分）
    const inDefault = await adj({ direction: 'IN', amount: 5, reason }, 'smoke_webw_df');
    snap = await walletSnap(stationWalletId);
    assert(
      inDefault.code === 200 && near(snap.recharge, 105) && near(snap.delivery, 30),
      `4.14 不传 pointsType 时默认加到充值积分（充值 ${snap.recharge} / 配送费 ${snap.delivery}）`
    );

    // ── 扣减（方向 = −，本域方向必须显式钉住）
    const outRecharge = await adj({ direction: 'OUT', amount: 20, reason: `${MONTH_TAG}-扣减` }, 'smoke_webw_o1');
    assert(outRecharge.code === 200, `4.15 扣减充值积分 20（${outRecharge.message || ''}）`);
    snap = await walletSnap(stationWalletId);
    assert(
      near(snap.balance, 115) && near(snap.recharge, 85) && near(snap.delivery, 30),
      `4.16 ★ 扣减方向正确（−20）：总额 115 / 充值 85 / 配送费 30（实得 ${snap.balance}/${snap.recharge}/${snap.delivery}）`
    );
    const rSum2 = await sumByPointsType(stationWalletId, POINTS_TYPE.RECHARGE);
    assert(near(rSum2.out, 20), `4.17 扣减流水方向为 OUT（实得 ${rSum2.out}）`);

    // ── 两条恒等式
    assert(
      near(snap.balance, snap.recharge + snap.delivery),
      `4.18 ★ 分账户恒等式：总额 = 充值 + 配送费（${snap.balance} = ${snap.recharge} + ${snap.delivery}）`
    );
    const agg = await q(
      `SELECT
          ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE 0 END), 0), 2) AS tin,
          ROUND(COALESCE(SUM(CASE WHEN direction = ? THEN amount ELSE 0 END), 0), 2) AS tout
         FROM wallet_transactions WHERE wallet_id = ?`,
      [TX_DIRECTION.IN, TX_DIRECTION.OUT, stationWalletId]
    );
    const expected = snap.initial + Number(agg[0].tin) - Number(agg[0].tout);
    assert(near(snap.balance, expected), `4.19 ★ 账实恒等式：余额 = 期初 + Σ入 − Σ出（${snap.balance} = ${expected}）`);

    // ══════════════════════ 5. 幂等（§45 重复点击） ══════════════════════
    section('5. 幂等：同键重放只生效一次；同键不同内容必须拒绝');

    const beforeIdem = await walletSnap(stationWalletId);
    const keyIdem = 'smoke_webw_idem1';
    const first = await adj({ direction: 'IN', amount: 60, reason: `${MONTH_TAG}-幂等` }, keyIdem);
    const second = await adj({ direction: 'IN', amount: 60, reason: `${MONTH_TAG}-幂等` }, keyIdem);
    const afterIdem = await walletSnap(stationWalletId);
    assert(first.code === 200, `5.1 首次调增成功（${first.message || ''}）`);
    assert(
      second.code === 200 && second.data && second.data.replayed === true,
      '5.2 ★ 重复点击被幂等合并（replayed=true）'
    );
    assert(
      near(afterIdem.balance, beforeIdem.balance + 60),
      `5.3 ★ 余额只变一次：${beforeIdem.balance} → ${afterIdem.balance}`
    );

    const sameKeyDiffAmount = await adj({ direction: 'IN', amount: 61, reason: `${MONTH_TAG}-幂等` }, keyIdem);
    assert(
      sameKeyDiffAmount.code === 400 && /不一致/.test(String(sameKeyDiffAmount.message || '')),
      `5.4 同键不同金额 → 400（不静默按首次参数执行，实得 ${sameKeyDiffAmount.code}）`
    );
    const sameKeyDiffType = await adj(
      { direction: 'IN', amount: 60, reason: `${MONTH_TAG}-幂等`, pointsType: POINTS_TYPE.DELIVERY_FEE },
      keyIdem
    );
    assert(
      sameKeyDiffType.code === 400,
      `5.5 ★ 同键 + 不同积分类型 → 400（指纹包含类型，否则「补发另一类」会被静默合并，实得 ${sameKeyDiffType.code}）`
    );

    // ══════════════════════ 6. 超额扣减 ══════════════════════
    section('6. 超额扣减：拒绝且不留痕');

    const beforeOver = await walletSnap(stationWalletId);
    const txBeforeOver = Number(
      (await q('SELECT COUNT(*) c FROM wallet_transactions WHERE wallet_id = ?', [stationWalletId]))[0].c
    );
    const over = await adj({ direction: 'OUT', amount: 999999, reason: `${MONTH_TAG}-超额` }, 'smoke_webw_over');
    const afterOver = await walletSnap(stationWalletId);
    const txAfterOver = Number(
      (await q('SELECT COUNT(*) c FROM wallet_transactions WHERE wallet_id = ?', [stationWalletId]))[0].c
    );
    assert(
      over.code === 400 && /积分不足/.test(String(over.message || '')),
      `6.1 超额扣减被拒且提示积分不足（实得 ${over.code} ${over.message || ''}）`
    );
    assert(
      near(afterOver.balance, beforeOver.balance) && txAfterOver === txBeforeOver,
      `6.2 ★ 余额与流水都没有变化（${beforeOver.balance} → ${afterOver.balance}，流水 ${txBeforeOver} → ${txAfterOver}）`
    );
    const overIdem = await q('SELECT COUNT(*) c FROM mini_idempotency WHERE idem_key = ?', ['smoke_webw_over']);
    assert(Number(overIdem[0].c) === 0, '6.3 被拒的请求不留幂等键（否则重试会被判成重复而永远无法成功）');

    // ══════════════════════ 7. 停用钱包语义（方向不对称） ══════════════════════
    section('7. 停用钱包：收入方向允许、支出方向拒绝（§11.7 第 4 条）');

    await pool.query('UPDATE wallet_accounts SET status = 0 WHERE wallet_id = ?', [stationWalletId]);
    const inDisabled = await adj(
      { direction: 'IN', amount: 10, reason: `${MONTH_TAG}-停用后补记` },
      'smoke_webw_dis_in'
    );
    assert(inDisabled.code === 200, `7.1 停用钱包仍可**增加**积分（补记/冲正不应被停用卡死，实得 ${inDisabled.code}）`);
    const outDisabled = await adj(
      { direction: 'OUT', amount: 1, reason: `${MONTH_TAG}-停用后扣减` },
      'smoke_webw_dis_out'
    );
    assert(
      outDisabled.code === 400 && /停用/.test(String(outDisabled.message || '')),
      `7.2 停用钱包**扣减**被拒（实得 ${outDisabled.code} ${outDisabled.message || ''}）`
    );
    await pool.query('UPDATE wallet_accounts SET status = 1 WHERE wallet_id = ?', [stationWalletId]);
    const restored = await walletSnap(stationWalletId);
    assert(restored.status === 1, '7.3 测完已恢复启用（不给后续断言留陷阱）');

    // ══════════════════════ 8. 流水 / 月度明细 / 对账 ══════════════════════
    section('8. 流水与按月明细：取数复用单源，只回本钱包的数据');

    const txRes = await call('GET', `/wallets/${stationWalletId}/transactions?page=1&pageSize=50`, null, token);
    assert(txRes.code === 200, `8.1 流水接口 200（${txRes.message || ''}）`);
    assert(
      txRes.data && txRes.data.wallet && txRes.data.wallet.walletId === stationWalletId,
      '8.2 返回的是**本钱包**的概览（不是别人的，也不是另一个域的）'
    );
    assert(
      Array.isArray(txRes.data.transactions) &&
        txRes.data.transactions.length > 0 &&
        txRes.data.transactions.every(t => t.pointsTypeLabel && t.direction),
      '8.3 每笔流水都带积分类型中文名与方向（充值积分 / 配送费积分）'
    );
    // ★ 流水**类型**必须与动作对应：本冒烟只做「管理员调整」，故类型只能是 ADJUST_IN/ADJUST_OUT。
    //   若类型写成了 RECHARGE/ORDER_PAYMENT，钱包余额与恒等式**照样成立**，
    //   但流水标签会误导对账（「这笔钱怎么来的」说错了）—— 恒等式查不出这类错。
    assert(
      txRes.data.transactions.every(t => t.type === WALLET_TX_TYPE.ADJUST_IN || t.type === WALLET_TX_TYPE.ADJUST_OUT),
      `8.3b 管理员调整记的流水类型正确（ADJUST_IN/ADJUST_OUT，实得 ${[
        ...new Set(txRes.data.transactions.map(t => t.type))
      ].join('/')}）`
    );
    assert(
      txRes.data.transactions.every(t => t.direction === TX_DIRECTION.IN || t.direction === TX_DIRECTION.OUT),
      '8.3c 流水 direction 为落库的 1/2（不靠类型反推方向）'
    );
    assert(
      near(txRes.data.wallet.balance, restored.balance) &&
        near(txRes.data.wallet.rechargeBalance, restored.recharge) &&
        near(txRes.data.wallet.deliveryFeeBalance, restored.delivery),
      '8.4 概览的两类余额与库中一致'
    );

    const filters = txRes.data.transactions.map(t => t.pointsType);
    assert(
      filters.includes(POINTS_TYPE.RECHARGE) && filters.includes(POINTS_TYPE.DELIVERY_FEE),
      '8.5 流水里两类积分都出现过（否则后面的类型筛选断言会空转）'
    );

    const onlyDelivery = await call(
      'GET',
      `/wallets/${stationWalletId}/transactions?pointsType=${POINTS_TYPE.DELIVERY_FEE}&pageSize=50`,
      null,
      token
    );
    const deliveryRows = (onlyDelivery.data && onlyDelivery.data.transactions) || [];
    assert(
      deliveryRows.length > 0 && deliveryRows.every(t => t.pointsType === POINTS_TYPE.DELIVERY_FEE),
      `8.6 按积分类型筛选只回配送费积分（${deliveryRows.length} 笔）`
    );

    const badPointsType = await call('GET', `/wallets/${stationWalletId}/transactions?pointsType=BOGUS`, null, token);
    assert(badPointsType.code === 400, `8.7 非法积分类型 → 400（实得 ${badPointsType.code}）`);

    assert(
      Array.isArray(txRes.data.deliveryFeeMonthly),
      '8.8 配送费积分按月明细字段齐备（本冒烟无发行入账 → 允许为空数组，但字段必须在）'
    );
    assert(
      txRes.data.reconciliation && txRes.data.reconciliation.identityOk === true,
      '8.9 区间对账恒等式：期初 + 净额 = 期末'
    );

    const ghostTx = await call('GET', '/wallets/WL_NOT_EXIST/transactions', null, token);
    assert(ghostTx.code === 404, `8.10 不存在的钱包查流水 → 404（实得 ${ghostTx.code}）`);

    // ══════════════════════ 9. 审计与幂等落库 ══════════════════════
    section('9. 审计：Web 端操作必须留下可追溯记录');

    const audits = await q(
      `SELECT action, actor_type, actor_id, target_type, target_id, detail
         FROM mini_audit_logs WHERE target_type = 'WALLET' AND target_id = ?`,
      [stationWalletId]
    );
    assert(audits.length > 0, `9.1 冒烟钱包上留下了审计（${audits.length} 条）`);
    assert(
      audits.every(a => a.action === 'WALLET_ADJUST'),
      '9.2 审计动作 = WALLET_ADJUST'
    );
    assert(
      audits.every(a => a.actor_type === 'WEB'),
      '9.3 审计 actor_type = WEB（与小程序端的 MINI 可区分）'
    );
    assert(
      audits.some(a => /"direction":"(IN|OUT)"/.test(String(a.detail || ''))) &&
        audits.some(a => /"pointsType":"(RECHARGE|DELIVERY_FEE)"/.test(String(a.detail || ''))),
      '9.4 ★ 审计 detail 记录了方向与**积分类型**（否则「这 100 分加的是哪一类」事后无法追溯）'
    );
    const idemDone = await q(`SELECT status, result_ref FROM mini_idempotency WHERE idem_key = ?`, [
      'smoke_webw_idem1'
    ]);
    assert(
      idemDone.length === 1 && idemDone[0].status === 'DONE' && idemDone[0].result_ref,
      '9.5 幂等键标记为 DONE 并记下首次流水号（重放时能返回同一笔）'
    );
    const idemScope = await q(`SELECT scope FROM mini_idempotency WHERE idem_key = ?`, ['smoke_webw_idem1']);
    assert(
      idemScope.length === 1 && /^WALLET_ADJUST:WEB:/.test(idemScope[0].scope),
      `9.6 ★ 幂等作用域带渠道 WEB（与小程序端键空间隔离，实得 ${idemScope[0] && idemScope[0].scope}）`
    );

    // ══════════════════════ 10. 业务员主体也可开立（对称性） ══════════════════════
    section('10. 业务员主体：与直营水站同构');

    const smOpen = await call('POST', '/wallets/open', { ownerType: 'SALESMAN', ownerId: salesmanId }, token);
    assert(smOpen.code === 200 && smOpen.data.walletId, `10.1 开立业务员钱包（${smOpen.message || ''}）`);
    const smWalletId = smOpen.data && smOpen.data.walletId;
    const smAdjust = await call(
      'POST',
      `/wallets/${smWalletId}/adjust`,
      { direction: 'IN', amount: 12, reason: `${MONTH_TAG}-业务员调增`, clientRequestId: 'smoke_webw_sm1' },
      token
    );
    assert(smAdjust.code === 200, `10.2 业务员钱包可调增（${smAdjust.message || ''}）`);
    // ⚠️ 断言**另一个**钱包不受影响：证明取值确实按钱包隔离，而不是串到了「第一个钱包」
    //    （restored 是第 7 节结束时水站钱包的快照，此后水站钱包不应再有任何变动）
    const stAfterSm = await walletSnap(stationWalletId);
    assert(
      near(stAfterSm.balance, restored.balance) &&
        near(stAfterSm.recharge, restored.recharge) &&
        near(stAfterSm.delivery, restored.delivery),
      `10.3 ★ 调整业务员钱包不影响水站钱包（${restored.balance} → ${stAfterSm.balance}）`
    );
    const smSnap = await walletSnap(smWalletId);
    assert(
      near(smSnap.balance, 12) && near(smSnap.recharge, 12) && near(smSnap.delivery, 0),
      `10.4 业务员钱包余额正确（${smSnap.balance}）`
    );
  } catch (e) {
    fail++;
    console.log(`\n❌ 冒烟异常中断：${e && e.message}`);
    console.log(e && e.stack);
  } finally {
    try {
      cleanup = await cleanupSmokeResidue(pool, { log: console.log });
      console.log(`\n清理：${JSON.stringify(cleanup)}`);
    } catch (e) {
      console.log(`\n清理失败：${e && e.message}`);
    }
    // 残留自检：本脚本建的三个载体必须都消失
    try {
      const left = await q(
        `SELECT
            (SELECT COUNT(*) FROM wallet_accounts WHERE owner_id IN (?, ?)) AS wallets,
            (SELECT COUNT(*) FROM sub_stations WHERE station_id = ?) AS stations,
            (SELECT COUNT(*) FROM workers WHERE worker_id = ?) AS workers,
            (SELECT COUNT(*) FROM users WHERE username = ?) AS users,
            (SELECT COUNT(*) FROM mini_idempotency WHERE idem_key LIKE 'smoke_webw%') AS idem,
            (SELECT COUNT(*) FROM mini_audit_logs WHERE target_id IN (SELECT wallet_id FROM wallet_accounts WHERE owner_id IN (?, ?))) AS audits`,
        [stationId, salesmanId, stationId, salesmanId, viewerName, stationId, salesmanId]
      );
      const r = left[0];
      const clean =
        Number(r.wallets) === 0 &&
        Number(r.stations) === 0 &&
        Number(r.workers) === 0 &&
        Number(r.users) === 0 &&
        Number(r.idem) === 0 &&
        Number(r.audits) === 0;
      console.log(
        clean ? '残留自检：✅ 零残留（钱包/水站/业务员/用户/幂等键/审计 全 0）' : `残留自检：❌ ${JSON.stringify(r)}`
      );
      if (!clean) fail++;
    } catch (e) {
      console.log(`残留自检失败：${e && e.message}`);
    }
    await pool.end();
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`结果：${pass} 项通过，${fail} 项失败`);
  process.exit(fail ? 1 : 0);
})();

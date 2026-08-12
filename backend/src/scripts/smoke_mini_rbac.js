// T7 越权验证 + 4 角色登录/数据隔离抽查（对照计划 Task8.2/8.3）
const BASE = 'http://localhost:3000';

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return await res.json();
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  console.log((cond ? '✅ PASS' : '❌ FAIL') + ' | ' + name + (cond ? '' : ' | ' + JSON.stringify(detail)));
  cond ? pass++ : fail++;
}

async function login(role) {
  const r = await call('POST', '/mini/auth/password-login', { username: role, password: '123456' });
  if (r.code !== 200) { console.error('登录失败 ' + role, r); return null; }
  return r.data.token;
}

async function main() {
  // 1. 无 token → 401
  const noAuth = await call('GET', '/mini/auth/me');
  check('未带 token 访问受保护接口 → 401', noAuth.code === 401, noAuth);

  // 2. 4 角色登录 + /me
  const tokens = {};
  for (const role of ['admin', 'worker', 'station', 'salesman']) {
    tokens[role] = await login(role);
    check(`${role} 登录成功`, !!tokens[role]);
    if (!tokens[role]) return;
  }
  const meAdmin = await call('GET', '/mini/auth/me', null, tokens.admin);
  check('admin /me 名称=管理员', meAdmin.data && meAdmin.data.name === '管理员', meAdmin);
  const meWorker = await call('GET', '/mini/auth/me', null, tokens.worker);
  check('worker /me 名称=万万万', meWorker.data && meWorker.data.name === '万万万', meWorker);
  const meStation = await call('GET', '/mini/auth/me', null, tokens.station);
  check('station /me 名称=秣陵水站 + stationName', meStation.data && meStation.data.name === '秣陵水站' && meStation.data.stationName === '秣陵水站', meStation);
  const meSalesman = await call('GET', '/mini/auth/me', null, tokens.salesman);
  check('salesman /me 名称=测试业务员1', meSalesman.data && meSalesman.data.name === '测试业务员1', meSalesman);

  // 3. 越权验证
  // 3.1 worker 审批报销 → 403
  const wApprove = await call('PUT', '/mini/reimbursements/1/approve', { status: 2 }, tokens.worker);
  check('worker 审批报销 → 403', wApprove.code === 403, wApprove);

  // 3.2 worker 创建 orderType=2（分销，越权）→ 403
  const wOrder2 = await call('POST', '/mini/orders', { orderType: 2, customerName: 't', customerPhone: '13900000000', items: [] }, tokens.worker);
  check('worker 创建分销单(orderType=2) → 403', wOrder2.code === 403, wOrder2);

  // 3.3 worker 创建 orderType=5（返货，越权）→ 403
  const wOrder5 = await call('POST', '/mini/orders', { orderType: 5, customerName: 't', customerPhone: '13900000000', items: [] }, tokens.worker);
  check('worker 创建返货单(orderType=5) → 403', wOrder5.code === 403, wOrder5);

  // 3.4 worker 创建 orderType=1（合法类型）→ 角色放行，业务校验 items 空 → 400（证明非 403）
  const wOrder1 = await call('POST', '/mini/orders', { orderType: 1, customerName: 't', customerPhone: '13900000000', items: [] }, tokens.worker);
  check('worker 创建线上单(orderType=1) 放行后业务校验 → 400', wOrder1.code === 400, wOrder1);

  // 3.5 station 访问配送 → 403
  const sPending = await call('GET', '/mini/delivery/pending', null, tokens.station);
  check('station 访问配送大厅 → 403', sPending.code === 403, sPending);

  // 3.6 station 创建 orderType=3（零售，worker 专属）→ 403
  const sOrder3 = await call('POST', '/mini/orders', { orderType: 3, customerName: 't', customerPhone: '13900000000', items: [] }, tokens.station);
  check('station 创建零售单(orderType=3) → 403', sOrder3.code === 403, sOrder3);

  // 3.7 salesman 访问配送 → 403
  const smPending = await call('GET', '/mini/delivery/pending', null, tokens.salesman);
  check('salesman 访问配送大厅 → 403', smPending.code === 403, smPending);

  // 3.8 admin 访问配送 + 报销 → 200
  const aPending = await call('GET', '/mini/delivery/pending?page=1&pageSize=5', null, tokens.admin);
  check('admin 访问配送大厅 → 200', aPending.code === 200, aPending);
  const aReimb = await call('GET', '/mini/reimbursements?page=1&pageSize=5', null, tokens.admin);
  check('admin 报销列表 → 200', aReimb.code === 200, aReimb);

  // 4. 数据隔离抽查（订单列表）
  const orders = {};
  for (const role of ['admin', 'worker', 'station', 'salesman']) {
    const r = await call('GET', '/mini/orders?page=1&pageSize=50', null, tokens[role]);
    orders[role] = r.code === 200 && Array.isArray(r.data.list) ? r.data.list.length : -1;
    console.log(`    [隔离抽查] ${role} 订单可见数 = ${orders[role]}`);
  }
  check('隔离：admin 可见数 >= worker 可见数', orders.admin >= orders.worker);
  check('隔离：admin 可见数 >= salesman 可见数', orders.admin >= orders.salesman);

  console.log('\n===== 结果: PASS=' + pass + ' FAIL=' + fail + ' =====');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('脚本异常: ' + e.message); process.exit(1); });

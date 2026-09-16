/**
 * 冒烟：业务员管理模块并入员工管理（2026-09-04）
 * 覆盖：
 *  1. 旧 /api/salesmen 接口已下线（404）
 *  2. workers API 支持 employeeType=3 业务员 + commissionRate 创建/更新/过滤
 *  3. 非业务员类型 commission_rate 保持 NULL
 *  4. 历史迁移数据（SM 前缀）可经员工接口正常访问
 *  5. 前端构建产物不再引用 salesman 路由（menuConfig 派生检查在 build 断言中做）
 *  6. 员工删除语义（2026-09-16 起）：无引用 → 物理删除；有单据引用 → 转离职(status=0)
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const { pool } = require('../src/config/db');
const { cleanupSmokeResidue } = require('./lib/smokeCleanup');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.error('  FAIL', name); } };

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 404 等 */ }
  return { status: res.status, data };
}

(async () => {
  // 登录
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  ok(login.status === 200 && login.data?.data?.token, '管理员登录');
  const token = login.data?.data?.token;

  console.log('== 1) 旧业务员接口下线 ==');
  const oldList = await api('GET', '/api/salesmen', null, token);
  ok(oldList.status === 404, `GET /api/salesmen 返回 404（实际 ${oldList.status}）`);

  console.log('== 2) 业务员类型创建/更新/过滤 ==');
  const created = await api('POST', '/api/workers', {
    workerName: '冒烟业务员', phone: '13999999999', employeeType: 3, commissionRate: 4.5, vehicleType: 1
  }, token);
  ok(created.status === 200 && created.data?.data, '创建业务员（type=3, commission=4.5）');
  const wid = created.data?.data?.id || created.data?.data?.workerId;
  ok(created.data?.data?.commissionRate === 4.5, '创建响应回显提成 4.5');
  ok(created.data?.data?.employeeType === 3, '创建响应回显类型 3');

  const updated = await api('PUT', `/api/workers/${wid}`, { commissionRate: 5.25 }, token);
  ok(updated.status === 200 && updated.data?.data?.commissionRate === 5.25, '更新提成 4.5 -> 5.25');

  const filtered = await api('GET', '/api/workers?employeeType=3&pageSize=50', null, token);
  const list = filtered.data?.data?.list || filtered.data?.data || [];
  ok(list.some(w => w.id === wid), '按 employeeType=3 过滤可见新业务员');
  const smRows = list.filter(w => String(w.id).startsWith('SM'));
  ok(smRows.length === 4, `历史迁移数据经员工接口可访问（SM 前缀 ${smRows.length}/4）`);
  ok(smRows.every(w => w.employeeType === 3 && w.commissionRate != null), '迁移行类型=3 且提成非空');

  console.log('== 3) 非业务员提成保持 NULL ==');
  const keeper = await api('POST', '/api/workers', {
    workerName: '冒烟配送员', phone: '13999999998', employeeType: 2, commissionRate: 9.9, vehicleType: 1
  }, token);
  const kid = keeper.data?.data?.id || keeper.data?.data?.workerId;
  ok(keeper.data?.data?.commissionRate === null, '配送员工（type=2）传提成仍落 NULL');

  console.log('== 4) 删除语义：「无引用→物理删除，有引用→转离职」 ==');
  // 2026-09-16 起后端改为「能真删就真删，否则设离职」：
  //   本脚本的业务员/配送员都没有任何订单/结算引用 → 应被**物理删除**（列表里查不到）
  await api('DELETE', `/api/workers/${wid}`, null, token);
  await api('DELETE', `/api/workers/${kid}`, null, token);
  const after = await api('GET', '/api/workers?employeeType=3&pageSize=50', null, token);
  const afterList = after.data?.data?.list || after.data?.data || [];
  ok(!afterList.some(w => w.id === wid), '无引用的业务员已被物理删除（列表中不存在）');

  // 有历史单据的员工只能软删（离职）：复用既有 ST001 场景不可靠，这里直接造一条引用
  const withRef = await api('POST', '/api/workers', {
    workerName: '冒烟有单据员工', phone: '13999999997', employeeType: 2
  }, token);
  const rid = withRef.data?.data?.id || withRef.data?.data?.workerId;
  await pool.query(
    `INSERT INTO orders (order_id, order_type, worker_id, delivery_type, customer_name, order_amount,
       delivery_fee, total_receivable, canceled_at, created_at, updated_at)
     VALUES ('SMK_SALESMAN_REF', 1, ?, 1, '冒烟引用', 0, 0, 0, NOW(), NOW(), NOW())`,
    [rid]
  );
  await api('DELETE', `/api/workers/${rid}`, null, token);  const [refRow] = await pool.query('SELECT status FROM workers WHERE worker_id = ?', [rid]);
  ok(refRow.length === 1 && Number(refRow[0].status) === 0, '有单据引用的员工转为离职（status=0，行保留）');
  await pool.query('DELETE FROM orders WHERE order_id = ?', ['SMK_SALESMAN_REF']);
  await pool.query('DELETE FROM workers WHERE worker_id = ?', [rid]);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
})()
  .catch(e => { console.error('SMOKE ERROR:', e); fail++; })
  .finally(async () => {
    // 兜底：若中途断言失败/异常，可能留下未清理的冒烟员工（有引用的会转为离职行）
    await cleanupSmokeResidue(pool);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });

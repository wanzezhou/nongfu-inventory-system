// 小程序账号管理（管理员 · 运维域 —— **不计入 17 个业务域**）
// ===========================================================================
// 背景：业务员离职、手机号换人、水站换微信，此前只能改 SQL —— 而「服务端每请求校验」
//      早已生效（禁用即时拦住写操作、改绑定即让旧令牌失效），缺的只是**管理入口**。
//
// 三条硬边界（不是保守 —— 这几条一旦放开就没有可恢复的路径）：
//   ① **不能操作自己**：禁用/解绑自己会让管理员当场失去管理权限；库里只剩一个管理员账号时
//      就是永久锁死（本系统没有 Web 侧的账号管理后台可救）。
//   ② **管理员角色账号不开放操作**：小程序端只管理业务账号（业务员 / 直营水站）。
//      否则「管理员令牌 → 把任意账号提权成 admin」这条链就成立了 —— 而 §22.4 之所以
//      让小程序管理端不复用 Web 的 requireAdmin，防的正是这层越权。
//   ③ **改绑定/解绑必须校验目标**：目标存在且启用、且未被其它**启用中**账号占用。
//      占用不能只靠唯一键兜底 —— 那只会让用户拿到一个「服务器错误」。
//
// ⚠️⚠️ 本域最容易做错的地方：**「禁用」与「解绑」是两件不同的事**。
//    · **禁用** = `status=0`：**保留 openid 绑定**。该微信再登录会被拒（禁用即时生效），
//      写操作 401（读历史仍可用）。同时 `active_key` 变 NULL → 唯一键让位，
//      同一主体可被**另一个**微信绑定。
//    · **解绑** = **删除这一行**：解除绑定，使这个微信可以重新登录并重新绑定。
//      ⚠️ **不能**用 `status=0` 当作解绑：登录流程 `findByOpenid` 会先命中那条禁用行，
//         再被 `assertAccountUsable` 拒掉 —— 用户会掉进「想重绑却永远登不进去」的死角。
//    · 两者都**不动钱包**：钱包按 `(owner_type, owner_id)` 挂在主体上，
//      所以「解绑后换新微信绑同一水站，余额保持连续」正是设计要的效果（§44.11 ⑥）。
//
// ⚠️ 改绑定/解绑会让该账号的**旧令牌立即失效**（miniAuth 比对 role/target_id）——
//    这是有意的：绑定关系变了，旧令牌不再代表当前身份。页面上要提示「对方需重新登录」。
//
// ⚠️⚠️ 本域路径是 **/mini/admin/mini-accounts**（不是 accounts）：
//    /admin/accounts 已属「公司资金账户」域（第 10 域）。Express 对同名路由注册两次**不报错**，
//    只静默命中先注册的那个 —— 首版因此把「公司账户列表」当成账号列表返回、删除按钮删的是公司账户，
//    而所有接口都是 200。**接口冒烟的「列表形状断言」是唯一能发现它的手段。**
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
const { parseMiniPage, requireIdemKey, respondBusinessError } = require('./_shared');
const { IDEM_SCOPE, AUDIT_ACTION, MINI_ROLES } = require('../../../constants/mini');
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');
const { maskPhone } = require('../../../services/miniAccountService');

/** 业务错误（e.business=true → respondBusinessError 按自带状态码回） */
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

/** 可绑定的主体类型（管理员账号不在此列 —— 见文件头 ②） */
const BINDABLE_ROLES = [
  { value: MINI_ROLES.SALESMAN, label: '业务员' },
  { value: MINI_ROLES.STATION, label: '直营水站' }
];
const ROLE_LABEL = { [MINI_ROLES.SALESMAN]: '业务员', [MINI_ROLES.STATION]: '直营水站', [MINI_ROLES.ADMIN]: '管理员' };

/** 逐字段映射（**不含 openid**：openid 属个人信息，§54 只存服务端、不回传前端） */
function toRow(a, subject) {
  return {
    accountId: a.id,
    role: a.role,
    roleLabel: ROLE_LABEL[a.role] || a.role,
    targetId: a.target_id,
    subjectName: subject ? subject.name : null,
    subjectStatus: subject ? Number(subject.status) : null,
    nickname: a.nickname || '',
    phoneTail: a.phone ? String(a.phone).slice(-4) : '',
    phoneMasked: maskPhone(a.phone),
    status: Number(a.status),
    // 管理员账号在小程序端**只读展示**（前端据此隐藏操作按钮；服务端同样会拒）
    operable: a.role !== MINI_ROLES.ADMIN,
    lastLoginAt: a.last_login_at,
    createdAt: a.created_at
  };
}

/** 批量取主体名与状态（逐表查，避免跨表 JOIN 的 collation 陷阱） */
async function loadSubjects(conn, accounts) {
  const byWorker = accounts.filter(a => a.role === MINI_ROLES.SALESMAN).map(a => a.target_id);
  const byStation = accounts.filter(a => a.role === MINI_ROLES.STATION).map(a => a.target_id);
  const byUser = accounts.filter(a => a.role === MINI_ROLES.ADMIN).map(a => a.target_id);
  const map = new Map();
  if (byWorker.length) {
    const [rows] = await conn.query('SELECT worker_id, worker_name, status FROM workers WHERE worker_id IN (?)', [
      byWorker
    ]);
    rows.forEach(r => map.set('salesman:' + r.worker_id, { name: r.worker_name, status: r.status }));
  }
  if (byStation.length) {
    const [rows] = await conn.query(
      'SELECT station_id, station_name, status FROM sub_stations WHERE station_id IN (?)',
      [byStation]
    );
    rows.forEach(r => map.set('station:' + r.station_id, { name: r.station_name, status: r.status }));
  }
  if (byUser.length) {
    const [rows] = await conn.query('SELECT id, display_name FROM users WHERE id IN (?)', [byUser]);
    // users 表无 status 列：管理员视为恒启用（启用与否由 mini_accounts.status 控制）
    rows.forEach(r => map.set('admin:' + r.id, { name: r.display_name, status: 1 }));
  }
  return map;
}

/** 取账号（可加锁）；不存在抛 404 业务错误 */
async function loadAccount(conn, id, forUpdate = false) {
  const [rows] = await conn.query(
    `SELECT id, openid, phone, role, target_id, nickname, status, last_login_at, created_at
       FROM mini_accounts WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [id]
  );
  if (!rows.length) throw bizFail('账号不存在', 404);
  return rows[0];
}

/** 三条硬边界（见文件头）：管理员账号不可操作 + 不能操作自己 */
function assertOperable(account, req) {
  if (account.role === MINI_ROLES.ADMIN) {
    throw bizFail('管理员账号不在此处管理，请到 Web 后台操作', 403);
  }
  if (Number(account.id) === Number(req.mini.accountId)) {
    throw bizFail('不能操作自己的账号（会当场失去管理权限）', 400);
  }
}

/** 目标主体：存在 + 启用（否则绑定过去立刻就是「主体已停用」的死号） */
async function resolveSubject(conn, role, targetId, forUpdate = false) {
  if (!BINDABLE_ROLES.some(r => r.value === role)) throw bizFail('只能绑定「业务员」或「直营水站」');
  if (!targetId) throw bizFail('请选择要绑定的主体');
  const sql =
    role === MINI_ROLES.SALESMAN
      ? `SELECT worker_id AS id, worker_name AS name, status FROM workers WHERE worker_id = ?${forUpdate ? ' FOR UPDATE' : ''}`
      : `SELECT station_id AS id, station_name AS name, status FROM sub_stations WHERE station_id = ?${forUpdate ? ' FOR UPDATE' : ''}`;
  const [rows] = await conn.query(sql, [targetId]);
  if (!rows.length) throw bizFail('绑定的主体不存在', 404);
  if (Number(rows[0].status) !== 1) throw bizFail('绑定的主体已停用，无法绑定');
  return rows[0];
}

/** 该主体是否已被**别的启用中账号**占用（唯一键 uk_role_active 的占位语义） */
async function assertNotOccupied(conn, role, targetId, exceptAccountId = null) {
  const [rows] = await conn.query(
    'SELECT id FROM mini_accounts WHERE role = ? AND target_id = ? AND status = 1 AND id <> ?',
    [role, targetId, exceptAccountId || 0]
  );
  if (rows.length) throw bizFail('该主体已绑定其他微信账号，请先禁用或解绑原账号');
}

// ── GET /mini/admin/mini-accounts/options ───────────────────────────────────
async function getFormOptions(req, res) {
  const conn = await pool.getConnection();
  try {
    const [workers] = await conn.query(
      `SELECT worker_id, worker_name FROM workers WHERE status = 1 AND employee_type = 3 ORDER BY worker_name`
    );
    const [stations] = await conn.query(
      'SELECT station_id, station_name FROM sub_stations WHERE status = 1 ORDER BY station_name'
    );
    return success(res, {
      roles: BINDABLE_ROLES,
      statusOptions: [
        { value: 1, label: '启用' },
        { value: 0, label: '禁用' }
      ],
      // 可绑定主体候选（按角色分组，页面据所选角色取其中一组）
      salesmanTargets: workers.map(w => ({ targetId: w.worker_id, targetName: w.worker_name })),
      stationTargets: stations.map(s => ({ targetId: s.station_id, targetName: s.station_name })),
      // 说明性文案：把「禁用 ≠ 解绑」讲清楚（这是本域最容易误操作的地方）
      notice: '禁用：保留该微信的绑定，此人登不进也改不了数据；解绑：解除绑定，换一个微信可重新绑定。'
    });
  } catch (e) {
    console.error('[mini/admin] 账号选项失败:', e);
    return error(res, '表单选项查询失败');
  } finally {
    conn.release();
  }
}

// ── GET /mini/admin/mini-accounts —— 账号列表（分页 + 角色/状态/关键词）──────
async function listAccounts(req, res) {
  const conn = await pool.getConnection();
  try {
    const { page, pageSize, offset } = parseMiniPage(req.query);
    const where = [];
    const params = [];
    if (req.query.role) {
      if (![MINI_ROLES.SALESMAN, MINI_ROLES.STATION, MINI_ROLES.ADMIN].includes(req.query.role)) {
        return error(res, '角色筛选值不正确', 400);
      }
      where.push('role = ?');
      params.push(req.query.role);
    }
    if (req.query.status !== undefined && req.query.status !== '') {
      if (!['0', '1'].includes(String(req.query.status))) return error(res, '状态筛选值不正确', 400);
      where.push('status = ?');
      params.push(Number(req.query.status));
    }
    const kw = String(req.query.keyword || '').trim();
    if (kw) {
      where.push('(phone LIKE ? OR nickname LIKE ?)');
      params.push('%' + kw + '%', '%' + kw + '%');
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [cnt] = await conn.query(`SELECT COUNT(*) AS total FROM mini_accounts ${whereSql}`, params);
    const [rows] = await conn.query(
      `SELECT id, phone, role, target_id, nickname, status, last_login_at, created_at
         FROM mini_accounts ${whereSql}
        ORDER BY status DESC, id DESC
        LIMIT ${parseInt(pageSize, 10)} OFFSET ${parseInt(offset, 10)}`,
      params
    );
    const subjects = await loadSubjects(conn, rows);
    return success(res, {
      list: rows.map(a => toRow(a, subjects.get(a.role + ':' + a.target_id))),
      total: Number(cnt[0].total) || 0,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[mini/admin] 账号列表失败:', e);
    return error(res, '账号列表查询失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/mini-accounts/:id/status —— 禁用 / 启用（幂等 + 审计）────
async function updateStatus(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const status = Number(body.status);
  if (![0, 1].includes(status)) return error(res, '状态只能是 0（禁用）或 1（启用）', 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_MINI_ACCOUNT_STATUS,
      key: String(clientRequestId),
      requestHash: hashRequest({ id: req.params.id, status }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: Number(req.params.id), replayed: true }, '该操作已提交（重复请求已合并）');
    }

    let before;
    try {
      const account = await loadAccount(conn, req.params.id, true);
      assertOperable(account, req);
      before = account;
      if (status === 1) {
        // 启用前必须确认该主体的占位没被别的账号占走 —— 否则唯一键会抛 500，
        // 用户只会看到「服务器错误」，而这其实是一条明确的业务冲突。
        await assertNotOccupied(conn, account.role, account.target_id, account.id);
      }
      await conn.query('UPDATE mini_accounts SET status = ?, updated_at = NOW() WHERE id = ?', [status, account.id]);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '状态修改失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_MINI_ACCOUNT_STATUS,
      key: String(clientRequestId),
      resultRef: String(before.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_MINI_ACCOUNT_STATUS,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'MINI_ACCOUNT',
      targetId: String(before.id),
      detail: {
        statusBefore: Number(before.status),
        statusAfter: status,
        role: before.role,
        targetId: before.target_id,
        phoneTail: before.phone ? String(before.phone).slice(-4) : null
      }
    });

    await conn.commit();
    return success(
      res,
      { accountId: before.id, status },
      status === 0 ? '已禁用（该微信写操作立即被拒）' : '已启用（该微信可重新登录）'
    );
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 账号状态修改失败:', e);
    return error(res, '状态修改失败');
  } finally {
    conn.release();
  }
}

// ── PUT /mini/admin/mini-accounts/:id/binding —— 改绑定主体（幂等 + 审计）───
// ⚠️ 改完后该账号的**旧令牌立即失效**（miniAuth 比对 role/target_id）→ 页面提示「需重新登录」。
async function updateBinding(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const role = String(body.role || '');
  const targetId = body.targetId ? String(body.targetId) : '';
  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_MINI_ACCOUNT_BINDING,
      key: String(clientRequestId),
      requestHash: hashRequest({ id: req.params.id, role, targetId }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: Number(req.params.id), replayed: true }, '该操作已提交（重复请求已合并）');
    }

    let before;
    let subject;
    let replayedWallet = null;
    try {
      const account = await loadAccount(conn, req.params.id, true);
      assertOperable(account, req);
      before = account;
      subject = await resolveSubject(conn, role, targetId);
      await assertNotOccupied(conn, role, targetId, account.id);
      if (account.role === role && account.target_id === targetId) {
        throw bizFail('绑定关系未变化');
      }
      await conn.query('UPDATE mini_accounts SET role = ?, target_id = ?, updated_at = NOW() WHERE id = ?', [
        role,
        targetId,
        account.id
      ]);
      // 钱包跟随主体：目标主体若已有钱包则复用（余额随主体连续，不随微信走）
      const ownerType = role === MINI_ROLES.SALESMAN ? 'SALESMAN' : 'STATION';
      replayedWallet = await walletService.ensureWallet(conn, {
        ownerType,
        ownerId: targetId,
        ownerName: subject.name
      });
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '修改绑定失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UPDATE_MINI_ACCOUNT_BINDING,
      key: String(clientRequestId),
      resultRef: String(before.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UPDATE_MINI_ACCOUNT_BINDING,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'MINI_ACCOUNT',
      targetId: String(before.id),
      detail: {
        roleBefore: before.role,
        targetBefore: before.target_id,
        roleAfter: role,
        targetAfter: targetId,
        subjectName: subject.name
      }
    });

    await conn.commit();
    return success(
      res,
      { accountId: before.id, role, targetId, walletId: replayedWallet ? replayedWallet.wallet_id : null },
      '已改绑，对方需重新登录'
    );
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 改绑定失败:', e);
    return error(res, '修改绑定失败');
  } finally {
    conn.release();
  }
}

// ── DELETE /mini/admin/mini-accounts/:id —— 解绑（删行 + 审计；幂等）─────────
// ⚠️ 解绑是**删除绑定关系**（不是 status=0）：只有删掉这一行，同一个微信才能重新登录并重绑。
//    ⚠️ 审计必须**在删除前**写：删完就没有 target 了（审计里的 detail 取自这一行）。
async function unbindAccount(req, res) {
  const body = req.body || {};
  const clientRequestId = body.clientRequestId || req.query.clientRequestId;
  const idemErr = requireIdemKey(clientRequestId);
  if (idemErr) return error(res, idemErr, 400);

  const operator = `mini:${req.mini.accountId}`;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const claim = await walletService.claimIdempotency(conn, {
      scope: IDEM_SCOPE.UNBIND_MINI_ACCOUNT,
      key: String(clientRequestId),
      requestHash: hashRequest({ id: req.params.id }),
      miniAccountId: req.mini.accountId
    });
    if (claim.conflict) {
      await conn.rollback();
      return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
    }
    if (claim.replayed) {
      await conn.rollback();
      return success(res, { accountId: Number(req.params.id), replayed: true }, '该操作已提交（重复请求已合并）');
    }

    let before;
    try {
      const account = await loadAccount(conn, req.params.id, true);
      assertOperable(account, req);
      before = account;
      await conn.query('DELETE FROM mini_accounts WHERE id = ?', [account.id]);
    } catch (e) {
      await conn.rollback();
      return respondBusinessError(res, e, '解绑失败');
    }

    await walletService.completeIdempotency(conn, {
      scope: IDEM_SCOPE.UNBIND_MINI_ACCOUNT,
      key: String(clientRequestId),
      resultRef: String(before.id)
    });
    await walletService.writeAuditLog(conn, {
      action: AUDIT_ACTION.UNBIND_MINI_ACCOUNT,
      actorType: 'MINI',
      actorId: operator,
      targetType: 'MINI_ACCOUNT',
      targetId: String(before.id),
      detail: {
        role: before.role,
        targetId: before.target_id,
        phoneTail: before.phone ? String(before.phone).slice(-4) : null,
        statusBefore: Number(before.status),
        note: '解绑=删除绑定关系；该微信可重新登录并重绑，主体钱包余额不受影响'
      }
    });

    await conn.commit();
    return success(res, { accountId: before.id }, '已解绑（该微信可重新登录并绑定）');
  } catch (e) {
    await conn.rollback();
    console.error('[mini/admin] 解绑失败:', e);
    return error(res, '解绑失败');
  } finally {
    conn.release();
  }
}

module.exports = { getFormOptions, listAccounts, updateStatus, updateBinding, unbindAccount };

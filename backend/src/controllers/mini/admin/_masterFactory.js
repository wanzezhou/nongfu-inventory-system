// 小程序管理端 · 主数据域工厂（Phase 8b）
// ===========================================================================
// 适用对象：结构同构的「表 + 名称字段 + status + 部分更新 + 引用式删除」业务域。
// 本项目里有四个：供应商 / 员工 / 水站 / 机台。
//
// 为什么抽工厂（而不是写四份控制器）：
//   这四个域的**业务规则完全一致**，差异只在「表名、字段清单、引用检查范围」三处。
//   写四份 400 行控制器，等于把同一条规则复制四遍 —— 而这类复制最危险的地方不是啰嗦，
//   而是**四处独立演化**：某天有人给"删除"补了一个边界（比如把事务范围改对），
//   只改了三个域，剩下那个就成为长期潜伏的例外。工厂让"四份实现"在物理上不可能分叉。
//
//   ⚠️ 这是本批次第 4 次做同类抽象（第 2 个域抽 `_shared.js`、第 3 个域改 _shared、现在抽工厂），
//      判断依据始终是同一条：**同一段逻辑出现第 2 次是抽取的最佳时机**；
//      出现第 4 次不抽，代价就不再是"多写几遍"，而是"改一处要记得改四处"。
//
// ⚠️ 与 `_shared.js` 的分工：_shared 放**与域无关**的积木（分页/幂等键/错误文案），
//    本文件放**同构域共享的编排**（CRUD + 删除语义 + 审计）。
//
// ⚠️ 安全前提：本文件所有 SQL 的表名/列名都来自 spec 里的**内部常量**（不是任何入参），
//    因此采用模板插值；每处插值均带 `hazard-allow` 说明。**spec 绝不可来自运行时输入**。
// ===========================================================================
const { pool } = require('../../../config/db');
const { success, error } = require('../../../utils/response');
// ⚠️ 这里**不** import AUDIT_ACTION / IDEM_SCOPE：动作名与幂等作用域由各域的 spec
//    显式传入（`masterDomains.js` 里解析后的值）。工厂不去"猜"某个域该用哪个常量 ——
//    否则新增域时会出现「工厂里少一个判断分支，于是所有域都写同一个动作名」这类静默错误。
const walletService = require('../../../services/walletService');
const { hashRequest } = require('../../../utils/requestHash');
const { generateId } = require('../../../utils/idGen');
const { parseMiniPage, requireIdemKey } = require('./_shared');

/** 按 spec 的 type 转换入参 */
function convert(kind, raw) {
  switch (kind) {
    case 'string':
      return raw === undefined || raw === null ? '' : String(raw).trim();
    case 'nullableString':
      return raw === undefined || raw === null || raw === '' ? null : String(raw).trim();
    case 'money': {
      if (raw === undefined || raw === null || raw === '') return 0;
      const n = Number(raw);
      return isNaN(n) ? NaN : n;
    }
    case 'int': {
      // ⚠️ 未提供时给 **0** 而不是 null：主数据表里这些列基本都是 NOT NULL
      //    （实测 `sub_stations.payment_type` NOT NULL，给 null 直接
      //    `ER_BAD_NULL_ERROR` → 500，而那句「Column 'x' cannot be null」对使用者毫无意义）。
      //    0 在业务上就是「未设置」的既有取值（库里 6 条水站全是 0）。
      //    必填的 int 字段（如 employeeType）会在 validate 阶段先被拦下，不受这里影响。
      if (raw === undefined || raw === null || raw === '') return 0;
      const n = Number(raw);
      return isNaN(n) ? NaN : n;
    }
    default:
      return raw;
  }
}

/** 校验：必填 + 非负金额/整数（与 Web 端同口径，文案用 spec 的 label） */
function validate(spec, body) {
  for (const f of spec.fields) {
    if (f.virtual) continue;
    if (!Object.prototype.hasOwnProperty.call(body, f.key)) {
      if (f.required && spec.isCreate) return `${f.label}不能为空`;
      continue;
    }
    const v = convert(f.type, body[f.key]);
    if (f.required && (v === '' || v === null)) return `${f.label}不能为空`;
    if (f.type === 'money' && (isNaN(v) || v < 0)) return `${f.label}必须为不小于 0 的数字`;
    if (f.type === 'int' && v !== null && isNaN(v)) return `${f.label}必须是数字`;
    // 枚举列（如员工类型 1店长/2配送/3业务员/4管理员）：不校验会让脏值落库，
    // 而脏值的表现是「列表里出现一个不认识的类型」—— 排查时还得回去翻代码
    if (f.enum && v !== null && v !== '' && !f.enum.includes(Number(v))) {
      return `${f.label}取值不合法（可选：${f.enum.join(' / ')}）`;
    }
  }
  return null;
}

/**
 * 构造一个主数据域控制器
 * @param {object} spec
 *   - table / idColumn / nameColumn        表与列（内部常量）
 *   - idPrefix                             generateId 的前缀（沿用 Web 端既有前缀）
 *   - searchColumns[]                      关键词搜索覆盖的列
 *   - fields[]                             { col, key, type, label, required? }
 *   - findReferences(conn, id) → []        引用检查（**从 Web 控制器导入同一个函数**）
 *   - audit / idem / targetType            审计动作、幂等作用域、审计 target 类型
 *   - idLabel / nameLabel                  文案用的字段名（如「供应商名称」）
 */
function buildMasterDomain(spec) {
  const { table, idColumn, nameColumn, idPrefix, searchColumns, fields, findReferences } = spec;
  const writable = fields.filter(f => !f.virtual);
  const targetType = spec.targetType;

  /** 行 → 视图对象（camelCase；字段名即 spec 的 key） */
  function shape(row) {
    const out = { id: row[idColumn], status: Number(row.status) };
    for (const f of writable) {
      const v = row[f.col];
      out[f.key] = f.type === 'money' || f.type === 'int' ? (v === null ? null : Number(v)) : v;
    }
    return out;
  }

  // ── 列表（关键词 / 状态 / 分页）─────────────────────────────────────────────
  async function list(req, res) {
    try {
      const { page, pageSize, offset } = parseMiniPage(req.query);
      const parts = [];
      const params = [];
      const kw = String(req.query.keyword || '').trim();
      if (kw && searchColumns.length) {
        parts.push('(' + searchColumns.map(c => `${c} LIKE ?`).join(' OR ') + ')');
        searchColumns.forEach(() => params.push(`%${kw}%`));
      }
      if (req.query.status !== undefined && req.query.status !== '') {
        parts.push('status = ?');
        params.push(Number(req.query.status));
      }
      const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
      const cols = [idColumn, nameColumn, 'status', ...writable.map(f => f.col)].join(', ');
      const [rows] = await pool.execute(
        // hazard-allow: cols/table 来自 spec 内部常量（非入参），spec 是模块内静态声明
        `SELECT ${cols} FROM ${table} ${where} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
        params
      );
      // hazard-allow: 同上（表名来自 spec 常量）
      const [cnt] = await pool.execute(`SELECT COUNT(*) AS n FROM ${table} ${where}`, params);
      return success(res, { list: rows.map(shape), total: Number(cnt[0].n) || 0, page, pageSize });
    } catch (e) {
      console.error(`[mini/admin] ${spec.nameLabel}列表查询失败:`, e);
      return error(res, `${spec.nameLabel}列表查询失败`);
    }
  }

  // ── 详情 ────────────────────────────────────────────────────────────────────
  async function getById(req, res) {
    try {
      const cols = [idColumn, nameColumn, 'status', ...writable.map(f => f.col)].join(', ');
      // hazard-allow: 表名/列名来自 spec 内部常量
      const [rows] = await pool.execute(`SELECT ${cols} FROM ${table} WHERE ${idColumn} = ?`, [req.params.id]);
      if (!rows.length) return error(res, `${spec.nameLabel}不存在`, 404);
      return success(res, shape(rows[0]));
    } catch (e) {
      console.error(`[mini/admin] ${spec.nameLabel}详情查询失败:`, e);
      return error(res, `${spec.nameLabel}详情查询失败`);
    }
  }

  // ── 新增（幂等 + 审计）──────────────────────────────────────────────────────
  async function create(req, res) {
    const body = req.body || {};
    const errMsg = validate(Object.assign({}, spec, { isCreate: true }), body);
    if (errMsg) return error(res, errMsg, 400);
    const idemErr = requireIdemKey(body.clientRequestId);
    if (idemErr) return error(res, idemErr, 400);

    const operator = `mini:${req.mini.accountId}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const scope = spec.idem.create;
      const claim = await walletService.claimIdempotency(conn, {
        scope,
        key: String(body.clientRequestId),
        requestHash: hashRequest(Object.assign({ _domain: spec.idem.create }, pick(body))),
        miniAccountId: req.mini.accountId
      });
      if (claim.conflict) {
        await conn.rollback();
        return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
      }
      if (claim.replayed) {
        await conn.rollback();
        return success(res, { id: claim.resultRef, replayed: true }, `该${spec.nameLabel}已创建（重复请求已合并）`);
      }

      const newId = generateId(idPrefix);
      const cols = writable.map(f => f.col);
      const vals = writable.map(f => {
        if (f.key === 'status' && !Object.prototype.hasOwnProperty.call(body, 'status')) return 1;
        return convert(f.type, body[f.key]);
      });
      // hazard-allow: 表名/列名来自 spec 内部常量
      await conn.query(
        `INSERT INTO ${table} (${idColumn}, ${cols.join(', ')}, created_at, updated_at)
         VALUES (?, ${cols.map(() => '?').join(', ')}, NOW(), NOW())`,
        [newId, ...vals]
      );

      await walletService.completeIdempotency(conn, {
        scope,
        key: String(body.clientRequestId),
        resultRef: newId
      });
      await walletService.writeAuditLog(conn, {
        action: spec.audit.create,
        actorType: 'MINI',
        actorId: operator,
        targetType,
        targetId: newId,
        detail: pick(body)
      });

      await conn.commit();
      return success(res, { id: newId }, `${spec.nameLabel}创建成功`);
    } catch (e) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('[mini/admin] 回滚失败:', rollbackErr);
      }
      console.error(`[mini/admin] 新增${spec.nameLabel}失败:`, e);
      return error(res, `创建${spec.nameLabel}失败`);
    } finally {
      conn.release();
    }
  }

  // ── 编辑（部分更新：不传的字段保持原值）────────────────────────────────────
  async function update(req, res) {
    const { id } = req.params;
    const body = req.body || {};
    const errMsg = validate(spec, body);
    if (errMsg) return error(res, errMsg, 400);
    const idemErr = requireIdemKey(body.clientRequestId);
    if (idemErr) return error(res, idemErr, 400);

    const operator = `mini:${req.mini.accountId}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // hazard-allow: 表名/列名来自 spec 内部常量
      const [exist] = await conn.query(`SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = ?`, [id]);
      if (!exist.length) {
        await conn.rollback();
        return error(res, `${spec.nameLabel}不存在`, 404);
      }

      const scope = spec.idem.update;
      const claim = await walletService.claimIdempotency(conn, {
        scope,
        key: String(body.clientRequestId),
        requestHash: hashRequest(Object.assign({ id, _domain: spec.idem.update }, pick(body))),
        miniAccountId: req.mini.accountId
      });
      if (claim.conflict) {
        await conn.rollback();
        return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
      }
      if (claim.replayed) {
        await conn.rollback();
        return success(res, { id: claim.resultRef, replayed: true }, '该修改已生效（重复请求已合并）');
      }

      const sets = [];
      const vals = [];
      for (const f of writable) {
        if (!Object.prototype.hasOwnProperty.call(body, f.key)) continue;
        sets.push(`${f.col} = ?`);
        vals.push(convert(f.type, body[f.key]));
      }
      if (!sets.length) {
        await conn.rollback();
        return error(res, '没有需要更新的字段', 400);
      }
      // hazard-allow: 表名/列名来自 spec 内部常量
      await conn.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE ${idColumn} = ?`, [
        ...vals,
        id
      ]);

      await walletService.completeIdempotency(conn, { scope, key: String(body.clientRequestId), resultRef: id });
      await walletService.writeAuditLog(conn, {
        action: spec.audit.update,
        actorType: 'MINI',
        actorId: operator,
        targetType,
        targetId: id,
        detail: { changed: sets.length, fields: pick(body) }
      });

      await conn.commit();
      return success(res, { id }, '修改成功');
    } catch (e) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('[mini/admin] 回滚失败:', rollbackErr);
      }
      console.error(`[mini/admin] 修改${spec.nameLabel}失败:`, e);
      return error(res, `修改${spec.nameLabel}失败`);
    } finally {
      conn.release();
    }
  }

  // ── 删除：**无引用 → 物理删除；有引用 → 转停用**（与 Web 端同一判据）────────
  async function remove(req, res) {
    const { id } = req.params;
    const body = req.body || {};
    // DELETE 的请求体并非所有客户端都会保留 → 幂等键同时接受查询参数
    const clientRequestId = body.clientRequestId || req.query.clientRequestId;
    const idemErr = requireIdemKey(clientRequestId);
    if (idemErr) return error(res, idemErr, 400);

    const operator = `mini:${req.mini.accountId}`;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const scope = spec.idem.disable;
      const claim = await walletService.claimIdempotency(conn, {
        scope,
        key: String(clientRequestId),
        requestHash: hashRequest({ id, _domain: spec.idem.disable }),
        miniAccountId: req.mini.accountId
      });
      if (claim.conflict) {
        await conn.rollback();
        return error(res, '重复提交的请求内容不一致，请刷新后重试', 400);
      }
      if (claim.replayed) {
        await conn.rollback();
        return success(res, { id: claim.resultRef, replayed: true }, `该${spec.nameLabel}已处理（重复请求已合并）`);
      }

      const [exist] = await conn.query(
        // hazard-allow: 同上 —— 表名/列名来自 spec 内部常量（非入参）
        `SELECT ${idColumn}, ${nameColumn}, status FROM ${table} WHERE ${idColumn} = ? FOR UPDATE`,
        [id]
      );
      if (!exist.length) {
        await conn.rollback();
        return error(res, `${spec.nameLabel}不存在`, 404);
      }
      const name = exist[0][nameColumn];

      // ⚠️ 引用检查**必须复用 Web 端同一个函数**（各域查哪几张表是实现细节，
      //    两处各写一份会让「有引用」的判据悄悄分叉）
      const references = await findReferences(conn, id);

      let mode;
      if (references.length === 0) {
        // hazard-allow: 表名/列名来自 spec 内部常量
        const [r] = await conn.query(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [id]);
        if (!r.affectedRows) {
          await conn.rollback();
          return error(res, `${spec.nameLabel}不存在`, 404);
        }
        mode = 'hard';
      } else {
        // hazard-allow: 表名/列名来自 spec 内部常量
        await conn.query(`UPDATE ${table} SET status = 0, updated_at = NOW() WHERE ${idColumn} = ?`, [id]);
        mode = 'soft';
      }

      await walletService.completeIdempotency(conn, {
        scope,
        key: String(clientRequestId),
        resultRef: id
      });
      await walletService.writeAuditLog(conn, {
        action: spec.audit.disable,
        actorType: 'MINI',
        actorId: operator,
        targetType,
        targetId: id,
        detail: { mode, name, references }
      });

      await conn.commit();
      return success(
        res,
        { id, name, mode, references },
        mode === 'hard'
          ? `${spec.nameLabel}「${name}」已删除`
          : `${spec.nameLabel}「${name}」存在关联数据，已转为「停用」保留`
      );
    } catch (e) {
      try {
        await conn.rollback();
      } catch (rollbackErr) {
        console.error('[mini/admin] 回滚失败:', rollbackErr);
      }
      console.error(`[mini/admin] 删除${spec.nameLabel}失败:`, e);
      return error(res, `删除${spec.nameLabel}失败`);
    } finally {
      conn.release();
    }
  }

  return { list, getById, create, update, remove };
}

/** 取 body 里属于本域的字段（用于审计与幂等指纹，避免把无关键塞进去） */
function pick(body) {
  const out = {};
  for (const k of Object.keys(body)) {
    if (k === 'clientRequestId') continue;
    out[k] = body[k];
  }
  return out;
}

module.exports = { buildMasterDomain, convert };

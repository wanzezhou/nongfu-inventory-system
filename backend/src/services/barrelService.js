/**
 * 回桶管理业务服务（三联事务：账户余额变动 + 资金流水 + 押金流水）
 * 规则：
 *  - 收取押金(collect)：押金入指定账户（余额+，收入流水）
 *  - 退回押金(return)：从指定账户支出（余额-，支出流水），且数量不得超过该对象该桶型在押桶数
 *  - 已入账/已退款记录不允许撤销（资金历史不可篡改），误操作用反向单冲销
 */
const { pool } = require('../config/db');
const { DEPOSIT_TYPES } = require('../constants/barrel');

const round2 = n => Math.round(Number(n || 0) * 100) / 100;

// 单号：YJ + YYYYMMDD + 3位序号
function genDepositNo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const dateStr = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return 'YJ' + dateStr + seq;
}

function genTxId() {
  return (
    'TX' +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 10000)
      .toString(36)
      .toUpperCase()
  );
}

function genTxNo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return (
    'TX' +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    String(Math.floor(Math.random() * 100000)).padStart(5, '0')
  );
}

// 对象条件：水站按 station_id，零售按 姓名+电话（无电话时用 IS NULL，避免 NULL 恒不匹配）
function partyCond(partyType, stationId, customerName, customerPhone) {
  if (partyType === 'customer') {
    const phone = customerPhone || null;
    if (phone) return { sql: 'customer_name = ? AND customer_phone = ?', params: [customerName, phone] };
    return { sql: 'customer_name = ? AND customer_phone IS NULL', params: [customerName] };
  }
  return { sql: 'station_id = ?', params: [stationId] };
}

// 某对象某桶型在押桶数（collect - return）
async function pendingQty(conn, cond) {
  const [rows] = await conn.query(
    `SELECT SUM(CASE WHEN deposit_type = 'collect' THEN quantity ELSE -quantity END) AS qty
     FROM barrel_deposits WHERE ${cond.sql}`,
    cond.params
  );
  return Number(rows[0].qty) || 0;
}

/**
 * 业务校验失败（`e.business = true`）—— 项目既有约定（同 salaryLedger.bizFail）
 * 由调用方统一 rollback 并按 e.status 转响应；**不再返回 {code,message} 对象**：
 * 那种约定下「校验失败」与「成功」走同一条返回路径，调用方漏判 code 就会
 * 把失败当成功（且事务边界散落在服务层，调用方无法把幂等/审计并进同一事务）。
 */
function bizFail(message, status = 400) {
  const e = new Error(message);
  e.business = true;
  e.status = status;
  return e;
}

// 登记押金（collect 入账 / return 支出）—— **须在调用方的事务内执行**（自身不开事务）
async function createDeposit(
  conn,
  {
    depositType,
    partyType,
    stationId,
    customerName,
    customerPhone,
    barrelType,
    quantity,
    unitPrice,
    accountId,
    remark,
    operator
  }
) {
  {
    const type = depositType === DEPOSIT_TYPES.RETURN ? DEPOSIT_TYPES.RETURN : DEPOSIT_TYPES.COLLECT;
    const qty = parseInt(quantity, 10);
    const price = round2(Number(unitPrice));
    if (!qty || qty <= 0) throw bizFail('数量必须大于 0');
    if (price <= 0) throw bizFail('押金单价必须大于 0');

    // 对象校验：水站必须存在；零售必须有姓名
    if (partyType === 'customer') {
      if (!customerName || !String(customerName).trim()) throw bizFail('零售客户姓名不能为空');
      customerName = String(customerName).trim();
    } else {
      const [st] = await conn.query('SELECT station_id FROM sub_stations WHERE station_id = ?', [stationId]);
      if (!st.length) throw bizFail('水站不存在');
    }

    // 桶型配置校验
    const [cfg] = await conn.query(
      'SELECT barrel_type, deposit_price FROM barrel_config WHERE barrel_type = ? AND status = 1',
      [barrelType]
    );
    if (!cfg.length) throw bizFail('桶型不存在或已停用');

    // 退回押金：数量不得超过该对象该桶型在押桶数
    const cond = partyCond(partyType, stationId, customerName, customerPhone);
    const pending = await pendingQty(conn, cond);
    if (type === DEPOSIT_TYPES.RETURN && qty > pending) {
      throw bizFail(`退回数量超过在押桶数（当前在押 ${pending} 桶）`);
    }

    // 财务账户（FOR UPDATE 锁定，避免并发扣款）
    const [acc] = await conn.query(
      'SELECT account_id, account_name, current_balance, status FROM finance_accounts WHERE account_id = ? FOR UPDATE',
      [accountId]
    );
    if (!acc.length || Number(acc[0].status) !== 1) throw bizFail('财务账户不存在或已停用');
    const balance = Number(acc[0].current_balance);
    const amount = round2(price * qty);

    const depositNo = genDepositNo();
    const accountName = acc[0].account_name;
    // 对方名称：水站显示站名，零售显示客户姓名
    let counterpartyName = customerName || null;
    if (partyType !== 'customer') {
      const [st2] = await conn.query('SELECT station_name FROM sub_stations WHERE station_id = ?', [stationId]);
      counterpartyName = st2.length ? st2[0].station_name : stationId;
    }

    if (type === DEPOSIT_TYPES.COLLECT) {
      // 收取：余额增加 + 收入流水
      await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
        round2(balance + amount),
        accountId
      ]);
      await conn.query(
        `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
        [
          genTxId(),
          genTxNo(),
          accountId,
          accountName,
          1,
          '押金收取',
          amount,
          balance,
          round2(balance + amount),
          'barrel_deposit',
          depositNo,
          operator || null,
          counterpartyName,
          remark || null
        ]
      );
    } else {
      // 退回：余额充足校验 + 支出流水
      if (balance < amount) throw bizFail('财务账户可用余额不足');
      await conn.query('UPDATE finance_accounts SET current_balance = ?, updated_at = NOW() WHERE account_id = ?', [
        round2(balance - amount),
        accountId
      ]);
      await conn.query(
        `INSERT INTO finance_transactions
           (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after,
            related_module, related_id, tx_date, handler, counterparty, remark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())`,
        [
          genTxId(),
          genTxNo(),
          accountId,
          accountName,
          2,
          '押金退回',
          amount,
          balance,
          round2(balance - amount),
          'barrel_deposit',
          depositNo,
          operator || null,
          counterpartyName,
          remark || null
        ]
      );
    }

    // 押金流水
    await conn.query(
      `INSERT INTO barrel_deposits
         (deposit_no, station_id, party_type, customer_name, customer_phone, barrel_type, quantity, unit_price,
          account_id, account_name, deposit_type, handler_id, remark, refunded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        depositNo,
        partyType === 'customer' ? null : stationId,
        partyType,
        partyType === 'customer' ? customerName : null,
        partyType === 'customer' ? customerPhone || null : null,
        barrelType,
        qty,
        price,
        accountId,
        accountName,
        type,
        operator || null,
        remark || null,
        type === DEPOSIT_TYPES.RETURN ? new Date() : null
      ]
    );

    return {
      depositNo,
      depositType: type,
      amount,
      accountId,
      accountName,
      // 文案由服务层给（两端复用同一句，避免「Web 说收取成功、小程序说已入账」这类漂移）
      message: type === DEPOSIT_TYPES.COLLECT ? '押金收取成功' : '押金退回成功'
    };
  }
}

// 押金流水列表（分页 + 筛选）
async function getDepositList({
  page = 1,
  pageSize = 10,
  partyType,
  stationId,
  customerName,
  barrelType,
  startDate,
  endDate
}) {
  const where = [];
  const params = [];
  if (partyType) {
    where.push('d.party_type = ?');
    params.push(partyType);
  }
  if (stationId) {
    where.push('d.station_id = ?');
    params.push(stationId);
  }
  if (customerName) {
    where.push('d.customer_name LIKE ?');
    params.push('%' + customerName + '%');
  }
  if (barrelType) {
    where.push('d.barrel_type = ?');
    params.push(barrelType);
  }
  if (startDate) {
    where.push('DATE(d.created_at) >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('DATE(d.created_at) <= ?');
    params.push(endDate);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM barrel_deposits d ${whereSql}`, params);
  const total = countRows[0].total;

  const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const offset = (currentPage - 1) * size;

  const [rows] = await pool.query(
    `SELECT d.id, d.deposit_no, d.party_type, d.station_id, s.station_name,
            d.customer_name, d.customer_phone, d.barrel_type, d.quantity, d.unit_price,
            d.account_id, d.account_name, d.deposit_type, d.handler_id, d.remark, d.refunded_at, d.created_at
     FROM barrel_deposits d
     LEFT JOIN sub_stations s ON d.station_id = s.station_id
     ${whereSql}
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT ${size} OFFSET ${offset}`,
    params
  );

  return {
    list: rows.map(r => ({
      id: r.id,
      depositNo: r.deposit_no,
      partyType: r.party_type,
      stationId: r.station_id,
      stationName: r.station_name,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      partyName:
        r.party_type === 'customer'
          ? (r.customer_name || '') + (r.customer_phone ? '（' + r.customer_phone + '）' : '')
          : r.station_name,
      barrelType: r.barrel_type,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      amount: round2(Number(r.quantity) * Number(r.unit_price)),
      accountId: r.account_id,
      accountName: r.account_name,
      depositType: r.deposit_type,
      handlerId: r.handler_id,
      remark: r.remark,
      refundedAt: r.refunded_at,
      createdAt: r.created_at
    })),
    total,
    page: currentPage,
    pageSize: size
  };
}

// 押金台账汇总：按 对象×桶型 聚合在押桶数与押金余额
async function getSummary({ partyType, stationId, customerName, barrelType }) {
  const where = [];
  const params = [];
  if (partyType) {
    where.push('d.party_type = ?');
    params.push(partyType);
  }
  if (stationId) {
    where.push('d.station_id = ?');
    params.push(stationId);
  }
  if (customerName) {
    where.push('d.customer_name LIKE ?');
    params.push('%' + customerName + '%');
  }
  if (barrelType) {
    where.push('d.barrel_type = ?');
    params.push(barrelType);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [rows] = await pool.query(
    `SELECT d.party_type, d.station_id, s.station_name, d.customer_name, d.customer_phone, d.barrel_type,
            SUM(CASE WHEN d.deposit_type = 'collect' THEN d.quantity ELSE -d.quantity END) AS pending_qty,
            SUM(CASE WHEN d.deposit_type = 'collect' THEN d.quantity * d.unit_price ELSE -d.quantity * d.unit_price END) AS pending_amount,
            MAX(d.unit_price) AS unit_price
     FROM barrel_deposits d
     LEFT JOIN sub_stations s ON d.station_id = s.station_id
     ${whereSql}
     GROUP BY d.party_type, d.station_id, s.station_name, d.customer_name, d.customer_phone, d.barrel_type
     HAVING pending_qty != 0
     ORDER BY d.party_type, d.station_id, d.barrel_type`,
    params
  );

  return rows.map(r => ({
    partyType: r.party_type,
    stationId: r.station_id,
    stationName: r.station_name,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    partyName:
      r.party_type === 'customer'
        ? (r.customer_name || '') + (r.customer_phone ? '（' + r.customer_phone + '）' : '')
        : r.station_name,
    barrelType: r.barrel_type,
    pendingQty: Number(r.pending_qty),
    pendingAmount: round2(Number(r.pending_amount)),
    unitPrice: r.unit_price
  }));
}

// 桶型配置列表（默认含停用，供管理）
async function listConfigs(conn = pool) {
  // 显式列（原为 SELECT *：列变更隐式耦合，且新增列会静默进入响应）
  const [rows] = await conn.query(
    'SELECT id, barrel_type, deposit_price, status, sort_order, created_at, updated_at FROM barrel_config ORDER BY sort_order, id'
  );
  return rows.map(r => ({
    id: r.id,
    barrelType: r.barrel_type,
    depositPrice: r.deposit_price,
    status: r.status,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

// 新增桶型配置
async function createConfig(conn, { barrelType, depositPrice, sortOrder }) {
  const type = barrelType && String(barrelType).trim();
  const price = round2(Number(depositPrice));
  if (!type) throw bizFail('桶型名称不能为空');
  if (price < 0) throw bizFail('押金单价不能为负');
  try {
    const [r] = await conn.query(
      `INSERT INTO barrel_config (barrel_type, deposit_price, status, sort_order, created_at, updated_at)
       VALUES (?, ?, 1, ?, NOW(), NOW())`,
      [type, price, parseInt(sortOrder, 10) || 0]
    );
    return { id: r.insertId, barrelType: type, depositPrice: price };
  } catch (e) {
    // 唯一键冲突是**业务可预期**的（桶型名重复），不能漏成 500
    if (/Duplicate|1062/i.test(e.message)) throw bizFail('桶型名称已存在');
    throw e;
  }
}

// 更新桶型配置
async function updateConfig(conn, id, { barrelType, depositPrice, status, sortOrder }) {
  try {
    const [exist] = await conn.query('SELECT id FROM barrel_config WHERE id = ? FOR UPDATE', [id]);
    if (!exist.length) throw bizFail('桶型配置不存在', 404);
    const price = round2(Number(depositPrice));
    if (price < 0) throw bizFail('押金单价不能为负');
    const nextStatus = status === 0 || status === '0' ? 0 : 1;
    await conn.query(
      `UPDATE barrel_config SET barrel_type = ?, deposit_price = ?, status = ?, sort_order = ?, updated_at = NOW() WHERE id = ?`,
      [barrelType && String(barrelType).trim(), price, nextStatus, parseInt(sortOrder, 10) || 0, id]
    );
    return { id: Number(id), status: nextStatus, depositPrice: price };
  } catch (e) {
    if (e.business) throw e;
    if (/Duplicate|1062/i.test(e.message)) throw bizFail('桶型名称已存在');
    throw e;
  }
}

// 删除桶型配置（有押金流水的桶型不允许删除，避免台账数据悬挂）
async function deleteConfig(conn, id) {
  const [exist] = await conn.query('SELECT barrel_type FROM barrel_config WHERE id = ? FOR UPDATE', [id]);
  if (!exist.length) throw bizFail('桶型配置不存在', 404);
  // 有押金流水的桶型不许删（否则台账里那条押金会指向一个不存在的桶型 = 数据悬挂）
  const [used] = await conn.query('SELECT COUNT(*) AS cnt FROM barrel_deposits WHERE barrel_type = ?', [
    exist[0].barrel_type
  ]);
  if (Number(used[0].cnt) > 0) throw bizFail('该桶型已有押金流水，不能删除，请改为停用');
  await conn.query('DELETE FROM barrel_config WHERE id = ?', [id]);
  return { barrelType: exist[0].barrel_type };
}

module.exports = {
  createDeposit,
  getDepositList,
  getSummary,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig
};

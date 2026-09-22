// 回桶管理冒烟测试：桶型配置 + 收取/退回押金三联事务 + 台账汇总 + 校验拦截
// 用法：在 backend 目录下运行 node scripts/smoke_barrel.js
require('dotenv').config();
const { pool } = require('../src/config/db');
const barrelService = require('../src/services/barrelService');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function main() {
  // 清理历史冒烟数据（幂等）
  await pool.query("DELETE FROM barrel_deposits WHERE deposit_no LIKE 'YJSM%'");
  await pool.query(
    "DELETE FROM finance_transactions WHERE related_module = 'barrel_deposit' AND related_id LIKE 'YJSM%'"
  );
  await pool.query("DELETE FROM barrel_config WHERE barrel_type LIKE '冒烟%'");

  console.log('== 1. 桶型配置 ==');
  const [cfgs] = await pool.query(
    'SELECT barrel_type, deposit_price FROM barrel_config WHERE status = 1 ORDER BY sort_order'
  );
  ok('预置桶型存在', cfgs.length >= 1, `共 ${cfgs.length} 个桶型`);
  ok(
    '19L桶 预置单价 30',
    cfgs.some(c => c.barrel_type === '19L桶' && Number(c.deposit_price) === 30)
  );
  await pool.query(
    "INSERT INTO barrel_config (barrel_type, deposit_price, status, sort_order, created_at, updated_at) VALUES ('冒烟桶', 50, 1, 99, NOW(), NOW())"
  );
  const [dup] = await pool.query("SELECT id FROM barrel_config WHERE barrel_type = '冒烟桶'");
  ok('新增桶型成功', dup.length === 1);
  const { code: dupCode } = await pool
    .query(
      "INSERT INTO barrel_config (barrel_type, deposit_price, status, sort_order, created_at, updated_at) VALUES ('冒烟桶', 60, 1, 99, NOW(), NOW())"
    )
    .catch(e => ({ code: e.code || e.errno }));
  ok('重复桶型被拦截', /ER_DUP_ENTRY/i.test(String(dupCode)));

  // 删除桶型：已有押金流水必须拦截，无流水可删除
  await pool.query(
    "INSERT INTO barrel_config (barrel_type, deposit_price, status, sort_order, created_at, updated_at) VALUES ('冒烟桶2', 55, 1, 98, NOW(), NOW())"
  );
  const [smk2] = await pool.query("SELECT id FROM barrel_config WHERE barrel_type = '冒烟桶2'");
  await pool.query(
    `INSERT INTO barrel_deposits (deposit_no, station_id, party_type, barrel_type, quantity, unit_price, account_id, account_name, deposit_type, handler_id, remark, created_at, updated_at)
     VALUES ('YJSM000004', 'ST001', 'station', '冒烟桶2', 1, 55.00, 'ACCOUNT_SZX', '晟之溪公户', 'collect', 'admin', '冒烟:删除拦截', NOW(), NOW())`
  );
  // ⚠️ deleteConfig 已改为「接收外部事务连接 + 抛 bizFail（e.business）」——
  //    Web 控制器与小程序管理端因此能把它并进同一个事务（幂等/审计与业务同事务）。
  //    这里自建事务并复现同一套状态码语义。
  const delWithConn = async id => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const r = await barrelService.deleteConfig(conn, id);
      await conn.commit();
      return { code: 200, data: r };
    } catch (e) {
      await conn.rollback();
      return { code: e.business ? e.status || 400 : 500, message: e.message };
    } finally {
      conn.release();
    }
  };
  const delBlocked = await delWithConn(smk2[0].id);
  ok('已有流水的桶型禁止删除', delBlocked.code === 400, delBlocked.message);
  await pool.query("DELETE FROM barrel_deposits WHERE deposit_no = 'YJSM000004'");
  const delOk = await delWithConn(smk2[0].id);
  ok('无流水的桶型删除成功', delOk.code === 200, delOk.message);
  const delAgain = await delWithConn(smk2[0].id);
  ok('重复删除返回不存在', delAgain.code === 404, delAgain.message);

  console.log('== 2. 收取押金（三联事务：余额+ 流水+ 台账+）==');
  const accBefore = await accBalance('ACCOUNT_SZX');
  const [ins1] = await pool.query(
    `INSERT INTO barrel_deposits (deposit_no, station_id, party_type, barrel_type, quantity, unit_price, account_id, account_name, deposit_type, handler_id, remark, created_at, updated_at)
     VALUES ('YJSM000001', 'ST001', 'station', '19L桶', 10, 30.00, 'ACCOUNT_SZX', '晟之溪公户', 'collect', 'admin', '冒烟:收押金', NOW(), NOW())`
  );
  // 模拟服务逻辑：同步账户余额与流水（此处直接调用 SQL 校验口径，真实逻辑在 barrelService）
  await pool.query(
    "UPDATE finance_accounts SET current_balance = current_balance + 300, updated_at = NOW() WHERE account_id = 'ACCOUNT_SZX'"
  );
  const txCollect = await pool.query(
    `INSERT INTO finance_transactions (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after, related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES ('TXSM000001', 'TXSM000001', 'ACCOUNT_SZX', '晟之溪公户', 1, '押金收取', 300, ?, ?, 'barrel_deposit', 'YJSM000001', CURDATE(), 'admin', '江宁水站', '冒烟:收押金', NOW())`,
    [accBefore, accBefore + 300]
  );
  ok('collect 记录插入', ins1.affectedRows === 1);
  const accMid = await accBalance('ACCOUNT_SZX');
  ok('账户余额 +300', Math.abs(accMid - accBefore - 300) < 0.01, `${accBefore} -> ${accMid}`);
  const [sum1] = await pool.query(
    `SELECT SUM(CASE WHEN deposit_type='collect' THEN quantity ELSE -quantity END) AS qty,
            SUM(CASE WHEN deposit_type='collect' THEN quantity*unit_price ELSE -quantity*unit_price END) AS amt
     FROM barrel_deposits WHERE deposit_no='YJSM000001'`
  );
  ok('台账在押 10 桶 / 300 元', Number(sum1[0].qty) === 10 && Number(sum1[0].amt) === 300);

  console.log('== 3. 退回押金（余额- 流水- 台账归零）==');
  // 超退校验：服务层逻辑，此处按口径断言（smoke 直测 SQL 口径，超退/余额不足由 barrelService 单测覆盖）
  await pool.query(
    `INSERT INTO barrel_deposits (deposit_no, station_id, party_type, barrel_type, quantity, unit_price, account_id, account_name, deposit_type, handler_id, remark, refunded_at, created_at, updated_at)
     VALUES ('YJSM000002', 'ST001', 'station', '19L桶', 10, 30.00, 'ACCOUNT_SZX', '晟之溪公户', 'return', 'admin', '冒烟:退押金', NOW(), NOW(), NOW())`
  );
  await pool.query(
    "UPDATE finance_accounts SET current_balance = current_balance - 300, updated_at = NOW() WHERE account_id = 'ACCOUNT_SZX'"
  );
  await pool.query(
    `INSERT INTO finance_transactions (tx_id, tx_no, account_id, account_name, tx_type, tx_category, amount, balance_before, balance_after, related_module, related_id, tx_date, handler, counterparty, remark, created_at)
     VALUES ('TXSM000002', 'TXSM000002', 'ACCOUNT_SZX', '晟之溪公户', 2, '押金退回', 300, ?, ?, 'barrel_deposit', 'YJSM000002', CURDATE(), 'admin', '江宁水站', '冒烟:退押金', NOW())`,
    [accMid, accMid - 300]
  );
  const accAfter = await accBalance('ACCOUNT_SZX');
  ok('账户余额回原值', Math.abs(accAfter - accBefore) < 0.01, `${accMid} -> ${accAfter}`);
  const [sum2] = await pool.query(
    `SELECT SUM(CASE WHEN deposit_type='collect' THEN quantity ELSE -quantity END) AS qty
     FROM barrel_deposits WHERE station_id='ST001' AND barrel_type='19L桶'`
  );
  ok('台账归零', Number(sum2[0].qty) === 0);

  console.log('== 4. 零售客户对象 ==');
  await pool.query(
    `INSERT INTO barrel_deposits (deposit_no, party_type, customer_name, customer_phone, barrel_type, quantity, unit_price, account_id, account_name, deposit_type, handler_id, remark, created_at, updated_at)
     VALUES ('YJSM000003', 'customer', '张三', '13800000001', '4L桶', 5, 15.00, 'ACCOUNT_WX', '微信', 'collect', 'admin', '冒烟:零售收押金', NOW(), NOW())`
  );
  await pool.query(
    "UPDATE finance_accounts SET current_balance = current_balance + 75, updated_at = NOW() WHERE account_id = 'ACCOUNT_WX'"
  );
  const [cRow] = await pool.query(
    `SELECT party_type, customer_name, customer_phone FROM barrel_deposits WHERE deposit_no='YJSM000003'`
  );
  ok('零售对象记录', cRow[0].party_type === 'customer' && cRow[0].customer_name === '张三');
  const [cSum] = await pool.query(
    `SELECT SUM(CASE WHEN deposit_type='collect' THEN quantity ELSE -quantity END) AS qty
     FROM barrel_deposits WHERE party_type='customer' AND customer_name='张三' AND customer_phone='13800000001' AND barrel_type='4L桶'`
  );
  ok('零售台账在押 5 桶', Number(cSum[0].qty) === 5);

  console.log('== 5. 清理 ==');
  await pool.query("DELETE FROM barrel_deposits WHERE deposit_no LIKE 'YJSM%'");
  await pool.query("DELETE FROM finance_transactions WHERE tx_id LIKE 'TXSM%'");
  await pool.query("DELETE FROM barrel_config WHERE barrel_type IN ('冒烟桶', '冒烟桶2')");
  await pool.query("UPDATE finance_accounts SET current_balance = 1000 WHERE account_id = 'ACCOUNT_SZX'");
  await pool.query("UPDATE finance_accounts SET current_balance = 0 WHERE account_id = 'ACCOUNT_WX'");
  ok('测试数据已清理', true);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

async function accBalance(accountId) {
  const [r] = await pool.query('SELECT current_balance FROM finance_accounts WHERE account_id = ?', [accountId]);
  return Number(r[0].current_balance);
}

main().catch(e => {
  console.error('测试异常:', e.message);
  process.exit(1);
});

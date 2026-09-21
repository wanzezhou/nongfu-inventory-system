// 小程序管理端 · 各业务域共用的「定式积木」（文档 §5.3 Phase 8b）
// ===========================================================================
// 为什么要有这个文件：Phase 8b 是 17 个业务域。**逐域验收 ≠ 逐域换写法** ——
// 若每个域各自写一遍分页/账户下拉/幂等键校验/错误文案透传，17 份实现迟早分叉，
// 而这类分叉的表现形式是「某个域能重放、某个域重复记账」这种极难发现的差异。
// 所以把与业务无关的部分收敛到这里，域控制器只写「本域特有的」那几行。
//
// ⚠️ 本文件**不碰任何表**（账户表除外，那是所有资金域共用的选项源），
//    也不做任何账务动作 —— 账务一律调 Web 端的原语（§41 头号禁止项）。
// ===========================================================================
const { MINI_PAGE, IDEM_KEY_MAX_LEN } = require('../../../constants/mini');
// ⚠️ respondBusinessError 要用它发响应 —— 忘了 import 的后果是：任何一次业务校验失败
//    都会在错误处理路径上抛 ReferenceError（未处理的 Promise rejection），响应**永不返回**，
//    客户端挂起到 fetch 超时（实测 300s），而服务端日志只有一行不起眼的 rejection。
//    这是「错误处理路径本身没被测过」的典型事故 —— 冒烟只盯成功路径时漏掉的正是它。
const { error } = require('../../../utils/response');

/** 分页（与 catalogController 同口径；mysql2 不支持 `LIMIT ?` → parseInt 后内联） */
function parseMiniPage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MINI_PAGE.MAX_SIZE, Math.max(1, parseInt(query.pageSize, 10) || MINI_PAGE.DEFAULT_SIZE));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * 资金账户下拉：**只列启用账户**。
 *
 * ⚠️ 刻意不复用 `financeAccountController.getAccounts`：那个接口返回**全部**账户
 *    （含停用）且取全字段，用途不同。而账务原语会以 `status = 1 FOR UPDATE` 加锁校验，
 *    列表若含停用账户，用户选完必然报错 —— 属自造失败。真正的约束仍在账务原语里。
 */
async function listActiveAccounts(conn) {
  const [rows] = await conn.query(
    `SELECT account_id, account_name, current_balance
       FROM finance_accounts WHERE status = 1 ORDER BY account_type, created_at`
  );
  return rows.map(r => ({
    accountId: r.account_id,
    accountName: r.account_name,
    currentBalance: Number(r.current_balance) || 0
  }));
}

/** 类别取数的表（内部白名单 —— 表名不来自任何入参，避免拼字符串） */
const CATEGORY_TABLE = {
  expense: 'other_expenses',
  income: 'other_incomes'
};

/**
 * 类别选项：预置 + 历史自定义（与 Web 端同一条取数，避免两处各列一份规则）
 * @param {'expense'|'income'} kind
 */
async function listCategories(conn, kind, presetCategories) {
  const table = CATEGORY_TABLE[kind];
  if (!table) throw new Error('未知的类别表类型');
  const [rows] = await conn.query(`SELECT DISTINCT category FROM ${table} ORDER BY category`);
  const custom = rows.map(r => r.category).filter(c => !presetCategories.includes(c));
  return { preset: presetCategories, custom };
}

/** 幂等键校验：缺失或超长一律 400（与订单/钱包调增同口径） */
function requireIdemKey(clientRequestId) {
  if (!clientRequestId || String(clientRequestId).length > IDEM_KEY_MAX_LEN) {
    return `缺少或非法 clientRequestId（幂等键，长度不超过 ${IDEM_KEY_MAX_LEN}）`;
  }
  return null;
}

/**
 * 业务错误出口
 * ⚠️ 账务原语抛的是 `new Error('支出账户不存在或已停用')` 这类**面向用户**的文案，
 *    故按白名单透传；其余一律给固定文案，**绝不把 err.message 出参**
 *    （红线：泄露表名/SQL）。
 */
function businessMessage(e, fallback) {
  const msg = String((e && e.message) || '');
  return /账户/.test(msg) ? msg : fallback;
}

/**
 * 业务错误出口（**带标记**的错误：`err.business === true`）
 * ---------------------------------------------------------------------------
 * 两种约定并存，不要搞混：
 *   ① 台账原语（`applyExpenseLedger` 等）抛**未标记**的 Error，文案需白名单过滤
 *      → 用 `businessMessage()` 取文案。
 *   ② 库存核心事务体（`applyStockIn` / `applyStockOut` / `applyPurchaseVoid`）
 *      抛的是 `bizFail()` 构造的**已标记**错误，且自带 `status`（如「商品不存在」是 404）
 *      → 用本函数。
 *   若把 ② 交给 ① 处理，「商品不存在」会丢掉 404、变成 400（前端按状态码分支就会错），
 *   且「库存不足，当前库存: 5」这类**有用**的文案会被白名单吞掉、退化成一句无用提示。
 *
 * @returns {boolean} true 表示已处理（调用方直接 return）
 */
function respondBusinessError(res, e, fallback) {
  if (e && e.business) {
    // hazard-allow: 仅透传 bizFail() 自建的业务文案（e.business 为真才进此分支），非业务错误走 fallback 固定文案 —— 本函数就是 R4 要求的白名单模式
    error(res, e.message, e.status || 400);
    return true;
  }
  console.error(`[mini/admin] ${fallback}:`, e);
  error(res, fallback);
  return true;
}

module.exports = {
  parseMiniPage,
  listActiveAccounts,
  listCategories,
  requireIdemKey,
  businessMessage,
  respondBusinessError
};

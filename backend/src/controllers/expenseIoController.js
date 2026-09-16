// 其他支出：导入 / 导出 / 模板（依赖 exceljs 与 multer）
const { writeWorkbook, readSheetJson, readCsvAoa } = require('../utils/excel');
const multer = require('multer');
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');
const expenseCore = require('./expenseController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const TEMPLATE_HEADERS = ['支出名称*', '金额*', '支出日期*（YYYY-MM-DD）', '支出类别*', '备注', '支出账户（可选，填账户名称）'];
const TEMPLATE_EXAMPLE = ['仓库月租', '5000', '2026-09-01', '房租水电', '示例：可删除', '晟之溪公户'];

function normalizeKey(k) {
  return String(k || '').replace(/[*（）()\s]/g, '').replace(/[：:].*$/, '');
}

// 模板下载（xlsx）
async function downloadTemplate(req, res) {
  try {
    const buf = await writeWorkbook([{ name: '其他支出模板', data: [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE] }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="other_expenses_template.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('downloadTemplate error:', e);
    return error(res, '模板生成失败', 500);
  }
}

// 导入（xlsx / csv）：逐行校验，跳过非法行并返回原因；事务批量入库 + 记账
async function importExpenses(req, res) {
  const file = req.file;
  if (!file) return error(res, '请上传文件', 400);
  try {
    let raw;
    const fname = String(file.originalname || '').toLowerCase();
    if (fname.endsWith('.csv')) {
      raw = readCsvAoa(file.buffer.toString('utf8'));
    } else {
      // sheet_to_json({ header: 1, defval: '' }) 等价物：直接取 AOA，空缺补 ''
      const wbRows = await readSheetJson(file.buffer);
      raw = wbRows.length ? [Object.keys(wbRows[0]), ...wbRows.map((o) => Object.values(o))] : [];
    }
    if (!raw.length) return error(res, '文件内容为空', 400);

    // 表头（首行非空行）
    let headerRowIdx = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].some((c) => String(c).trim() !== '')) { headerRowIdx = i; break; }
    }
    if (headerRowIdx < 0) return error(res, '文件内容为空', 400);
    const header = raw[headerRowIdx].map((h) => normalizeKey(h));
    const idxName = header.findIndex((h) => h.includes('名称'));
    const idxAmount = header.findIndex((h) => h.includes('金额'));
    const idxDate = header.findIndex((h) => h.includes('日期'));
    const idxCategory = header.findIndex((h) => h.includes('类别'));
    const idxRemark = header.findIndex((h) => h.includes('备注'));
    const idxAccount = header.findIndex((h) => h.includes('账户'));
    if (idxName < 0 || idxAmount < 0 || idxDate < 0 || idxCategory < 0) {
      return error(res, '表头缺少必要列（支出名称/金额/支出日期/支出类别）', 400);
    }

    // 账户名称 -> id 映射
    const [accounts] = await pool.query('SELECT account_id, account_name FROM finance_accounts WHERE status = 1');
    const accountMap = {};
    accounts.forEach((a) => { accountMap[String(a.account_name).trim()] = a.account_id; });

    const failed = [];
    const user = (req.user && (req.user.username || req.user.id)) || null;
    let successCount = 0;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = headerRowIdx + 1; i < raw.length; i++) {
        const row = raw[i];
        if (!row.some((c) => String(c).trim() !== '')) continue; // 空行跳过
        const lineNo = i + 1;
        const name = String(row[idxName] ?? '').trim();
        const amountRaw = String(row[idxAmount] ?? '').trim();
        const dateRaw = String(row[idxDate] ?? '').trim();
        const category = String(row[idxCategory] ?? '').trim();
        const remark = (idxRemark >= 0 ? String(row[idxRemark] ?? '') : '').trim();
        const accountName = (idxAccount >= 0 ? String(row[idxAccount] ?? '') : '').trim();

        const reason = validateImportRow(name, amountRaw, dateRaw, category, accountName, accountMap);
        if (reason) { failed.push({ row: lineNo, reason }); continue; }

        const expenseId = expenseCore.genId();
        const accountId = accountName ? accountMap[accountName] : null;
        const accountNameSnapshot = accountName || null;
        try {
          await conn.query(
            `INSERT INTO other_expenses (expense_id, expense_name, category, amount, expense_date, account_id, account_name, remark, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [expenseId, name, category, Number(amountRaw), dateRaw, accountId, accountNameSnapshot, remark || null, user]
          );
          await expenseCore.applyExpenseLedger(conn, { expense_id: expenseId, account_id: accountId, amount: Number(amountRaw), expense_date: dateRaw, expense_name: name, remark: remark || null }, user);
          successCount++;
        } catch (e) {
          failed.push({ row: lineNo, reason: e.message.includes('账户') ? e.message : '入库失败' });
        }
      }
      await conn.commit();
      return success(res, { successCount, failedCount: failed.length, failed }, `导入完成：成功 ${successCount} 条，失败 ${failed.length} 条`);
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('importExpenses error:', e);
    return error(res, '导入失败：' + e.message, 500);
  }
}

function validateImportRow(name, amountRaw, dateRaw, category, accountName, accountMap) {
  if (!name) return '支出名称为空';
  const amt = Number(amountRaw);
  if (amountRaw === '' || isNaN(amt) || amt <= 0) return `金额无效（${amountRaw || '空'}）`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return `日期格式无效（${dateRaw || '空'}，应为 YYYY-MM-DD）`;
  if (!category) return '支出类别为空';
  if (accountName && !accountMap[accountName]) return `账户不存在（${accountName}）`;
  return null;
}

// 导出（xlsx / csv）：按日期范围/类别/关键词筛选
async function exportExpenses(req, res) {
  try {
    const { startDate, endDate, category, keyword, format = 'xlsx', month, range } = req.query;
    const parts = [];
    const params = [];
    // 时间条件与列表接口保持一致：range / month 走统一区间解析，否则用直接传入的起止日期
    if (range || month) {
      const r = resolveRange({ range, month, startDate, endDate });
      if (!r) {
        return error(res, RANGE_INVALID_MSG, 400);
      }
      const rw = buildRangeWhere('expense_date', r);
      if (rw.clause) {
        parts.push(rw.clause);
        params.push(...rw.params);
      }
    } else {
      if (startDate) { parts.push('expense_date >= ?'); params.push(startDate); }
      if (endDate) { parts.push('expense_date <= ?'); params.push(endDate); }
    }
    if (category) { parts.push('category = ?'); params.push(category); }
    if (keyword) {
      parts.push('(expense_name LIKE ? OR remark LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    const [rows] = await pool.execute(
      `SELECT expense_name, category, amount, DATE_FORMAT(expense_date, '%Y-%m-%d') AS expense_date,
              COALESCE(account_name, '') AS account_name, COALESCE(remark, '') AS remark
       FROM other_expenses ${where}
       ORDER BY expense_date DESC`,
      params
    );
    const aoa = [['支出名称', '支出类别', '金额', '支出日期', '支出账户', '备注']];
    rows.forEach((r) => aoa.push([r.expense_name, r.category, Number(r.amount), r.expense_date, r.account_name, r.remark]));

    if (String(format).toLowerCase() === 'csv') {
      const csv = aoa.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="other_expenses.csv"');
      return res.send('\ufeff' + csv); // BOM 保证 Excel 打开中文正常
    }
    const buf = await writeWorkbook([{ name: '其他支出', data: aoa }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="other_expenses.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('exportExpenses error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = { upload, downloadTemplate, importExpenses, exportExpenses };

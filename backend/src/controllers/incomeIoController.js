// 其他收入：导入 / 导出 / 模板（结构与其他支出的 expenseIoController 对称）
const { writeWorkbook, readSheetJson, readCsvAoa } = require('../utils/excel');
const multer = require('multer');
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { resolveRange, buildRangeWhere, RANGE_INVALID_MSG } = require('../utils/dateRange');
const incomeCore = require('./incomeController');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const TEMPLATE_HEADERS = [
  '收入名称*',
  '金额*',
  '收入日期*（YYYY-MM-DD）',
  '收入类别*',
  '备注',
  '收入账户（可选，填账户名称）'
];
const TEMPLATE_EXAMPLE = ['废纸箱出售', '300', '2026-09-01', '废品回收', '示例：可删除', '新农夫上单账户'];

function normalizeKey(k) {
  return String(k || '')
    .replace(/[*（）()\s]/g, '')
    .replace(/[：:].*$/, '');
}

// 模板下载（xlsx）
async function downloadTemplate(req, res) {
  try {
    const buf = await writeWorkbook([{ name: '其他收入模板', data: [TEMPLATE_HEADERS, TEMPLATE_EXAMPLE] }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="other_incomes_template.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('downloadIncomeTemplate error:', e);
    return error(res, '模板生成失败', 500);
  }
}

// 导入（xlsx / csv）：逐行校验，跳过非法行并返回原因；事务批量入库 + 记账
async function importIncomes(req, res) {
  const file = req.file;
  if (!file) return error(res, '请上传文件', 400);
  try {
    let raw;
    const fname = String(file.originalname || '').toLowerCase();
    if (fname.endsWith('.csv')) {
      raw = readCsvAoa(file.buffer.toString('utf8'));
    } else {
      const wbRows = await readSheetJson(file.buffer);
      raw = wbRows.length ? [Object.keys(wbRows[0]), ...wbRows.map(o => Object.values(o))] : [];
    }
    if (!raw.length) return error(res, '文件内容为空', 400);

    let headerRowIdx = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].some(c => String(c).trim() !== '')) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx < 0) return error(res, '文件内容为空', 400);
    const header = raw[headerRowIdx].map(h => normalizeKey(h));
    const idxName = header.findIndex(h => h.includes('名称'));
    const idxAmount = header.findIndex(h => h.includes('金额'));
    const idxDate = header.findIndex(h => h.includes('日期'));
    const idxCategory = header.findIndex(h => h.includes('类别'));
    const idxRemark = header.findIndex(h => h.includes('备注'));
    const idxAccount = header.findIndex(h => h.includes('账户'));
    if (idxName < 0 || idxAmount < 0 || idxDate < 0 || idxCategory < 0) {
      return error(res, '表头缺少必要列（收入名称/金额/收入日期/收入类别）', 400);
    }

    // 账户名称 -> id 映射
    const [accounts] = await pool.query('SELECT account_id, account_name FROM finance_accounts WHERE status = 1');
    const accountMap = {};
    accounts.forEach(a => {
      accountMap[String(a.account_name).trim()] = a.account_id;
    });

    const failed = [];
    const user = (req.user && (req.user.username || req.user.id)) || null;
    let successCount = 0;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (let i = headerRowIdx + 1; i < raw.length; i++) {
        const row = raw[i];
        if (!row.some(c => String(c).trim() !== '')) continue; // 空行跳过
        const lineNo = i + 1;
        const name = String(row[idxName] ?? '').trim();
        const amountRaw = String(row[idxAmount] ?? '').trim();
        const dateRaw = String(row[idxDate] ?? '').trim();
        const category = String(row[idxCategory] ?? '').trim();
        const remark = (idxRemark >= 0 ? String(row[idxRemark] ?? '') : '').trim();
        const accountName = (idxAccount >= 0 ? String(row[idxAccount] ?? '') : '').trim();

        const reason = validateImportRow(name, amountRaw, dateRaw, category, accountName, accountMap);
        if (reason) {
          failed.push({ row: lineNo, reason });
          continue;
        }

        const incomeId = incomeCore.genId();
        const accountId = accountName ? accountMap[accountName] : null;
        const accountNameSnapshot = accountName || null;
        try {
          await conn.query(
            `INSERT INTO other_incomes (income_id, income_name, category, amount, income_date, account_id, account_name, remark, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [incomeId, name, category, Number(amountRaw), dateRaw, accountId, accountNameSnapshot, remark || null, user]
          );
          await incomeCore.applyIncomeLedger(
            conn,
            {
              income_id: incomeId,
              account_id: accountId,
              amount: Number(amountRaw),
              income_date: dateRaw,
              income_name: name,
              remark: remark || null
            },
            user
          );
          successCount++;
        } catch (e) {
          failed.push({ row: lineNo, reason: e.message.includes('账户') ? e.message : '入库失败' });
        }
      }
      await conn.commit();
      return success(
        res,
        { successCount, failedCount: failed.length, failed },
        `导入完成：成功 ${successCount} 条，失败 ${failed.length} 条`
      );
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('importIncomes error:', e);
    return error(res, '导入失败', 500);
  }
}

function validateImportRow(name, amountRaw, dateRaw, category, accountName, accountMap) {
  if (!name) return '收入名称为空';
  const amt = Number(amountRaw);
  if (amountRaw === '' || isNaN(amt) || amt <= 0) return `金额无效（${amountRaw || '空'}）`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) return `日期格式无效（${dateRaw || '空'}，应为 YYYY-MM-DD）`;
  if (!category) return '收入类别为空';
  if (accountName && !accountMap[accountName]) return `账户不存在（${accountName}）`;
  return null;
}

// 导出（xlsx / csv）：按日期范围/类别/关键词筛选
async function exportIncomes(req, res) {
  try {
    const { startDate, endDate, category, keyword, format = 'xlsx', month, range } = req.query;
    const parts = [];
    const params = [];
    if (range || month) {
      const r = resolveRange({ range, month, startDate, endDate });
      if (!r) {
        return error(res, RANGE_INVALID_MSG, 400);
      }
      const rw = buildRangeWhere('income_date', r);
      if (rw.clause) {
        parts.push(rw.clause);
        params.push(...rw.params);
      }
    } else {
      if (startDate) {
        parts.push('income_date >= ?');
        params.push(startDate);
      }
      if (endDate) {
        parts.push('income_date <= ?');
        params.push(endDate);
      }
    }
    if (category) {
      parts.push('category = ?');
      params.push(category);
    }
    if (keyword) {
      parts.push('(income_name LIKE ? OR remark LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';
    const [rows] = await pool.execute(
      `SELECT income_name, category, amount, DATE_FORMAT(income_date, '%Y-%m-%d') AS income_date,
              COALESCE(account_name, '') AS account_name, COALESCE(remark, '') AS remark
       FROM other_incomes ${where}
       ORDER BY income_date DESC`,
      params
    );
    const aoa = [['收入名称', '收入类别', '金额', '收入日期', '收入账户', '备注']];
    rows.forEach(r => aoa.push([r.income_name, r.category, Number(r.amount), r.income_date, r.account_name, r.remark]));

    if (String(format).toLowerCase() === 'csv') {
      const csv = aoa.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="other_incomes.csv"');
      return res.send('\ufeff' + csv); // BOM 保证 Excel 打开中文正常
    }
    const buf = await writeWorkbook([{ name: '其他收入', data: aoa }]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="other_incomes.xlsx"');
    return res.send(buf);
  } catch (e) {
    console.error('exportIncomes error:', e);
    return error(res, '导出失败', 500);
  }
}

module.exports = { upload, downloadTemplate, importIncomes, exportIncomes };

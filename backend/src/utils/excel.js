// Excel 读写统一 shim（S5：xlsx/SheetJS → exceljs，消除 CVE-2023-30533 风险依赖）
// - writeWorkbook(sheets)：写 .xlsx Buffer。sheets: [{ name, data }]，data 支持
//   AOA（二维数组，等价 XLSX.utils.aoa_to_sheet）或对象数组（等价 json_to_sheet，列取首行键序）
// - readSheetJson(buffer)：读 .xlsx 第一个 sheet → 对象数组（首行为表头，空缺补 ''，
//   等价 XLSX.utils.sheet_to_json(sheet, { defval: '' })）
// - readCsvAoa(text)：轻量 CSV 解析（RFC4180：引号转义/换行），返回二维数组
// - parseTable(bufferOrText, filename)：按文件名自动分流 xlsx/csv → 对象数组
const ExcelJS = require('exceljs');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 对象数组 → AOA（列序取首行键序，与 json_to_sheet 一致）
function objectsToAoa(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  if (Array.isArray(data[0])) return data;
  if (!isPlainObject(data[0])) return data.map((v) => [v]);
  const headers = Object.keys(data[0]);
  return [headers, ...data.map((o) => headers.map((h) => (o[h] === undefined || o[h] === null ? '' : o[h])))];
}

async function writeWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  const list = Array.isArray(sheets) ? sheets : [sheets];
  for (const sheet of list) {
    const ws = wb.addWorksheet(sheet.name || 'Sheet1');
    const rows = objectsToAoa(sheet.data);
    if (rows.length) ws.addRows(rows);
    // 列宽：widths 按列给（等价 ws['!cols'] 的 wch），width 统一所有列
    // 注意用 getColumn（ws.columns 未显式定义时可能为空）
    if (Array.isArray(sheet.widths)) {
      sheet.widths.forEach((w, i) => { if (w) ws.getColumn(i + 1).width = w; });
    } else if (sheet.width) {
      for (let c = 1; c <= ws.columnCount; c++) ws.getColumn(c).width = sheet.width;
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// exceljs 单元格值归一：公式取 result、富文本取拼接文本、Date/原始值原样
function cellValue(v, defval) {
  if (v === null || v === undefined) return defval;
  if (typeof v !== 'object') return v;
  if (v instanceof Date) return v;
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('result' in v) return v.result === null || v.result === undefined ? defval : v.result;
  if ('text' in v) return v.text;
  return v;
}

async function readSheetJson(buffer, { sheetIndex = 0, defval = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[sheetIndex];
  if (!ws || ws.rowCount === 0) return [];

  // 表头（含空单元格占位，保持列号对齐）
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellValue(cell.value, '') ?? '').trim();
  });
  const maxCol = headers.length - 1;
  if (maxCol < 1) return [];

  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    for (let col = 1; col <= maxCol; col++) {
      const key = headers[col] || `__col${col}`;
      obj[key] = cellValue(row.getCell(col).value, defval);
    }
    out.push(obj);
  });
  return out;
}

// 轻量 CSV 解析：支持双引号包裹、"" 转义、\r\n / \n 换行、逗号分隔
function readCsvAoa(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // 去掉 UTF-8 BOM 残留
  if (rows.length && typeof rows[0][0] === 'string' && rows[0][0].charCodeAt(0) === 0xfeff) {
    rows[0][0] = rows[0][0].slice(1);
  }
  return rows;
}

function aoaToObjects(aoa, { defval = '' } = {}) {
  if (!Array.isArray(aoa) || aoa.length === 0) return [];
  const headers = (aoa[0] || []).map((h) => String(h ?? '').trim());
  return aoa.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = r[idx] === undefined || r[idx] === null ? defval : r[idx];
    });
    return obj;
  });
}

// 按文件名自动分流：.csv → CSV 解析；否则按 xlsx 读取
async function parseTable(bufferOrText, filename = '') {
  if (/\.csv$/i.test(filename)) {
    const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString('utf8') : String(bufferOrText);
    return aoaToObjects(readCsvAoa(text));
  }
  return readSheetJson(bufferOrText);
}

// 从 .xlsx 文件路径读第一个 sheet → AOA 二维数组（等价 readFile + sheet_to_json({header:1})）
async function readSheetAoa(filePath, { sheetIndex = 0, defval = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[sheetIndex];
  if (!ws || ws.rowCount === 0) return [];
  const aoa = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const last = Math.max(ws.columnCount, row.cellCount);
    const arr = [];
    for (let c = 1; c <= last; c++) arr.push(cellValue(row.getCell(c).value, defval));
    aoa.push(arr);
  });
  return aoa;
}

module.exports = { writeWorkbook, readSheetJson, readSheetAoa, readCsvAoa, aoaToObjects, parseTable, ExcelJS };

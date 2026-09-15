// 机台销量（量贩机/零售机营收）Excel 一键导入 + 模板下载（2026-09-15，需求 3）
//
// 背景：量贩机/零售机营收不再与订单关联，改为在营收页手动录入或 Excel 批量导入。
//       成本统计仍关联订单（type 4/6 订单内商品），此处只负责营收侧数据落库。
//
// 表头（与下载模板一致，允许列顺序不同）：
//   机台编号* / 商品编码* / 销售数量* / 销售单价 / 销售日期* / 备注
//
// 设计要点：
//   - 逐行校验并返回行号级错误，任一错误整体不写库（事务）；
//   - 机台类型由 machine_stations.machine_type 反查补齐（不信任用户填的值）；
//   - 商品编码 → product_id 需查库，不存在则报错该行；
//   - 日期兼容 Excel 序列号与字符串两种形态。
const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const { parseTable, writeWorkbook } = require('../utils/excel');

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Excel 日期可能被解析为 Date / 序列号数字 / 字符串，统一为 YYYY-MM-DD
function normalizeDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  // Excel 序列号（1900 日期系统，仅处理 1960 年以后的合理区间）
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
  }
  const s = String(v).trim().replace(/[/.]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return null;
}

// 下载导入模板
async function downloadMachineSaleTemplate(req, res) {
  try {
    const data = [
      { 机台编号: 'M001', 商品编码: 'P0001', 销售数量: 10, 销售单价: 2.5, 销售日期: '2026-09-01', 备注: '示例行，导入前请删除' }
    ];
    const buffer = await writeWorkbook([
      {
        name: '机台销量',
        data,
        widths: [14, 14, 12, 12, 14, 24]
      }
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="machine-sale-template.xlsx"');
    return res.send(buffer);
  } catch (e) {
    console.error('downloadMachineSaleTemplate error:', e);
    return error(res, '模板生成失败', 500);
  }
}

// 一键导入机台销量
async function importMachineSales(req, res) {
  let conn;
  try {
    if (!req.file || !req.file.buffer) {
      return error(res, '请上传 .xlsx / .csv 文件', 400);
    }
    let records;
    try {
      records = await parseTable(req.file.buffer, req.file.originalname || '');
    } catch (e) {
      return error(res, '文件解析失败，请确认是有效的 .xlsx / .csv', 400);
    }
    if (!records || records.length === 0) {
      return error(res, '文件中没有数据行', 400);
    }

    // —— 逐行解析与校验（收集全部错误后一次性返回，便于用户批量修正） ——
    const errors = [];
    const cleaned = [];
    records.forEach((raw, idx) => {
      const line = idx + 2; // 含表头，故数据从第 2 行开始
      const machineNo = String(raw['机台编号'] ?? raw['机台编号*'] ?? '').trim();
      const productCode = String(raw['商品编码'] ?? raw['商品编码*'] ?? '').trim();
      const qtyRaw = raw['销售数量'] ?? raw['销售数量*'];
      const priceRaw = raw['销售单价'];
      const dateRaw = raw['销售日期'] ?? raw['销售日期*'];
      const remark = String(raw['备注'] ?? '').trim();

      // 整行为空则跳过（Excel 常见尾部空行）
      if (!machineNo && !productCode && (qtyRaw === undefined || qtyRaw === '') && (dateRaw === undefined || dateRaw === '')) {
        return;
      }

      if (!machineNo) { errors.push(`第 ${line} 行：机台编号为空`); return; }
      if (!productCode) { errors.push(`第 ${line} 行：商品编码为空`); return; }

      const quantity = Number(qtyRaw);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
        errors.push(`第 ${line} 行：销售数量必须为正整数（当前「${qtyRaw ?? ''}」）`);
        return;
      }

      const salePrice = priceRaw === undefined || priceRaw === '' ? 0 : Number(priceRaw);
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        errors.push(`第 ${line} 行：销售单价必须为不小于 0 的数字（当前「${priceRaw ?? ''}」）`);
        return;
      }

      const saleDate = normalizeDate(dateRaw);
      if (!saleDate) {
        errors.push(`第 ${line} 行：销售日期格式不正确（应为 YYYY-MM-DD，当前「${dateRaw ?? ''}」）`);
        return;
      }

      cleaned.push({ line, machineNo, productCode, quantity, salePrice: round2(salePrice), saleDate, remark });
    });

    if (cleaned.length === 0) {
      return error(res, errors.length ? `导入失败：\n${errors.slice(0, 20).join('\n')}` : '文件中没有有效数据行', 400);
    }

    // —— 批量反查机台与商品，避免逐行查库 ——
    const machineNos = [...new Set(cleaned.map((r) => r.machineNo))];
    const productCodes = [...new Set(cleaned.map((r) => r.productCode))];

    const [machines] = await pool.query(
      `SELECT machine_id, machine_type, station_name FROM machine_stations WHERE machine_id IN (${machineNos.map(() => '?').join(',')})`,
      machineNos
    );
    const machineMap = new Map(machines.map((m) => [m.machine_id, m]));

    const [products] = await pool.query(
      `SELECT product_id, product_code FROM products WHERE product_code IN (${productCodes.map(() => '?').join(',')}) AND status = 1`,
      productCodes
    );
    const productMap = new Map(products.map((p) => [p.product_code, p.product_id]));

    const valid = [];
    for (const r of cleaned) {
      const m = machineMap.get(r.machineNo);
      if (!m) { errors.push(`第 ${r.line} 行：机台编号「${r.machineNo}」不存在`); continue; }
      const pid = productMap.get(r.productCode);
      if (!pid) { errors.push(`第 ${r.line} 行：商品编码「${r.productCode}」不存在或已停用`); continue; }
      valid.push({ ...r, machineId: m.machine_id, machineType: Number(m.machine_type) || 1, productId: pid });
    }

    if (valid.length === 0) {
      return error(res, `导入失败：\n${errors.slice(0, 20).join('\n')}`, 400);
    }

    const creator = (req.user && (req.user.username || req.user.id)) || null;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const saleIds = [];
    let seq = 0;
    for (const it of valid) {
      const saleId = `MS${Date.now()}${String(seq++).padStart(3, '0')}${Math.floor(Math.random() * 90 + 10)}`;
      await conn.execute(
        `INSERT INTO machine_sales (sale_id, machine_id, machine_type, product_id, quantity, sale_price, sale_date, remark, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, it.machineId, it.machineType, it.productId, it.quantity, it.salePrice, it.saleDate, it.remark || null, creator]
      );
      saleIds.push(saleId);
    }
    await conn.commit();

    // 部分行失败时也提交成功行，但把失败明细回传给前端提示
    const msg = errors.length
      ? `成功导入 ${saleIds.length} 条，${errors.length} 条被跳过`
      : `成功导入 ${saleIds.length} 条`;
    return success(res, {
      inserted: saleIds.length,
      skipped: errors.length,
      errors: errors.slice(0, 50),
      saleIds
    }, msg);
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('importMachineSales error:', e);
    return error(res, '机台销量导入失败', 500);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { importMachineSales, downloadMachineSaleTemplate };

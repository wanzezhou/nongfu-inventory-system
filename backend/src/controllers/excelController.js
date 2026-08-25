const { pool } = require('../config/db');
const { success, error } = require('../utils/response');
const XLSX = require('xlsx');
const multer = require('multer');

// 文件上传中间件（内存存储）
const upload = multer({ storage: multer.memoryStorage() });

// ===== 各模块字段配置 =====
const MODULE_CONFIG = {
  products: {
    table: 'products',
    idField: 'product_id',
    matchField: 'product_code',
    columns: [
      { header: '商品编码', db: 'product_code', required: true },
      { header: '商品名称', db: 'product_name', required: true },
      { header: '规格', db: 'specification' },
      { header: '单位', db: 'unit' },
      { header: '进货价', db: 'purchase_price', type: 'number' },
      { header: '批发价', db: 'wholesale_price', type: 'number' },
      { header: '零售价', db: 'retail_price', type: 'number' },
      { header: '零售机价', db: 'machine_price', type: 'number' },
      { header: '总配送费', db: 'total_delivery_fee', type: 'number' },
      { header: '分销配送费', db: 'distribution_delivery_fee', type: 'number' },
      { header: '工人零售配送费', db: 'worker_retail_delivery_fee', type: 'number' },
      { header: '工人水站配送费', db: 'worker_wholesale_delivery_fee', type: 'number' },
      { header: '工人零售机配送费', db: 'worker_machine_delivery_fee', type: 'number' },
      { header: '分类', db: 'category' },
      { header: '状态', db: 'status', type: 'number', default: 1 }
    ],
    generateId: () => {
      const timestamp = Date.now().toString();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `P${timestamp}${random}`;
    }
  },
  stations: {
    table: 'sub_stations',
    idField: 'station_id',
    matchField: 'station_name',
    columns: [
      { header: '水站名称', db: 'station_name', required: true },
      { header: '联系人', db: 'contact_name' },
      { header: '电话', db: 'phone' },
      { header: '地址', db: 'address' },
      { header: '区域', db: 'area' },
      { header: '信用额度', db: 'credit_limit', type: 'number' },
      { header: '当前欠款', db: 'current_debt', type: 'number' },
      { header: '付款方式', db: 'payment_type' },
      { header: '开户银行', db: 'bank_name' },
      { header: '银行账号', db: 'bank_account' },
      { header: '账户名称', db: 'account_name' },
      { header: '发票抬头', db: 'invoice_title' },
      { header: '税号', db: 'tax_number' },
      { header: '发票地址', db: 'invoice_address' },
      { header: '发票电话', db: 'invoice_phone' },
      { header: '状态', db: 'status', type: 'number', default: 1 }
    ],
    generateId: () => {
      const timestamp = Date.now().toString();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `S${timestamp}${random}`;
    }
  },
  suppliers: {
    table: 'suppliers',
    idField: 'supplier_id',
    matchField: 'supplier_name',
    columns: [
      { header: '供应商名称', db: 'supplier_name', required: true },
      { header: '联系人', db: 'contact_name' },
      { header: '电话', db: 'phone' },
      { header: '地址', db: 'address' },
      { header: '开户银行', db: 'bank_name' },
      { header: '银行账号', db: 'bank_account' },
      { header: '账户名称', db: 'account_name' },
      { header: '税号', db: 'tax_number' },
      { header: '发票抬头', db: 'invoice_title' },
      { header: '备注', db: 'remark' },
      { header: '状态', db: 'status', type: 'number', default: 1 }
    ],
    generateId: () => {
      const timestamp = Date.now().toString();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `SUP${timestamp}${random}`;
    }
  },
  workers: {
    table: 'workers',
    idField: 'worker_id',
    matchField: 'worker_name',
    columns: [
      { header: '员工姓名', db: 'worker_name', required: true },
      { header: '电话', db: 'phone' },
      { header: '员工类型', db: 'employee_type', type: 'number', default: 2 },
      { header: '车辆类型', db: 'vehicle_type', type: 'number', default: 1 },
      { header: '开户银行', db: 'bank_name' },
      { header: '银行账号', db: 'bank_account' },
      { header: '状态', db: 'status', type: 'number', default: 1 }
    ],
    generateId: () => {
      const timestamp = Date.now().toString();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      return `W${timestamp}${random}`;
    }
  }
};

// ===== 导出 =====
async function exportData(req, res) {
  const moduleName = req.params.module;
  const config = MODULE_CONFIG[moduleName];

  // inventory 和 orders 走特殊导出逻辑，不需要在 MODULE_CONFIG 中
  if (!config && moduleName !== 'inventory' && moduleName !== 'orders') {
    return error(res, '不支持的模块', 400);
  }

  try {
    // 特殊处理库存模块
    if (moduleName === 'inventory') {
      const [rows] = await pool.execute(`
        SELECT p.product_code, p.product_name, p.specification, p.unit,
               COALESCE(i.quantity, 0) as quantity, p.category
        FROM products p
        LEFT JOIN inventory i ON p.product_id = i.product_id
        WHERE p.status = 1
        ORDER BY p.created_at DESC
      `);
      const headers = ['商品编码', '商品名称', '规格', '单位', '库存数量', '分类'];
      const data = rows.map(r => [r.product_code, r.product_name, r.specification, r.unit, Number(r.quantity), r.category]);
      const aoa = [headers, ...data];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '库存数据');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=inventory_${Date.now()}.xlsx`);
      return res.send(buffer);
    }

    // 特殊处理订单模块
    if (moduleName === 'orders') {
      const [rows] = await pool.execute(`
        SELECT o.order_id, o.order_type, o.customer_name, o.customer_phone,
               o.customer_address, o.order_amount, o.delivery_fee, o.total_receivable,
               o.delivery_type, o.remark, o.created_at,
               w.worker_name AS creator_name,
               dw.worker_name AS delivery_staff_name
        FROM orders o
        LEFT JOIN workers w ON o.created_by = w.worker_id
        LEFT JOIN workers dw ON o.worker_id = dw.worker_id
        ORDER BY o.created_at DESC
      `);
      const orderTypeMap = { 1: '官方平台销售', 2: '直营水站销售', 3: '线下零售', 4: '量贩机供货', 6: '零售机供货' };
      const deliveryMap = { 1: '自有员工配送', 2: '水站配送', 3: '无需配送', 4: '零售机配送' };

      // 查询所有订单的商品明细
      const orderIds = rows.map(r => r.order_id);
      let itemsMap = {};
      if (orderIds.length > 0) {
        const placeholders = orderIds.map(() => '?').join(',');
        const [items] = await pool.execute(
          `SELECT oi.order_id, oi.quantity, oi.unit_price, oi.subtotal,
                  p.product_name, p.product_code, p.specification, p.unit
           FROM order_items oi
           LEFT JOIN products p ON oi.product_id = p.product_id
           WHERE oi.order_id IN (${placeholders})
           ORDER BY oi.item_id ASC`,
          orderIds
        );
        for (const item of items) {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push(item);
        }
      }

      const headers = ['订单号', '订单类型', '客户姓名', '客户电话', '客户地址',
                       '商品编码', '商品名称', '规格', '单位', '数量', '单价', '小计',
                       '订单金额', '配送费', '应收总额', '配送方式', '配送员工', '备注', '创建人', '创建时间'];
      const data = [];
      for (const r of rows) {
        const items = itemsMap[r.order_id] || [];
        if (items.length === 0) {
          data.push([
            r.order_id,
            orderTypeMap[r.order_type] || r.order_type,
            r.customer_name, r.customer_phone, r.customer_address,
            '', '', '', '', '', '', '',
            Number(r.order_amount), Number(r.delivery_fee), Number(r.total_receivable),
            deliveryMap[r.delivery_type] || r.delivery_type,
            r.delivery_staff_name || '',
            r.remark, r.creator_name,
            r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''
          ]);
        } else {
          for (const item of items) {
            data.push([
              r.order_id,
              orderTypeMap[r.order_type] || r.order_type,
              r.customer_name, r.customer_phone, r.customer_address,
              item.product_code || '', item.product_name || '',
              item.specification || '', item.unit || '',
              Number(item.quantity), Number(item.unit_price) || 0, Number(item.subtotal) || 0,
              Number(r.order_amount), Number(r.delivery_fee), Number(r.total_receivable),
              deliveryMap[r.delivery_type] || r.delivery_type,
              r.delivery_staff_name || '',
              r.remark, r.creator_name,
              r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : ''
            ]);
          }
        }
      }
      const aoa = [headers, ...data];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = headers.map(() => ({ wch: 15 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '订单数据');
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.xlsx`);
      return res.send(buffer);
    }

    // 通用模块导出
    const [rows] = await pool.execute(`SELECT * FROM ${config.table} ORDER BY created_at DESC`);
    const headers = config.columns.map(c => c.header);
    const data = rows.map(row => config.columns.map(c => {
      let val = row[c.db];
      if (c.type === 'number') val = Number(val) || 0;
      return val !== null && val !== undefined ? val : '';
    }));
    const aoa = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = config.columns.map(() => ({ wch: 15 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '数据');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${moduleName}_${Date.now()}.xlsx`);
    return res.send(buffer);
  } catch (err) {
    console.error('导出失败:', err);
    return error(res, '导出失败: ' + err.message);
  }
}

// ===== 导入 =====
async function importData(req, res) {
  const moduleName = req.params.module;
  const config = MODULE_CONFIG[moduleName];

  // 订单和库存模块有特殊处理，不需要在 MODULE_CONFIG 中
  if (!config && moduleName !== 'orders' && moduleName !== 'inventory') {
    return error(res, '不支持的模块', 400);
  }

  if (!req.file) {
    return error(res, '请选择要导入的Excel文件', 400);
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (jsonData.length === 0) {
      return error(res, 'Excel文件中没有数据', 400);
    }

    // 特殊处理订单模块
    if (moduleName === 'orders') {
      const orderTypeMap = { '官方平台销售': 1, '直营水站销售': 2, '线下零售': 3, '量贩机供货': 4, '零售机供货': 6 };
      const deliveryMap = { '自有员工配送': 1, '水站配送': 2, '无需配送': 3, '零售机配送': 4 };
      let inserted = 0;
      let updated = 0;
      let failed = 0;

      for (const row of jsonData) {
        try {
          const customerName = row['客户姓名'] || '';
          if (!customerName) { failed++; continue; }

          const orderTypeStr = row['订单类型'] || '';
          const orderType = orderTypeMap[orderTypeStr] || Number(orderTypeStr) || 1;
          const deliveryTypeStr = row['配送方式'] || '';
          const deliveryType = deliveryMap[deliveryTypeStr] || Number(deliveryTypeStr) || 1;
          const orderAmount = Number(row['订单金额']) || 0;
          const deliveryFee = Number(row['配送费']) || 0;
          const totalReceivable = Number(row['应收总额']) || (orderAmount + deliveryFee);
          const customerPhone = row['客户电话'] || '';
          const customerAddress = row['客户地址'] || '';
          const remark = row['备注'] || '';
          const creatorName = row['创建人'] || '';

          // 查找创建人ID
          let createdBy = null;
          if (creatorName) {
            const [workers] = await pool.execute('SELECT worker_id FROM workers WHERE worker_name = ?', [creatorName]);
            if (workers.length > 0) createdBy = workers[0].worker_id;
          }

          const now = new Date();
          const orderId = row['订单号'] || '';

          // 检查订单是否已存在
          if (orderId) {
            const [existing] = await pool.execute('SELECT order_id FROM orders WHERE order_id = ?', [orderId]);
            if (existing.length > 0) {
              await pool.execute(
                `UPDATE orders SET order_type=?, customer_name=?, customer_phone=?, customer_address=?,
                 order_amount=?, delivery_fee=?, total_receivable=?, delivery_type=?, remark=?,
                 created_by=?, updated_at=? WHERE order_id=?`,
                [orderType, customerName, customerPhone, customerAddress,
                 orderAmount, deliveryFee, totalReceivable, deliveryType, remark,
                 createdBy, now, orderId]
              );
              updated++;
              continue;
            }
          }

          // 生成新订单号
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const prefix = `SZX${year}${month}${day}`;
          const [maxRows] = await pool.execute(
            'SELECT order_id FROM orders WHERE order_id LIKE ? ORDER BY order_id DESC LIMIT 1',
            [`${prefix}%`]
          );
          let seq = 1;
          if (maxRows.length > 0) {
            const lastSeq = parseInt(maxRows[0].order_id.slice(prefix.length), 10);
            if (!isNaN(lastSeq)) seq = lastSeq + 1;
          }
          const newOrderId = `${prefix}${String(seq).padStart(5, '0')}`;

          await pool.execute(
            `INSERT INTO orders (order_id, order_type, customer_name, customer_phone, customer_address,
              order_amount, delivery_fee, total_receivable, delivery_type, remark, created_by, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newOrderId, orderType, customerName, customerPhone, customerAddress,
             orderAmount, deliveryFee, totalReceivable, deliveryType, remark, createdBy, now, now]
          );
          inserted++;
        } catch (e) {
          console.error('订单导入行失败:', e.message);
          failed++;
        }
      }
      return success(res, { inserted, updated, failed, total: jsonData.length },
        `导入完成：新增${inserted}条，更新${updated}条，失败${failed}条`);
    }

    // 特殊处理库存模块（只更新库存数量）
    if (moduleName === 'inventory') {
      let updated = 0;
      let failed = 0;
      for (const row of jsonData) {
        const code = row['商品编码'] || row['product_code'];
        const qty = Number(row['库存数量'] || row['quantity']);
        if (!code || isNaN(qty)) { failed++; continue; }
        const [products] = await pool.execute('SELECT product_id FROM products WHERE product_code = ?', [code]);
        if (products.length === 0) { failed++; continue; }
        const pid = products[0].product_id;
        const [inv] = await pool.execute('SELECT inventory_id FROM inventory WHERE product_id = ?', [pid]);
        const now = new Date();
        if (inv.length === 0) {
          const invId = 'INV' + Date.now() + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          await pool.execute('INSERT INTO inventory (inventory_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?)', [invId, pid, qty, now]);
        } else {
          await pool.execute('UPDATE inventory SET quantity = ?, updated_at = ? WHERE product_id = ?', [qty, now, pid]);
        }
        updated++;
      }
      return success(res, { updated, failed, total: jsonData.length }, `导入完成：更新${updated}条，失败${failed}条`);
    }

    // 通用模块导入
    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const row of jsonData) {
      try {
        // 构建 fieldValue 映射
        const fieldValueMap = {};
        let hasRequired = true;
        for (const col of config.columns) {
          let val = row[col.header] !== undefined ? row[col.header] : '';
          if (val === '' && col.default !== undefined) val = col.default;
          if (col.type === 'number') val = val === '' ? 0 : Number(val);
          fieldValueMap[col.db] = val;
          if (col.required && (val === '' || val === null || val === undefined)) {
            hasRequired = false;
          }
        }
        if (!hasRequired) { failed++; continue; }

        // 查找是否已存在（按matchField匹配）
        const matchVal = fieldValueMap[config.matchField];
        const [existing] = await pool.execute(
          `SELECT ${config.idField} FROM ${config.table} WHERE ${config.matchField} = ?`,
          [matchVal]
        );

        const now = new Date();
        if (existing.length > 0) {
          // 更新
          const setClauses = [];
          const values = [];
          for (const col of config.columns) {
            if (col.db === config.matchField) continue;
            setClauses.push(`${col.db} = ?`);
            values.push(fieldValueMap[col.db]);
          }
          setClauses.push('updated_at = ?');
          values.push(now);
          values.push(existing[0][config.idField]);
          await pool.execute(
            `UPDATE ${config.table} SET ${setClauses.join(', ')} WHERE ${config.idField} = ?`,
            values
          );
          updated++;
        } else {
          // 新增
          const id = config.generateId();
          const fields = [config.idField, ...config.columns.map(c => c.db), 'created_at', 'updated_at'];
          const placeholders = fields.map(() => '?').join(', ');
          const values = [id, ...config.columns.map(c => fieldValueMap[c.db]), now, now];
          await pool.execute(
            `INSERT INTO ${config.table} (${fields.join(', ')}) VALUES (${placeholders})`,
            values
          );
          inserted++;
        }
      } catch (e) {
        console.error('导入行失败:', e.message);
        failed++;
      }
    }

    return success(res, { inserted, updated, failed, total: jsonData.length },
      `导入完成：新增${inserted}条，更新${updated}条，失败${failed}条`);
  } catch (err) {
    console.error('导入失败:', err);
    return error(res, '导入失败: ' + err.message);
  }
}

// ===== 下载导入模板 =====
async function downloadTemplate(req, res) {
  const moduleName = req.params.module;

  // 库存模板
  if (moduleName === 'inventory') {
    const headers = ['商品编码', '商品名称', '规格', '单位', '库存数量', '分类'];
    const sample = ['SPBM001', '农夫山泉饮用天然水', '550ml', '瓶', 100, '饮用水'];
    const aoa = [headers, sample];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 15 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '导入模板');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=template_${moduleName}.xlsx`);
    return res.send(buffer);
  }

  // 订单模板
  if (moduleName === 'orders') {
    const headers = ['订单号', '订单类型', '客户姓名', '客户电话', '客户地址', '订单金额', '配送费', '应收总额', '配送方式', '备注', '创建人'];
    const sample = ['', '官方平台销售', '张三', '13800138000', '南京市XX区XX路', 100.00, 10.00, 110.00, '自有员工配送', '备注信息', '管理员'];
    const aoa = [headers, sample];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map(() => ({ wch: 15 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '导入模板');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=template_${moduleName}.xlsx`);
    return res.send(buffer);
  }

  const config = MODULE_CONFIG[moduleName];
  if (!config) {
    return error(res, '不支持的模块', 400);
  }

  const headers = config.columns.map(c => c.header);
  const sample = config.columns.map(c => {
    if (c.type === 'number') return c.default !== undefined ? c.default : 0;
    return '';
  });
  const aoa = [headers, sample];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = config.columns.map(() => ({ wch: 15 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '导入模板');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=template_${moduleName}.xlsx`);
  return res.send(buffer);
}

module.exports = {
  upload,
  exportData,
  importData,
  downloadTemplate
};

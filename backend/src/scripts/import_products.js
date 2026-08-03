const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

const excelPath = path.join(__dirname, '../../../商品档案/(商品档案)表格视图.xlsx');
const imageFolder = path.join(__dirname, '../../../商品档案/商品图片');

function generateId() {
  return 'P' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function extractImageCode(imgFormula) {
  if (!imgFormula || typeof imgFormula !== 'string') return null;
  const match = imgFormula.match(/ID_([A-F0-9]+)/);
  return match ? match[1] : null;
}

function findImageFile(productCode) {
  const fileName = `${productCode}_image.png`;
  const filePath = path.join(imageFolder, fileName);
  if (fs.existsSync(filePath)) {
    return `/product_images/${fileName}`;
  }
  return null;
}

function parseProductName(name) {
  let category = '其他';
  if (name.includes('天然水') || name.includes('天然矿泉水') || name.includes('矿泉水') || name.includes('饮用纯净水') || name.includes('饮用天然水')) {
    category = '饮用水';
  } else if (name.includes('茶') || name.includes('乌龙') || name.includes('红茶') || name.includes('绿茶') || name.includes('茉莉花') || name.includes('东方树叶')) {
    category = '茶饮料';
  } else if (name.includes('果汁') || name.includes('橙汁') || name.includes('鲜果橙') || name.includes('NFC') || name.includes('果味')) {
    category = '果汁饮料';
  } else if (name.includes('咖啡') || name.includes('拿铁') || name.includes('黑咖')) {
    category = '咖啡饮料';
  } else if (name.includes('功能') || name.includes('力量帝') || name.includes('维他命')) {
    category = '功能饮料';
  } else if (name.includes('苏打') || name.includes('气泡')) {
    category = '气泡水';
  } else if (name.includes('奶') || name.includes('酸奶') || name.includes('牛乳')) {
    category = '乳饮料';
  } else if (name.includes('米') || name.includes('香米')) {
    category = '粮食';
  } else if (name.includes('橙') || name.includes('鲜果')) {
    category = '水果';
  }
  return category;
}

function extractUnit(specification) {
  if (!specification) return '箱';
  if (specification.includes('入') || specification.includes('瓶')) return '箱';
  if (specification.includes('桶')) return '桶';
  if (specification.includes('袋')) return '袋';
  return '箱';
}

async function importProducts() {
  console.log('========== 商品数据导入开始 ==========\n');

  try {
    if (!fs.existsSync(excelPath)) {
      console.error('错误：Excel文件不存在:', excelPath);
      return;
    }

    console.log('1. 读取Excel文件...');
    const workbook = XLSX.readFile(excelPath, { cellFormula: true, cellHTML: false, cellNF: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });

    console.log(`   共读取到 ${data.length - 1} 条商品记录\n`);

    const connection = await pool.getConnection();
    console.log('2. 数据库连接成功\n');

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    const failedProducts = [];

    console.log('3. 开始导入商品...\n');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const productCode = row[0];
      const productName = row[2];
      const specification = row[3];

      if (!productCode || !productName) {
        skipCount++;
        continue;
      }

      try {
        const [existing] = await connection.query(
          'SELECT product_id FROM products WHERE product_code = ?',
          [productCode]
        );

        if (existing.length > 0) {
          skipCount++;
          console.log(`   跳过已存在: ${productCode} - ${productName}`);
          continue;
        }

        const productId = generateId();
        const category = parseProductName(productName);
        const unit = extractUnit(specification);
        const imageUrl = findImageFile(productCode);

        await connection.query(
          `INSERT INTO products (
            product_id, product_code, product_name, specification, unit,
            purchase_price, wholesale_price, retail_price, machine_price,
            total_delivery_fee, distribution_delivery_fee,
            worker_retail_delivery_fee, worker_wholesale_delivery_fee, worker_machine_delivery_fee,
            category, image_url, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?, 1, NOW(), NOW())`,
          [productId, productCode, productName, specification, unit, category, imageUrl]
        );

        await connection.query(
          'INSERT INTO inventory (product_id, quantity, updated_at) VALUES (?, 0, NOW())',
          [productId]
        );

        successCount++;
        console.log(`   导入成功: ${productCode} - ${productName}`);

      } catch (err) {
        failCount++;
        failedProducts.push({ code: productCode, name: productName, error: err.message });
        console.error(`   导入失败: ${productCode} - ${productName}`, err.message);
      }
    }

    connection.release();

    console.log('\n========== 导入完成 ==========');
    console.log(`成功: ${successCount} 条`);
    console.log(`跳过: ${skipCount} 条`);
    console.log(`失败: ${failCount} 条`);

    if (failedProducts.length > 0) {
      console.log('\n失败详情:');
      failedProducts.forEach(p => {
        console.log(`  - ${p.code} ${p.name}: ${p.error}`);
      });
    }

    console.log('\n================================');

  } catch (error) {
    console.error('导入过程出错:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

importProducts();

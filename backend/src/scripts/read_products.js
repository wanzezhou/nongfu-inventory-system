const { readSheetAoa } = require('../utils/excel');
const path = require('path');

const excelPath = path.join(__dirname, '../../../商品档案/(商品档案)表格视图.xlsx');

(async () => {
const data = await readSheetAoa(excelPath);

console.log('商品总数:', data.length - 1);
console.log('\n表头:', JSON.stringify(data[0]));

console.log('\n===== 查看前15个商品的所有列原始值 =====');
for (let i = 1; i <= Math.min(15, data.length - 1); i++) {
  const row = data[i];
  console.log(`\n行${i} (${row[0]}):`);
  console.log(`  列0(文本): ${JSON.stringify(row[0])}`);
  console.log(`  列1(商品图片): ${JSON.stringify(row[1])}`);
  console.log(`  列2(商品名称): ${JSON.stringify(row[2])}`);
  console.log(`  列3(规格): ${JSON.stringify(row[3])}`);
  console.log(`  列4(进货价): ${JSON.stringify(row[4])}`);
  console.log(`  列5(分销价): ${JSON.stringify(row[5])}`);
  console.log(`  列6(总配送费): ${JSON.stringify(row[6])}`);
  console.log(`  列7(分销配送费): ${JSON.stringify(row[7])}`);
}

console.log('\n\n===== 检查第4-7列有没有任何值 =====');
for (let col = 4; col <= 7; col++) {
  let hasValue = 0;
  let sampleValue = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][col] !== null && data[i][col] !== undefined && data[i][col] !== '') {
      hasValue++;
      if (!sampleValue) sampleValue = data[i][col];
    }
  }
  console.log(`列${col}: 有值的行数 = ${hasValue}, 示例值 = ${JSON.stringify(sampleValue)}`);
}

console.log('\n\n===== 查看最后10行 =====');
for (let i = Math.max(1, data.length - 10); i < data.length; i++) {
  console.log(`行${i}: ${JSON.stringify(data[i])}`);
}
})();

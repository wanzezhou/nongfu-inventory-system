// 遍历 mini-program 下所有 .js 和 .json，检查语法
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../../../mini-program');
const jsFail = [];
const jsonFail = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) {
      try {
        const code = fs.readFileSync(full, 'utf8');
        new vm.Script(code, { filename: full });
      } catch (err) { jsFail.push(full + ' :: ' + err.message); }
    } else if (e.name.endsWith('.json')) {
      try {
        JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (err) { jsonFail.push(full + ' :: ' + err.message); }
    }
  }
}

walk(root);
console.log('JS checked:', 'OK, fail=' + jsFail.length);
jsFail.forEach(f => console.log('  JS FAIL: ' + f));
console.log('JSON checked:', 'OK, fail=' + jsonFail.length);
jsonFail.forEach(f => console.log('  JSON FAIL: ' + f));
process.exit(jsFail.length + jsonFail.length > 0 ? 1 : 0);

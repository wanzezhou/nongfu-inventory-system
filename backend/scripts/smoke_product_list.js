/**
 * 冒烟：商品 —— Web 端列表筛选分支 + 图片上传的拒绝路径（补齐既有覆盖缺口）
 * ---------------------------------------------------------------------------
 * 为什么补它：`productController.getProductList` 的筛选逻辑此前**没有任何冒烟覆盖**。
 * 2026-09-21 为小程序 Phase 8b 抽出 `buildProductListWhere`（Web 与小程序共用）时才发现 ——
 * 与 `expenseController` 是同一类情况：**重构在没有防线的情况下做了**。
 * 上次（支出域）只留了一句"已知缺口"，这次直接补上，不留欠账。
 *
 * ⚠️ 本域筛选里有个容易写错的细节：`status` 的**空串表示「不限」**（而不是"查 status 为空"）。
 *    如果哪天有人把判断从 `status !== undefined && status !== ''` 改成 `if (status)`，
 *    `status=0`（查停用商品）会**静默变成不限** —— 界面看起来正常，只是筛选失效了。
 *    故这里用「status=1 的条数 + status=0 的条数 == 不限的条数」把它钉死。
 *
 * ⚠️ 图片上传只测**拒绝路径**：磁盘存储下 multer 会「先落盘再校验大小」，
 *    历史上每被拒一次就留一个孤儿文件（真实发生过，见 productController 注释）。
 *    所以断言必须同时覆盖「返回 400」与「目录里没有多出文件」两件事。
 *
 * 只读冒烟（上传走的是会被拒绝的请求，不落盘）：不写库、不产生残留。
 * 运行：node scripts/smoke_product_list.js（需后端已启动）
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:3000/api';

const { pool } = require('../src/config/db');

const IMAGE_DIR = path.join(__dirname, '../../商品档案/商品图片');

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { ...json, _status: res.status };
}

let pass = 0;
let fail = 0;
function assert(cond, name, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? '  → ' + extra : ''}`);
  }
}

function dirFileCount() {
  try {
    return fs.readdirSync(IMAGE_DIR).length;
  } catch (e) {
    return -1;
  }
}

(async () => {
  console.log('\n0. 登录取管理员令牌');
  const login = await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert(!!(login.data && login.data.token), '管理员登录成功');
  const token = login.data && login.data.token;
  if (!token) {
    console.log('\n（无令牌，无法继续）');
    console.log(`结果：${pass} 通过 / ${fail} 失败`);
    await pool.end();
    process.exit(1);
  }

  console.log('\n1. 鉴权');
  const noAuth = await call('GET', '/products');
  assert(
    noAuth._status === 401 && noAuth.code === 401,
    `无 token → HTTP 401 + 信封 code 401：HTTP ${noAuth._status} code ${noAuth.code}`
  );

  console.log('\n2. 基础分支');
  const all = await call('GET', '/products?page=1&pageSize=5', null, token);
  assert(all._status === 200, `无筛选 → 200：${all._status}`);
  assert(
    Array.isArray(all.data && all.data.list) && typeof all.data.total === 'number',
    '响应含 { list, total }',
    JSON.stringify(all.data || {}).slice(0, 160)
  );
  assert(
    Array.isArray(all.data.list) && all.data.list.length <= 5,
    `pageSize=5 生效：${(all.data.list || []).length} 条`
  );

  console.log('\n3. ⚠️ status 的三态（空串=不限，0 也要能查出来）');
  const st1 = await call('GET', '/products?status=1&pageSize=1', null, token);
  const st0 = await call('GET', '/products?status=0&pageSize=1', null, token);
  const stEmpty = await call('GET', '/products?status=&pageSize=1', null, token);
  const stAbsent = await call('GET', '/products?pageSize=1', null, token);
  assert(st1._status === 200 && st0._status === 200, `status=1/0 均 200：${st1._status}/${st0._status}`);
  assert(
    Number(st1.data.total) + Number(st0.data.total) === Number(stAbsent.data.total),
    `启用 + 停用 = 不限（筛选划分完备）：${st1.data.total} + ${st0.data.total} = ${stAbsent.data.total}`
  );
  assert(
    Number(stEmpty.data.total) === Number(stAbsent.data.total),
    `status=空串与不传等价（都是"不限"，不是"查空值"）：${stEmpty.data.total} vs ${stAbsent.data.total}`
  );

  console.log('\n4. keyword / category 筛选');
  const [sample] = await pool.query(
    'SELECT product_name, product_code, category FROM products WHERE status = 1 ORDER BY created_at DESC LIMIT 1'
  );
  if (sample.length) {
    const kwName = await call(
      'GET',
      '/products?keyword=' + encodeURIComponent(sample[0].product_name.slice(0, 4)) + '&pageSize=5',
      null,
      token
    );
    assert(kwName._status === 200, `keyword（名称片段）→ 200：${kwName._status}`);
    assert(Number(kwName.data.total) >= 1, `关键词能命中已存在商品：命中 ${kwName.data.total} 条`);

    const byCode = await call(
      'GET',
      '/products?keyword=' + encodeURIComponent(sample[0].product_code) + '&pageSize=5',
      null,
      token
    );
    assert(
      (byCode.data.list || []).some(p => p.code === sample[0].product_code),
      `keyword 也能按商品编码命中（不是只搜名称）：${sample[0].product_code}`
    );

    if (sample[0].category) {
      const cat = await call(
        'GET',
        '/products?category=' + encodeURIComponent(sample[0].category) + '&pageSize=10',
        null,
        token
      );
      assert(cat._status === 200, `category → 200：${cat._status}`);
      const allMatch = (cat.data.list || []).length
        ? (cat.data.list || []).every(p => p.category === sample[0].category)
        : true;
      assert(allMatch, `category 结果只含该类别（样本 ${(cat.data.list || []).length} 条）`);
      if (!(cat.data.list || []).length) {
        console.log('  ⓘ 注意：该类别下 0 条，此断言为空转（形式正确 ≠ 有效）');
      }
    }
  } else {
    console.log('  ⓘ 库中无启用商品，跳过 keyword/category（不空转账面断言）');
  }

  console.log('\n5. 组合筛选');
  const combo = await call('GET', '/products?status=1&pageSize=3&page=1', null, token);
  assert(combo._status === 200, `status + 分页组合 → 200：${combo._status}`);
  assert(Array.isArray(combo.data.list), '返回 list 数组');

  console.log('\n6. 分类选项接口（与列表同一段取数）');
  const cats = await call('GET', '/products/categories', null, token);
  assert(cats._status === 200, `GET /products/categories → 200：${cats._status}`);
  assert(Array.isArray(cats.data), '返回数组', JSON.stringify(cats.data || {}).slice(0, 120));

  console.log('\n7. ⚠️ 图片上传的拒绝路径（不得留孤儿文件）');
  const before = dirFileCount();
  assert(before >= 0, `可读取图片目录（当前 ${before} 个文件）`);

  // 非图片：fileFilter 必须在写盘前拒绝
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'smoke.txt');
  const badUpload = await fetch(BASE + '/products/upload-image', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: fd
  });
  const badJson = await badUpload.json().catch(() => ({}));
  assert(badUpload.status === 400, `非图片类型被拒（400，而不是 500「服务器内部错误」）：HTTP ${badUpload.status}`);
  assert(/图片|png|jpg|webp/i.test(String(badJson.message || '')), `拒绝文案说明格式要求：${badJson.message}`);

  const after = dirFileCount();
  assert(after === before, `被拒的上传没有留下孤儿文件（${before} → ${after}）`);

  // 无文件：必须给出 400 而不是 500
  const emptyUpload = await fetch(BASE + '/products/upload-image', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert(emptyUpload.status === 400, `未带文件被拒（400）：HTTP ${emptyUpload.status}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async e => {
  console.error('冒烟执行异常:', e);
  try {
    await pool.end();
  } catch (err) {
    /* 忽略 */
  }
  process.exit(1);
});

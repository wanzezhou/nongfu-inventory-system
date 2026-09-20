/**
 * ESLint 扁平配置（ESLint 9+）—— 农夫山泉经销商进销存系统
 * =====================================================================
 * 设计原则（见 docs/代码审查标准.md）：
 *   1. 只写这个项目真正踩过的坑，不抄通用最佳实践清单
 *   2. 能用机器判的绝不用人眼看
 *   3. 判"错"优先于判"丑"——格式交给 Prettier
 *
 * 本配置的核心是「项目红线规则」（PROJECT_HAZARDS）：每一条都指向
 * 一次真实事故或历史缺陷，目的是让同类缺陷**在提交时就被拦下**，
 * 而不是靠评审者记得。历史证据：F6（下拉取前 100 条）修了 OrderList，
 * 同类仍残留在 OrderFormDialog 5 处——不补门禁的修复会复发。
 *
 * 用法：
 *   npx eslint .            # 全量
 *   npx eslint . --fix      # 自动修可修项
 * 安装依赖见 docs/代码审查流程.md 第八章
 */
import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

/**
 * 项目红线规则集合（R1–R7），前后端共用。
 * 严重度策略：会直接造成「静默错数据 / 掩盖失败」的设为 error（阻断），
 * 其余为 warn（记录但不阻断），避免上线首日因历史存量告警被整体关闭。
 */
const PROJECT_HAZARDS = {
  'no-restricted-syntax': [
    'error',
    // ── R1 禁止 mock / 假数据兜底 ──────────────────────────────
    // 出处：历史缺陷 F2（6 个页面在接口失败时把伪造数据塞进表格，
    //       用户会把测试假单当真实业务数据用于备货对账）
    {
      selector:
        'Identifier[name=/^(generateMockData|mockData|mockList|mockOrders|mockProducts|mockStations|mockWorkers|fakeData|FAKE_)/]',
      message: '[R1] 禁止 mock/假数据兜底：接口失败应展示空表 + 报错，不得用伪造数据让流程"看起来跑通"（历史缺陷 F2）。'
    },
    // ── R2 catch 分支中报「成功」──────────────────────────────
    // 出处：历史缺陷 F1（出库失败仍提示"出库成功"并关闭对话框）
    {
      selector: "CatchClause CallExpression[callee.object.name='ElMessage'][callee.property.name='success']",
      message:
        '[R2] catch 分支中出现「成功」提示：操作失败却告知用户成功（历史缺陷 F1）。失败分支必须改变用户可感知状态。'
    },
    // ── R2' 空 catch ──────────────────────────────────────────
    // 由下方 COMMON_RULES 的 `no-empty`（allowEmptyCatch: false）以 error 级别拦截，
    // 此处不重复声明，避免同一问题出两条告警。
    // ── R3 禁止 SELECT * ──────────────────────────────────────
    // 出处：历史 37 处 SELECT *（拖网络与内存；列变更时隐式耦合）
    {
      selector: 'TemplateElement[value.raw=/select\\s+\\*\\s+from/i]',
      message: '[R3] 禁止 SELECT *：请显式列出字段（拖网络与内存 + 列变更隐式耦合）。'
    },
    // ── R5 禁止硬编码取数上限 ─────────────────────────────────
    // 出处：本轮发现 20 处 pageSize 魔数（值域 10/100/200/500/999）。
    //       CostSummary.vue:169 的 pageSize:500 会让成本汇总静默少算（资金口径错误）。
    //       历史 F6 的同类在 OrderFormDialog 复发 5 处。
    // ⚠️ 2026-09-18 修正：原选择器「只要是 Literal 就判红」，于是 pageSize: 10 这类
    //    **正常分页默认值**也被判红（6 处误报，与规则注释自相矛盾）。
    //    阈值改为 ≥100，与 scripts/check-diff-hazards.mjs 的 R5 对齐 —— 两处规则同名同义
    //    却阈值不同，本身就是隐患（扫描器上轮已改，eslint 侧漏改）。
    {
      selector: "Property[key.name='pageSize'][value.type='Literal'][value.value>=100]",
      message:
        '[R5] 硬编码取数上限：超限即静默少算（S1 静默错数据）。下拉/选项类数据请走专用轻量接口或远程搜索；确需上限时必须向用户显式提示。'
    },
    {
      selector: "Property[key.name='limit'][value.type='Literal'][value.value>=100]",
      message: '[R5] 硬编码 limit：确认是否会造成"静默截断"，超限须显式提示用户。'
    },
    // ── R7 禁止绕过统一响应工具 ───────────────────────────────
    // ⚠️ 只用于**服务端**（backend/src）。2026-09-18 修正：此规则原放在前后端共用集合里，
    //    导致 backend/scripts 下 11 处「解析响应」被误判 —— 冒烟脚本里 `res.json()` 是
    //    读取 fetch 响应的方法，与「用 res.json 发响应」是两回事。
    //    故 R7 已移出本集合，单独作用于 backend/src（见下方 SERVER_ONLY）。
    // ── R4 禁止把内部错误详情返回客户端 ───────────────────────
    // 出处：历史缺陷 S7（把 err.message 拼进文案直出，泄露表结构/路径/库名）
    // ⚠️ 本规则历经两次误报修正，过程值得记下：
    //    ① 原选择器 `BinaryExpression[operator='+']` 过宽 —— 把
    //       `error(res, '库存不足，当前库存: ' + currentQuantity)` 这类**业务数值拼接**判红；
    //    ② 收窄为 `MemberExpression[property.name='message']` 后又过宽 —— 把项目**刻意采用**的
    //       bizFail 模式 `if (err.business) return error(res, err.message, 400)` 全判红（26 处）。
    //    最终形态＝"拼接 + 拼接项里含 .message/.stack/.sql"，即 S7 的原始形态。
    //    说明：`error(res, err.message, 500)` 这种**不拼接**的写法无需拦 —— response.js
    //    已在生产环境把 5xx 文案替换为固定文案（那才是防泄露的主防线，规则只是补一层）。
    {
      selector:
        "CallExpression[callee.name='error'] > BinaryExpression[operator='+'] MemberExpression[property.name=/^(message|stack|sql)$/]",
      message:
        '[R4] 把 err.message / SQL 原文**拼接**进客户端响应：内部错误详情只进日志（历史缺陷 S7）。业务文案请直接传 err.message 并走 bizFail。'
    }
  ]
};

/**
 * 仅服务端适用的红线规则。
 * 与 PROJECT_HAZARDS 分开的原因：其中有些规则的对象（如 `res`）在客户端/脚本里同形不同义，
 * 混用会产生系统性误报——而误报会训练人忽略告警，最终让规则失效。
 */
const SERVER_ONLY_HAZARDS = {
  // ── R7 禁止绕过统一响应工具 ───────────────────────────────
  // 出处：响应语义出现过两套（HTTP 状态码口径分裂），故统一走 utils/response.js
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='res'][callee.property.name='json']",
      message:
        '[R7] 请走 utils/response.js 的 success/error/pagination，避免出现第二套响应语义（含 HTTP 状态码口径分裂）。'
    }
  ]
};

/**
 * 由红线集合派生规则，可按场景增删个别条目。
 * 例：`hazardRule({ allowSelectStar: true })` 用于冒烟/诊断脚本（见文件末尾说明）。
 *
 * 之所以要"派生"而不是把规则列表复制一份：
 *   ① 复制会立刻产生两处需同步维护的定义，下次调阈值必然只改一处
 *      —— 本文件 R5 的阈值就出现过这种不同步（扫描器改了、eslint 侧漏改）；
 *   ② `no-restricted-syntax` 是**同一个规则 id**：在后面的配置块里再次声明会**整体覆盖**
 *      而不是合并。2026-09-18 就因此让 backend/src 悄悄丢掉了 R1–R5（只留下服务端专属那条），
 *      而 eslint 依旧"有个规则在跑"，从输出上看不出规则已经消失。
 *      所以服务端专属规则也必须经本函数显式合并，不得单独成块。
 */
function hazardRule({ allowSelectStar = false, serverOnly = false } = {}) {
  const [level, ...selectors] = PROJECT_HAZARDS['no-restricted-syntax'];
  const kept = selectors.filter(s => !(allowSelectStar && String(s.message).startsWith('[R3]')));
  const extra = serverOnly ? SERVER_ONLY_HAZARDS['no-restricted-syntax'].slice(1) : [];
  return { 'no-restricted-syntax': [level, ...kept, ...extra] };
}

/** 通用规则（与项目无关的基础卫生） */
const COMMON_RULES = {
  'no-unused-vars': [
    'warn',
    { args: 'after-used', argsIgnorePattern: '^_|^next$', varsIgnorePattern: '^_', caughtErrors: 'none' }
  ],
  'no-var': 'error',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'smart'],
  'no-debugger': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  // 中文文案里的全角空格是合法的排版手段，只在代码区判红（2026-09-18 起）
  'no-irregular-whitespace': [
    'error',
    { skipComments: true, skipStrings: true, skipTemplates: true, skipRegExps: true }
  ],
  'no-unreachable': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-self-assign': 'error',
  'no-useless-escape': 'warn',
  'no-prototype-builtins': 'warn',
  'no-fallthrough': 'error',
  'valid-typeof': 'error',
  // 本项目大量 async 聚合场景下误报率高，保持关闭
  'require-atomic-updates': 'off'
};

export default [
  // ─────────────────────────── 忽略范围 ───────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'backend/uploads/**',
      '商品档案/**',
      'database/**',
      '.ui-shots/**',
      '.workbuddy/**',
      '**/*.min.js',
      'frontend/vite.config.js.timestamp-*'
    ]
  },

  // ─────────────────── 基础推荐规则（全仓）───────────────────────
  js.configs.recommended,
  {
    rules: { ...COMMON_RULES }
  },

  // ─────────────────── 后端：Node + CommonJS ────────────────────
  {
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      ...PROJECT_HAZARDS
    }
  },

  // 后端 src：限制 console 使用（应走正式日志，见标准 #8）+ 服务端专属红线（R7）
  // ⚠️ 必须用 hazardRule({ serverOnly: true }) 与项目红线**合并**：
  //    直接写 `...SERVER_ONLY_HAZARDS` 会让同名规则 no-restricted-syntax 整体覆盖掉 R1–R5。
  {
    files: ['backend/src/**/*.js'],
    rules: {
      ...hazardRule({ serverOnly: true }),
      'no-console': ['warn', { allow: ['error', 'warn'] }]
    }
  },

  /* 后端 scripts：CLI 脚本，允许 console.log 输出进度；R7 亦不适用（那里的 res 是响应对象） */

  // 根目录 scripts：门禁脚本，运行于 Node
  // ⚠️ 2026-09-18 补：此前没有任何配置块覆盖根 scripts/，导致 check-diff-hazards.mjs 里的
  //    process / console 被 no-undef 判红（16 处误报）——自家门禁脚本反而"不通过门禁"。
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-console': 'off'
    }
  },

  // 后端 controllers/services：禁止横向 import 当工具库（历史问题 A2）
  // 注意：仅约束 controllers/services 内部，routes 导入 controller 是合法的，不在此列。
  {
    files: ['backend/src/controllers/**/*.js', 'backend/src/services/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['**/controllers/*', './*Controller*', '../controllers/*'],
              message: '禁止从其他 controller 横向导入工具函数：请下沉到 utils/ 或 services/（历史问题 A2）。'
            }
          ]
        }
      ]
    }
  },

  // ─────────────────── 前端：Vue 3 + ESM ────────────────────────
  ...pluginVue.configs['flat/essential'],

  {
    files: ['frontend/src/**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    rules: {
      ...PROJECT_HAZARDS,
      // 本项目页面文件即组件名，无需强制多词
      'vue/multi-word-component-names': 'off',
      'vue/no-unused-components': 'warn',
      'vue/no-unused-vars': 'warn',
      'vue/no-mutating-props': 'error',
      'vue/require-v-for-key': 'error',
      'vue/no-dupe-keys': 'error',
      'vue/no-side-effects-in-computed-properties': 'warn',
      'vue/no-template-shadow': 'warn',
      'vue/require-default-prop': 'off'
    }
  },

  // 组件层禁止裸 axios：必须走 src/api/*（标准 5.4）
  // ⚠️ 2026-09-18 修正：原规则挂在 frontend/src/** 上，把 src/api/request.js 自己
  //    （axios 的封装层，唯一允许 import axios 的地方）也判红了 —— 规则把"例外"给禁了。
  //    故收窄到只有视图/组件/布局三层。
  {
    files: ['frontend/src/views/**', 'frontend/src/components/**', 'frontend/src/layout/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'axios',
              message: '禁止在组件中直接使用 axios：请新增/复用 src/api/*.js 中的接口封装（标准 5.4）。'
            }
          ]
        }
      ]
    }
  },

  // 前端脚本与构建配置：Node 环境运行，放开 console / import 限制
  {
    files: ['frontend/scripts/**/*.{js,mjs}', 'frontend/vite.config.js', 'frontend/*.config.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off'
    }
  },

  // ── 规则自身的例外（不是"豁免债务"，而是规则与被约束对象的关系）──────────
  // 这两条是 2026-09-18 首跑 lint 时暴露的「规则误伤自身」：
  // 把规则作用到了它唯一合法的实现上，会让门禁变成"永远不通过"的噪声源。
  {
    files: ['backend/src/utils/response.js'],
    rules: {
      // 本文件**就是** R7 要求大家使用的统一出口，其内部必然要调用 res.json。
      // 例外本身是规则定义的一部分，故直接关闭而非加注释豁免。
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['backend/scripts/**/*.js'],
    rules: {
      // R3（禁止 SELECT *）针对的是**生产查询路径**：拖网络内存 + 列变更隐式耦合。
      // 冒烟/诊断脚本读整行做快照与比对，加列后"读到新列"正是它要的效果，
      // 显式列举反而会静默漏读 —— 与本规则的初衷相反。故脚本内放行 R3，其余红线照旧。
      ...hazardRule({ allowSelectStar: true })
    }
  },

  // ── R3 存量豁免（逐文件列名，不得整目录放行）─────────────────────────────
  // 以下 6 处 `SELECT *` 是接手前就有的列表查询，位于**生产路径**上，属真实债务
  // （标准第三章 R3）。之所以豁免而非立刻改：把这些查询逐列展开需要核对每个字段的
  // 前端消费侧，属独立改动，混在门禁上线里做会让"门禁是否生效"无法验证。
  // ⚠️ 计划：下次触及这些接口时随功能改动顺手展开列名，并从此列表移除。
  // ⚠️ 新增代码不受此豁免影响：`scripts/check-diff-hazards.mjs --staged` 只判新增行，R3 依旧拦。
  {
    files: [
      'backend/src/controllers/machineStationController.js', // 机台列表
      'backend/src/controllers/productController.js', // 商品列表
      'backend/src/controllers/stationController.js', // 水站列表
      'backend/src/controllers/supplierController.js', // 供应商列表
      'backend/src/controllers/workerController.js', // 员工列表
      'backend/src/services/orderPricingService.js' // 订单定价取价
    ],
    rules: {
      ...hazardRule({ allowSelectStar: true })
    }
  },

  // ─────────── 微信小程序（2026-09-20 新增）───────────
  // 为什么必须显式配置：miniprogram/ 不在顶层 ignores 里，若不配 globals，
  // `wx` / `Page` / `App` / `Component` 会被 no-undef 判红 ——
  // 那样 `npm run lint`（= eslint . --max-warnings 40）会在小程序代码一落地就爆表，
  // 最终结果是有人把整个目录加进 ignores，反而失去对小程序的静态检查。
  // 同时保留 R1（禁止 mock 兜底）——小程序侧同样不允许接口失败时伪造数据。
  {
    files: ['miniprogram/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // 小程序宿主注入的全局对象
        wx: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        Behavior: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        requirePlugin: 'readonly',
        __wxConfig: 'readonly',
        // miniprogram/scripts/*.js 是 Node 校验脚本，需要 node 全局
        ...globals.node
      }
    },
    rules: {
      // 只并入与客户端代码真正相关的红线（R1 mock / R2 catch 报成功）。
      // 其余红线（R3 SELECT * / R5 取数上限 / R7 裸 res.json）面向 SQL 与后端 HTTP 出口，
      // 在小程序里没有对应物，硬套会制造无意义的规则噪音。
      // ⚠️ 必须把严重度 'error' 显式补回数组首位：
      //    PROJECT_HAZARDS['no-restricted-syntax'] 的形状是 ['error', {...}, ...]，
      //    直接 filter 会把首位的严重度字符串也滤掉，导致 ESLint 报「规则值形状非法」。
      'no-restricted-syntax': [
        'error',
        ...PROJECT_HAZARDS['no-restricted-syntax'].filter(item => {
          if (typeof item !== 'object' || item === null) return false;
          const msg = String(item.message || '');
          return msg.startsWith('[R1]') || msg.startsWith('[R2]');
        })
      ],
      // 小程序页面里 `catch (e) {}` 空捕获同样是「失败不可见」的来源
      'no-empty': ['error', { allowEmptyCatch: false }]
    }
  },

  // 小程序校验脚本（Node CLI）：允许 console 输出进度
  {
    files: ['miniprogram/scripts/**/*.js'],
    rules: {
      'no-console': 'off'
    }
  }

  // ─────────── 存量豁免区（须逐条注明原因与计划，禁止整目录豁免）───────────
  // 说明：历史巨页（>800 行）在拆分前如需保留个别告警，按下列形式逐文件豁免，
  //      并可度量的存量债务才叫债务。示例：
  //
  // {
  //   files: ['frontend/src/views/statistics/ProductSales.vue'],
  //   rules: {
  //     // 待拆分：表格 + ECharts 同页（标准 6.3）；计划随下次功能迭代抽子组件
  //     'no-restricted-syntax': 'warn'
  //   }
  // },
];

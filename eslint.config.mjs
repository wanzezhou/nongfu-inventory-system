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
import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'

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
        "Identifier[name=/^(generateMockData|mockData|mockList|mockOrders|mockProducts|mockStations|mockWorkers|fakeData|FAKE_)/]",
      message:
        '[R1] 禁止 mock/假数据兜底：接口失败应展示空表 + 报错，不得用伪造数据让流程"看起来跑通"（历史缺陷 F2）。'
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
    {
      selector: "Property[key.name='pageSize'][value.type='Literal']",
      message:
        '[R5] 硬编码取数上限：超限即静默少算（S1 静默错数据）。下拉/选项类数据请走专用轻量接口或远程搜索；确需上限时必须向用户显式提示。'
    },
    {
      selector: "Property[key.name='limit'][value.type='Literal']",
      message: '[R5] 硬编码 limit：确认是否会造成"静默截断"，超限须显式提示用户。'
    },
    // ── R7 禁止绕过统一响应工具 ───────────────────────────────
    {
      selector: "CallExpression[callee.object.name='res'][callee.property.name='json']",
      message:
        '[R7] 请走 utils/response.js 的 success/error/pagination，避免出现第二套响应语义（含 HTTP 状态码口径分裂）。'
    },
    // ── R4 禁止把内部错误详情返回客户端 ───────────────────────
    // 出处：历史缺陷 S7（err.message 直出，泄露表结构/路径/库名）
    {
      selector: "CallExpression[callee.name='error'] BinaryExpression[operator='+']",
      message: '[R4] 疑似把 err.message / SQL 原文拼进客户端响应：内部错误详情只进日志（历史缺陷 S7）。'
    }
  ]
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
  'no-unreachable': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-self-assign': 'error',
  'no-useless-escape': 'warn',
  'no-prototype-builtins': 'warn',
  'no-fallthrough': 'error',
  'valid-typeof': 'error',
  // 本项目大量 async 聚合场景下误报率高，保持关闭
  'require-atomic-updates': 'off'
}

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

  // 后端 src：限制 console 使用（应走正式日志，见标准 #8）
  {
    files: ['backend/src/**/*.js'],
    rules: {
      'no-console': ['warn', { allow: ['error', 'warn'] }]
    }
  },

  /* 后端 scripts：CLI 脚本，允许 console.log 输出进度 */

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
      // 组件内禁止裸 axios：必须走 src/api/*（标准 5.4）
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
      ],
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
]

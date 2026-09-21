// 主数据四域的前端字段配置（Phase 8b 第 4~7 域：供应商 / 员工 / 水站 / 机台）
// ===========================================================================
// 为什么用配置驱动而不是写 4 套页面：
//   这四页除了「字段清单」以外**完全一样**（列表筛选、编辑校验、幂等提交、删除确认）。
//   写 4 套 = 同一段交互逻辑复制 4 遍，而复制品会各自演化 —— 与后端抽 `_masterFactory.js`
//   是同一个理由。这里一份配置 + 一套页面覆盖 4 个域。
//
// ⚠️ 与后端 `controllers/mini/admin/masterDomains.js` 的字段清单必须一一对应：
//   key 就是提交给后端的 camelCase 字段名，多一个少一个都会表现为「保存后没生效」
//   或「后端 400 说某字段不能为空」，但前端界面上看不出哪里不对。
//
// ⚠️ 刻意**不放在这里**的字段：
//   · 水站的 `currentDebt`（未结欠款）—— 由下单/结算业务产生，手改会让欠款口径失去唯一来源。
//   · 所有域的 `id` / `createdAt` / `updatedAt` —— 只读。
// ===========================================================================

/** 枚举选项集中在此，避免同一个枚举在不同域里写出两套文案 */
const EMPLOYEE_TYPES = [
  { value: 1, label: '店长' },
  { value: 2, label: '配送' },
  { value: 3, label: '业务员' },
  { value: 4, label: '管理员' }
];
// ⚠️ 注意：业务员(3) 这一档与小程序登录绑定相关 —— 把员工类型从 3 改掉，
//    会让该员工的业务员端账号失去「业务员可售」能力（下单时按角色判定）。编辑页有提示。
const PAYMENT_TYPES = [
  { value: 0, label: '未设置' },
  { value: 1, label: '先付款后拿货' },
  { value: 2, label: '先拿货后付款' }
];
const MACHINE_TYPES = [
  { value: 1, label: '量贩机' },
  { value: 2, label: '零售机' }
];

const DOMAINS = {
  // ── 供应商 ──────────────────────────────────────────────────────────────────
  supplier: {
    key: 'supplier',
    label: '供应商',
    // ⚠️ 路径必须写成**字面量**，不要用 `base + '/' + id` 这类拼法：
    //    miniprogram/scripts/check-api-paths.js 是正则抽取，认不出拼接 ——
    //    实测后果是「整个域的接口在门禁里静默消失、交叉校验显示假通过」。
    routes: {
      list: '/admin/suppliers',
      detail: '/admin/suppliers/:id',
      create: '/admin/suppliers',
      update: '/admin/suppliers/:id',
      remove: '/admin/suppliers/:id'
    },
    nameKey: 'supplierName',
    summaryKeys: ['contactName', 'phone'],
    groups: [
      {
        title: '基本信息',
        fields: [
          { key: 'supplierName', label: '供应商名称', required: true, placeholder: '如 农夫山泉华东仓' },
          { key: 'contactName', label: '联系人' },
          { key: 'phone', label: '联系电话', type: 'digit' },
          { key: 'address', label: '地址' },
          { key: 'remark', label: '备注', type: 'textarea' }
        ]
      },
      {
        title: '银行信息',
        fields: [
          { key: 'bankName', label: '开户行' },
          { key: 'bankAccount', label: '银行账号', type: 'digit' },
          { key: 'accountName', label: '账户名称' }
        ]
      },
      {
        title: '开票信息',
        fields: [
          { key: 'invoiceTitle', label: '发票抬头' },
          { key: 'taxNumber', label: '税号', type: 'digit' }
        ]
      }
    ]
  },

  // ── 员工 / 业务员 ───────────────────────────────────────────────────────────
  worker: {
    key: 'worker',
    label: '员工',
    // ⚠️ 路径必须写成**字面量**，不要用 `base + '/' + id` 这类拼法：
    //    miniprogram/scripts/check-api-paths.js 是正则抽取，认不出拼接 ——
    //    实测后果是「整个域的接口在门禁里静默消失、交叉校验显示假通过」。
    routes: {
      list: '/admin/workers',
      detail: '/admin/workers/:id',
      create: '/admin/workers',
      update: '/admin/workers/:id',
      remove: '/admin/workers/:id'
    },
    nameKey: 'workerName',
    summaryKeys: ['phone', 'employeeTypeLabel'],
    groups: [
      {
        title: '基本信息',
        fields: [
          { key: 'workerName', label: '员工姓名', required: true, placeholder: '如 张三' },
          { key: 'phone', label: '联系电话', type: 'digit' },
          {
            key: 'employeeType',
            label: '员工类型',
            type: 'picker',
            required: true,
            options: EMPLOYEE_TYPES,
            hint: '业务员(3) 的员工才能用业务员小程序下单；改成其它类型会使其失去下单能力。'
          },
          { key: 'commissionRate', label: '提成比例(%)', type: 'digit' },
          {
            key: 'monthlySalary',
            label: '月薪(元)',
            type: 'digit',
            hint: '改月薪只影响将来的工资结算，已发放的历史工资单不受影响。'
          }
        ]
      },
      {
        title: '银行信息',
        fields: [
          { key: 'bankName', label: '开户行' },
          { key: 'bankAccount', label: '银行账号', type: 'digit' }
        ]
      }
    ]
  },

  // ── 水站 ────────────────────────────────────────────────────────────────────
  station: {
    key: 'station',
    label: '水站',
    // ⚠️ 路径必须写成**字面量**，不要用 `base + '/' + id` 这类拼法：
    //    miniprogram/scripts/check-api-paths.js 是正则抽取，认不出拼接 ——
    //    实测后果是「整个域的接口在门禁里静默消失、交叉校验显示假通过」。
    routes: {
      list: '/admin/stations',
      detail: '/admin/stations/:id',
      create: '/admin/stations',
      update: '/admin/stations/:id',
      remove: '/admin/stations/:id'
    },
    nameKey: 'stationName',
    summaryKeys: ['contactName', 'phone'],
    note: '未结欠款由下单与结算业务产生，不在本页编辑；需要修正欠款请走财务调账。',
    groups: [
      {
        title: '基本信息',
        fields: [
          { key: 'stationName', label: '水站名称', required: true, placeholder: '如 江宁直营水站' },
          { key: 'contactName', label: '联系人' },
          { key: 'phone', label: '联系电话', type: 'digit' },
          { key: 'address', label: '地址', hint: '水站下单时可选「使用档案地址」，此处填写能被直接带出。' },
          { key: 'area', label: '所属区域' },
          { key: 'creditLimit', label: '授信额度(元)', type: 'digit' },
          { key: 'paymentType', label: '结算方式', type: 'picker', options: PAYMENT_TYPES }
        ]
      },
      {
        title: '银行信息',
        fields: [
          { key: 'bankName', label: '开户行' },
          { key: 'bankAccount', label: '银行账号', type: 'digit' },
          { key: 'accountName', label: '账户名称' }
        ]
      },
      {
        title: '开票信息',
        fields: [
          { key: 'invoiceTitle', label: '发票抬头' },
          { key: 'taxNumber', label: '税号', type: 'digit' },
          { key: 'invoiceAddress', label: '开票地址' },
          { key: 'invoicePhone', label: '开票电话', type: 'digit' }
        ]
      }
    ]
  },

  // ── 机台（零售机 / 量贩机）──────────────────────────────────────────────────
  machine: {
    key: 'machine',
    label: '机台',
    // ⚠️ 路径必须写成**字面量**，不要用 `base + '/' + id` 这类拼法：
    //    miniprogram/scripts/check-api-paths.js 是正则抽取，认不出拼接 ——
    //    实测后果是「整个域的接口在门禁里静默消失、交叉校验显示假通过」。
    routes: {
      list: '/admin/machines',
      detail: '/admin/machines/:id',
      create: '/admin/machines',
      update: '/admin/machines/:id',
      remove: '/admin/machines/:id'
    },
    nameKey: 'stationName',
    summaryKeys: ['manager', 'machineTypeLabel'],
    note: '机台若有销量记录，删除会转为「停用」而非真删（销量记录需保留）。',
    groups: [
      {
        title: '基本信息',
        fields: [
          { key: 'stationName', label: '机台名称', required: true, placeholder: '如 江宁万达1号机' },
          { key: 'machineType', label: '机台类型', type: 'picker', required: true, options: MACHINE_TYPES },
          { key: 'address', label: '地址' },
          { key: 'manager', label: '负责人' },
          { key: 'managerPhone', label: '负责人电话', type: 'digit' }
        ]
      }
    ]
  }
};

const DOMAIN_KEYS = ['supplier', 'worker', 'station', 'machine'];

/** 取枚举的显示文案（找不到时显示原值，便于发现脏数据而不是显示空白） */
function optionLabel(options, value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  const found = options.find(o => o.value === n);
  return found ? found.label : `未知(${value})`;
}

function optionsOf(key) {
  if (key === 'employeeType') return EMPLOYEE_TYPES;
  if (key === 'paymentType') return PAYMENT_TYPES;
  if (key === 'machineType') return MACHINE_TYPES;
  return [];
}

module.exports = { DOMAINS, DOMAIN_KEYS, EMPLOYEE_TYPES, PAYMENT_TYPES, MACHINE_TYPES, optionLabel, optionsOf };

// 小程序管理端 · 主数据四域（Phase 8b 第 4~7 域：供应商 / 员工 / 水站 / 机台）
// ===========================================================================
// 这个文件**只有声明**，没有逻辑 —— 四个域的编排全在 `_masterFactory.js`。
//
// 四份 spec 并排放在一起，是为了让差异一眼可见。它们的差异**只有三处**：
//   ① 表名与字段清单
//   ② 引用检查（从 Web 控制器导入**同一个函数**，见下）
//   ③ 文案（nameLabel 等）
// 其余（幂等、审计、部分更新、"无引用→物理删 / 有引用→停用"）完全一致。
//
// ⚠️ 两处刻意的"不开放"：
//   · **水站的 `current_debt`（未结欠款）不在可写字段里**。欠款由业务（下单、结算）产生，
//     手改档案字段会让「余额/欠款」类口径失去唯一来源 —— 需要修正欠款应走专门的调账流程。
//     新增水站时该列由 DB 默认值兜底（0）。
//   · **员工的 `commission_rate`（提成比例）**虽可写，但它是工资计算的输入之一；
//     改它只影响**将来**的结算（历史工资单已固化为独立记录），这一点在编辑页有提示。
//
// ⚠️ ID 前缀沿用各 Web 控制器的既有写法（SUP / W / S / M）。注意库里历史数据里
//    员工是 `SM` 开头、水站是 `ST` 开头 —— 与控制器前缀并不一致（既有历史遗留），
//    本批次**不擅自更改**（改了会让小程序与 Web 两端的新建 ID 风格再次分叉）。
// ===========================================================================
const { AUDIT_ACTION, IDEM_SCOPE } = require('../../../constants/mini');
const { buildMasterDomain } = require('./_masterFactory');

// 引用检查：**导入 Web 端同一个函数**，不重写
const { findSupplierReferences } = require('../../supplierController');
const { findWorkerReferences } = require('../../workerController');
const { findStationReferences } = require('../../stationController');
const { findMachineReferences } = require('../../machineStationController');

// ── 域 4/17：供应商 ──────────────────────────────────────────────────────────
const supplier = buildMasterDomain({
  nameLabel: '供应商',
  table: 'suppliers',
  idColumn: 'supplier_id',
  nameColumn: 'supplier_name',
  idPrefix: 'SUP',
  searchColumns: ['supplier_name', 'contact_name', 'phone'],
  targetType: 'SUPPLIER',
  audit: {
    create: AUDIT_ACTION.CREATE_SUPPLIER,
    update: AUDIT_ACTION.UPDATE_SUPPLIER,
    disable: AUDIT_ACTION.DISABLE_SUPPLIER
  },
  idem: {
    create: IDEM_SCOPE.CREATE_SUPPLIER,
    update: IDEM_SCOPE.UPDATE_SUPPLIER,
    disable: IDEM_SCOPE.DISABLE_SUPPLIER
  },
  findReferences: findSupplierReferences,
  fields: [
    { col: 'supplier_name', key: 'supplierName', type: 'string', required: true, label: '供应商名称' },
    { col: 'contact_name', key: 'contactName', type: 'nullableString', label: '联系人' },
    { col: 'phone', key: 'phone', type: 'nullableString', label: '联系电话' },
    { col: 'address', key: 'address', type: 'nullableString', label: '地址' },
    { col: 'bank_name', key: 'bankName', type: 'nullableString', label: '开户行' },
    { col: 'bank_account', key: 'bankAccount', type: 'nullableString', label: '银行账号' },
    { col: 'account_name', key: 'accountName', type: 'nullableString', label: '账户名称' },
    { col: 'tax_number', key: 'taxNumber', type: 'nullableString', label: '税号' },
    { col: 'invoice_title', key: 'invoiceTitle', type: 'nullableString', label: '发票抬头' },
    { col: 'remark', key: 'remark', type: 'nullableString', label: '备注' },
    { col: 'status', key: 'status', type: 'int', label: '状态' }
  ]
});

// ── 域 5/17：员工 / 业务员 ───────────────────────────────────────────────────
const worker = buildMasterDomain({
  nameLabel: '员工',
  table: 'workers',
  idColumn: 'worker_id',
  nameColumn: 'worker_name',
  idPrefix: 'W',
  searchColumns: ['worker_name', 'phone'],
  targetType: 'WORKER',
  audit: {
    create: AUDIT_ACTION.CREATE_WORKER,
    update: AUDIT_ACTION.UPDATE_WORKER,
    disable: AUDIT_ACTION.DISABLE_WORKER
  },
  idem: {
    create: IDEM_SCOPE.CREATE_WORKER,
    update: IDEM_SCOPE.UPDATE_WORKER,
    disable: IDEM_SCOPE.DISABLE_WORKER
  },
  findReferences: findWorkerReferences,
  fields: [
    { col: 'worker_name', key: 'workerName', type: 'string', required: true, label: '员工姓名' },
    { col: 'phone', key: 'phone', type: 'nullableString', label: '联系电话' },
    // 1店长 / 2配送 / 3业务员 / 4管理员（与 docs/项目概览.md 一致）
    { col: 'employee_type', key: 'employeeType', type: 'int', required: true, enum: [1, 2, 3, 4], label: '员工类型' },
    { col: 'commission_rate', key: 'commissionRate', type: 'money', label: '提成比例' },
    { col: 'monthly_salary', key: 'monthlySalary', type: 'money', label: '月薪' },
    { col: 'bank_name', key: 'bankName', type: 'nullableString', label: '开户行' },
    { col: 'bank_account', key: 'bankAccount', type: 'nullableString', label: '银行账号' },
    { col: 'status', key: 'status', type: 'int', label: '状态' }
  ]
});

// ── 域 6/17：水站 ────────────────────────────────────────────────────────────
// ⚠️ 19 列里刻意**排除 `current_debt`**（未结欠款）—— 见文件头说明。
const station = buildMasterDomain({
  nameLabel: '水站',
  table: 'sub_stations',
  idColumn: 'station_id',
  nameColumn: 'station_name',
  idPrefix: 'S',
  searchColumns: ['station_name', 'contact_name', 'phone'],
  targetType: 'STATION',
  audit: {
    create: AUDIT_ACTION.CREATE_STATION,
    update: AUDIT_ACTION.UPDATE_STATION,
    disable: AUDIT_ACTION.DISABLE_STATION
  },
  idem: {
    create: IDEM_SCOPE.CREATE_STATION,
    update: IDEM_SCOPE.UPDATE_STATION,
    disable: IDEM_SCOPE.DISABLE_STATION
  },
  findReferences: findStationReferences,
  fields: [
    { col: 'station_name', key: 'stationName', type: 'string', required: true, label: '水站名称' },
    { col: 'contact_name', key: 'contactName', type: 'nullableString', label: '联系人' },
    { col: 'phone', key: 'phone', type: 'nullableString', label: '联系电话' },
    { col: 'address', key: 'address', type: 'nullableString', label: '地址' },
    { col: 'area', key: 'area', type: 'nullableString', label: '所属区域' },
    { col: 'credit_limit', key: 'creditLimit', type: 'money', label: '授信额度' },
    { col: 'payment_type', key: 'paymentType', type: 'int', label: '结算方式' },
    { col: 'bank_name', key: 'bankName', type: 'nullableString', label: '开户行' },
    { col: 'bank_account', key: 'bankAccount', type: 'nullableString', label: '银行账号' },
    { col: 'account_name', key: 'accountName', type: 'nullableString', label: '账户名称' },
    { col: 'invoice_title', key: 'invoiceTitle', type: 'nullableString', label: '发票抬头' },
    { col: 'tax_number', key: 'taxNumber', type: 'nullableString', label: '税号' },
    { col: 'invoice_address', key: 'invoiceAddress', type: 'nullableString', label: '开票地址' },
    { col: 'invoice_phone', key: 'invoicePhone', type: 'nullableString', label: '开票电话' },
    { col: 'status', key: 'status', type: 'int', label: '状态' }
  ]
});

// ── 域 7/17：机台（零售机 / 供货点）──────────────────────────────────────────
// ⚠️ 表里名称列叫 `station_name`（与"水站"重名，但语义是机台名）—— 别按惯例猜成 machine_name。
// ⚠️ `machine_sales.machine_id` 是 ON DELETE CASCADE：有销量记录时**必须**停用而非删除，
//    否则会连带删掉历史销量。本域的 findReferences 正是查它（导入自 Web 控制器）。
const machine = buildMasterDomain({
  nameLabel: '机台',
  table: 'machine_stations',
  idColumn: 'machine_id',
  nameColumn: 'station_name',
  idPrefix: 'M',
  searchColumns: ['station_name', 'manager', 'manager_phone'],
  targetType: 'MACHINE',
  audit: {
    create: AUDIT_ACTION.CREATE_MACHINE,
    update: AUDIT_ACTION.UPDATE_MACHINE,
    disable: AUDIT_ACTION.DISABLE_MACHINE
  },
  idem: {
    create: IDEM_SCOPE.CREATE_MACHINE,
    update: IDEM_SCOPE.UPDATE_MACHINE,
    disable: IDEM_SCOPE.DISABLE_MACHINE
  },
  findReferences: findMachineReferences,
  fields: [
    { col: 'station_name', key: 'stationName', type: 'string', required: true, label: '机台名称' },
    // ⚠️ 枚举必须逐个域核对：第一版这里漏了 enum（员工类型写了、机台忘了），
    //    后果是非法类型（7）能直接落库 —— 冒烟里那条"非法值应被拒"就是照出来的。
    //    1-量贩机 / 2-零售机（以 machine_stations.machine_type 列注释为准）
    { col: 'machine_type', key: 'machineType', type: 'int', required: true, enum: [1, 2], label: '机台类型' },
    { col: 'address', key: 'address', type: 'nullableString', label: '地址' },
    { col: 'manager', key: 'manager', type: 'nullableString', label: '负责人' },
    { col: 'manager_phone', key: 'managerPhone', type: 'nullableString', label: '负责人电话' },
    { col: 'status', key: 'status', type: 'int', label: '状态' }
  ]
});

module.exports = { supplier, worker, station, machine };

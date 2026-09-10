# 回桶管理模块 — 设计文档

> 日期：2026-09-08 ｜ 状态：已确认待实现 ｜ 项目：农夫山泉经销商进销存系统

## 1. 背景与目标

桶装水配送过程中对桶收取押金（押金随桶走），客户/水站退回空桶时退还押金。本模块负责：

- **收取押金**：独立登记单，押金存入所选财务账户（入账）
- **退回押金**：独立登记单，从所选财务账户支出（出账）
- **押金台账**：按 对象×桶型 聚合在押桶数与押金余额
- **桶型配置**：预置桶型 + 押金单价维护

不涉及：订单联动、库存联动、审批流、小程序端（仅 PC admin）。

## 2. 已确认需求决策

| 项 | 决策 |
|---|---|
| 记账对象 | 水站（sub_stations）+ 零售客户（姓名/电话，无客户档案表） |
| 登记方式 | 独立登记单，不关联订单 |
| 资金流 | **收取与退回都选财务账户，都走三联事务**（收取入账、退回支出） |
| 桶型 | 预置常见桶型 + 押金单价配置（`barrel_config`），无库存联动 |
| 审批 | 无 |
| 权限 | 仅 admin 可操作（后端接口 + 前端菜单双重限制） |
| 撤销 | 已入账/已退款单不允许撤销；误操作用「反向单冲销」 |

## 3. 数据模型

### 3.1 `barrel_config`（新表）— 桶型配置

```sql
CREATE TABLE `barrel_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `barrel_type` varchar(50) NOT NULL COMMENT '桶型（唯一），如 19L桶/12L桶/4L桶/7.5L桶',
  `deposit_price` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '押金单价',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1启用 0停用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_barrel_type` (`barrel_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='桶型押金配置';
```

种子数据：`19L桶/12L桶/4L桶/7.5L桶` 各一条（单价按惯例预置，admin 可改）。

### 3.2 `barrel_deposits`（扩展现有空表）— 押金流水

现有字段：`id / deposit_no / station_id / barrel_type / quantity / unit_price / deposit_type(collect|return) / handler_id / remark / created_at / updated_at`

新增字段：

| 字段 | 说明 |
|---|---|
| `party_type` | `station`水站 / `customer`零售 |
| `customer_name` | 零售客户姓名（水站时 NULL） |
| `customer_phone` | 零售客户电话（水站时 NULL） |
| `account_id` | 财务账户 ID（collect=入账账户，return=支出账户，均必填） |
| `account_name` | 账户名称冗余 |
| `refunded_at` | 退回完成时间（仅 return 有值） |

约束：`station_id` 与 `customer_name` 按 `party_type` 二选一；表默认 collation `utf8mb4_unicode_ci`（与 sub_stations/workers 一致，避免 JOIN 报 collation 冲突）。

## 4. 业务规则

### 4.1 收取押金（collect）

登记单（对象+桶型+数量+单价+财务账户）→ 事务内：

1. `UPDATE finance_accounts SET balance = balance + 金额`（`balance_before` 取前值）
2. 写 `finance_transactions` 收入流水：`tx_type=1`、`tx_category='押金收取'`、`related_module='barrel_deposit'`、`related_id=deposit_no`
3. `INSERT barrel_deposits`（`deposit_type='collect'`、`account_id/account_name`）

### 4.2 退回押金（return）

登记单（数量 ≤ 该对象该桶型在押桶数，防超退；必选账户且余额充足）→ 事务内：

1. `UPDATE finance_accounts SET balance = balance - 金额`（不足则报错回滚）
2. 写 `finance_transactions` 支出流水：`tx_type=2`、`tx_category='押金退回'`、`related_module='barrel_deposit'`
3. `INSERT barrel_deposits`（`deposit_type='return'`、`refunded_at=NOW()`）

### 4.3 台账汇总

按 对象×桶型 聚合：`在押桶数 = SUM(collect.quantity) - SUM(return.quantity)`，`押金余额 = SUM(collect金额) - SUM(return金额)`。支持按 日期/对象/桶型 筛选。

### 4.4 撤销策略

- **不允许撤销**任何已入账单（collect）或已退款单（return）——账户资金历史不可篡改。
- 误操作处理：录一张反向单（如多收了就录一张同金额 return 冲销），走正常三联事务，台账自然归零。
- 说明文档中明确该规则。

## 5. 接口设计

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/api/barrel-configs` | 桶型配置列表（含停用） | admin |
| POST | `/api/barrel-configs` | 新增桶型 | admin |
| PUT | `/api/barrel-configs/:id` | 修改单价/状态/排序 | admin |
| POST | `/api/barrel-deposits` | 收取/退回押金登记（`depositType` 区分） | admin |
| GET | `/api/barrel-deposits` | 押金流水列表（分页，可按日期/对象/桶型筛选） | admin |
| GET | `/api/barrel-deposits/summary` | 押金台账汇总（按对象×桶型） | admin |

金额字段一律 `Math.round(n*100)/100`；分页用 `parsePage` 工具（LIMIT/OFFSET 拼整数，mysql2 不支持 `?` 占位）。

## 6. 前端设计

- `src/api/barrel.js`：封装上述接口
- `src/views/barrel/`：
  - `BarrelDeposit.vue`：押金登记（收取/退回切换，对象选择器：水站下拉/客户姓名电话，桶型下拉带出单价，财务账户下拉带余额）
  - `BarrelLedger.vue`：押金台账汇总（对象×桶型，含筛选）
  - `BarrelConfig.vue`：桶型配置管理
- 菜单注册：`layout/menuConfig.js` 新增「回桶管理」（icon + 子菜单或单页），仅 admin 可见
- 表单校验：数量>0、桶型必选、账户必选、退押金时显示该对象在押桶数提示

## 7. 测试与验证

- `backend/scripts/smoke_barrel.js`（参照 `smoke_salary_advance.js` 模式）：
  - 桶型 CRUD
  - 收取押金 → 账户余额增加 + 流水生成
  - 退回押金（余额充足）→ 余额减少 + 流水生成 + 台账归零
  - 超退校验、余额不足校验
  - 清理测试数据
- 回归：`node scripts/smoke_order_pricing.js`（基线 40/40）不受影响
- 前端 `vite build` 通过

## 8. 改动清单

1. `database/migration_barrel_module.sql`（幂等）→ `node` 执行 → `node backend/scripts/export_dump.js` 重导 `full_schema_data.sql`
2. 后端：`constants/barrel.js`、`services/barrelService.js`、`controllers/barrelController.js`、`routes/barrelRoutes.js` + `app.js` 路由注册
3. 前端：`api/barrel.js`、`views/barrel/*`、`layout/menuConfig.js`
4. 文档：`docs/项目概览.md` 〇节追加变更记录
5. 测试：`smoke_barrel.js` + 回归

## 9. 关键约束提醒

- 资金记账三联事务规范（`.workbuddy/memory/MEMORY.md` 第一条）：账户余额变动必须同时写流水，任何例外都会造成账实不符。
- `finance_transactions` 写入需 `tx_no` 唯一、`balance_before/balance_after` 正确记录。
- 新表/新字段必须显式 `COLLATE=utf8mb4_unicode_ci`。
- 路由具体路径注册在通配 `/:param` 之前。

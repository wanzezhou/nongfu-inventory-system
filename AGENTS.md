# AGENTS.md — AI 智能体必读入口

> 农夫山泉经销商进销存管理系统。你（无论人是开发者还是 AI 智能体）在动手改代码前，先读完本文件。

## 项目一句话

Vue3 + Element Plus 前端（:5173）｜ Node.js + Express 后端（:3000）｜ MySQL（30 张表）——经销商进销存 + 营收/成本统计 + 资金记账 + 工资发放。

## 文档地图（按需读取，勿跳过第 1 项）

1. **`docs/交接文档.md`** —— 项目交接主文档：背景/架构/决策/进度/待办/规范/入口/环境，从这里建立全局认知。
2. **`docs/项目概览.md`** —— ★ 唯一事实源：真实数据模型、功能模块、核心业务规则、历史变更日志。**改任何代码前查它，改完必须同步它**（〇节追加变更记录）。
3. **`docs/技术债务审查报告.md`** —— 历史债务与处置记录（P0–P3 已全部闭环）。
4. `.workbuddy/memory/MEMORY.md` —— 项目长期硬性约定原文；`.workbuddy/memory/2026-*.md` —— 按日开发日志与踩坑。

## 每次动手前（硬性检查清单）

- [ ] 涉及**账户余额变动**的功能：必须遵守资金记账三联事务规范（`.workbuddy/memory/MEMORY.md` 第一条），任何例外都会造成账实不符。
- [ ] **改库结构**：写幂等 `database/migration_*.sql` → 用 node+mysql2 执行（勿用 mysql.exe，中文乱码）→ `node backend/scripts/export_dump.js` 重导 `full_schema_data.sql`。
- [ ] **改订单/定价/水票**：逻辑归 `services/orderPricingService.js`，不要往 orderController 里抄；改前跑 `node scripts/smoke_order_pricing.js`（基线 40/40），改后再跑。
- [ ] **改营收/成本口径**：营收表达式唯一来源 `utils/revenueExpr.js`，前端只展示不计算；订单类型 4/6 营收走 machine_sales。
- [ ] **写 controller**：`req.body` 一律驼峰单读（全局 normalizeBody 已归一），禁止蛇形别名回退；金额 `Math.round(n*100)/100`；分页 parseInt 内联（mysql2 不支持 `LIMIT ?`）。
- [ ] **改前端**：菜单只改 `layout/menuConfig.js`；窄屏适配（对话框 ≤768px 94vw）；失败分支不得误报成功；完成后台账 `docs/项目概览.md`。
- [ ] **验证**：改后端代码后必须重启服务再跑冒烟；相关冒烟基线见 `docs/交接文档.md` 第四节表格。

## 快速运行

```
start.bat    # 一键启动（自动建库/装依赖/拉起前后端/开浏览器）
stop.bat     # 一键停止
# 冒烟：cd backend && node scripts/smoke_order_pricing.js（其余 smoke_* 同理）
# 构建：cd frontend && node node_modules/vite/bin/vite.js build
```

## 已知陷阱（完整清单见 docs/交接文档.md 第五节）

- 路由具体路径必须注册在通配 `/:param` 之前，否则被吞。
- 订单取消 `canceled_at` ≠ 软删除 `status=0`，不是同一字段。
- 库存负数是有意设计（仅盘库出库强制非负）。
- 商品销售统计不带 range 参数时是「当月」口径，空表非 bug。
- workers 与 salesmen（归档表）collation 不同，跨表比较需显式 `COLLATE utf8mb4_unicode_ci`。
- `README.md` 与 `docs/superpowers/` 已过时，勿作为事实依据。

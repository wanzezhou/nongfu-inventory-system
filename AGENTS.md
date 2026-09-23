# AGENTS.md — AI 智能体必读入口

> 农夫山泉经销商进销存管理系统。你（无论人是开发者还是 AI 智能体）在动手改代码前，先读完本文件。

## 项目一句话

Vue3 + Element Plus 前端（:5173）｜ Node.js + Express 后端（:3000）｜ MySQL（30 张表）——经销商进销存 + 营收/成本统计 + 资金记账 + 工资发放。

## 文档地图（按需读取，勿跳过第 1 项）

1. **`docs/交接文档.md`** —— 项目交接主文档：背景/架构/决策/进度/待办/规范/入口/环境，从这里建立全局认知。
2. **`docs/项目概览.md`** —— ★ 唯一事实源：真实数据模型、功能模块、核心业务规则、历史变更日志。**改任何代码前查它，改完必须同步它**（〇节追加变更记录）。
3. **`docs/技术债务审查报告.md`** —— 历史债务与处置记录（P0–P3 已全部闭环）。
4. **`docs/代码审查标准.md`** —— ★ **写码前必读**：不可变式 I1–I5、红线 R1–R7、**AI 生成代码专项规则（六大失败模式 + 三问法）**、分层检查清单。配套 `docs/代码审查流程.md`（五道闸门 / PR 模板 / 评审 SLA）。
5. **`docs/部署指南（腾讯云-新手版）.md`** —— ★ **上服务器前必读**：传什么/不传什么（逐条核对表）、从零 7 步部署、分层排查法 + 常见问题速查、发布与回滚流程。配套 `deploy/` 模板（nginx / pm2 / 备份 / 发布 / 回滚脚本）。
   ⚠️ 三个最易踩的坑先记住：**商品图片在仓库根 `商品档案/商品图片/`（不在 backend/ 内）**、**nginx 必须同时反代 `/api` + `/product_images` + `/uploads` 三条前缀**、**前端是 history 路由必须配 `try_files … /index.html`**。
6. `.workbuddy/memory/MEMORY.md` —— 项目长期硬性约定原文（**索引，细节看同目录 `REF-工程手册.md`**）；`.workbuddy/memory/2026-*.md` —— 按日开发日志与踩坑。

> ⚠️ **AI 智能体特别注意**：本项目已有机器门禁（`scripts/check-diff-hazards.mjs`、`eslint.config.mjs`）。提交前先自检 ——
> `node scripts/check-diff-hazards.mjs --staged` 会拦住 mock 兜底 / 空 catch / `SELECT *` / `err.message` 出参 / 硬编码取数上限 / 硬编码地址 / 硬编码密钥。
> 不要试图用 `hazard-allow` 绕过；确需豁免必须在行内写明原因，评审会看。

## 每次动手前（硬性检查清单）

- [ ] 涉及**账户余额变动**的功能：必须遵守资金记账三联事务规范（`.workbuddy/memory/MEMORY.md` 第一条），任何例外都会造成账实不符。
- [ ] **改库结构**：写幂等 `database/migration_*.sql` → 用 node+mysql2 执行（勿用 mysql.exe，中文乱码）→ `node backend/scripts/export_dump.js` 重导 `full_schema_data.sql`。
      ⚠️ **`full_schema_data.sql` 自带 `CREATE DATABASE ... / USE nongfu_inventory;`**，直接 `mysql < dump` 会**打到正式库**（`DROP TABLE` + 重建），命令行指定的目标库会被 `USE` 覆盖。要导入到别的库做对比，必须加 `mysql --one-database=<db>` 或先剥掉这两行。**任何涉及生产库的写操作，先 `mysqldump` 备份再说**（2026-09-11 已因此出过一次事故）。
- [ ] **改订单/定价/水票**：逻辑归 `services/orderPricingService.js`，不要往 orderController 里抄；改前跑 `node scripts/smoke_order_pricing.js`（基线 40/40），改后再跑。
- [ ] **改营收/成本口径**：营收表达式唯一来源 `utils/revenueExpr.js`，前端只展示不计算；订单类型 4/6 营收走 machine_sales。
- [ ] **写 controller**：`req.body` 一律驼峰单读（全局 normalizeBody 已归一），禁止蛇形别名回退；金额 `Math.round(n*100)/100`；分页 parseInt 内联（mysql2 不支持 `LIMIT ?`）。
      ⚠️ 归一化是**机械转换**（`delivery_type`→`deliveryType`）。若前端用的是另一个驼峰名，两者不会自动对齐、字段会静默取空 —— 订单接口已有三例（配送方式 `deliveryType`/`deliveryMethod`、配送员工 `workerId`/`deliveryStaffId`、创建人 `createdBy`/`createdById`）。**新增请求体字段前先 grep 前端确认实际键名。**
- [ ] **写 response**：统一走 `utils/response.js`（`success` / `error` / `pagination` / `unauthorized` / `forbidden`），**不要裸 `res.json`**。
      ⚠️ **鉴权失败 = HTTP 401 + 信封 code 401**（2026-09-18 起，此前是 HTTP 200 + code 401）；无权限 = HTTP 403。前端 `request.js` 在 **error 分支**处理 401（登出 + 跳登录）。非 axios 调用路径（`<img>`、直连、脚本探测）拿不到 401 的中文文案，探测服务是否就绪请用 **`GET /health`**（免鉴权、固定 200）。
- [ ] **5xx 的 `message` 不得带 `err.message`**：`error(res, 'xx失败: ' + err.message)` 会泄露表名/列名/SQL/绝对路径（历史缺陷 S7 共 65 处，已收敛）。业务文案才允许 `err.message`（bizFail 模式，需带 `hazard-allow` 豁免注释）。
- [ ] **下拉/选项类取数**：一律用专用全量接口 —— `/products/options`、`/inventory/options`、`/stations/all`、`/machine-stations/all`、`/suppliers/all`、`/workers/all`。**禁止**用 `getXxxList({ pageSize: N })` 拉下拉：分页有上限，实体一超上限选项就**静默缺失**（2026-09-18 发现：商品 159 > 上限 100，开单选不到后 59 个商品）。**接口失败时绝不能用假数据兜底**（红线 R1）。
- [ ] **改前端**：菜单只改 `layout/menuConfig.js`；窄屏适配（对话框 ≤768px 94vw）；失败分支不得误报成功；完成后台账 `docs/项目概览.md`。
- [ ] **验证**：改后端代码后必须重启服务再跑冒烟；相关冒烟基线见 `docs/交接文档.md` 第四节表格。
      ⚠️ `loginLimiter` 为 `max 10 / 15min`（按 IP），**连续跑整套冒烟会在第 11 个脚本处被限流**（登录返 `null`、断言连锁失败，极易误判为回归）—— 请分批跑，或每批前重启后端重置计数。
- [ ] **写/改冒烟脚本**：凡写库的 `smoke_*.js` 必须在 `finally` 调 `cleanupSmokeResidue(pool)`（`scripts/lib/smokeCleanup.js`），测试数据须带「冒烟 / smoke_ / SMK / 未来月份」标记；**禁止**把真实数据（如 `products LIMIT 1`）当测试对象。历史残留可用 `node scripts/cleanup_smoke_data.js`（预演）/ `--apply`（执行）清理。

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
- 统计类时间筛选统一走 `utils/dateRange.js`（后端）/`utils/dateRange.js`（前端）：预设键 `month/lastMonth/quarter/year/custom`，`start` 含 `end` 不含；旧 `month=YYYY-MM` 参数仍兼容（冒烟脚本依赖）。**跨月区间的工资按应发口径统计、发放/撤销按钮禁用** —— 发放记录是按自然月存的，别改成「先看是否发过再算金额」。
- workers 与 salesmen（归档表）collation 不同，跨表比较需显式 `COLLATE utf8mb4_unicode_ci`。
- `README.md` 与 `docs/superpowers/` 已过时，勿作为事实依据。

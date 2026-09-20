-- =============================================================================
-- 迁移：微信订货小程序 V1.1 · Phase 1 ~ Phase 5（账号 / 钱包 / 订单统一 / 水票积分）
-- =============================================================================
-- 事实源：《农夫库存管理系统微信订货小程序 产品需求、业务规则与技术开发文档 V1.1》
--   §4.1.1 mini_accounts 复用 + 清理改造
--   §4.6.1 「一个水站一个微信账号」唯一约束（生成列 + 唯一索引）
--   §20.1 新增表 wallet_accounts / wallet_transactions / mini_payment_orders
--   §20.2 orders 新增 10 列（全部可空或带默认值，不得打断既有 Web 创建订单）
--   §20.3 products 新增 2 列（业务员小程序可售 / 最低成交价）
--   §20.4 water_ticket_issuance 拆分单件值与总额
--   §23.1 幂等表
--   §40   审计日志
--
-- ⚠️ 本文件是**权威 DDL 事实源**，但**不要直接 `mysql < 本文件`**：
--     MySQL 8 不支持 `ADD COLUMN IF NOT EXISTS`，直接重跑会报错（不满足 §4.1.1 的「可重入」要求）。
--     正确执行方式（仓库既有规范：用 node + mysql2，勿用 mysql.exe，中文会乱码）：
--
--         cd backend && node scripts/migrate_mini_program_v1.js --dry-run   # 预演，不写库
--         cd backend && node scripts/migrate_mini_program_v1.js --apply     # 执行
--
--     执行器按下方 `-- [STEP]` / `-- [GUARD]` 标记逐段判定，只跑尚未生效的段，因此可反复重跑。
--     全新空库也可直接灌本文件（所有 STEP 都会被执行）。
--
-- ⚠️ 执行前必须 mysqldump 全量备份并确认体积非 0（项目规范）。
--    本次备份：database/backup_20260920_203139_before_miniprogram.sql
-- =============================================================================


-- -----------------------------------------------------------------------------
-- [STEP mini_accounts_drop_placeholder]
-- [GUARD] ALWAYS
-- [DESC]  清除上一版小程序（2026-08-23 已整体删除）遗留的 4 条占位账号。
--         其中 seed_admin 的 role=admin 且 status=1，属「可被触达的既存账号」——这是越权面。
--         它们是上一版冒烟脚本的登录账号，脚本已随小程序删除，故可安全清除。
--         幂等：DELETE 带 WHERE 条件，重复执行影响 0 行。
-- -----------------------------------------------------------------------------
DELETE FROM `mini_accounts` WHERE `openid` IN ('seed_admin', 'seed_worker', 'seed_station', 'seed_salesman');


-- -----------------------------------------------------------------------------
-- [STEP mini_accounts_role_enum]
-- [GUARD] COLUMN_TYPE:mini_accounts:role:worker
-- [DESC]  裁剪 role 枚举：admin / worker / station / salesman → admin / station / salesman。
--         新版只有 3 个角色，worker（上一版「配送员工」角色）留旧值会让人误以为该角色仍有效。
-- -----------------------------------------------------------------------------
ALTER TABLE `mini_accounts`
  MODIFY COLUMN `role` enum('admin','station','salesman') NOT NULL COMMENT '角色：admin=管理员 station=直营水站 salesman=业务员';


-- -----------------------------------------------------------------------------
-- [STEP mini_accounts_drop_username_index]
-- [GUARD] INDEX:mini_accounts:idx_username
-- [DESC]  先显式移除 username 上的 UNIQUE 索引，再删列（拆两步，避免「索引名与列名不同」导致重跑失败）。
--         现状核实：该索引名是 `idx_username`（UNIQUE KEY idx_username (username)），**不叫** `username`。
--         若某个库的索引名不同，本 STEP 会跳过 —— 删列时会连同其上的索引一并删除，结果一致。
-- -----------------------------------------------------------------------------
ALTER TABLE `mini_accounts` DROP INDEX `idx_username`;


-- -----------------------------------------------------------------------------
-- [STEP mini_accounts_drop_credentials]
-- [GUARD] HASCOLUMN:mini_accounts:username
-- [DESC]  移除 username 与 password_hash 两列。
--         （守卫用 HASCOLUMN：**存在才执行** —— 删列类步骤的判定方向与"加列"相反。）
--         新版走 wx.login + 微信实名手机号绑定，不需要口令；保留即多留一个凭据面（该列现存 bcrypt 散列）。
-- -----------------------------------------------------------------------------
ALTER TABLE `mini_accounts`
  DROP COLUMN `username`,
  DROP COLUMN `password_hash`;


-- -----------------------------------------------------------------------------
-- [STEP mini_accounts_active_key]
-- [GUARD] COLUMN:mini_accounts:active_key
-- [DESC]  §4.6.1「一个水站一个微信账号」的唯一性落地。
--         MySQL 不支持部分唯一索引（WHERE status = 1），故用生成列：
--           启用时 active_key = target_id，停用时为 NULL（唯一索引允许多个 NULL，故停用行不占键）。
--         效果：同一 role + 同一 target_id 只能有一条启用中记录；
--              停用/解绑后该键释放，新微信账号可立即绑定，历史行保留便于审计。
-- -----------------------------------------------------------------------------
ALTER TABLE `mini_accounts`
  ADD COLUMN `active_key` varchar(50)
    GENERATED ALWAYS AS (IF(`status` = 1, `target_id`, NULL)) VIRTUAL
    COMMENT '启用态唯一键（= target_id；停用时为 NULL，用于唯一索引）',
  ADD UNIQUE KEY `uk_role_active` (`role`, `active_key`);


-- -----------------------------------------------------------------------------
-- [STEP wallet_accounts]
-- [GUARD] TABLE:wallet_accounts
-- [DESC]  §11.2 钱包表。与既有 finance_accounts（公司真实资金）并存，是第二套余额体系。
--         金额一律走流水变更，禁止 `UPDATE ... SET balance = ?`（§11.7 第 6 条 / §41）。
--         initial_balance 用于承载 §11.5 恒等式的「期初」项，正常为 0。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wallet_accounts` (
  `wallet_id`       varchar(64)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '钱包ID',
  `owner_type`      enum('SALESMAN','STATION') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主体类型：SALESMAN=业务员 STATION=直营水站',
  `owner_id`        varchar(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主体ID：SALESMAN→workers.worker_id；STATION→sub_stations.station_id',
  `owner_name`      varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '主体名称快照（仅展示用，非事实源）',
  `initial_balance` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '初始余额（恒等式期初项，正常为 0）',
  `balance`         decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '当前积分余额（唯一权威值，只经 wallet_transactions 变动）',
  `status`          tinyint NOT NULL DEFAULT '1' COMMENT '状态：1启用 0停用',
  `remark`          varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `created_at`      datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`wallet_id`),
  UNIQUE KEY `uk_owner` (`owner_type`, `owner_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序积分钱包表（业务员/直营水站内部订货预存额度，1元=1积分）';


-- -----------------------------------------------------------------------------
-- [STEP wallet_transactions]
-- [GUARD] TABLE:wallet_transactions
-- [DESC]  §11.3 钱包流水表。字段齐备是 §11.7 第 3 条硬要求（缺一不可，便于对账与排障）。
--
--         ⚠️ 这里比文档多一个 `direction` 列，是有意为之：
--         仓库既有铁律「收入类流水的撤销是 −amount，抄成 + 会越撤越多，而恒等式看起来仍然成立」
--         （.workbuddy/memory/MEMORY.md 第一条 / §11.7 第 5 条）是本仓库**真实踩过的坑**。
--         用「类型反推方向」正是该坑的成因，故把方向显式落库：amount 恒为正数，方向只看 direction。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wallet_transactions` (
  `transaction_id`   varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水ID',
  `transaction_no`   varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务流水号（人可读，用于对账）',
  `wallet_id`        varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '钱包ID',
  `transaction_type` enum('RECHARGE','DISTRIBUTION_FEE','ORDER_PAYMENT','REFUND','DISTRIBUTION_FEE_REVERSAL','ADJUST_IN','ADJUST_OUT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水类型，见文档 §11.4',
  `direction`        tinyint NOT NULL COMMENT '方向：1=正向入账 2=负向出账（amount 恒为正数，方向只看本列）',
  `amount`           decimal(14,2) NOT NULL COMMENT '金额（正数）',
  `balance_before`   decimal(14,2) NOT NULL COMMENT '变动前余额',
  `balance_after`    decimal(14,2) NOT NULL COMMENT '变动后余额',
  `related_type`     varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联业务类型：ORDER / WATER_TICKET_ISSUANCE / WATER_TICKET / PAYMENT / MANUAL_ADJUST',
  `related_id`       varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联业务ID',
  `reversal_of`      varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '被本笔冲回/撤销的原流水ID（撤销类流水必填）',
  `operator_id`      varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人（管理员手工调整必填）',
  `operator_role`    varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人角色',
  `remark`           varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注/操作原因（管理员手工调整必填）',
  `created_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`transaction_id`),
  UNIQUE KEY `uk_tx_no` (`transaction_no`),
  KEY `idx_wallet_time` (`wallet_id`, `created_at`),
  KEY `idx_related` (`related_type`, `related_id`),
  KEY `idx_type` (`transaction_type`),
  CONSTRAINT `fk_wallet_tx_wallet` FOREIGN KEY (`wallet_id`) REFERENCES `wallet_accounts` (`wallet_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序积分钱包流水表（余额 = 期初 + Σ正向 − Σ负向 的事实源）';


-- -----------------------------------------------------------------------------
-- [STEP mini_payment_orders]
-- [GUARD] TABLE:mini_payment_orders
-- [DESC]  §13.5 充值单表。充值≠主营业务收入（§19.1），故独立成表，不进 orders。
--         Phase 6（微信充值）需等微信支付资质，本表先建好，接口按 §13.8 降级路径返回「未开通」。
--         out_trade_no 唯一索引 = §13.6 幂等（同一充值单只能入账一次）的兜底。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mini_payment_orders` (
  `payment_id`       varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '充值单ID',
  `out_trade_no`     varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商户订单号（唯一，幂等兜底）',
  `payment_scene`    varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WALLET_RECHARGE' COMMENT '支付场景',
  `wallet_id`        varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '目标钱包ID',
  `owner_type`       varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主体类型快照',
  `owner_id`         varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主体ID快照',
  `openid`           varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支付用户 openid',
  `amount`           decimal(12,2) NOT NULL COMMENT '充值金额（元）= 到账积分（1元=1积分）',
  `appid`            varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '小程序 AppID 快照',
  `mchid`            varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商户号快照',
  `prepay_id`        varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '微信预支付交易会话标识',
  `wechat_transaction_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '微信支付交易单号',
  `trade_state`      varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NOTPAY' COMMENT '交易状态：NOTPAY/SUCCESS/CLOSED/REFUND',
  `credited`         tinyint NOT NULL DEFAULT '0' COMMENT '是否已入账：0未入账 1已入账（§13.6 幂等标记）',
  `credited_at`      datetime DEFAULT NULL COMMENT '入账时间',
  `transaction_id`   varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '入账产生的钱包流水ID',
  `paid_at`          datetime DEFAULT NULL COMMENT '微信侧支付成功时间',
  `created_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`       datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uk_out_trade_no` (`out_trade_no`),
  KEY `idx_wallet` (`wallet_id`),
  KEY `idx_trade_state` (`trade_state`),
  CONSTRAINT `fk_mini_pay_wallet` FOREIGN KEY (`wallet_id`) REFERENCES `wallet_accounts` (`wallet_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序微信充值单（充值只用于积分入账，不参与主营业务收入口径）';


-- -----------------------------------------------------------------------------
-- [STEP mini_idempotency]
-- [GUARD] TABLE:mini_idempotency
-- [DESC]  §23.1 幂等键落地：key + scope + result_ref + created_at，UNIQUE(scope, key)。
--         客户端生成键（提交订单那一刻生成一次并持久化本地），服务端保留 ≥24h；
--         重复请求返回首次成功的同一结果（HTTP 200，不报错、不新建单）。
--         必须在业务同一事务内写入，不能事后补写。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mini_idempotency` (
  `id`          bigint NOT NULL AUTO_INCREMENT,
  `scope`       varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '作用域（如 CREATE_ORDER:{walletId} / RECHARGE / REFUND）',
  `idem_key`    varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '幂等键（≤64，客户端生成）',
  `request_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求指纹；同键不同参数视为客户端异常，返回 400 并记日志',
  `status`      varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DONE' COMMENT '处理状态：PENDING/DONE',
  `result_ref`  varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首次成功的结果引用（如 order_id）',
  `mini_account_id` int DEFAULT NULL COMMENT '发起账号（排障用）',
  `created_at`  datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scope_key` (`scope`, `idem_key`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序接口幂等表（§23.1；服务端至少保留 24h）';


-- -----------------------------------------------------------------------------
-- [STEP mini_audit_logs]
-- [GUARD] TABLE:mini_audit_logs
-- [DESC]  §40 审计日志：微信账号绑定/解绑、管理员禁用账号、商品最低价修改、订单创建/退款、
--         水票发行/作废/冲正、钱包人工增减 —— 必须可追溯到操作人。
--         钱包流水本身已带 operator_id/remark，本表补「非资金类」操作的留痕。
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mini_audit_logs` (
  `log_id`        bigint NOT NULL AUTO_INCREMENT,
  `action`        varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作：BIND/UNBIND/LOGIN/DISABLE_ACCOUNT/SET_PRODUCT_MIN_PRICE/CREATE_ORDER/CANCEL_ORDER/REFUND_ORDER/ISSUE_TICKET/VOID_TICKET/REVERSE_DISTRIBUTION_FEE/WALLET_ADJUST',
  `actor_type`    varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人类型：MINI/WEB/SYSTEM',
  `actor_id`      varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人ID',
  `target_type`   varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标类型',
  `target_id`     varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标ID',
  `detail`        varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '明细（JSON 或文本）',
  `created_at`    datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`log_id`),
  KEY `idx_action_time` (`action`, `created_at`),
  KEY `idx_target` (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='小程序审计日志（§40）';


-- -----------------------------------------------------------------------------
-- [STEP orders_add_mini_columns]
-- [GUARD] COLUMN:orders:order_source
-- [DESC]  §20.2 orders 新增 10 列。
--
--         ⚠️ 关键约束（§20.2）：必须**全部可空或带默认值**。
--         orderController 的 INSERT 是显式列清单，未列出的列必须有默认值，
--         否则会直接打断既有 Web 订单创建流程（既有冒烟会全红）。
--
--         ⚠️ §6.2.1 归并说明：不在本次新增第二套「来源」语义 —— order_source 是唯一权威来源。
--         既有 platform_type / platform_order_no 属历史遗留（写入但前端从不读取），保持原样不动。
--
--         ⚠️ §16.1：refund_status 独立成列，不与 payment_status 复用，也不放进 fulfillment_status。
--         fulfillment_type（怎么取货）与既有 delivery_type（谁去送）是两个维度，不互相替代。
-- -----------------------------------------------------------------------------
ALTER TABLE `orders`
  ADD COLUMN `order_source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WEB'
    COMMENT '订单来源：WEB / MINI_PROGRAM（唯一权威来源语义，§6.2.1）',
  ADD COLUMN `buyer_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '购买主体类型：SALESMAN / STATION（仅小程序订单）',
  ADD COLUMN `buyer_id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '购买主体ID：SALESMAN→workers.worker_id；STATION→sub_stations.station_id',
  ADD COLUMN `payment_method` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EXISTING'
    COMMENT '支付方式：EXISTING=沿用既有记账 / WALLET=积分钱包 / OTHER=仅兼容历史',
  ADD COLUMN `wallet_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '支付所用钱包ID（payment_method=WALLET 时必填）',
  ADD COLUMN `fulfillment_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '履约方式：DELIVERY=配送 / PICKUP=自提（与 delivery_type 是两个维度，§10.1.1）',
  ADD COLUMN `fulfillment_status` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '履约状态：PAID/PROCESSING/DELIVERING/READY_FOR_PICKUP/COMPLETED/CANCELED（不含退款态，§16.1）',
  ADD COLUMN `order_scene` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '业务员订货场景：SELF_PURCHASE=自购 / CUSTOMER_ORDER=代客下单（§7.1）',
  ADD COLUMN `refund_status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NONE'
    COMMENT '退款状态：NONE/REFUNDING/REFUNDED（独立于 payment_status 与 canceled_at，§16.1）',
  ADD COLUMN `created_from_mini_account_id` int DEFAULT NULL
    COMMENT '由哪个小程序账号创建（mini_accounts.id）',
  ADD KEY `idx_order_source` (`order_source`),
  ADD KEY `idx_buyer` (`buyer_type`, `buyer_id`),
  ADD KEY `idx_refund_status` (`refund_status`),
  ADD KEY `idx_fulfillment_status` (`fulfillment_status`);


-- -----------------------------------------------------------------------------
-- [STEP products_add_salesman_columns]
-- [GUARD] COLUMN:products:salesman_mini_enabled
-- [DESC]  §20.3 products 新增 2 列（现状核实：products 共 20 列、无此二列 → 属净新增）。
--         业务口径（§8.5）：未开启 salesman_mini_enabled，**或**未配置有效 salesman_min_price
--         的商品，业务员**不可下单**；「未配置」不得回退成 0 元（否则零售价为 0 的商品会变成可零元销售）。
-- -----------------------------------------------------------------------------
ALTER TABLE `products`
  ADD COLUMN `salesman_mini_enabled` tinyint NOT NULL DEFAULT '0'
    COMMENT '业务员小程序可售：1=可售 0=不可售（默认 0，须管理员显式开启）',
  ADD COLUMN `salesman_min_price` decimal(10,2) DEFAULT NULL
    COMMENT '业务员小程序允许成交的最低单价（NULL=未配置 → 业务员不可下单）';


-- -----------------------------------------------------------------------------
-- [STEP ticket_issuance_fee_columns]
-- [GUARD] COLUMN:water_ticket_issuance:distribution_delivery_fee_unit
-- [DESC]  §12.2.1 字段拆分（V1.1 定论：不是可选，是必须）。
--
--         核实结论：既有 distribution_delivery_fee **确实是总额**（= 数量 × 单件值），
--         而**单件值当前从不落库** —— 这才是必须新增列的根本原因。
--         原因：§12.7 要求「作废 1 张票 → 扣回该票对应的分销配送费积分」，
--         若只有总额，单件值只能靠 `总额 ÷ 数量` 反推；而 §12.6 允许调整数量、
--         历史数据也可能除不尽 → 反推必然引入误差，且误差会随每张票的作废**累积**。
--
--         三项并存，各司其职：
--           distribution_delivery_fee        保留：旧字段继续承载总额语义，兼容既有读取方
--           distribution_delivery_fee_unit   新增：单件值（审计与单张作废的依据）
--           distribution_delivery_fee_total  新增：总额（= quantity × unit）
-- -----------------------------------------------------------------------------
ALTER TABLE `water_ticket_issuance`
  ADD COLUMN `distribution_delivery_fee_unit` decimal(12,4) DEFAULT NULL
    COMMENT '分销配送费·单件值（服务端从 products.distribution_delivery_fee 重取，§12.10）',
  ADD COLUMN `distribution_delivery_fee_total` decimal(12,2) DEFAULT NULL
    COMMENT '分销配送费·总额（= quantity × 单件值）',
  ADD COLUMN `wallet_transaction_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
    COMMENT '关联钱包流水ID，便于对账追溯（§20.4）';


-- -----------------------------------------------------------------------------
-- [STEP ticket_issuance_backfill]
-- [GUARD] ALWAYS
-- [DESC]  §12.2.1 迁移要求 1：对**存量记录**回填 unit = total / quantity（仅 quantity > 0）。
--         幂等：全部带 `IS NULL` 条件，重复执行影响 0 行。
--
--         ⚠️ 文档明确要求：**不得静默四舍五入**，无法整除的记录必须列出交业务确认。
--         执行器（migrate_mini_program_v1.js）会在回填后单独查询并打印这些记录。
--         偏差若需修正，按 §12.5「不允许无痕改历史」走冲正，而非直接 UPDATE。
-- -----------------------------------------------------------------------------
UPDATE `water_ticket_issuance`
   SET `distribution_delivery_fee_total` = `distribution_delivery_fee`
 WHERE `distribution_delivery_fee_total` IS NULL;

UPDATE `water_ticket_issuance`
   SET `distribution_delivery_fee_unit` = ROUND(`distribution_delivery_fee` / `quantity`, 4)
 WHERE `distribution_delivery_fee_unit` IS NULL
   AND `quantity` > 0;


-- -----------------------------------------------------------------------------
-- [STEP drop_sms_codes]
-- [GUARD] HASTABLE:sms_codes
-- [DESC]  §4.1.1 ⚠️ sms_codes 与 mini_accounts 同属上一版小程序残留（短信验证码登录）。
--         新版流程走 wx.login + 微信实名手机号，**不使用短信** → 与 mini_accounts 同批处置。
--         现状核实：全仓库零代码引用（孤儿表）。
--         （守卫用 HASTABLE：**存在才执行** —— 删表类步骤的判定方向与"建表"相反。）
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `sms_codes`;


-- -----------------------------------------------------------------------------
-- [STEP retire_pickup_address_key]
-- [GUARD] ALWAYS
-- [DESC]  ⚠️ 2026-09-20 **自提（PICKUP）业务下线，前后端一并移除。**
--         原 `set_pickup_address_note` 步骤用于登记 `mini_self_pickup_address`
--         （setting_value = NULL，供管理员在 Web 系统设置页填写门店自提地点）。
--         自提下线后**已无任何代码读取该键**（原读取方 services/miniSettings.js 已整体删除），
--         故这里把它**删除**而不是留作空键：
--         留着的坏处是管理员会在系统设置里看到一个「小程序自提地点」并认真填写它，
--         而那个值不再影响任何行为 —— 属于典型的误导性残留配置。
--
--         ⚠️ 与「登记键位」相反，本步骤是**删除**：若将来恢复自提，需要重新登记该键
--         （连同 miniSettings 服务、§10.4.1 口径、前端入口一并恢复）。
--         幂等：DELETE 本身幂等（重跑影响 0 行）。
-- -----------------------------------------------------------------------------
DELETE FROM `system_settings` WHERE `setting_key` = 'mini_self_pickup_address';


-- -----------------------------------------------------------------------------
-- [STEP retire_pickup_column_comments]
-- [GUARD] ALWAYS
-- [DESC]  ⚠️ 列注释是 schema 的自述文档。自提下线后 `PICKUP` / `READY_FOR_PICKUP`
--         这两个取值**不再可能被写入**，但列注释里还写着它们 —— 留着会让后来者
--         按注释去实现已经不存在的能力（本项目已有「注释与实现不一致」的历史教训）。
--
--         ⚠️ 两条 MODIFY 必须**原样保留类型 / 字符集 / 排序规则 / NULL 性，只换 COMMENT**：
--            本项目踩过 collation 不一致导致跨表比较失败的坑（workers vs salesmen），
--            所以这里不做任何「顺手收紧类型」的动作。执行后请用
--              SHOW FULL COLUMNS FROM orders LIKE 'fulfillment%';
--            核对 Type / Collation / Null / Default 与改动前一致。
--         幂等：MODIFY COLUMN 只改注释，重跑结果相同（原类型见下方，可直接对照）。
-- -----------------------------------------------------------------------------
ALTER TABLE `orders` MODIFY COLUMN `fulfillment_type`
  varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '履约方式：DELIVERY=配送（PICKUP=自提已于 2026-09-20 下线，接口不再接受，§10.1.1）';

ALTER TABLE `orders` MODIFY COLUMN `fulfillment_status`
  varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '履约状态：PAID/PROCESSING/DELIVERING/COMPLETED/CANCELED（不含退款态，§16.1；READY_FOR_PICKUP 已随自提下线退役）';


-- =============================================================================
-- 迁移结束。执行后请按仓库规范重导一键部署初始化源：
--     cd backend && node scripts/export_dump.js
-- 并同步文档：docs/项目概览.md（真实数据模型 + 变更记录）
-- =============================================================================

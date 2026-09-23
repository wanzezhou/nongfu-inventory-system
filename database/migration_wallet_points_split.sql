-- ============================================================================
-- 迁移：积分钱包「双积分」拆分（2026-09-23）
-- ----------------------------------------------------------------------------
-- 背景：原积分钱包只有单一余额 `balance`。业务要求区分两类积分：
--   ① 充值积分（管理员后台设置，原 RECHARGE / ADJUST_IN）
--   ② 配送费积分（返货配送费 1 元 = 1 配送费积分，来自水票发行入账）
-- 两类可**混合**用于小程序下单抵扣，但必须**分别可见、分别记账、分别回冲**。
--
-- 设计要点（与项目资金铁律一致）：
--   * 保留 `balance` 作为**总余额**（恒等式「余额 = 期初 + 流水净额」不变），
--     新增两个分账户列，事务内维持 `balance = recharge_balance + delivery_fee_balance`；
--   * 流水新增 `points_type` 标明本笔作用于哪类积分；混合扣款拆成两条流水；
--   * 流水新增 `points_month`（仅配送费积分入账填写发行月份），用于「按月发放明细」。
--
-- 幂等：MySQL 的 ADD COLUMN 无 IF NOT EXISTS，**本文件重复执行会报 Duplicate column**。
--       请通过 backend/scripts/migrate_wallet_points_split.js 执行（含存在性判断与核对）。
-- 回滚：database/rollback_wallet_points_split.sql
-- ============================================================================

ALTER TABLE `wallet_accounts`
  ADD COLUMN `recharge_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00
    COMMENT '充值积分余额（管理员后台设置，可与配送费积分混合抵扣）' AFTER `balance`,
  ADD COLUMN `delivery_fee_balance` DECIMAL(14,2) NOT NULL DEFAULT 0.00
    COMMENT '配送费积分余额（返货配送费 1 元 = 1 积分，来源水票发行）' AFTER `recharge_balance`;

ALTER TABLE `wallet_transactions`
  ADD COLUMN `points_type` ENUM('RECHARGE','DELIVERY_FEE') NOT NULL DEFAULT 'RECHARGE'
    COMMENT '积分类型：RECHARGE=充值积分 DELIVERY_FEE=配送费积分' AFTER `amount`,
  ADD COLUMN `points_month` VARCHAR(7) NULL
    COMMENT '配送费积分发行月份 YYYY-MM（仅 DELIVERY_FEE 入账填写，用于按月发放明细）' AFTER `points_type`;

-- 存量回填：历史流水（若有）一律归「充值积分」—— 双积分拆分前的余额都来自
-- 管理员调整或旧的充值，语义上等同充值积分；分账户余额初始化为对应类型净额。
UPDATE `wallet_accounts` w
SET w.recharge_balance = w.balance,
    w.delivery_fee_balance = 0.00
WHERE w.recharge_balance = 0.00 AND w.delivery_fee_balance = 0.00 AND w.balance <> 0.00;

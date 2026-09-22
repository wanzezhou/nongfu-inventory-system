// 微信订货小程序 · 枚举与常量单一来源
// ===========================================================================
// 事实源：《农夫库存管理系统微信订货小程序 产品需求、业务规则与技术开发文档 V1.1》
//   §4.1   角色（3 个：ADMIN / SALESMAN / STATION）
//   §6.2   订单新增字段取值
//   §11.4  钱包流水类型
//   §16    履约状态 / 退款状态
//   §51    令牌契约
//
// ⚠️ 本文件是**取值集合的唯一来源**：DB 层刻意用 varchar 而非 ENUM（便于扩展，
//    且避免每次加取值都要迁移），因此「合法取值」这件事只能靠这里收口。
//    任何 controller/service 都不得内联字符串字面量做校验。
// ===========================================================================

// ── 角色（§4.1）─────────────────────────────────────────────────────────────
// ⚠️ 上一版的 `worker`（配送员工）角色已随小程序删除，mini_accounts.role 枚举已在
//    migration_mini_program_v1.sql 中裁剪。这里只保留 3 个。
const MINI_ROLES = {
  ADMIN: 'admin',
  SALESMAN: 'salesman',
  STATION: 'station'
};
const MINI_ROLE_VALUES = Object.values(MINI_ROLES);

// 角色 → 钱包主体类型（admin 无钱包）
const ROLE_TO_OWNER_TYPE = {
  [MINI_ROLES.SALESMAN]: 'SALESMAN',
  [MINI_ROLES.STATION]: 'STATION'
};

// ── 订单新增字段（§6.2 / §16）────────────────────────────────────────────────
const ORDER_SOURCE = { WEB: 'WEB', MINI_PROGRAM: 'MINI_PROGRAM' };
const ORDER_SOURCE_VALUES = Object.values(ORDER_SOURCE);

const BUYER_TYPE = { SALESMAN: 'SALESMAN', STATION: 'STATION' };
const BUYER_TYPE_VALUES = Object.values(BUYER_TYPE);

const PAYMENT_METHOD = {
  EXISTING: 'EXISTING', // 沿用既有记账（Web 订单）
  WALLET: 'WALLET', // 积分钱包（小程序订单）
  OTHER: 'OTHER' // 仅兼容历史，不用于新小程序
};
const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD);

// 履约方式：怎么取货（§10.1.1）—— 与 delivery_type（谁去送）是两个维度
//
// ⚠️ **自提（PICKUP）已于 2026-09-20 业务决定下线，前后端一并移除。**
//    因此这里只剩 DELIVERY 一个值，且**必须保持只有这一个值**：
//    下单入口采用**白名单**校验（见 miniOrderService.createMiniOrder ②），
//    重新加回 PICKUP 常量会让接口重新接受自提 —— 但前端已无自提入口与展示，
//    会立刻形成「界面不可达、接口可达」的半状态。要恢复自提请走完整批次。
//    同日一并作废的还有「自提订单 delivery_type 取 3」那个决策（见 git 历史与
//    docs/小程序开发说明.md 的变更说明）：既然不再有自提订单，该取值不再需要裁决。
const FULFILLMENT_TYPE = { DELIVERY: 'DELIVERY' };
const FULFILLMENT_TYPE_VALUES = Object.values(FULFILLMENT_TYPE);

// 履约状态（§16）：**不含退款态**（退款态见 REFUND_STATUS）
//
// ⚠️ READY_FOR_PICKUP（待自提）已随自提下线一并**退役**（2026-09-20）。
//    该值在数据库里仍是合法 varchar（列无 CHECK 约束），但**没有任何代码路径能写入它** ——
//    若将来恢复自提，需要同时把状态、前端筛选页签、待办统计一并加回。
const FULFILLMENT_STATUS = {
  PAID: 'PAID', // 已支付
  PROCESSING: 'PROCESSING', // 备货中
  DELIVERING: 'DELIVERING', // 配送中
  COMPLETED: 'COMPLETED', // 已完成
  CANCELED: 'CANCELED' // 已取消
};
const FULFILLMENT_STATUS_VALUES = Object.values(FULFILLMENT_STATUS);

// 退款状态（§16.1）：独立成列，不与 payment_status 复用、不与 canceled_at 混用
const REFUND_STATUS = {
  NONE: 'NONE', // 未退款（默认）
  REFUNDING: 'REFUNDING', // 退款中
  REFUNDED: 'REFUNDED' // 已退款
};

// 业务员订货场景（§7.1）
const ORDER_SCENE = {
  SELF_PURCHASE: 'SELF_PURCHASE', // 业务员自己订货
  CUSTOMER_ORDER: 'CUSTOMER_ORDER' // 业务员代客户订货
};
const ORDER_SCENE_VALUES = Object.values(ORDER_SCENE);

// 订单类型（复用既有编号，**不新造 type 7**，§6.3/§6.4）
const MINI_ORDER_TYPE = { STATION: 2, SALESMAN: 3 };

// ── delivery_type 取值 ────────────────────────────────────────────────────────
// 既有取值语义（database/full_schema_data.sql 的列注释为准）：
//   1 = 自有员工配送   2 = 水站配送   3 = 无需配送
// （注：前端 ProductSales.vue 把 3 显示为「机台配送」，列注释写的是「无需配送」；
//   本模块不参与该歧义的裁决 —— 小程序配送单一律由 resolveDeliveryExecution
//   复用既有逻辑取 1 或 2，展示以 fulfillment_type 为准。）
//
// ⚠️ 2026-09-20：原先为「自提订单」定义的 `PICKUP_DELIVERY_TYPE = 3` 已随自提下线**删除**。
//    不要再为了「某个不配送的场景」把它加回来 —— 那属于重新引入自提语义。

// ── 钱包（§11）────────────────────────────────────────────────────────────────
const WALLET_OWNER_TYPE = { SALESMAN: 'SALESMAN', STATION: 'STATION' };
const WALLET_OWNER_TYPE_VALUES = Object.values(WALLET_OWNER_TYPE);

const WALLET_TX_TYPE = {
  RECHARGE: 'RECHARGE', // 微信充值
  DISTRIBUTION_FEE: 'DISTRIBUTION_FEE', // 水票发行产生分销配送费积分
  ORDER_PAYMENT: 'ORDER_PAYMENT', // 订单消费
  REFUND: 'REFUND', // 退款
  DISTRIBUTION_FEE_REVERSAL: 'DISTRIBUTION_FEE_REVERSAL', // 水票作废/发行冲正导致积分扣回
  ADJUST_IN: 'ADJUST_IN', // 管理员增加积分
  ADJUST_OUT: 'ADJUST_OUT' // 管理员扣减积分
};

// ⚠️ 资金方向显式落库（wallet_transactions.direction）——这是本仓库真实踩过的坑：
//   「收入类流水的撤销是 −amount，抄成 + 会变成"撤一次反而再加一笔"，而恒等式看起来仍然成立」
//   （.workbuddy/memory/MEMORY.md 第一条 / 文档 §11.7 第 5 条）。
//   用「类型反推方向」正是该坑的成因，故方向只看这张表，不看类型。
const TX_DIRECTION = { IN: 1, OUT: 2 };

const TX_TYPE_DIRECTION = {
  [WALLET_TX_TYPE.RECHARGE]: TX_DIRECTION.IN,
  [WALLET_TX_TYPE.DISTRIBUTION_FEE]: TX_DIRECTION.IN,
  [WALLET_TX_TYPE.ORDER_PAYMENT]: TX_DIRECTION.OUT,
  [WALLET_TX_TYPE.REFUND]: TX_DIRECTION.IN,
  [WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL]: TX_DIRECTION.OUT,
  [WALLET_TX_TYPE.ADJUST_IN]: TX_DIRECTION.IN,
  [WALLET_TX_TYPE.ADJUST_OUT]: TX_DIRECTION.OUT
};

/** 流水类型 → 中文名（下发给小程序，前端不再维护一份映射） */
const TX_TYPE_LABEL = {
  [WALLET_TX_TYPE.RECHARGE]: '充值',
  [WALLET_TX_TYPE.DISTRIBUTION_FEE]: '分销配送费积分',
  [WALLET_TX_TYPE.ORDER_PAYMENT]: '订单消费',
  [WALLET_TX_TYPE.REFUND]: '退款',
  [WALLET_TX_TYPE.DISTRIBUTION_FEE_REVERSAL]: '分销配送费冲回',
  [WALLET_TX_TYPE.ADJUST_IN]: '管理员增加积分',
  [WALLET_TX_TYPE.ADJUST_OUT]: '管理员扣减积分'
};

// 钱包流水的关联业务类型
const WALLET_RELATED_TYPE = {
  ORDER: 'ORDER',
  WATER_TICKET_ISSUANCE: 'WATER_TICKET_ISSUANCE',
  WATER_TICKET: 'WATER_TICKET',
  PAYMENT: 'PAYMENT',
  MANUAL_ADJUST: 'MANUAL_ADJUST'
};

// ── 幂等（§23.1）────────────────────────────────────────────────────────────
const IDEM_SCOPE = {
  CREATE_ORDER: 'CREATE_ORDER',
  REFUND: 'REFUND',
  WALLET_ADJUST: 'WALLET_ADJUST',
  // ── Phase 8b 管理员写操作（§23.1：移动端弱网重试必须能安全重放，逐域追加）──
  CREATE_EXPENSE: 'CREATE_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',
  CREATE_INCOME: 'CREATE_INCOME',
  UPDATE_INCOME: 'UPDATE_INCOME',
  DELETE_INCOME: 'DELETE_INCOME',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DISABLE_PRODUCT: 'DISABLE_PRODUCT',
  // ── Phase 8b 主数据四域（与上面 AUDIT_ACTION 一一对应）
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  UPDATE_SUPPLIER: 'UPDATE_SUPPLIER',
  DISABLE_SUPPLIER: 'DISABLE_SUPPLIER',
  CREATE_WORKER: 'CREATE_WORKER',
  UPDATE_WORKER: 'UPDATE_WORKER',
  DISABLE_WORKER: 'DISABLE_WORKER',
  CREATE_STATION: 'CREATE_STATION',
  UPDATE_STATION: 'UPDATE_STATION',
  DISABLE_STATION: 'DISABLE_STATION',
  CREATE_MACHINE: 'CREATE_MACHINE',
  UPDATE_MACHINE: 'UPDATE_MACHINE',
  DISABLE_MACHINE: 'DISABLE_MACHINE',
  // ── Phase 8b 第 8 域 库存（入库/出库/作废）——
  //    ⚠️ 只有三个动作：库存没有「改一笔」的语义。入库单记错了要**作废重开**
  //      （作废会回退库存 + 原路退回款项），不允许直接编辑历史入库单 ——
  //      直接把数量改掉会让账实关系失去可追溯性（资金流水与库存变动都对不上单据）。
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  VOID_PURCHASE: 'VOID_PURCHASE',
  // ── Phase 8b 第 9 域 订单（履约推进 / 管理员取消）──
  //    ⚠️ 管理员取消与业务员取消（既有 CANCEL_ORDER）分开记：二者可取消范围不同
  //      （任意订单 vs 自己的未发货订单），审计里要能区分是谁在什么范围内操作。
  ADVANCE_ORDER: 'ADVANCE_ORDER',
  CANCEL_ORDER_ADMIN: 'CANCEL_ORDER_ADMIN',
  // ── Phase 8b 第 10 域 公司账户（新增/编辑/删除/转账）──
  //    ⚠️ 转账是**双边余额 + 双流水**动作，单独一个审计动作（不是两个「余额调整」），
  //      否则审计里看不出「这两笔变动是同一次转账的两条腿」。
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  UPDATE_ACCOUNT: 'UPDATE_ACCOUNT',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  TRANSFER_ACCOUNT: 'TRANSFER_ACCOUNT',
  // ── Phase 8b 第 11 域 工资（发放/撤销发放/预支/撤销预支）──
  //    ⚠️ 发放与预支**都要幂等键**，而且理由比转账更硬：
  //      工资发放对「同一员工同一月」有唯一约束，弱网重试第二次会被业务校验挡下（不会重复发钱）；
  //      但**预支没有这个约束** —— 重试一次就是真的再预支一笔、账户再扣一次，
  //      且两笔都合法、账面看不出来。所以两个都必须带键。
  //    ⚠️ 撤销类（REVOKE/DELETE）同样要键：撤销是「回补余额」的正向资金动作，
  //      重放一次 = 余额多加一次（这正是本仓库铁律里「撤销方向抄反」的同类风险）。
  PAY_SALARY: 'PAY_SALARY',
  REVOKE_SALARY_PAYMENT: 'REVOKE_SALARY_PAYMENT',
  CREATE_SALARY_ADVANCE: 'CREATE_SALARY_ADVANCE',
  DELETE_SALARY_ADVANCE: 'DELETE_SALARY_ADVANCE',
  // ── Phase 8b 第 16 域 回桶（押金登记 / 桶型配置三动作）──
  //    ⚠️ 押金登记是**资金动作**（收取=账户+ / 退回=账户−），且没有「同单号唯一」之类的
  //      天然约束 —— 弱网重试一次就是真的再收/再退一笔押金，两笔都合法。必须带幂等键。
  //    ⚠️ 桶型配置的三个动作同样带键：配置类写操作的重放不会直接动钱，但会让
  //      「谁在什么时候把押金价从 30 改成 50」出现两条一模一样、却无法区分真假的审计。
  CREATE_BARREL_DEPOSIT: 'CREATE_BARREL_DEPOSIT',
  CREATE_BARREL_CONFIG: 'CREATE_BARREL_CONFIG',
  UPDATE_BARREL_CONFIG: 'UPDATE_BARREL_CONFIG',
  DELETE_BARREL_CONFIG: 'DELETE_BARREL_CONFIG',
  // ── Phase 8b 第 17 域 系统设置（打印店长）──
  //    ⚠️ 只有一个动作、只改一行配置，但它决定「客户回拨的是谁的电话」——
  //      重放不会造成账面问题，却会让审计里出现两条无法区分的记录。仍按定式带键。
  UPDATE_SETTING: 'UPDATE_SETTING',
  // ── Phase 8b 第 15 域 水票 · Phase 7 补齐（发行 + 改数量）──
  //    ⚠️ 与「只做手机端接入」的那一批不同：这一批**先把 Web 侧的定价权收回到服务端**
  //      （§12.6 单件值落库 / §12.10 服务端重取 / §12.9 停用两个改历史金额的端点），
  //      再开放手机端发行 —— 顺序反了就是「前端传多少，公司就欠水站多少积分」。
  //    ⚠️ 发行与改数量都是**资金动作**（水站钱包入账 / 回冲）：弱网重试一次就是真的多发一笔
  //      积分，两笔都合法、账面看不出异常。必须带幂等键。
  CANCEL_TICKET_ADMIN: 'CANCEL_TICKET_ADMIN',
  ISSUE_TICKET_ADMIN: 'ISSUE_TICKET_ADMIN',
  UPDATE_TICKET_ISSUANCE_ADMIN: 'UPDATE_TICKET_ISSUANCE_ADMIN',
  // ── 运维域 小程序账号管理（禁用/启用、改绑定、解绑）──
  //    ⚠️ 这三个动作都**不直接动钱**，但都会改变「谁能操作钱」：
  //      禁用后该微信写操作立即 401；改绑定/解绑会让旧令牌立即失效。
  //      重放一次会让审计里出现两条无法区分真假的记录（「谁在什么时候把谁禁了」），
  //      故同样按定式带键。
  UPDATE_MINI_ACCOUNT_STATUS: 'UPDATE_MINI_ACCOUNT_STATUS',
  UPDATE_MINI_ACCOUNT_BINDING: 'UPDATE_MINI_ACCOUNT_BINDING',
  UNBIND_MINI_ACCOUNT: 'UNBIND_MINI_ACCOUNT'
};
/** 服务端保留幂等键至少 24h（覆盖「用户离线数小时后重试」，§23.1） */
const IDEM_TTL_HOURS = 24;
/** 客户端幂等键长度上限（§23.1 要求 ≤64） */
const IDEM_KEY_MAX_LEN = 64;

// ── 令牌契约（§51）────────────────────────────────────────────────────────────
// ⚠️ 小程序令牌与 Web 令牌必须隔离。这里用独立密钥（JWT_SECRET_MINI）+ 独立
//    aud/iss 双保险：即便将来有人把密钥配成同一个，auth / miniAuth 仍会因
//    aud/iss 不匹配而双向拒绝（§51.2 第 1 条「不能只依赖密钥不同这一隐含屏障」）。
const MINI_TOKEN_AUDIENCE = 'nongfu-mini-program';
const MINI_TOKEN_ISSUER = 'nongfu-inventory-backend';
/** 小程序令牌取短（§4.5.1 / §51.1 建议 ≤ 2h），把「禁用生效延迟」压到可接受范围 */
const MINI_TOKEN_TTL = process.env.MINI_TOKEN_TTL || '2h';
/** 超过生命周期这个比例时，/me 顺带下发新令牌（滑动续期，不额外开接口） */
const MINI_TOKEN_RENEW_AFTER = 0.5;

// ── 审计动作（§40）──────────────────────────────────────────────────────────
const AUDIT_ACTION = {
  BIND: 'BIND',
  LOGIN: 'LOGIN',
  DISABLE_ACCOUNT: 'DISABLE_ACCOUNT',
  SET_PRODUCT_MIN_PRICE: 'SET_PRODUCT_MIN_PRICE',
  CREATE_ORDER: 'CREATE_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
  REFUND_ORDER: 'REFUND_ORDER',
  ISSUE_TICKET: 'ISSUE_TICKET',
  VOID_TICKET: 'VOID_TICKET',
  REVERSE_DISTRIBUTION_FEE: 'REVERSE_DISTRIBUTION_FEE',
  WALLET_ADJUST: 'WALLET_ADJUST',
  // ── Phase 8b 管理员写操作（§40 审计：每个写域都要落，逐域追加）──────────
  CREATE_EXPENSE: 'CREATE_EXPENSE',
  UPDATE_EXPENSE: 'UPDATE_EXPENSE',
  DELETE_EXPENSE: 'DELETE_EXPENSE',
  CREATE_INCOME: 'CREATE_INCOME',
  UPDATE_INCOME: 'UPDATE_INCOME',
  DELETE_INCOME: 'DELETE_INCOME',
  CREATE_PRODUCT: 'CREATE_PRODUCT',
  UPDATE_PRODUCT: 'UPDATE_PRODUCT',
  DISABLE_PRODUCT: 'DISABLE_PRODUCT',
  // 注：改到最低价时**额外**记一条既有常量 SET_PRODUCT_MIN_PRICE（本对象上方，第一期已定义）——
  //     价格体系的关键变更值得单独可追溯，不该淹没在 UPDATE_PRODUCT 的 detail 里。
  // ── Phase 8b 主数据四域（供应商/员工/水站/机台）——
  //    四个域由 `_masterFactory.js` 统一构造，动作名按域展开（不用拼接，
  //    这样 grep 一个动作名能立刻定位到域，审计表里也不会出现意料外的动作字符串）
  CREATE_SUPPLIER: 'CREATE_SUPPLIER',
  UPDATE_SUPPLIER: 'UPDATE_SUPPLIER',
  DISABLE_SUPPLIER: 'DISABLE_SUPPLIER',
  CREATE_WORKER: 'CREATE_WORKER',
  UPDATE_WORKER: 'UPDATE_WORKER',
  DISABLE_WORKER: 'DISABLE_WORKER',
  CREATE_STATION: 'CREATE_STATION',
  UPDATE_STATION: 'UPDATE_STATION',
  DISABLE_STATION: 'DISABLE_STATION',
  CREATE_MACHINE: 'CREATE_MACHINE',
  UPDATE_MACHINE: 'UPDATE_MACHINE',
  DISABLE_MACHINE: 'DISABLE_MACHINE',
  // ── Phase 8b 第 8 域 库存（入库/出库/作废）——
  //    ⚠️ 只有三个动作：库存没有「改一笔」的语义。入库单记错了要**作废重开**
  //      （作废会回退库存 + 原路退回款项），不允许直接编辑历史入库单 ——
  //      直接把数量改掉会让账实关系失去可追溯性（资金流水与库存变动都对不上单据）。
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  VOID_PURCHASE: 'VOID_PURCHASE',
  // ── Phase 8b 第 9 域 订单（履约推进 / 管理员取消）——
  //    推进用幂等键：同一「目标状态」重放 = 无变化（弱网点两下「开始配送」不该出两条审计）；
  //    管理员取消与业务员取消（CANCEL_ORDER）分开记：二者的可取消范围不同（任意单 vs 自己的未发货单）。
  ADVANCE_ORDER: 'ADVANCE_ORDER',
  CANCEL_ORDER_ADMIN: 'CANCEL_ORDER_ADMIN',
  // ── Phase 8b 第 10 域 公司账户（新增/编辑/删除/转账）──
  //    ⚠️ 转账必须带幂等键：弱网重试一次转账 = 两边各动两次，而每次动作都是合法的、
  //      总额也守恒 —— 账面看不出异常，只有对手方流水条数会翻倍。
  CREATE_ACCOUNT: 'CREATE_ACCOUNT',
  UPDATE_ACCOUNT: 'UPDATE_ACCOUNT',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
  TRANSFER_ACCOUNT: 'TRANSFER_ACCOUNT',
  // ── Phase 8b 第 11 域 工资（发放/撤销发放/预支/撤销预支）──
  //    ⚠️ 四个动作**都**落审计，`actor_id = mini:<accountId>`：工资是唯一
  //      「公司对个人」的资金动作，出问题时第一个被问的就是「谁在什么时候发的」。
  PAY_SALARY: 'PAY_SALARY',
  REVOKE_SALARY_PAYMENT: 'REVOKE_SALARY_PAYMENT',
  CREATE_SALARY_ADVANCE: 'CREATE_SALARY_ADVANCE',
  DELETE_SALARY_ADVANCE: 'DELETE_SALARY_ADVANCE',
  // ── Phase 8b 第 16 域 回桶 ──
  //    ⚠️ 四个动作都落审计：押金台账是「公司欠客户多少桶、客户欠公司多少押金」的凭据，
  //      出问题时第一个被问的就是「这笔押金是谁什么时候收的」。
  CREATE_BARREL_DEPOSIT: 'CREATE_BARREL_DEPOSIT',
  CREATE_BARREL_CONFIG: 'CREATE_BARREL_CONFIG',
  UPDATE_BARREL_CONFIG: 'UPDATE_BARREL_CONFIG',
  DELETE_BARREL_CONFIG: 'DELETE_BARREL_CONFIG',
  // ── Phase 8b 第 17 域 系统设置 ──
  //    ⚠️ 审计 detail 里记 before/after 的**人**（不只是 id）：
  //      打印配置的变更只对「电话是谁的」有意义，光记 id 事后要再查一次员工表才知道换成了谁。
  UPDATE_SETTING: 'UPDATE_SETTING',
  // ── Phase 8b 第 15 域 水票（作废单张 + Phase 7 补齐的发行/改数量）──
  //    与业务员侧的 CANCEL_ORDER 不同名：这里是管理员在管理端作废任意一张未用票，
  //    审计里要能区分「谁在什么端作废的」。
  CANCEL_TICKET_ADMIN: 'CANCEL_TICKET_ADMIN',
  //    ⚠️ 发行与改数量的审计 detail 必须记**金额与单件值**（不只是数量）：
  //      这两个动作会给水站入账/回冲积分，事后核账要能一眼看出「这次动了多少钱」。
  ISSUE_TICKET_ADMIN: 'ISSUE_TICKET_ADMIN',
  UPDATE_TICKET_ISSUANCE_ADMIN: 'UPDATE_TICKET_ISSUANCE_ADMIN',
  // ── 运维域 小程序账号管理 ──
  //    ⚠️ detail 必须记 before/after（status 或 role+target）：本域动作的结果是
  //      「某个人从此刻起能不能操作系统」，只记「改过了」事后无法还原判断依据。
  UPDATE_MINI_ACCOUNT_STATUS: 'UPDATE_MINI_ACCOUNT_STATUS',
  UPDATE_MINI_ACCOUNT_BINDING: 'UPDATE_MINI_ACCOUNT_BINDING',
  UNBIND_MINI_ACCOUNT: 'UNBIND_MINI_ACCOUNT'
};

// ── 分页（⚠️ mysql2 不支持 LIMIT ?，必须 parseInt 内联）────────────────────
const MINI_PAGE = {
  DEFAULT_SIZE: 10,
  MAX_SIZE: 50
};

// ── 业务提示文案（集中，便于前后端口径一致）──────────────────────────────────
const MINI_MESSAGE = {
  DISABLED_ACCOUNT: '账号已被禁用，如有疑问请联系管理员',
  DISABLED_SUBJECT: '绑定的主体已被停用，无法继续操作，请联系管理员',
  NEED_BIND: '尚未绑定身份，请使用微信手机号完成绑定',
  // 履约方式不合法 / 传了已下线的自提。对正常小程序用户不可达（前端已无自提入口），
  // 只可能出现在抓包或脚本构造的请求里，所以文案直接说清「本期只支持配送」。
  FULFILLMENT_INVALID: '配送方式不正确，本期仅支持「配送」',
  WECHAT_PAY_NOT_OPEN: '微信充值尚未开通（微信支付资质未就绪），请联系管理员为账号调增积分'
};

module.exports = {
  MINI_ROLES,
  MINI_ROLE_VALUES,
  ROLE_TO_OWNER_TYPE,
  ORDER_SOURCE,
  ORDER_SOURCE_VALUES,
  BUYER_TYPE,
  BUYER_TYPE_VALUES,
  PAYMENT_METHOD,
  PAYMENT_METHOD_VALUES,
  FULFILLMENT_TYPE,
  FULFILLMENT_TYPE_VALUES,
  FULFILLMENT_STATUS,
  FULFILLMENT_STATUS_VALUES,
  REFUND_STATUS,
  ORDER_SCENE,
  ORDER_SCENE_VALUES,
  MINI_ORDER_TYPE,
  WALLET_OWNER_TYPE,
  WALLET_OWNER_TYPE_VALUES,
  WALLET_TX_TYPE,
  TX_DIRECTION,
  TX_TYPE_DIRECTION,
  TX_TYPE_LABEL,
  WALLET_RELATED_TYPE,
  IDEM_SCOPE,
  IDEM_TTL_HOURS,
  IDEM_KEY_MAX_LEN,
  MINI_TOKEN_AUDIENCE,
  MINI_TOKEN_ISSUER,
  MINI_TOKEN_TTL,
  MINI_TOKEN_RENEW_AFTER,
  AUDIT_ACTION,
  MINI_PAGE,
  MINI_MESSAGE
};

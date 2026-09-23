import request from './request'

// 积分钱包管理（Web 管理端）—— 双积分：充值积分 / 配送费积分
//
// ⚠️ 本模块读写的都是**他人**的资产，后端整域 requireAdmin（读也是如此）。
//
// ⚠️ adjustWallet 必须带 clientRequestId（幂等键，服务端强校验）：
//    「管理员重复点击增加积分」是本仓库明确列为必测的场景（§45）——
//    没有幂等键时，误触两次就是真的加两次钱，且两笔都合法、账面看不出异常。
//    键由页面在**打开调整弹窗时**生成一次，成功后不重复使用。
export const getWallets = params => request.get('/wallets', { params }) // 主体钱包总览（含未开立）
export const openWallet = data => request.post('/wallets/open', data) // 为主体开立积分钱包（天然幂等）
export const adjustWallet = (walletId, data) => request.post(`/wallets/${walletId}/adjust`, data) // 增减积分
export const getWalletTransactions = (walletId, params) => request.get(`/wallets/${walletId}/transactions`, { params }) // 流水 + 按月明细 + 区间对账

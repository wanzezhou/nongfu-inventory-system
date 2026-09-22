import request from './request'

// 水站账户管理（水票系统）
export const issueTickets = data => request.post('/water-tickets/issue', data) // 返货清单录入/发行
export const getTicketInventory = params => request.get('/water-tickets/inventory', { params }) // 水站账户详情（水票余额）
export const getIssuanceList = params => request.get('/water-tickets/issuances', { params }) // 发行记录
export const updateIssuance = (id, data) => request.put(`/water-tickets/issuances/${id}`, data) // 编辑发行记录（管理员）
export const adjustBalance = data => request.post('/water-tickets/adjust-balance', data) // 水站账户调整（管理员）
// ⚠️ adjust-delivery-fee / adjust-station-delivery-fee 已于 2026-09-22 **停用**（Phase 7 §12.9）：
//    它们的能力是「直接改历史发行金额」，而发行金额现在是水站的积分（钱）。
//    端点保留（返回 410），前端不再提供入口；确需修正请新增对冲发行记录。
export const deleteIssuanceBatch = batchId => request.delete(`/water-tickets/issuances/batch/${batchId}`) // 删除发行批次（管理员）

import request from './request'

// 水站返货管理（水票系统）
export const issueTickets = (data) => request.post('/water-tickets/issue', data)       // 返货清单录入/发行
export const getTicketInventory = (params) => request.get('/water-tickets/inventory', { params })  // 水站账户详情（水票余额）
export const getTicketList = (params) => request.get('/water-tickets/list', { params })            // 水票明细
export const cancelTicket = (id) => request.post(`/water-tickets/${id}/cancel`)                    // 作废水票
export const getIssuanceList = (params) => request.get('/water-tickets/issuances', { params })     // 发行记录
export const updateIssuance = (id, data) => request.put(`/water-tickets/issuances/${id}`, data)    // 编辑发行记录（管理员）
export const adjustBalance = (data) => request.post('/water-tickets/adjust-balance', data)          // 水站账户调整（管理员）
export const adjustDeliveryFee = (data) => request.post('/water-tickets/adjust-delivery-fee', data)  // 分销配送费余额调整（管理员）
export const adjustStationDeliveryFee = (data) => request.post('/water-tickets/adjust-station-delivery-fee', data) // 水站级分销配送费调整（管理员）

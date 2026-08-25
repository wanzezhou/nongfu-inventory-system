import request from './request'

// 水站返货管理（水票系统）
export const issueTickets = (data) => request.post('/water-tickets/issue', data)       // 返货清单录入/发行
export const getTicketInventory = (params) => request.get('/water-tickets/inventory', { params })  // 水票库存
export const getTicketList = (params) => request.get('/water-tickets/list', { params })            // 水票明细
export const cancelTicket = (id) => request.post(`/water-tickets/${id}/cancel`)                    // 作废水票
export const getIssuanceList = (params) => request.get('/water-tickets/issuances', { params })     // 发行记录

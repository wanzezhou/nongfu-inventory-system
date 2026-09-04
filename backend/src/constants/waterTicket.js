/**
 * 水票状态常量（单一事实来源）
 * water_tickets.status；此前语义只存在于注释、各处以魔法数字 1/2/3 出现（2026-09-04 抽常量）
 */
const TICKET_STATUS = {
  UNUSED: 1,  // 未用（可被订单抵扣）
  USED: 2,    // 已核销（已被订单抵扣）
  VOID: 3     // 已作废
};

const TICKET_STATUS_NAMES = {
  [TICKET_STATUS.UNUSED]: '未用',
  [TICKET_STATUS.USED]: '已核销',
  [TICKET_STATUS.VOID]: '作废'
};

module.exports = { TICKET_STATUS, TICKET_STATUS_NAMES };

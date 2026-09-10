/**
 * 回桶管理常量（与前端 constants 保持一致）
 */
const DEPOSIT_TYPES = {
  COLLECT: 'collect', // 收取押金
  RETURN: 'return'    // 退回押金
};

const PARTY_TYPES = {
  STATION: 'station',   // 水站
  CUSTOMER: 'customer'  // 零售客户
};

module.exports = {
  DEPOSIT_TYPES,
  PARTY_TYPES
};

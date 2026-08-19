function getOrderScope(miniUser) {
  switch (miniUser.role) {
    case 'admin':    return {};
    case 'worker':   return { 'o.worker_id': miniUser.targetId };
    case 'station':  return { 'o.station_id': miniUser.targetId };
    case 'salesman': return { 'o.created_by': miniUser.targetId };
    default:         return { '1': 0 };
  }
}

function getDepositScope(miniUser) {
  switch (miniUser.role) {
    case 'admin':    return {};
    case 'worker':   return { 'd.handler_id': miniUser.targetId };
    case 'station':  return { 'd.station_id': miniUser.targetId };
    case 'salesman': return { 'd.handler_id': miniUser.targetId };
    default:         return { '1': 0 };
  }
}

function getReimburseScope(miniUser) {
  switch (miniUser.role) {
    case 'admin':    return {};
    default:         return { 'r.applicant_id': miniUser.targetId };
  }
}

module.exports = { getOrderScope, getDepositScope, getReimburseScope };

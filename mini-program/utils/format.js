function formatAmount(n) {
  if (n === null || n === undefined || n === '') return '0.00';
  const num = Number(n);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}

function formatDate(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maskPhone(p) {
  if (!p || p.length < 11) return p || '';
  return p.substr(0, 3) + '****' + p.substr(7);
}

const ORDER_TYPE_LABELS = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '零售机供货',
  5: '线下水站返货'
};
function orderTypeLabel(t) { return ORDER_TYPE_LABELS[t] || '未知类型'; }

function allowedOrderTypes(role) {
  switch (role) {
    case 'worker':   return [1, 3];
    case 'station':  return [2, 5];
    case 'admin':
    case 'salesman': return [1, 2, 3, 4, 5];
    default: return [];
  }
}

const ROLE_LABELS = {
  admin: '管理员',
  worker: '配送员工',
  station: '水站负责人',
  salesman: '业务员'
};
function roleLabel(r) { return ROLE_LABELS[r] || r || ''; }

function stockClass(qty) {
  if (qty === undefined || qty === null || qty === '') return 'stock-zero';
  const n = Number(qty);
  if (n < 0) return 'stock-negative';
  if (n === 0) return 'stock-zero';
  if (n < 50) return 'stock-low';
  if (n < 200) return 'stock-mid';
  if (n < 1000) return 'stock-good';
  return 'stock-plenty';
}

module.exports = {
  formatAmount, formatDate, maskPhone,
  orderTypeLabel, allowedOrderTypes,
  roleLabel, stockClass
};

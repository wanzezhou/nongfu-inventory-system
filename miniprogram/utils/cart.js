// 购物车（本地存储）
// ===========================================================================
// ⚠️ 关键设计：购物车**只存「选了什么、选了几个」，不存价格**。
//    文档 §22.1 / §22.6 明确「前端传入的 subtotal / orderAmount / totalAmount 一律不可信，
//    服务端必须重算」。若购物车缓存了价格，就会出现「加购时 18 元、下单时档案改成 20 元，
//    用户看到的还是 18」这类不一致 —— 而且它是**前端算出来的金额**，直接违反该条。
//    因此购物车只保留 productId / quantity / 水票选择，价格一律在下单页拉服务端最新值。
//
// 存储结构（按主体隔离，避免换账号后购物车串号）：
//   { ownerKey: 'SALESMAN:SM001', items: [ { productId, quantity, useTicket, ticketQty } ] }
// ===========================================================================
const { STORAGE_KEYS } = require('../config/index');

/** 变更订阅者（tabBar 角标、页面刷新用） */
const listeners = [];

function onCartChange(fn) {
  if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emit() {
  const snapshot = summary();
  listeners.slice().forEach(fn => {
    try {
      fn(snapshot);
    } catch (e) {
      console.warn('[cart] 订阅回调异常：', e);
    }
  });
}

/** 购物车按「主体」隔离 —— 业务员与水站的购物车不能互相看到 */
let ownerKey = 'GUEST';
function setOwner(key) {
  const next = key || 'GUEST';
  if (next !== ownerKey) {
    ownerKey = next;
    emit();
  }
}

function readAll() {
  try {
    return wx.getStorageSync(STORAGE_KEYS.CART) || {};
  } catch (e) {
    return {};
  }
}

function writeAll(all) {
  try {
    wx.setStorageSync(STORAGE_KEYS.CART, all || {});
  } catch (e) {
    console.warn('[cart] 写入失败：', e);
  }
}

/** 当前主体的条目 */
function items() {
  const all = readAll();
  const list = all[ownerKey];
  return Array.isArray(list) ? list.slice() : [];
}

function saveItems(list) {
  const all = readAll();
  all[ownerKey] = list;
  writeAll(all);
  emit();
}

function findIndex(list, productId) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].productId === productId) return i;
  }
  return -1;
}

/** 加入购物车（已存在则累加数量） */
function add(productId, quantity, extra) {
  if (!productId) return items();
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const list = items();
  const idx = findIndex(list, productId);
  if (idx >= 0) {
    list[idx].quantity = list[idx].quantity + qty;
    if (extra) Object.assign(list[idx], extra);
  } else {
    list.push(Object.assign({ productId, quantity: qty, useTicket: false, ticketQty: 0 }, extra || {}));
  }
  saveItems(list);
  return list;
}

/** 设置数量（<=0 视为删除） */
function setQuantity(productId, quantity) {
  const qty = parseInt(quantity, 10) || 0;
  let list = items();
  const idx = findIndex(list, productId);
  if (idx < 0) return list;
  if (qty <= 0) {
    list = list.filter(it => it.productId !== productId);
  } else {
    list[idx].quantity = qty;
    // 数量减少时水票抵扣数不能超过数量（与后端 buildOrderItems 的校验一致，提前收口）
    if (list[idx].ticketQty > qty) list[idx].ticketQty = qty;
  }
  saveItems(list);
  return list;
}

function remove(productId) {
  const list = items().filter(it => it.productId !== productId);
  saveItems(list);
  return list;
}

function clear() {
  saveItems([]);
}

/** 只清空指定商品之外的内容（下单成功后保留未下单的商品） */
function clearMany(productIds) {
  const set = {};
  (productIds || []).forEach(id => {
    set[id] = true;
  });
  const list = items().filter(it => !set[it.productId]);
  saveItems(list);
  return list;
}

/** 勾选/取消水票抵扣（仅直营水站可用） */
function setTicket(productId, useTicket, ticketQty) {
  const list = items();
  const idx = findIndex(list, productId);
  if (idx < 0) return list;
  list[idx].useTicket = !!useTicket;
  const qty = parseInt(ticketQty, 10) || 0;
  list[idx].ticketQty = useTicket ? Math.max(0, Math.min(qty, list[idx].quantity)) : 0;
  saveItems(list);
  return list;
}

/** 汇总（角标用） */
function summary() {
  const list = items();
  const count = list.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0);
  return { ownerKey, count, kinds: list.length };
}

module.exports = {
  setOwner,
  onCartChange,
  items,
  add,
  setQuantity,
  remove,
  clear,
  clearMany,
  setTicket,
  summary
};

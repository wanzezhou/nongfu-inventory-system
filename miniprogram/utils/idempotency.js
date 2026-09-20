// 幂等键管理（文档 §23.1）
// ===========================================================================
// 文档对幂等键的三条硬要求，逐条落实到本文件：
//
//   ① **客户端生成**，在用户点「提交订单」的**那一刻**生成一次，
//      并**持久化到本地存储**；同一次提交的重试**复用同一个键**。
//      → 所以 key 存进 storage，且带「业务内容指纹」：
//        内容没变的重复提交复用同一个键（后端会合并成一次）；
//        内容变了则生成新键（否则会被后端判为「同键不同参数」而 400）。
//
//   ② **格式**：`buyerType + buyerId + 时间戳 + 随机串`，长度不超过 64。
//
//   ③ **存活期**：服务端保留至少 24h；本地同样保留 24h 后视为过期丢弃，
//      避免一个陈旧的键在第二天把新订单「合并」到昨天那单上。
//
//   ⚠️ 文档同时明确：「换设备 / 重装小程序 → 本地存储丢失 → 生不成同一个键 →
//      可能重复下单。**该场景不做技术兜底**，靠订单列表可见 + 管理员介入」。
//      因此本文件**不**在本地存储丢失时试图用其它线索重建密钥（那会破坏幂等语义）。
// ===========================================================================
const { STORAGE_KEYS } = require('../config/index');

const MAX_LEN = 64;
const TTL_MS = 24 * 60 * 60 * 1000; // 与后端 IDEM_TTL_HOURS 对齐

function randomStr(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

/** 极简内容指纹（不是加密用途，只用于「内容是否变了」的判定） */
function fingerprint(payload) {
  const text = JSON.stringify(payload || {});
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function readStore() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.PENDING_IDEM);
    return raw && typeof raw === 'object' ? raw : null;
  } catch (e) {
    return null;
  }
}

function writeStore(store) {
  try {
    wx.setStorageSync(STORAGE_KEYS.PENDING_IDEM, store);
  } catch (e) {
    console.warn('[idempotency] 写入失败：', e);
  }
}

function clearStore() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.PENDING_IDEM);
  } catch (e) {
    console.warn('[idempotency] 清除失败：', e);
  }
}

/**
 * 取本次提交应使用的幂等键
 *
 * @param {object} p
 *   - scope    : 业务作用域（如 'CREATE_ORDER'）
 *   - ownerKey : buyerType:buyerId（写入键前缀，便于排障时定位归属）
 *   - payload  : 本次业务参数（用于内容指纹）
 * @returns {string} 幂等键
 */
function acquireKey({ scope, ownerKey, payload }) {
  const fp = fingerprint(payload);
  const store = readStore();
  const now = Date.now();

  if (
    store &&
    store.scope === scope &&
    store.ownerKey === ownerKey &&
    store.fp === fp &&
    now - store.createdAt < TTL_MS &&
    store.key
  ) {
    // 同一次提交的重试 → 复用同一个键（文档 §23.1 第 1 条）
    return store.key;
  }

  // 新的一次提交 → 生成新键：buyerType + buyerId + 时间戳 + 随机串
  let key = `${ownerKey}${now}${randomStr(6)}`.replace(/[^A-Za-z0-9_-]/g, '');
  if (key.length > MAX_LEN) key = key.slice(0, MAX_LEN);

  writeStore({ scope, ownerKey, fp, key, createdAt: now });
  return key;
}

/** 提交成功后清除（下次提交是新的一单） */
function releaseKey() {
  clearStore();
}

/** 记录最近一次提交结果，供「重复提交」排障 */
function rememberResult(result) {
  const store = readStore();
  if (!store) return;
  store.result = result;
  store.finishedAt = Date.now();
  writeStore(store);
}

module.exports = {
  acquireKey,
  releaseKey,
  rememberResult,
  fingerprint,
  MAX_LEN
};

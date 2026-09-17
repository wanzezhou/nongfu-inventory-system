// 删除前的「引用检查」辅助（机台 / 供应商 / 水站共用，2026-09-17）
// ---------------------------------------------------------------------------
// 删除策略：**无引用 → 物理删除；有引用 → 转为停用（status=0）保留**。
// 与「员工删除」（workerController.deleteWorker）同一套语义。
//
// 为什么不能无脑物理删：这几张表的下游外键规则不同，物理删的后果不一致——
//   · machine_sales.machine_id  → ON DELETE **CASCADE**（删机台会连带删掉销量记录！）
//   · purchase_records.supplier_id → ON DELETE SET NULL（采购记录会失去供应商归属）
//   · sub_stations 被 6 张表以裸列引用（订单/水票/对账/押金/退站…）
// 因此凡下游有数据，一律不物理删。
//
// references 项：`{ label, count }`（条数型）或 `{ label, amount }`（金额型）。

/** 条数型引用项；n <= 0 时返回 null，便于 `.filter(Boolean)` */
function countRef(label, n) {
  const count = Number(n) || 0;
  return count > 0 ? { label, count } : null;
}

/** 金额型引用项（如欠款）；v <= 0 时返回 null */
function amountRef(label, v) {
  const amount = Number(v) || 0;
  return amount > 0 ? { label, amount } : null;
}

/** 引用清单 → 中文描述，用于「已转为停用保留而非删除」的提示文案 */
function describeReferences(references) {
  return (references || [])
    .map((r) => (r.amount !== undefined
      ? `${r.label} ¥${Number(r.amount).toFixed(2)}`
      : `${r.label} ${r.count} 条`))
    .join('、');
}

module.exports = { countRef, amountRef, describeReferences };

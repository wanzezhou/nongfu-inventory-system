<template>
  <el-dialog
    v-model="visible"
    title="订单详情"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
    class="order-detail-dialog"
  >
    <div v-if="order" class="order-detail">
      <el-descriptions title="基本信息" :column="2" border class="detail-section">
        <el-descriptions-item label="订单号">{{ order.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="订单类型">{{ getOrderTypeText(order.orderType) }}</el-descriptions-item>
        <el-descriptions-item label="下单时间">{{ order.createTime }}</el-descriptions-item>
        <el-descriptions-item label="创建人">{{ order.createdByName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="客户/水站">{{ order.customerName }}</el-descriptions-item>
        <el-descriptions-item label="联系电话">{{ order.customerPhone }}</el-descriptions-item>
        <el-descriptions-item label="配送地址" :span="2">{{ order.customerAddress }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-section">
        <div class="section-title">商品明细</div>
        <el-table :data="order.items" border size="small">
          <el-table-column prop="productName" label="商品名称" min-width="150" />
          <el-table-column prop="spec" label="规格" width="100" />
          <el-table-column prop="quantity" label="数量" width="80" align="center" />
          <el-table-column v-if="![1, 4, 6].includes(order.orderType)" prop="unitPrice" label="单价" width="100" align="right">
            <template #default="{ row }">¥{{ formatMoney(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column v-if="![1, 4, 6].includes(order.orderType)" prop="subtotal" label="小计" width="100" align="right">
            <template #default="{ row }">¥{{ formatMoney(row.subtotal) }}</template>
          </el-table-column>
        </el-table>
      </div>

      <el-descriptions title="配送信息" :column="2" border class="detail-section">
        <el-descriptions-item label="配送方式">{{ getDeliveryMethodText(order.deliveryMethod) }}</el-descriptions-item>
        <el-descriptions-item v-if="order.deliveryStaff" label="配送员工">{{ order.deliveryStaff }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ order.remark || '-' }}</el-descriptions-item>
      </el-descriptions>

      <div class="amount-summary">
        <div class="amount-row" v-if="![1, 4, 6].includes(order.orderType)">
          <span>订单金额：</span>
          <span>¥{{ formatMoney(order.orderAmount) }}</span>
        </div>
        <div class="amount-row total" v-if="![1, 4, 6].includes(order.orderType)">
          <span>应收总额：</span>
          <span>¥{{ formatMoney(order.totalAmount) }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        v-if="order"
        type="warning"
        @click="handleEdit"
      >
        修改
      </el-button>
      <el-button
        v-if="order"
        type="warning"
        @click="handlePrint"
      >
        打印
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 订单详情弹窗（2026-09-09 自 OrderList 拆分）
// 对外 API：open(row) —— 拉取详情并打开；事件：edit(order) / print(order)
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getOrderDetail } from '@/api/order'
import { formatMoney, getOrderTypeText, getDeliveryMethodText } from './orderText'

const emit = defineEmits(['edit', 'print'])

const visible = ref(false)
const order = ref(null)

const open = async (row) => {
  try {
    const res = await getOrderDetail(row.id)
    if (res.data) {
      order.value = res.data
    }
  } catch (error) {
    console.error('获取订单详情失败:', error)
    order.value = row
  }
  visible.value = true
}

const handleEdit = () => {
  visible.value = false
  emit('edit', order.value)
}

const handlePrint = () => {
  emit('print', order.value)
}

defineExpose({ open })
</script>

<style scoped>
.order-detail {
  padding: 5px;
}

.detail-section {
  margin-bottom: 20px;
}

.section-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
  margin-bottom: 12px;
  padding-left: 5px;
}

.amount-summary {
  background: var(--bg);
  padding: 15px 20px;
  border-radius: var(--radius-sm);
  margin-top: 10px;
}

.amount-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--text-2);
}

.amount-row:last-child {
  margin-bottom: 0;
}

.amount-row.total {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-color-danger);
}

.amount-row span:last-child {
  min-width: 100px;
  text-align: right;
}

/* ===== 移动端 / 窄屏适配 ===== */
@media screen and (max-width: 768px) {
  .order-detail-dialog {
    width: 94vw !important;
    max-width: 94vw !important;
    margin-top: 4vh !important;
    margin-bottom: 4vh !important;
  }
}
</style>

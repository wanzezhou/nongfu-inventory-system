<template>
  <div class="salary-statistics">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-form">
        <el-date-picker
          v-model="month"
          type="month"
          placeholder="选择统计月份"
          value-format="YYYY-MM"
          format="YYYY年MM月"
          style="width: 180px"
        />
        <el-button type="primary" style="margin-left: 12px;" @click="handleSearch">
          <el-icon><Search /></el-icon>
          查询
        </el-button>
        <span class="filter-tip">按订单计算员工配送费：官方平台/线下零售=工人零售配送费；直营水站=工人水站配送费；量贩机/零售机=工人零售机配送费</span>
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div class="summary-card card-gold">
        <div class="card-label"><el-icon><Money /></el-icon><span>配送费总额</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.totalDeliveryFee) }}</div>
        <div class="card-desc">{{ month || '本月' }} 员工配送费合计</div>
      </div>
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><User /></el-icon><span>参与员工</span></div>
        <div class="card-value">{{ summary.workerCount }} 人</div>
        <div class="card-desc">当月有配送订单的员工数</div>
      </div>
      <div class="summary-card card-teal">
        <div class="card-label"><el-icon><List /></el-icon><span>配送订单数</span></div>
        <div class="card-value">{{ summary.orderCount }} 单</div>
        <div class="card-desc">当月计入工资的配送订单</div>
      </div>
    </div>

    <!-- 员工汇总表 -->
    <el-card class="table-card" shadow="never">
      <div class="table-header">
        <span class="table-title">员工配送费汇总（{{ month || '-' }}）</span>
      </div>
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="workerName" label="员工姓名" min-width="110">
          <template #default="{ row }">
            <el-icon style="vertical-align: -2px; margin-right: 4px;"><User /></el-icon>{{ row.workerName }}
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="联系电话" width="130" />
        <el-table-column prop="orderCount" label="配送订单数" width="110" align="center" />
        <el-table-column prop="totalQty" label="配送件数" width="100" align="center" />
        <el-table-column prop="deliveryFee" label="配送费" width="120" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewDetail(row)">
              <el-icon><View /></el-icon>
              明细
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 员工订单明细弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="`配送订单明细：${currentWorker?.workerName || ''}（${month}）`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="detailRows" v-loading="detailLoading" border stripe size="small" max-height="420">
        <el-table-column prop="orderId" label="订单号" min-width="160" show-overflow-tooltip />
        <el-table-column prop="orderTypeName" label="订单类型" width="120" />
        <el-table-column prop="customerName" label="客户/水站" min-width="110" show-overflow-tooltip />
        <el-table-column prop="createTime" label="下单时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column prop="totalQty" label="件数" width="70" align="center" />
        <el-table-column prop="deliveryFee" label="配送费" width="110" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewOrderItems(row)">
              <el-icon><View /></el-icon>
              商品明细
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="detail-total">合计配送费：<span class="fee-text">¥{{ fmtMoney(detailTotal) }}</span></div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 订单商品明细弹窗 -->
    <el-dialog
      v-model="itemsVisible"
      :title="`商品配送明细：${currentOrder?.orderId || ''}（${currentOrder?.orderTypeName || ''}）`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="itemRows" v-loading="itemsLoading" border stripe size="small" max-height="380">
        <el-table-column prop="productName" label="商品名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unit" label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.unit || '-' }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="80" align="center" />
        <el-table-column prop="feePerUnit" label="配送费率" width="100" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.feePerUnit) }}/件</template>
        </el-table-column>
        <el-table-column prop="deliveryFee" label="配送费" width="110" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="detail-total">合计配送费：<span class="fee-text">¥{{ fmtMoney(itemsTotal) }}</span></div>
      <template #footer>
        <el-button @click="itemsVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, User, Money, List, View } from '@element-plus/icons-vue'
import { getSalarySummary, getSalaryOrders, getSalaryOrderItems } from '@/api/salary'

const loading = ref(false)
const month = ref('')
const rows = ref([])
const summary = reactive({ totalDeliveryFee: 0, workerCount: 0, orderCount: 0 })

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailRows = ref([])
const currentWorker = ref(null)

// 订单商品明细
const itemsVisible = ref(false)
const itemsLoading = ref(false)
const itemRows = ref([])
const currentOrder = ref(null)

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '720px'))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d)) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const detailTotal = computed(() => detailRows.value.reduce((s, x) => s + (x.deliveryFee || 0), 0))
const itemsTotal = computed(() => itemRows.value.reduce((s, x) => s + (x.deliveryFee || 0), 0))

const fetchSummary = async () => {
  if (!month.value) {
    ElMessage.warning('请选择统计月份')
    return
  }
  loading.value = true
  try {
    const res = await getSalarySummary({ month: month.value })
    if (res.data) {
      rows.value = res.data.list || []
      Object.assign(summary, res.data.summary || {})
    }
  } catch (e) {
    console.error('工资统计失败:', e)
    ElMessage.error(e.response?.data?.message || '工资统计失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  fetchSummary()
}

const viewDetail = async (row) => {
  currentWorker.value = row
  detailVisible.value = true
  detailLoading.value = true
  detailRows.value = []
  try {
    const res = await getSalaryOrders({ month: month.value, workerId: row.workerId })
    detailRows.value = res.data?.list || []
  } catch (e) {
    console.error('工资明细失败:', e)
    ElMessage.error('获取配送订单明细失败')
  } finally {
    detailLoading.value = false
  }
}

// 订单商品配送明细
const viewOrderItems = async (row) => {
  currentOrder.value = row
  itemsVisible.value = true
  itemsLoading.value = true
  itemRows.value = []
  try {
    const res = await getSalaryOrderItems({ orderId: row.orderId })
    itemRows.value = res.data?.list || []
  } catch (e) {
    console.error('商品明细失败:', e)
    ElMessage.error('获取商品配送明细失败')
  } finally {
    itemsLoading.value = false
  }
}

onMounted(() => {
  const now = new Date()
  month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  fetchSummary()
})
</script>

<style scoped>
.salary-statistics {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.filter-tip {
  margin-left: 16px;
  font-size: 12px;
  color: #909399;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: 10px;
  padding: 16px 18px;
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.92;
}

.card-value {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0 4px;
  line-height: 1.2;
}

.card-desc {
  font-size: 12px;
  opacity: 0.85;
}

.card-gold { background: linear-gradient(135deg, #f59e0b, #d97706); }
.card-blue { background: linear-gradient(135deg, #3b82f6, #2563eb); }
.card-teal { background: linear-gradient(135deg, #14b8a6, #0d9488); }

.table-card {
  border-radius: 8px;
}

.table-header {
  margin-bottom: 12px;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
}

.fee-text {
  color: #f56c6c;
  font-weight: 600;
}

.detail-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
}
</style>

<template>
  <div class="station-cost">
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
        <span class="filter-tip">统计直营水站销售订单中水票抵扣商品的成本 =（进货价 + 水站分销配送费）× 抵扣件数</span>
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div class="summary-card card-gold">
        <div class="card-label"><el-icon><Money /></el-icon><span>成本总额</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.totalCost) }}</div>
        <div class="card-desc">{{ month || '本月' }} 水票抵扣商品成本合计</div>
      </div>
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><OfficeBuilding /></el-icon><span>水站数</span></div>
        <div class="card-value">{{ summary.stationCount }} 家</div>
        <div class="card-desc">当月产生抵扣成本的水站</div>
      </div>
      <div class="summary-card card-purple">
        <div class="card-label"><el-icon><List /></el-icon><span>抵扣订单数</span></div>
        <div class="card-value">{{ summary.orderCount }} 单</div>
        <div class="card-desc">当月使用水票抵扣的订单</div>
      </div>
      <div class="summary-card card-teal">
        <div class="card-label"><el-icon><Goods /></el-icon><span>抵扣件数</span></div>
        <div class="card-value">{{ summary.ticketQty }} 件</div>
        <div class="card-desc">当月水票抵扣商品件数</div>
      </div>
    </div>

    <!-- 水站汇总表 -->
    <el-card class="table-card" shadow="never">
      <div class="table-header">
        <span class="table-title">水站抵扣成本汇总（{{ month || '-' }}）</span>
      </div>
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="stationName" label="水站名称" min-width="130">
          <template #default="{ row }">
            <el-icon style="vertical-align: -2px; margin-right: 4px;"><OfficeBuilding /></el-icon>{{ row.stationName }}
          </template>
        </el-table-column>
        <el-table-column prop="orderCount" label="抵扣订单数" width="110" align="center" />
        <el-table-column prop="ticketQty" label="抵扣件数" width="100" align="center" />
        <el-table-column prop="costTotal" label="成本总额" width="130" align="right">
          <template #default="{ row }">
            <span class="cost-text">¥{{ fmtMoney(row.costTotal) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewStationOrders(row)">
              <el-icon><View /></el-icon>
              明细
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 水站抵扣订单明细弹窗 -->
    <el-dialog
      v-model="ordersVisible"
      :title="`抵扣订单明细：${currentStation?.stationName || ''}（${month}）`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="orderRows" v-loading="ordersLoading" border stripe size="small" max-height="400">
        <el-table-column prop="orderId" label="订单号" min-width="170" show-overflow-tooltip />
        <el-table-column prop="createTime" label="下单时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column prop="ticketQty" label="抵扣件数" width="90" align="center" />
        <el-table-column prop="costTotal" label="成本" width="120" align="right">
          <template #default="{ row }">
            <span class="cost-text">¥{{ fmtMoney(row.costTotal) }}</span>
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
      <div class="detail-total">合计成本：<span class="cost-text">¥{{ fmtMoney(ordersTotal) }}</span></div>
      <template #footer>
        <el-button @click="ordersVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 订单商品行成本弹窗 -->
    <el-dialog
      v-model="itemsVisible"
      :title="`抵扣商品成本：${currentOrder?.orderId || ''}`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="itemRows" v-loading="itemsLoading" border stripe size="small" max-height="380">
        <el-table-column prop="productName" label="商品名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="ticketQty" label="抵扣件数" width="90" align="center" />
        <el-table-column prop="purchasePrice" label="进货价" width="100" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.purchasePrice) }}/件</template>
        </el-table-column>
        <el-table-column prop="distributionFee" label="水站分销配送费" width="130" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.distributionFee) }}/件</template>
        </el-table-column>
        <el-table-column prop="costTotal" label="成本" width="120" align="right">
          <template #default="{ row }">
            <span class="cost-text">¥{{ fmtMoney(row.costTotal) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="detail-total">合计成本：<span class="cost-text">¥{{ fmtMoney(itemsTotal) }}</span></div>
      <template #footer>
        <el-button @click="itemsVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Money, List, View, Goods, OfficeBuilding } from '@element-plus/icons-vue'
import { getStationCostSummary, getStationCostOrders, getCostOrderItems } from '@/api/cost'

const loading = ref(false)
const month = ref('')
const rows = ref([])
const summary = reactive({ totalCost: 0, stationCount: 0, orderCount: 0, ticketQty: 0 })

// 水站订单明细
const ordersVisible = ref(false)
const ordersLoading = ref(false)
const orderRows = ref([])
const currentStation = ref(null)

// 订单商品行
const itemsVisible = ref(false)
const itemsLoading = ref(false)
const itemRows = ref([])
const currentOrder = ref(null)

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '760px'))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d)) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const ordersTotal = computed(() => orderRows.value.reduce((s, x) => s + (x.costTotal || 0), 0))
const itemsTotal = computed(() => itemRows.value.reduce((s, x) => s + (x.costTotal || 0), 0))

const fetchSummary = async () => {
  if (!month.value) {
    ElMessage.warning('请选择统计月份')
    return
  }
  loading.value = true
  try {
    const res = await getStationCostSummary({ month: month.value })
    if (res.data) {
      rows.value = res.data.list || []
      Object.assign(summary, res.data.summary || {})
    }
  } catch (e) {
    console.error('成本统计失败:', e)
    ElMessage.error(e.response?.data?.message || '成本统计失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  fetchSummary()
}

const viewStationOrders = async (row) => {
  currentStation.value = row
  ordersVisible.value = true
  ordersLoading.value = true
  orderRows.value = []
  try {
    const res = await getStationCostOrders({ month: month.value, stationId: row.stationId })
    orderRows.value = res.data?.list || []
  } catch (e) {
    console.error('水站订单明细失败:', e)
    ElMessage.error('获取抵扣订单明细失败')
  } finally {
    ordersLoading.value = false
  }
}

const viewOrderItems = async (row) => {
  currentOrder.value = row
  itemsVisible.value = true
  itemsLoading.value = true
  itemRows.value = []
  try {
    const res = await getCostOrderItems({ orderId: row.orderId })
    itemRows.value = res.data?.list || []
  } catch (e) {
    console.error('商品成本明细失败:', e)
    ElMessage.error('获取抵扣商品成本失败')
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
.station-cost {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: var(--radius-md);
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.filter-tip {
  margin-left: 16px;
  font-size: 12px;
  color: var(--text-2);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s ease;
}

.summary-card:hover {
  border-color: rgba(168, 32, 26, 0.25);
}

.card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}

.card-label .el-icon {
  color: var(--accent, var(--text-2));
}

.card-value {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0 4px;
  line-height: 1.2;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.card-desc {
  font-size: 12px;
  color: var(--text-3);
}

.card-gold { --accent: var(--gold); }
.card-blue { --accent: var(--text-2); }
.card-purple { --accent: var(--text-2); }
.card-teal { --accent: var(--text-2); }

.table-card {
  border-radius: var(--radius-md);
}

.table-header {
  margin-bottom: 12px;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
}

.cost-text {
  color: var(--el-color-warning);
  font-weight: 600;
}

.detail-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
}
</style>

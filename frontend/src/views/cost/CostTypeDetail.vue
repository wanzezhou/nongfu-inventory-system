<template>
  <div class="cost-type-page">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="query.range" @change="handleSearch">
          <el-radio-button value="day">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="lastMonth">上月</el-radio-button>
          <el-radio-button value="quarter">本季</el-radio-button>
          <el-radio-button value="year">今年</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="query.range === 'custom'"
          v-model="customRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="range-picker"
        />
        <el-button type="primary" :loading="loading" @click="handleSearch">
          <el-icon><Search /></el-icon>查询
        </el-button>
        <el-button @click="handleReset">
          <el-icon><Refresh /></el-icon>重置
        </el-button>
      </div>
      <div class="filter-hint">
        成本口径：<b>{{ label.main }}</b> —— {{ label.desc }}。统计范围：<b>{{ rangeLabel }}</b>，均不含已取消订单。
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div v-for="card in summaryCards" :key="card.key" class="summary-card">
        <div class="card-label">
          <el-icon><component :is="card.icon" /></el-icon>
          <span>{{ card.label }}</span>
        </div>
        <div class="card-value" :class="{ total: card.total }">¥{{ fmtMoney(card.value) }}</div>
        <div class="card-desc">{{ card.desc }}</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ typeName }}成本明细</span>
          <span class="header-sub">共 {{ summary.orderCount }} 单</span>
        </div>
      </template>

      <!-- 机台类型：无订单明细，仅按机台汇总 -->
      <el-table v-if="isMachineType" :data="machineRows" v-loading="loading" border stripe size="small">
        <el-table-column prop="machineName" label="机台" min-width="160" show-overflow-tooltip />
        <el-table-column prop="orderCount" label="供货订单数" width="120" align="center" />
        <el-table-column prop="totalQty" label="供货件数" width="110" align="right" />
        <el-table-column prop="costTotal" label="成本" width="130" align="right">
          <template #default="{ row }"><span class="cost-text">¥{{ fmtMoney(row.costTotal) }}</span></template>
        </el-table-column>
      </el-table>
      <el-empty v-else-if="isMachineType && !machineRows.length" description="当前区间无机台供货成本" :image-size="60" />

      <!-- 订单类型：订单维度明细，可展开看商品行 -->
      <el-table
        v-else
        :data="rows"
        v-loading="loading"
        border
        stripe
        size="small"
        row-key="orderId"
        @expand-change="handleExpand"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="expand-box">
              <el-table :data="row._lines || []" size="small" border class="inner-table">
                <el-table-column prop="productName" label="商品" min-width="150" show-overflow-tooltip />
                <el-table-column prop="spec" label="规格" width="100" />
                <el-table-column prop="quantity" label="数量" width="70" align="right" />
                <el-table-column v-if="showTicket" prop="ticketQty" label="抵扣件数" width="90" align="right" />
                <el-table-column v-if="showTicket" prop="nonTicketQty" label="未抵扣件数" width="100" align="right" />
                <el-table-column prop="purchasePrice" label="进货价" width="90" align="right">
                  <template #default="{ row: r }">¥{{ fmtMoney(r.purchasePrice) }}</template>
                </el-table-column>
                <el-table-column v-if="orderType === 2" prop="distributionFee" label="水站分销配送费" width="130" align="right">
                  <template #default="{ row: r }">¥{{ fmtMoney(r.distributionFee) }}</template>
                </el-table-column>
                <el-table-column v-if="orderType === 2" prop="workerWholesaleFee" label="工人水站配送费" width="130" align="right">
                  <template #default="{ row: r }">¥{{ fmtMoney(r.workerWholesaleFee) }}</template>
                </el-table-column>
                <el-table-column v-if="[1, 3, 5].includes(orderType)" prop="workerRetailFee" label="工人零售配送费" width="130" align="right">
                  <template #default="{ row: r }">¥{{ fmtMoney(r.workerRetailFee) }}</template>
                </el-table-column>
                <el-table-column v-if="orderType === 4" prop="workerMachineFee" label="工人零售机配送费" width="130" align="right">
                  <template #default="{ row: r }">¥{{ fmtMoney(r.workerMachineFee) }}</template>
                </el-table-column>
                <el-table-column prop="costTotal" label="行成本" width="110" align="right">
                  <template #default="{ row: r }"><span class="cost-text">¥{{ fmtMoney(r.costTotal) }}</span></template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!(row._lines || []).length" description="无商品行" :image-size="50" />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip />
        <el-table-column v-if="orderType === 2" prop="stationName" label="水站" min-width="130" show-overflow-tooltip />
        <el-table-column v-else prop="customerName" label="客户" min-width="120" show-overflow-tooltip />
        <el-table-column prop="totalQty" label="数量" width="75" align="right" />
        <el-table-column v-if="showTicket" prop="ticketQty" label="抵扣件数" width="95" align="right" />
        <el-table-column v-if="orderType === 2" prop="cost1" label="成本1" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.cost1) }}</template>
        </el-table-column>
        <el-table-column v-if="orderType === 2" prop="cost2" label="成本2" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.cost2) }}</template>
        </el-table-column>
        <el-table-column v-if="orderType === 3" prop="costA" label="成本A" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.costA) }}</template>
        </el-table-column>
        <el-table-column v-if="orderType === 3" prop="costB" label="成本B" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.costB) }}</template>
        </el-table-column>
        <el-table-column prop="costTotal" label="成本合计" width="120" align="right">
          <template #default="{ row }"><span class="cost-text">¥{{ fmtMoney(row.costTotal) }}</span></template>
        </el-table-column>
        <el-table-column prop="createTime" label="下单时间" width="165" />
      </el-table>
      <el-empty v-if="!isMachineType && !rows.length && !loading" description="当前区间无成本数据" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Money, Wallet, TrendCharts, Goods } from '@element-plus/icons-vue'
import { toQuery, rangeText } from '@/utils/dateRange'
import { getCostByType, getMachineCost, getCostOrderLines } from '@/api/cost'

const props = defineProps({
  orderType: { type: Number, required: true },
  typeName: { type: String, default: '' },
  machineType: { type: Number, default: null } // 1=量贩机 / 2=零售机
})

const loading = ref(false)
const query = reactive({ range: 'month' })
const customRange = ref([])
const rows = ref([])
const machineRows = ref([])
const summary = reactive({ costTotal: 0, cost1: 0, cost2: 0, costA: 0, costB: 0, orderCount: 0, totalQty: 0, ticketQty: 0, machineCount: 0 })
const label = reactive({ main: '成本', desc: '' })

const isMachineType = computed(() => props.orderType === 4 || props.orderType === 6)
const showTicket = computed(() => props.orderType === 2)
const rangeLabel = computed(() => rangeText({ range: query.range, startDate: customRange.value?.[0], endDate: customRange.value?.[1] }))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const summaryCards = computed(() => {
  if (props.orderType === 2) {
    return [
      { key: 'c1', label: '成本1（水票抵扣商品）', value: summary.cost1, desc: '（进货价+水站分销配送费+工人水站配送费）× 抵扣件数', icon: Money },
      { key: 'c2', label: '成本2（未抵扣商品）', value: summary.cost2, desc: '（进货价+工人水站配送费）× 未抵扣件数', icon: Wallet },
      { key: 'total', label: '成本合计', value: summary.costTotal, desc: `成本1 + 成本2，共 ${summary.orderCount} 单`, icon: TrendCharts, total: true }
    ]
  }
  if (props.orderType === 3) {
    return [
      { key: 'ca', label: '成本A（自有员工配送）', value: summary.costA, desc: '（进货价+工人零售配送费）× 数量', icon: Money },
      { key: 'cb', label: '成本B（无需配送）', value: summary.costB, desc: '进货价 × 数量', icon: Wallet },
      { key: 'total', label: '成本合计', value: summary.costTotal, desc: `成本A + 成本B，共 ${summary.orderCount} 单`, icon: TrendCharts, total: true }
    ]
  }
  if (isMachineType.value) {
    return [
      { key: 'total', label: '成本合计', value: summary.costTotal, desc: label.desc, icon: TrendCharts, total: true },
      { key: 'mc', label: '机台数量', value: summary.machineCount, desc: '有供货成本的机台数', icon: Goods, count: true },
      { key: 'qty', label: '供货件数', value: summary.totalQty, desc: `供货订单 ${summary.orderCount} 单`, icon: Wallet, count: true }
    ]
  }
  return [
    { key: 'total', label: '成本合计', value: summary.costTotal, desc: label.desc, icon: TrendCharts, total: true },
    { key: 'cnt', label: '订单数', value: summary.orderCount, desc: '计入成本的订单笔数', icon: Money, count: true },
    { key: 'qty', label: '商品件数', value: summary.totalQty, desc: '计入成本的商品件数', icon: Wallet, count: true }
  ]
})

const buildParams = () => {
  const q = toQuery({ range: query.range, startDate: customRange.value?.[0], endDate: customRange.value?.[1] })
  return isMachineType.value ? { ...q, machineType: props.machineType ?? (props.orderType === 6 ? 2 : 1) } : { ...q, orderType: props.orderType }
}

const fetchData = async () => {
  if (query.range === 'custom' && !(customRange.value?.[0] && customRange.value?.[1])) {
    ElMessage.warning('请选择起止日期')
    return
  }
  loading.value = true
  try {
    if (isMachineType.value) {
      const res = await getMachineCost(buildParams())
      const d = res.data || {}
      machineRows.value = d.list || []
      Object.assign(summary, d.summary || {})
      if (d.label) Object.assign(label, d.label)
    } else {
      const res = await getCostByType(buildParams())
      const d = res.data || {}
      rows.value = (d.list || []).map(r => ({ ...r, _lines: null }))
      Object.assign(summary, d.summary || {})
      if (d.label) Object.assign(label, d.label)
    }
  } catch (e) {
    console.error('成本查询失败:', e)
    ElMessage.error(e.response?.data?.message || '成本查询失败')
  } finally {
    loading.value = false
  }
}

// 展开行时按需拉取商品行明细
const handleExpand = async (row, expanded) => {
  if (!expanded.includes(row)) return
  if (row._lines) return
  try {
    const res = await getCostOrderLines({ orderId: row.orderId })
    row._lines = res.data?.list || []
  } catch (e) {
    console.error('明细加载失败:', e)
    row._lines = []
  }
}

const handleSearch = () => fetchData()
const handleReset = () => {
  query.range = 'month'
  customRange.value = []
  fetchData()
}

onMounted(() => fetchData())
</script>

<style scoped>
.cost-type-page { padding: 0; }
.filter-card { margin-bottom: 14px; border-radius: var(--radius-md); }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.range-picker { max-width: 300px; }
.filter-hint { margin-top: 10px; font-size: 12px; color: var(--text-2); line-height: 1.7; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 14px; }
.summary-card {
  border-radius: var(--radius-lg); padding: 16px 18px; background: var(--card);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: border-color 0.2s ease;
}
.summary-card:hover { border-color: rgba(168, 32, 26, 0.25); }
.card-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); }
.card-label .el-icon { color: var(--text-2); }
.card-value { font-size: 25px; font-weight: 700; margin: 6px 0 4px; line-height: 1.2; color: var(--text); font-variant-numeric: tabular-nums; }
.card-value.total { font-size: 30px; color: var(--gold); }
.card-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.detail-card { border-radius: var(--radius-md); }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.header-sub { font-size: 12px; color: var(--text-3); font-weight: 400; }
.cost-text { color: var(--gold); font-weight: 600; }
.expand-box { padding: 8px 12px; background: var(--bg-2, rgba(0, 0, 0, 0.02)); border-radius: var(--radius-sm); }
.inner-table { margin-bottom: 4px; }

@media (max-width: 768px) {
  .filter-bar { flex-direction: column; align-items: stretch; }
  .range-picker { max-width: 100%; }
  .summary-grid { grid-template-columns: 1fr; }
}
</style>

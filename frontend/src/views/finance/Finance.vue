<template>
  <div class="finance">
    <!-- 筛选卡片 -->
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="时间范围">
          <el-radio-group v-model="queryForm.range" @change="onRangeChange">
            <el-radio-button value="day">今日</el-radio-button>
            <el-radio-button value="week">本周</el-radio-button>
            <el-radio-button value="month">本月</el-radio-button>
            <el-radio-button value="year">今年</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="queryForm.range === 'custom'" label="起止日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 280px"
          />
        </el-form-item>
        <el-form-item label="订单类型">
          <el-select v-model="queryForm.orderTypes" placeholder="全部业务类型" clearable multiple collapse-tags collapse-tags-tooltip style="width: 260px">
            <el-option v-for="(label, val) in orderTypes" :key="val" :label="label" :value="Number(val)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
          <el-button type="success" :loading="exporting" @click="handleExport">
            <el-icon><Download /></el-icon>
            导出
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 概览汇总卡片 -->
    <el-row :gutter="20" class="summary-row" v-loading="summaryLoading">
      <el-col :span="6" v-for="(card, idx) in summaryCards" :key="idx" :style="{ animationDelay: idx * 0.06 + 's' }">
        <div class="summary-card shine-effect" :class="card.cls">
          <div class="sc-content">
            <div class="sc-info">
              <div class="sc-label">{{ card.label }}</div>
              <div class="sc-value">{{ card.value }}</div>
              <div class="sc-desc">{{ card.desc }}</div>
            </div>
            <div class="sc-icon">
              <el-icon :size="42"><component :is="card.icon" /></el-icon>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 逐单明细 -->
    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="chart-header">
          <span class="chart-title">逐单财务明细</span>
          <span class="chart-badge">按订单类型展示对应财务指标</span>
        </div>
      </template>
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
        height="480"
      >
        <el-table-column type="index" label="#" width="50" align="center" />
        <el-table-column prop="orderId" label="订单号" width="180" show-overflow-tooltip />
        <el-table-column prop="orderTypeName" label="订单类型" width="120" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="orderTypeTag(row.orderType)" effect="plain">{{ row.orderTypeName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户" min-width="120" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column prop="quantity" label="数量" width="90" align="right">
          <template #default="{ row }">
            <span class="quantity-text">{{ row.quantity }}</span>
          </template>
        </el-table-column>
        <el-table-column label="财务指标" min-width="240">
          <template #default="{ row }">
            <div class="metric-display" v-for="(m, i) in metricDisplay(row)" :key="i">
              <span class="metric-name">{{ m.name }}</span>
              <span class="metric-amount">¥{{ formatMoney(m.value) }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap" v-if="total > 0">
        <el-pagination
          background
          layout="total, prev, pager, next, jumper"
          :total="total"
          :page-size="pageSize"
          :current-page="page"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Download, Money, Goods, ShoppingCart, Van, Coin, Wallet } from '@element-plus/icons-vue'
import { getFinanceSummary, getFinanceOrders, exportFinanceOrders } from '@/api/finance'
import { downloadBlob } from '@/api/excel'

const summaryLoading = ref(false)
const loading = ref(false)
const exporting = ref(false)
const tableData = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

// 订单类型映射（与后端一致）
const orderTypes = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '量贩机供货',
  5: '线下水站返货',
  6: '零售机供货'
}

const summary = ref({ list: [], overall: { totalAmount: 0, orderCount: 0 } })

const queryForm = ref({
  range: 'month',
  orderTypes: []
})
const dateRange = ref([])

// 指标 -> 图标/配色映射
const METRIC_ICON = {
  '总包配送费': { icon: Van, cls: 'card-red' },
  '分销价': { icon: Goods, cls: 'card-blue' },
  '零售价': { icon: ShoppingCart, cls: 'card-green' },
  '工人配送费': { icon: Van, cls: 'card-gold' },
  '进货价': { icon: Coin, cls: 'card-purple' },
  '分销配送费': { icon: Money, cls: 'card-teal' }
}

const summaryCards = computed(() => {
  const cards = (summary.value.list || []).map(m => {
    const meta = METRIC_ICON[m.metricName] || { icon: Money, cls: 'card-blue' }
    return {
      label: `${m.orderTypeName} · ${m.metricName}`,
      value: '¥' + formatMoney(m.amount),
      desc: `${m.orderCount} 单`,
      cls: meta.cls,
      icon: meta.icon
    }
  })
  const ov = summary.value.overall || { totalAmount: 0, orderCount: 0 }
  cards.push({
    label: '指标合计',
    value: '¥' + formatMoney(ov.totalAmount),
    desc: `共 ${ov.orderCount} 单`,
    cls: 'card-dark',
    icon: Wallet
  })
  return cards
})

const formatMoney = (v) => {
  const n = Number(v) || 0
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const orderTypeTag = (t) => {
  const map = { 1: 'danger', 2: 'warning', 3: 'success', 4: 'info', 5: 'danger', 6: '' }
  return map[t] || 'info'
}

// 按订单类型返回需要展示的指标键值对
const metricDisplay = (row) => {
  const t = Number(row.orderType)
  const items = []
  if (t === 1) items.push({ name: '总包配送费', value: row.totalDeliveryFee })
  else if (t === 2) items.push({ name: '分销价', value: row.wholesaleAmount })
  else if (t === 3) items.push({ name: '零售价', value: row.retailAmount })
  else if (t === 4) items.push({ name: '工人配送费', value: row.workerMachineFee })
  else if (t === 5) {
    items.push({ name: '进货价', value: row.purchaseAmount })
    items.push({ name: '分销配送费', value: row.distributionFee })
  }
  return items
}

const buildParams = () => {
  const params = { range: queryForm.value.range }
  if (queryForm.value.range === 'custom') {
    if (dateRange.value && dateRange.value.length === 2) {
      params.startDate = dateRange.value[0]
      params.endDate = dateRange.value[1]
    }
  }
  if (queryForm.value.orderTypes.length) params.orderTypes = queryForm.value.orderTypes.join(',')
  return params
}

const onRangeChange = () => {
  if (queryForm.value.range !== 'custom') handleSearch()
}

const handleSearch = () => {
  if (queryForm.value.range === 'custom' && (!dateRange.value || dateRange.value.length !== 2)) {
    ElMessage.warning('请选择起止日期')
    return
  }
  page.value = 1
  fetchAll()
}

const handleReset = () => {
  queryForm.value = { range: 'month', orderTypes: [] }
  dateRange.value = []
  page.value = 1
  handleSearch()
}

const handlePageChange = (p) => {
  page.value = p
  fetchOrders()
}

const fetchAll = () => {
  fetchSummary()
  fetchOrders()
}

const fetchSummary = async () => {
  summaryLoading.value = true
  try {
    const res = await getFinanceSummary(buildParams())
    if (res.data) summary.value = res.data
  } catch (error) {
    console.error('获取财务汇总失败:', error)
  } finally {
    summaryLoading.value = false
  }
}

const fetchOrders = async () => {
  loading.value = true
  try {
    const params = buildParams()
    params.page = page.value
    params.pageSize = pageSize.value
    const res = await getFinanceOrders(params)
    if (res.data) {
      tableData.value = res.data.list || []
      total.value = res.data.total || 0
    }
  } catch (error) {
    console.error('获取财务明细失败:', error)
  } finally {
    loading.value = false
  }
}

const handleExport = async () => {
  if (!tableData.value.length && total.value === 0) {
    ElMessage.warning('当前没有可导出的数据')
    return
  }
  exporting.value = true
  try {
    const res = await exportFinanceOrders(buildParams())
    downloadBlob(res.data, `财务明细_${Date.now()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('导出财务明细失败:', error)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  fetchAll()
})
</script>

<style scoped>
.finance {
  padding: 0;
}

.filter-card {
  margin-bottom: 20px;
  border-radius: 14px;
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
}

.filter-card :deep(.el-card__body) {
  padding: 20px 20px 2px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  row-gap: 4px;
}

.summary-row {
  margin-bottom: 20px;
}

.summary-row .el-col {
  animation: scEnter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes scEnter {
  0% {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.summary-card {
  position: relative;
  border-radius: 16px;
  padding: 22px 24px;
  color: #fff;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  height: 100%;
}

.summary-card:hover {
  transform: translateY(-4px);
  box-shadow:
    0 16px 32px rgba(0, 0, 0, 0.12),
    0 4px 12px rgba(0, 0, 0, 0.06);
}

.summary-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent);
  pointer-events: none;
}

.card-red    { background: linear-gradient(135deg, #C7000B 0%, #9A0008 100%); }
.card-blue   { background: linear-gradient(135deg, #2563EB 0%, #1E40AF 100%); }
.card-green  { background: linear-gradient(135deg, #0B8043 0%, #066B36 100%); }
.card-gold   { background: linear-gradient(135deg, #C5A55A 0%, #A88842 100%); }
.card-purple { background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%); }
.card-teal   { background: linear-gradient(135deg, #0D9488 0%, #0B7272 100%); }
.card-dark   { background: linear-gradient(135deg, #1F2937 0%, #111827 100%); }

.sc-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}

.sc-label {
  font-size: 13px;
  opacity: 0.92;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.sc-value {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 6px;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.sc-desc {
  font-size: 12px;
  opacity: 0.85;
}

.sc-icon {
  opacity: 0.88;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.table-card {
  border-radius: 14px;
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  margin-bottom: 20px;
}

.table-card :deep(.el-card__header) {
  border-bottom: 1px solid #f5f5f7;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chart-title {
  font-size: 15px;
  font-weight: 600;
  color: #1A1A2E;
}

.chart-badge {
  font-size: 11px;
  color: #C7000B;
  background: rgba(199, 0, 11, 0.08);
  padding: 3px 10px;
  border-radius: 10px;
  font-weight: 500;
}

.metric-display {
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.8;
}

.metric-name {
  font-size: 12px;
  color: #8E8E9E;
  flex: 0 0 auto;
}

.metric-amount {
  font-size: 13px;
  font-weight: 600;
  color: #1A1A2E;
}

.quantity-text {
  font-weight: 600;
  color: #1A1A2E;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

/* 窄屏/移动端适配 */
@media screen and (max-width: 768px) {
  .filter-form {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .filter-form .el-form-item {
    margin-right: 0;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .filter-form .el-form-item__label {
    width: auto !important;
    text-align: left;
    justify-content: flex-start;
    line-height: 1.4;
    margin-bottom: 6px;
  }

  .filter-form .el-form-item__content {
    margin-left: 0 !important;
    width: 100%;
  }

  .filter-form .el-select,
  .filter-form .el-date-editor,
  .filter-form .el-input {
    width: 100% !important;
  }

  .filter-form .el-radio-group {
    flex-wrap: wrap;
  }

  .summary-row .el-col {
    flex: 0 0 50%;
    max-width: 50%;
    margin-bottom: 12px;
  }

  .sc-value {
    font-size: 20px;
  }
}
</style>

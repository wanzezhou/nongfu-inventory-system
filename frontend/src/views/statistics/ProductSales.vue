<template>
  <div class="product-sales">
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
          <el-select v-model="queryForm.orderTypes" placeholder="全部销售类型" clearable multiple collapse-tags collapse-tags-tooltip style="width: 220px">
            <el-option v-for="(label, val) in orderTypes" :key="val" :label="label" :value="Number(val)" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品分类">
          <el-select v-model="queryForm.categories" placeholder="全部分类" clearable multiple collapse-tags collapse-tags-tooltip style="width: 180px">
            <el-option v-for="item in categoryList" :key="item.id" :label="item.name" :value="item.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="配送方式">
          <el-select v-model="queryForm.deliveryTypes" placeholder="全部配送方式" clearable multiple collapse-tags collapse-tags-tooltip style="width: 180px">
            <el-option v-for="(label, val) in deliveryTypes" :key="val" :label="label" :value="Number(val)" />
          </el-select>
        </el-form-item>
        <el-form-item label="创建人">
          <el-select v-model="queryForm.createdBys" placeholder="全部创建人" clearable multiple collapse-tags collapse-tags-tooltip filterable style="width: 160px">
            <el-option v-for="item in workerOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="配送员工">
          <el-select v-model="queryForm.workerIds" placeholder="全部配送员工" clearable multiple collapse-tags collapse-tags-tooltip filterable style="width: 160px">
            <el-option v-for="item in workerOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="水站">
          <el-select v-model="queryForm.stationIds" placeholder="全部水站" clearable multiple collapse-tags collapse-tags-tooltip filterable style="width: 180px">
            <el-option v-for="item in stationOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="机台">
          <el-select v-model="queryForm.machineStationIds" placeholder="全部机台" clearable multiple collapse-tags collapse-tags-tooltip filterable style="width: 180px">
            <el-option
              v-for="item in machineOptions"
              :key="item.machine_id"
              :label="item.station_name + (item.machine_type === 1 ? '（量贩机）' : '（零售机）')"
              :value="item.machine_id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="queryForm.keyword"
            placeholder="商品名称/编码"
            clearable
            style="width: 180px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
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

    <!-- 概览统计卡片 -->
    <el-row :gutter="20" class="summary-row">
      <el-col :span="6" v-for="(card, idx) in summaryCards" :key="idx" :style="{ animationDelay: idx * 0.08 + 's' }">
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

    <!-- 图表 + 表格 -->
    <el-row :gutter="20">
      <el-col :span="10">
        <el-card class="chart-card" shadow="never">
          <template #header>
            <div class="chart-header">
              <span class="chart-title">Top 10 商品销量</span>
              <span class="chart-badge">按销量排序</span>
            </div>
          </template>
          <div ref="barChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card class="table-card" shadow="never">
          <el-table
            :data="tableData"
            style="width: 100%"
            v-loading="loading"
            border
            height="480"
            @sort-change="handleSortChange"
          >
            <el-table-column type="index" label="#" width="50" align="center" />
            <el-table-column prop="productCode" label="商品编码" width="110">
              <template #default="{ row }">
                <span class="code-text">{{ row.productCode }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="productName" label="商品名称" min-width="170" show-overflow-tooltip />
            <el-table-column prop="specification" label="规格" width="120" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-if="row.specification">{{ row.specification }}</span>
                <span v-else class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="category" label="分类" width="90" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.category" size="small" type="info" effect="plain">{{ row.category }}</el-tag>
                <span v-else class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="quantity" label="销量" width="100" align="right" sortable="custom">
              <template #default="{ row }">
                <span class="quantity-text">{{ row.quantity }} {{ row.unit }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="orderCount" label="订单数" width="90" align="center">
              <template #default="{ row }">
                <span>{{ row.orderCount }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ORDER_TYPE_TEXT as orderTypes } from '@/utils/constants'
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import echarts from '@/utils/echarts'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Download, Box, DataLine, ShoppingCart, TrendCharts } from '@element-plus/icons-vue'
import { getProductSales, exportProductSales } from '@/api/statistics'
import { getCategoryList } from '@/api/product'
import { getAllWorkers } from '@/api/worker'
import { getStations } from '@/api/station'
import { getMachineStations } from '@/api/machineStation'
import { downloadBlob } from '@/api/excel'

const loading = ref(false)
const exporting = ref(false)
const tableData = ref([])
const categoryList = ref([])
const workerOptions = ref([])
const stationOptions = ref([])
const machineOptions = ref([])
const barChartRef = ref(null)
let barChart = null

// 配送方式映射
const deliveryTypes = {
  1: '自有员工配送',
  2: '水站配送',
  3: '无需配送'
}

const queryForm = ref({
  range: 'month',
  orderTypes: [],
  categories: [],
  deliveryTypes: [],
  createdBys: [],
  workerIds: [],
  stationIds: [],
  machineStationIds: [],
  keyword: ''
})
const dateRange = ref([])

const summary = ref({
  totalQuantity: 0,
  productCount: 0,
  orderCount: 0
})

const summaryCards = computed(() => [
  {
    label: '总销量',
    value: summary.value.totalQuantity + ' 件',
    desc: '共 ' + summary.value.orderCount + ' 个订单',
    cls: 'card-red',
    icon: ShoppingCart
  },
  {
    label: '订单数',
    value: summary.value.orderCount + ' 单',
    desc: '统计范围内成交订单',
    cls: 'card-green',
    icon: DataLine
  },
  {
    label: '在售商品数',
    value: summary.value.productCount + ' 种',
    desc: '有销售记录的商品',
    cls: 'card-blue',
    icon: Box
  },
  {
    label: '平均每单销量',
    value: summary.value.orderCount ? (summary.value.totalQuantity / summary.value.orderCount).toFixed(2) + ' 件' : '0.00 件',
    desc: '总销量 ÷ 订单数',
    cls: 'card-gold',
    icon: TrendCharts
  }
])

const onRangeChange = () => {
  if (queryForm.value.range !== 'custom') {
    handleSearch()
  }
}

const handleSearch = async () => {
  if (queryForm.value.range === 'custom') {
    if (!dateRange.value || dateRange.value.length !== 2) {
      ElMessage.warning('请选择起止日期')
      return
    }
  }
  await fetchData()
}

const handleReset = () => {
  queryForm.value = {
    range: 'month',
    orderTypes: [],
    categories: [],
    deliveryTypes: [],
    createdBys: [],
    workerIds: [],
    stationIds: [],
    machineStationIds: [],
    keyword: ''
  }
  dateRange.value = []
  handleSearch()
}

const handleSortChange = ({ prop, order }) => {
  if (order === 'ascending') {
    tableData.value.sort((a, b) => a[prop] - b[prop])
  } else if (order === 'descending') {
    tableData.value.sort((a, b) => b[prop] - a[prop])
  } else {
    // 恢复按销量降序
    tableData.value.sort((a, b) => b.quantity - a.quantity)
  }
}

// 构建查询参数（数组转逗号分隔字符串，兼容后端多选解析）
const buildParams = () => {
  const params = {
    range: queryForm.value.range
  }
  if (queryForm.value.range === 'custom') {
    params.startDate = dateRange.value[0]
    params.endDate = dateRange.value[1]
  }
  if (queryForm.value.orderTypes.length) params.orderTypes = queryForm.value.orderTypes.join(',')
  if (queryForm.value.categories.length) params.categories = queryForm.value.categories.join(',')
  if (queryForm.value.deliveryTypes.length) params.deliveryTypes = queryForm.value.deliveryTypes.join(',')
  if (queryForm.value.createdBys.length) params.createdBys = queryForm.value.createdBys.join(',')
  if (queryForm.value.workerIds.length) params.workerIds = queryForm.value.workerIds.join(',')
  if (queryForm.value.stationIds.length) params.stationIds = queryForm.value.stationIds.join(',')
  if (queryForm.value.machineStationIds.length) params.machineStationIds = queryForm.value.machineStationIds.join(',')
  if (queryForm.value.keyword.trim()) params.keyword = queryForm.value.keyword.trim()
  return params
}

const fetchData = async () => {
  loading.value = true
  const params = buildParams()

  try {
    const res = await getProductSales(params)
    if (res.data) {
      tableData.value = res.data.list || []
      summary.value = res.data.summary || summary.value
      await nextTick()
      initBarChart()
    }
  } catch (error) {
    console.error('获取商品销售统计失败:', error)
  } finally {
    loading.value = false
  }
}

// 一键导出
const handleExport = async () => {
  if (!tableData.value.length) {
    ElMessage.warning('当前没有可导出的数据')
    return
  }
  exporting.value = true
  try {
    const res = await exportProductSales(buildParams())
    downloadBlob(res.data, `商品销售统计_${Date.now()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('导出商品销售统计失败:', error)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

const fetchCategories = async () => {
  try {
    const res = await getCategoryList()
    if (res.data) {
      categoryList.value = res.data
    }
  } catch (error) {
    console.error('获取商品分类失败:', error)
  }
}

const fetchWorkers = async () => {
  try {
    const res = await getAllWorkers()
    if (Array.isArray(res.data)) {
      workerOptions.value = res.data
    }
  } catch (error) {
    console.error('获取员工列表失败:', error)
  }
}

const fetchStations = async () => {
  try {
    const res = await getStations({ pageSize: 999, status: 1 })
    if (res.data) {
      stationOptions.value = res.data.list || []
    }
  } catch (error) {
    console.error('获取水站列表失败:', error)
  }
}

const fetchMachines = async () => {
  try {
    const res = await getMachineStations({ pageSize: 999, status: 1 })
    if (res.data) {
      machineOptions.value = res.data.list || []
    }
  } catch (error) {
    console.error('获取机台列表失败:', error)
  }
}

const initBarChart = () => {
  if (!barChartRef.value) return
  if (!barChart) barChart = echarts.init(barChartRef.value)

  const top10 = [...tableData.value]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10)
    .reverse() // 反转以便图表从小到大显示

  const option = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const item = params[0]
        const row = top10[item.dataIndex]
        return `${row.productName}<br/>销量: ${row.quantity} ${row.unit}<br/>订单数: ${row.orderCount}`
      }
    },
    grid: {
      left: '3%',
      right: '6%',
      bottom: '3%',
      top: '4%',
      containLabel: true
    },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f2f5' } }
    },
    yAxis: {
      type: 'category',
      data: top10.map(item => item.productName.length > 8 ? item.productName.slice(0, 8) + '…' : item.productName),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#606266', fontSize: 12 }
    },
    series: [
      {
        type: 'bar',
        data: top10.map(item => item.quantity),
        barWidth: 16,
        itemStyle: {
          borderRadius: [0, 8, 8, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: '#C7000B' },
            { offset: 1, color: '#E63946' }
          ])
        },
        label: {
          show: true,
          position: 'right',
          color: '#8E8E9E',
          fontSize: 11
        }
      }
    ]
  }
  barChart.setOption(option, true)
}

const handleResize = () => {
  barChart?.resize()
}

onMounted(async () => {
  await Promise.all([fetchCategories(), fetchWorkers(), fetchStations(), fetchMachines()])
  await fetchData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  barChart?.dispose()
  barChart = null
})
</script>

<style scoped>
.product-sales {
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

.card-red   { background: linear-gradient(135deg, #C7000B 0%, #9A0008 100%); }
.card-green { background: linear-gradient(135deg, #0B8043 0%, #066B36 100%); }
.card-blue  { background: linear-gradient(135deg, #2563EB 0%, #1E40AF 100%); }
.card-gold  { background: linear-gradient(135deg, #C5A55A 0%, #A88842 100%); }

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
  font-size: 28px;
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
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.summary-card:hover .sc-icon {
  transform: scale(1.12) rotate(-5deg);
}

.chart-card,
.table-card {
  border-radius: 14px;
  border: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  margin-bottom: 20px;
}

.chart-card :deep(.el-card__header) {
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

.chart-container {
  width: 100%;
  height: 440px;
}

.code-text {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  color: #5A5A6E;
}

.quantity-text {
  font-weight: 600;
  color: #1A1A2E;
}

.text-muted {
  color: #B8B8C4;
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
    font-size: 22px;
  }

  .chart-card,
  .table-card {
    margin-bottom: 12px;
  }

  .chart-container {
    height: 320px;
  }
}
</style>

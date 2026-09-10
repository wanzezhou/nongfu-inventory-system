<template>
  <div class="dashboard">
    <el-row :gutter="16" class="stat-cards">
      <el-col v-for="(card, idx) in statCards" :key="idx" :xs="24" :sm="12" :md="6" :style="{ animationDelay: idx * 0.05 + 's' }">
        <div class="stat-card">
          <div class="stat-label"><span class="dot" :style="{ background: card.dotColor }"></span>{{ card.label }}</div>
          <div class="stat-value font-serif">{{ card.valuePrefix }}{{ card.value }}<span v-if="card.unit" class="unit">{{ card.unit }}</span></div>
          <div class="stat-desc">{{ card.desc }}</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-row">
      <el-col :span="24" :style="{ animationDelay: '0.2s' }">
        <div class="chart-card">
          <div class="chart-header">
            <span class="chart-title font-serif">近7天销售趋势</span>
            <span class="chart-range">{{ trendRange }}</span>
          </div>
          <div v-if="trendEmpty" class="chart-empty">暂无订单数据</div>
          <div v-show="!trendEmpty" ref="trendChartRef" class="chart-container"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { formatMoney } from '@/utils/format'
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { ElMessage } from 'element-plus'
import echarts from '@/utils/echarts'
import { getDashboardSummary, getDashboardTrend } from '@/api/dashboard'

const trendChartRef = ref(null)
let trendChart = null

const summaryData = ref({
  totalInventoryValue: 0,
  monthlySales: 0,
  stationDebt: 0,
  stationCount: 0,
  pendingOrders: 0
})

// 统计卡：全部取自 /dashboard/summary 真实字段，副文案为可追溯口径，不展示编造的环比
const statCards = computed(() => [
  {
    label: '库存总金额',
    value: formatMoney(summaryData.value.totalInventoryValue),
    valuePrefix: '¥ ',
    dotColor: 'var(--primary)',
    desc: '全部商品 库存 × 进货价'
  },
  {
    label: '本月销售额',
    value: formatMoney(summaryData.value.monthlySales),
    valuePrefix: '¥ ',
    dotColor: 'var(--green)',
    desc: '本月订单金额合计（不含已取消）'
  },
  {
    label: '水站欠款总额',
    value: formatMoney(summaryData.value.stationDebt),
    valuePrefix: '¥ ',
    dotColor: 'var(--gold)',
    desc: `共 ${summaryData.value.stationCount ?? 0} 个在职水站`
  },
  {
    label: '待配送订单',
    value: String(summaryData.value.pendingOrders ?? 0),
    valuePrefix: '',
    unit: '单',
    dotColor: 'var(--primary)',
    desc: '自有配送且未分配配送员'
  }
])

const trendData = ref({ dates: [], sales: [] })
const trendEmpty = computed(() => !(trendData.value.sales || []).some((v) => Number(v) > 0))
const trendRange = computed(() => {
  const d = trendData.value.dates || []
  return d.length ? `${d[0]} ~ ${d[d.length - 1]}` : ''
})

const initTrendChart = () => {
  if (!trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value)
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: '{b}<br/>销售额: ¥{c}'
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendData.value.dates,
      axisLine: { lineStyle: { color: '#E8E6DF' } },
      axisLabel: { color: '#7A7A72' }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#7A7A72', formatter: '¥{value}' },
      splitLine: { lineStyle: { color: '#E8E6DF' } }
    },
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        data: trendData.value.sales,
        lineStyle: { color: '#A8201A', width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(168, 32, 26, 0.10)' },
            { offset: 1, color: 'rgba(168, 32, 26, 0)' }
          ])
        },
        itemStyle: { color: '#A8201A', borderWidth: 2, borderColor: '#fff' }
      }
    ]
  }
  trendChart.setOption(option)
}

const fetchSummaryData = async () => {
  try {
    const res = await getDashboardSummary()
    if (res.data) {
      summaryData.value = res.data
    }
  } catch (error) {
    console.error('获取仪表盘数据失败:', error)
    ElMessage.error('仪表盘统计数据加载失败')
  }
}

const fetchTrendData = async () => {
  try {
    const res = await getDashboardTrend()
    if (res.data) {
      trendData.value = {
        dates: res.data.map((x) => x.date?.slice(5)),
        sales: res.data.map((x) => Number(x.amount) || 0)
      }
    }
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    ElMessage.error('销售趋势数据加载失败')
  }
}

const handleResize = () => {
  trendChart?.resize()
}

onMounted(async () => {
  await fetchSummaryData()
  await fetchTrendData()
  await nextTick()
  initTrendChart()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  trendChart = null
})
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stat-cards {
  margin-bottom: 16px;
  row-gap: 16px;
}

.stat-cards .el-col {
  animation: fadeUp 0.4s ease-out both;
}

.stat-card {
  height: 100%;
  border-radius: var(--radius-lg);
  padding: 20px 22px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s ease;
}

.stat-card:hover {
  border-color: rgba(168, 32, 26, 0.25);
}

.stat-label {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat-label .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.3px;
  line-height: 1.1;
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
}

.stat-value .unit {
  font-size: 14px;
  color: var(--text-3);
  margin-left: 3px;
  font-weight: 400;
}

.stat-desc {
  font-size: 12px;
  color: var(--text-3);
}

/* 图表卡片 */
.chart-card {
  background: var(--card);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  animation: fadeUp 0.4s ease-out both;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.chart-range {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.chart-empty {
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 13px;
}

.chart-container {
  width: 100%;
  height: 320px;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

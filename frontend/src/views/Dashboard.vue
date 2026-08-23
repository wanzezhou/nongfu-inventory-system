<template>
  <div class="dashboard">
    <el-row :gutter="20" class="stat-cards">
      <el-col :span="6" v-for="(card, idx) in statCards" :key="idx" :style="{ animationDelay: idx * 0.08 + 's' }">
        <div class="stat-card shine-effect" :class="card.cls">
          <div class="card-content">
            <div class="card-info">
              <div class="card-label">{{ card.label }}</div>
              <div class="card-value">{{ card.value }}</div>
              <div class="card-desc" v-html="card.desc"></div>
            </div>
            <div class="card-icon">
              <el-icon :size="48"><component :is="card.icon" /></el-icon>
            </div>
          </div>
          <div class="card-overlay"></div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="14" :style="{ animationDelay: '0.32s' }">
        <div class="chart-card chart-enter">
          <div class="chart-header">
            <span class="chart-title">近7天销售趋势</span>
            <span class="chart-badge">实时</span>
          </div>
          <div ref="trendChartRef" class="chart-container"></div>
        </div>
      </el-col>
      <el-col :span="10" :style="{ animationDelay: '0.4s' }">
        <div class="chart-card chart-enter">
          <div class="chart-header">
            <span class="chart-title">商品销售占比</span>
            <span class="chart-badge">本月</span>
          </div>
          <div ref="pieChartRef" class="chart-container"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed } from 'vue'
import * as echarts from 'echarts'
import { getDashboardSummary, getDashboardTrend } from '@/api/dashboard'
import { Box, DataLine, Wallet, Clock } from '@element-plus/icons-vue'

const trendChartRef = ref(null)
const pieChartRef = ref(null)
let trendChart = null
let pieChart = null

const summaryData = ref({
  totalInventoryValue: 0,
  monthlySales: 0,
  stationDebt: 0,
  debtStationCount: 0,
  pendingOrders: 0
})

const statCards = computed(() => [
  {
    label: '库存总金额',
    value: '¥ ' + formatMoney(summaryData.value.totalInventoryValue),
    desc: '较昨日 <span class="trend-up">↑ 2.5%</span>',
    cls: 'card-blue',
    icon: Box
  },
  {
    label: '本月销售额',
    value: '¥ ' + formatMoney(summaryData.value.monthlySales),
    desc: '较上月 <span class="trend-up">↑ 12.3%</span>',
    cls: 'card-green',
    icon: DataLine
  },
  {
    label: '水站欠款总额',
    value: '¥ ' + formatMoney(summaryData.value.stationDebt),
    desc: '共 ' + summaryData.value.debtStationCount + ' 个水站',
    cls: 'card-orange',
    icon: Wallet
  },
  {
    label: '待配送订单数',
    value: summaryData.value.pendingOrders,
    desc: '自有员工配送且未分配配送员',
    cls: 'card-red',
    icon: Clock
  }
])

const trendData = ref({
  dates: [],
  sales: []
})

const pieData = ref([
  { name: '农夫山泉 550ml', value: 3520 },
  { name: '农夫山泉 1.5L', value: 2480 },
  { name: '农夫山泉 4L', value: 1860 },
  { name: '农夫山泉 19L', value: 1250 },
  { name: '其他产品', value: 890 }
])

const formatMoney = (value) => {
  if (!value) return '0.00'
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const initTrendChart = () => {
  if (!trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value)
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: '{b}<br/>销售额: ¥{c}'
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendData.value.dates,
      axisLine: {
        lineStyle: {
          color: '#e4e7ed'
        }
      },
      axisLabel: {
        color: '#606266'
      }
    },
    yAxis: {
      type: 'value',
      axisLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        color: '#606266',
        formatter: '¥{value}'
      },
      splitLine: {
        lineStyle: {
          color: '#f0f2f5'
        }
      }
    },
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: true,
        data: trendData.value.sales,
        lineStyle: {
          color: '#C7000B',
          width: 3
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(199, 0, 11, 0.3)' },
            { offset: 1, color: 'rgba(199, 0, 11, 0.05)' }
          ])
        },
        itemStyle: {
          color: '#C7000B',
          borderWidth: 2,
          borderColor: '#fff'
        }
      }
    ]
  }
  trendChart.setOption(option)
}

const initPieChart = () => {
  if (!pieChartRef.value) return
  pieChart = echarts.init(pieChartRef.value)
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'vertical',
      right: '5%',
      top: 'center',
      textStyle: {
        color: '#606266'
      }
    },
    series: [
      {
        name: '商品销售',
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: {
          show: false
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold'
          }
        },
        labelLine: {
          show: false
        },
        data: pieData.value,
        color: ['#C7000B', '#0B8043', '#C5A55A', '#E0666E', '#8E8E9E']
      }
    ]
  }
  pieChart.setOption(option)
}

const fetchSummaryData = async () => {
  try {
    const res = await getDashboardSummary()
    if (res.data) {
      summaryData.value = res.data
    }
  } catch (error) {
    console.error('获取仪表盘数据失败:', error)
    summaryData.value = {
      totalInventoryValue: 1256800.50,
      monthlySales: 856420.80,
      stationDebt: 325600.00,
      debtStationCount: 12,
      pendingOrders: 28
    }
  }
}

const fetchTrendData = async () => {
  try {
    const res = await getDashboardTrend()
    if (res.data) {
      trendData.value = res.data
    }
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    const dates = []
    const sales = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      dates.push(`${date.getMonth() + 1}/${date.getDate()}`)
      sales.push(Math.floor(Math.random() * 50000) + 80000)
    }
    trendData.value = { dates, sales }
  }
}

const handleResize = () => {
  trendChart?.resize()
  pieChart?.resize()
}

onMounted(async () => {
  await fetchSummaryData()
  await fetchTrendData()
  await nextTick()
  initTrendChart()
  initPieChart()
  window.addEventListener('resize', handleResize)
})
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stat-cards {
  margin-bottom: 20px;
}

.stat-cards .el-col {
  animation: statEnter 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes statEnter {
  0% {
    opacity: 0;
    transform: translateY(24px) scale(0.94);
    filter: blur(4px);
  }
  60% {
    transform: translateY(-3px) scale(1.01);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

.stat-card {
  position: relative;
  border-radius: 16px;
  padding: 26px;
  color: #fff;
  box-shadow: 
    0 4px 12px rgba(0, 0, 0, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  cursor: pointer;
  height: 100%;
}

.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, transparent 100%);
  pointer-events: none;
}

.stat-card:hover {
  transform: translateY(-6px) scale(1.02);
  box-shadow: 
    0 20px 40px rgba(0, 0, 0, 0.12),
    0 6px 16px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.stat-card:active {
  transform: translateY(-2px) scale(1);
  transition-duration: 0.15s;
}

.card-overlay {
  position: absolute;
  bottom: -40px;
  right: -40px;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.12) 0%, transparent 70%);
  pointer-events: none;
}

.card-blue {
  background: linear-gradient(135deg, #C7000B 0%, #A00009 100%);
}

.card-green {
  background: linear-gradient(135deg, #0B8043 0%, #066B36 100%);
}

.card-orange {
  background: linear-gradient(135deg, #C5A55A 0%, #A88842 100%);
}

.card-red {
  background: linear-gradient(135deg, #1A1A2E 0%, #2D2D44 100%);
}

.card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
  z-index: 1;
}

.card-label {
  font-size: 13px;
  opacity: 0.92;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
  font-weight: 500;
}

.card-value {
  font-size: 30px;
  font-weight: 700;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.card-desc {
  font-size: 12px;
  opacity: 0.85;
  letter-spacing: 0.2px;
}

.trend-up {
  color: #67C23A;
  font-weight: 700;
}

.card-icon {
  opacity: 0.88;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.stat-card:hover .card-icon {
  transform: scale(1.1) rotate(-5deg);
}

.chart-row {
  margin-top: 0;
}

.chart-row .el-col {
  animation: chartEnter 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes chartEnter {
  0% {
    opacity: 0;
    transform: translateY(20px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.chart-card {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 1px 2px rgba(0, 0, 0, 0.02);
  transition: box-shadow 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.chart-card:hover {
  box-shadow: 
    0 12px 32px rgba(0, 0, 0, 0.08),
    0 4px 12px rgba(0, 0, 0, 0.04);
  transform: translateY(-2px);
}

.chart-header {
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A1A2E;
  letter-spacing: 0.3px;
}

.chart-badge {
  font-size: 11px;
  color: #C7000B;
  background: rgba(199, 0, 11, 0.08);
  padding: 3px 10px;
  border-radius: 10px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.chart-container {
  width: 100%;
  height: 320px;
}
</style>

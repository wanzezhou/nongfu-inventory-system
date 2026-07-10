<template>
  <div class="dashboard">
    <el-row :gutter="20" class="stat-cards">
      <el-col :span="6">
        <div class="stat-card card-blue">
          <div class="card-content">
            <div class="card-info">
              <div class="card-label">库存总金额</div>
              <div class="card-value">¥ {{ formatMoney(summaryData.totalInventoryValue) }}</div>
              <div class="card-desc">较昨日 <span class="trend-up">↑ 2.5%</span></div>
            </div>
            <div class="card-icon">
              <el-icon :size="48"><Warehouse /></el-icon>
            </div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card card-green">
          <div class="card-content">
            <div class="card-info">
              <div class="card-label">本月销售额</div>
              <div class="card-value">¥ {{ formatMoney(summaryData.monthlySales) }}</div>
              <div class="card-desc">较上月 <span class="trend-up">↑ 12.3%</span></div>
            </div>
            <div class="card-icon">
              <el-icon :size="48"><TrendCharts /></el-icon>
            </div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card card-orange">
          <div class="card-content">
            <div class="card-info">
              <div class="card-label">水站欠款总额</div>
              <div class="card-value">¥ {{ formatMoney(summaryData.stationDebt) }}</div>
              <div class="card-desc">共 {{ summaryData.debtStationCount }} 个水站</div>
            </div>
            <div class="card-icon">
              <el-icon :size="48"><Wallet /></el-icon>
            </div>
          </div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="stat-card card-red">
          <div class="card-content">
            <div class="card-info">
              <div class="card-label">待处理订单数</div>
              <div class="card-value">{{ summaryData.pendingOrders }}</div>
              <div class="card-desc">需要及时处理</div>
            </div>
            <div class="card-icon">
              <el-icon :size="48"><Clock /></el-icon>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="14">
        <div class="chart-card">
          <div class="chart-header">
            <span class="chart-title">近7天销售趋势</span>
          </div>
          <div ref="trendChartRef" class="chart-container"></div>
        </div>
      </el-col>
      <el-col :span="10">
        <div class="chart-card">
          <div class="chart-header">
            <span class="chart-title">商品销售占比</span>
          </div>
          <div ref="pieChartRef" class="chart-container"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { getDashboardSummary, getDashboardTrend } from '@/api/dashboard'

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
          color: '#409EFF',
          width: 3
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64, 158, 255, 0.3)' },
            { offset: 1, color: 'rgba(64, 158, 255, 0.05)' }
          ])
        },
        itemStyle: {
          color: '#409EFF',
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
        color: ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399']
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

.stat-card {
  border-radius: 12px;
  padding: 24px;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s, box-shadow 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.card-blue {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.card-green {
  background: linear-gradient(135deg, #43cea2 0%, #185a9d 100%);
}

.card-orange {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
}

.card-red {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
}

.card-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-label {
  font-size: 14px;
  opacity: 0.9;
  margin-bottom: 8px;
}

.card-value {
  font-size: 28px;
  font-weight: bold;
  margin-bottom: 8px;
}

.card-desc {
  font-size: 12px;
  opacity: 0.85;
}

.trend-up {
  color: #67C23A;
  font-weight: bold;
}

.card-icon {
  opacity: 0.85;
}

.chart-row {
  margin-top: 0;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.chart-header {
  margin-bottom: 16px;
}

.chart-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.chart-container {
  width: 100%;
  height: 320px;
}
</style>

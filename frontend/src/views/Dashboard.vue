<template>
  <div class="dashboard">
    <el-row :gutter="16" class="stat-cards">
      <el-col
        v-for="(card, idx) in cardList"
        :key="card.key"
        :xs="24"
        :sm="12"
        :md="cardSpan"
        :style="{ animationDelay: idx * 0.04 + 's' }"
      >
        <div class="stat-card">
          <div class="card-head">
            <div class="stat-label">
              <span class="dot" :style="{ background: card.dotColor }"></span>{{ card.label }}
            </div>
            <!-- 周期切换（月/季/年）：选择结果写入 localStorage，刷新后保留 -->
            <el-radio-group
              v-if="card.rangeKey"
              v-model="cardRanges[card.rangeKey]"
              size="small"
              class="range-switch"
            >
              <el-radio-button v-for="opt in RANGE_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </el-radio-button>
            </el-radio-group>
          </div>
          <div class="stat-value font-serif">
            {{ card.prefix }}{{ card.value }}<span v-if="card.unit" class="unit">{{ card.unit }}</span>
          </div>
          <div class="stat-desc">{{ card.desc }}</div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-row">
      <el-col :span="24" :style="{ animationDelay: '0.2s' }">
        <div class="chart-card">
          <div class="chart-header">
            <span class="chart-title font-serif">月销售趋势（按商品件数）</span>
            <span class="chart-range">{{ trendYear }}年 · 单位：件</span>
          </div>
          <div v-if="trendEmpty" class="chart-empty">本年度暂无销量数据</div>
          <div v-show="!trendEmpty" ref="trendChartRef" class="chart-container"></div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { formatMoney } from '@/utils/format'
import { ref, reactive, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import echarts from '@/utils/echarts'
import { getDashboardSummary, getDashboardMetrics, getDashboardTrend } from '@/api/dashboard'

// ---------------------------------------------------------------------------
// 周期卡片（月/季/年）—— 每张卡片独立选择，选择结果按 key 记忆在 localStorage
// ---------------------------------------------------------------------------
const RANGE_OPTIONS = [
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季' },
  { value: 'year', label: '年' }
]
const RANGE_VALUES = RANGE_OPTIONS.map((o) => o.value)
const RANGE_TEXT = { month: '本月', quarter: '本季度', year: '今年' }
const RANGE_STORE_KEY = 'dashboard_card_ranges'

// 需要周期切换的卡片字段（其余卡片与时间无关）
const RANGE_FIELDS = ['salesQty', 'orderCount', 'revenue', 'cost', 'salary', 'profit']

const defaultRanges = () => RANGE_FIELDS.reduce((acc, k) => ({ ...acc, [k]: 'month' }), {})

// 读取记忆的周期：逐项校验，非法值回落 month（localStorage 内容可能被手改/版本升级）
const loadRanges = () => {
  const base = defaultRanges()
  try {
    const raw = JSON.parse(localStorage.getItem(RANGE_STORE_KEY) || '{}')
    RANGE_FIELDS.forEach((k) => {
      if (RANGE_VALUES.includes(raw?.[k])) base[k] = raw[k]
    })
  } catch (e) {
    // 解析失败按默认值处理，不阻断页面
  }
  return base
}

const cardRanges = reactive(loadRanges())

// ---------------------------------------------------------------------------
// 数据
// ---------------------------------------------------------------------------
const summaryData = ref({ totalInventoryValue: 0 })
// 周期指标按 range 缓存：多张卡片选同一周期时只发一次请求
const metricsMap = reactive({})

const metricOf = (field) => metricsMap[cardRanges[field]] || {}
const rangeTextOf = (field) => RANGE_TEXT[cardRanges[field]] || ''

const fetchMetrics = async (range) => {
  if (metricsMap[range]) return
  try {
    const res = await getDashboardMetrics(range)
    if (res.data) metricsMap[range] = res.data
  } catch (error) {
    console.error('获取仪表盘周期指标失败:', error)
    ElMessage.error('仪表盘统计数据加载失败')
  }
}

// 卡片：全部取后端真实字段，副文案标注口径来源（不展示编造的环比）
const cardList = computed(() => [
  {
    key: 'inventory',
    label: '库存总金额',
    prefix: '¥ ',
    value: formatMoney(summaryData.value.totalInventoryValue),
    dotColor: 'var(--primary)',
    desc: '启用商品 库存 × 进货价（负库存按 0 计）'
  },
  {
    key: 'salesQty',
    rangeKey: 'salesQty',
    label: '总销量',
    prefix: '',
    unit: '件',
    value: String(metricOf('salesQty').salesQty ?? 0),
    dotColor: 'var(--green)',
    desc: `${rangeTextOf('salesQty')} · 订单商品件数 + 机台销量件数`
  },
  {
    key: 'orderCount',
    rangeKey: 'orderCount',
    label: '总订单数',
    prefix: '',
    unit: '单',
    value: String(metricOf('orderCount').orderCount ?? 0),
    dotColor: 'var(--primary)',
    desc: `${rangeTextOf('orderCount')} · 未取消订单（含机台供货）`
  },
  {
    key: 'revenue',
    rangeKey: 'revenue',
    label: '总营收',
    prefix: '¥ ',
    value: formatMoney(metricOf('revenue').revenue),
    dotColor: 'var(--green)',
    desc: `${rangeTextOf('revenue')} · 订单营收 + 机台销量营收`
  },
  {
    key: 'cost',
    rangeKey: 'cost',
    label: '总成本',
    prefix: '¥ ',
    value: formatMoney(metricOf('cost').cost),
    dotColor: 'var(--gold)',
    desc: `${rangeTextOf('cost')} · 订单商品成本（不含工资与其他支出）`
  },
  {
    key: 'salary',
    rangeKey: 'salary',
    label: '工资统计',
    prefix: '¥ ',
    value: formatMoney(metricOf('salary').salary),
    dotColor: 'var(--gold)',
    desc: `${rangeTextOf('salary')} · 应发工资合计（全员配送费口径）`
  },
  {
    key: 'profit',
    rangeKey: 'profit',
    label: '总利润',
    prefix: '¥ ',
    value: formatMoney(metricOf('profit').profit),
    dotColor: 'var(--primary)',
    desc: `${rangeTextOf('profit')} · 总营收 − 总成本（不重复扣工资）`
  }
])

// 卡片栅格等分：优先 4 列、其次 3 列，保证末行不留空（7 张 → 4+3，8 张 → 4×2）
const cardSpan = computed(() => {
  const n = cardList.value.length || 1
  if (n <= 4) return 24 / n
  if (n % 4 === 0) return 6
  if (n % 3 === 0) return 8
  return 6
})

// ---------------------------------------------------------------------------
// 月销售趋势（本年度 1~12 月，按商品件数）
// ---------------------------------------------------------------------------
const trendChartRef = ref(null)
let trendChart = null
const trendData = ref({ labels: [], values: [] })
const trendYear = new Date().getFullYear()
const trendEmpty = computed(() => !(trendData.value.values || []).some((v) => Number(v) > 0))

// 图表颜色取自主题 token（避免在 JS 里硬编码色值，与 DESIGN.md 一致）
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v || '').trim() || fallback
}

const initTrendChart = () => {
  if (!trendChartRef.value) return
  const cPrimary = cssVar('--primary', '#A8201A')
  const cBorder = cssVar('--border', '#E8E6DF')
  const cText2 = cssVar('--text-2', '#7A7A72')
  const cCard = cssVar('--card', '#FFFFFF')
  const rgba = (rgb, a) => `rgba(${rgb}, ${a})`
  // #A8201A → '168, 32, 26'
  const primaryRgb = cPrimary.replace('#', '').match(/.{2}/g)?.map((h) => parseInt(h, 16)).join(', ') || '168, 32, 26'

  trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: '{b}<br/>销量: {c} 件'
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendData.value.labels,
      axisLine: { lineStyle: { color: cBorder } },
      axisLabel: { color: cText2 }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: cText2 },
      splitLine: { lineStyle: { color: cBorder } }
    },
    series: [
      {
        name: '商品件数',
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        data: trendData.value.values,
        lineStyle: { color: cPrimary, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: rgba(primaryRgb, 0.1) },
            { offset: 1, color: rgba(primaryRgb, 0) }
          ])
        },
        itemStyle: { color: cPrimary, borderWidth: 2, borderColor: cCard }
      }
    ]
  })
}

const fetchSummaryData = async () => {
  try {
    const res = await getDashboardSummary()
    if (res.data) summaryData.value = res.data
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
        labels: res.data.map((x) => x.label),
        values: res.data.map((x) => Number(x.qty) || 0)
      }
    }
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    ElMessage.error('销售趋势数据加载失败')
  }
}

// 周期变化：先记忆，再按需拉取该周期数据（已缓存则直接复用）
watch(
  () => ({ ...cardRanges }),
  (val) => {
    localStorage.setItem(RANGE_STORE_KEY, JSON.stringify(val))
    const distinct = [...new Set(Object.values(val))]
    Promise.all(distinct.map((r) => fetchMetrics(r)))
  },
  { deep: true }
)

const handleResize = () => {
  trendChart?.resize()
}

onMounted(async () => {
  await fetchSummaryData()
  await Promise.all([...new Set(Object.values(cardRanges))].map((r) => fetchMetrics(r)))
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

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.stat-label {
  font-size: 13px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.stat-label .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.range-switch {
  flex-shrink: 0;
}

.range-switch :deep(.el-radio-button__inner) {
  padding: 3px 8px;
  font-size: 12px;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.3px;
  line-height: 1.1;
  margin-bottom: 10px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
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
  gap: 8px;
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
  white-space: nowrap;
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

/* 窄屏：卡片内标题与周期切换换行，图表高度收紧 */
@media (max-width: 768px) {
  .stat-card {
    padding: 16px 16px;
  }

  .card-head {
    flex-wrap: wrap;
  }

  .stat-value {
    font-size: 22px;
  }

  .chart-card {
    padding: 16px 14px;
  }

  .chart-header {
    flex-wrap: wrap;
  }

  .chart-container,
  .chart-empty {
    height: 240px;
  }
}
</style>

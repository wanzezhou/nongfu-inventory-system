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

    <!-- 趋势图（4 张）：每张独立切换粒度（日/周/月/季/年）并记忆所选粒度 -->
    <el-row :gutter="16" class="trend-row">
      <el-col
        v-for="(t, idx) in TREND_DEFS"
        :key="t.key"
        :xs="24"
        :md="12"
        :style="{ animationDelay: (0.16 + idx * 0.04) + 's' }"
        class="trend-col"
      >
        <TrendChartCard
          :title="t.title"
          :subtitle="trendSubtitle(t)"
          :value-type="t.valueType"
          :unit="t.unit"
          :color-var="t.colorVar"
          :labels="trendSeries(t.key).labels"
          :values="trendSeries(t.key).values"
          :granularity="trendGranularities[t.key]"
          :empty-text="t.emptyText"
          @update:granularity="setGranularity(t.key, $event)"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { formatMoney } from '@/utils/format'
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import TrendChartCard from '@/components/TrendChartCard.vue'
import { getDashboardSummary, getDashboardMetrics, getDashboardTrends } from '@/api/dashboard'

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
// 趋势图配置（4 张：销售件数 / 营收 / 成本 / 利润）
// 每张图独立切换粒度，故粒度记忆也按 key 分开存
// ---------------------------------------------------------------------------
const TREND_DEFS = [
  { key: 'salesQty', title: '销售趋势', valueType: 'qty', unit: '件', colorVar: '--green', emptyText: '所选区间暂无销量数据' },
  { key: 'revenue', title: '总营收趋势', valueType: 'money', unit: '', colorVar: '--green', emptyText: '所选区间暂无营收数据' },
  { key: 'cost', title: '总成本趋势', valueType: 'money', unit: '', colorVar: '--gold', emptyText: '所选区间暂无成本数据' },
  { key: 'profit', title: '总利润趋势', valueType: 'money', unit: '', colorVar: '--primary', emptyText: '所选区间暂无利润数据' }
]

const TREND_KEYS = TREND_DEFS.map((t) => t.key)
const GRANULARITY_VALUES = ['day', 'week', 'month', 'quarter', 'year']
const GRANULARITY_TEXT = {
  day: '近 30 天',
  week: '近 12 周',
  month: '近 12 个月',
  quarter: '近 8 个季度',
  year: '近 5 年'
}
const TREND_STORE_KEY = 'dashboard_trend_granularities'

const loadGranularities = () => {
  const base = TREND_KEYS.reduce((acc, k) => ({ ...acc, [k]: 'month' }), {})
  try {
    const raw = JSON.parse(localStorage.getItem(TREND_STORE_KEY) || '{}')
    TREND_KEYS.forEach((k) => {
      if (GRANULARITY_VALUES.includes(raw?.[k])) base[k] = raw[k]
    })
  } catch (e) {
    // 同上：解析失败用默认值
  }
  return base
}

const trendGranularities = reactive(loadGranularities())

// ---------------------------------------------------------------------------
// 数据
// ---------------------------------------------------------------------------
const summaryData = ref({ totalInventoryValue: 0 })
// 周期指标按 range 缓存：多张卡片选同一周期时只发一次请求
const metricsMap = reactive({})
// 趋势按粒度缓存：4 张图共用一份结果（同一粒度只请求一次）
const trendsMap = reactive({})

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

// 趋势序列：从缓存的桶数组里取某一个指标
const trendSeries = (key) => {
  const buckets = trendsMap[trendGranularities[key]]?.buckets || []
  return {
    labels: buckets.map((b) => b.label),
    values: buckets.map((b) => Number(b[key]) || 0)
  }
}

const trendSubtitle = (t) => {
  const span = GRANULARITY_TEXT[trendGranularities[t.key]] || ''
  return t.valueType === 'qty' ? `${span} · 单位：件` : `${span} · 单位：元`
}

const fetchTrends = async (granularity) => {
  if (trendsMap[granularity]) return
  try {
    const res = await getDashboardTrends(granularity)
    if (res.data) trendsMap[granularity] = res.data
  } catch (error) {
    console.error('获取趋势数据失败:', error)
    ElMessage.error('趋势数据加载失败')
  }
}

const setGranularity = (key, value) => {
  if (!GRANULARITY_VALUES.includes(value)) return
  trendGranularities[key] = value
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
    desc: `${rangeTextOf('cost')} · 订单商品成本 + 工资 + 其他支出`
  },
  {
    key: 'salary',
    rangeKey: 'salary',
    label: '工资统计',
    prefix: '¥ ',
    value: formatMoney(metricOf('salary').salary),
    dotColor: 'var(--gold)',
    desc: `${rangeTextOf('salary')} · 应发工资（已计入总成本）`
  },
  {
    key: 'profit',
    rangeKey: 'profit',
    label: '总利润',
    prefix: '¥ ',
    value: formatMoney(metricOf('profit').profit),
    dotColor: 'var(--primary)',
    desc: `${rangeTextOf('profit')} · 总营收 − 总成本（成本含工资与其他支出）`
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

const fetchSummaryData = async () => {
  try {
    const res = await getDashboardSummary()
    if (res.data) summaryData.value = res.data
  } catch (error) {
    console.error('获取仪表盘数据失败:', error)
    ElMessage.error('仪表盘统计数据加载失败')
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

// 趋势粒度变化：先记忆，再按需拉取（同一粒度只请求一次，4 张图共用）
watch(
  () => ({ ...trendGranularities }),
  (val) => {
    localStorage.setItem(TREND_STORE_KEY, JSON.stringify(val))
    const distinct = [...new Set(Object.values(val))]
    Promise.all(distinct.map((g) => fetchTrends(g)))
  },
  { deep: true }
)

onMounted(async () => {
  await fetchSummaryData()
  await Promise.all([
    ...[...new Set(Object.values(cardRanges))].map((r) => fetchMetrics(r)),
    ...[...new Set(Object.values(trendGranularities))].map((g) => fetchTrends(g))
  ])
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
  border-color: var(--border-strong);
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

/* 趋势图区：2×2 栅格，窄屏堆叠 */
.trend-row {
  row-gap: 16px;
}

.trend-col {
  animation: fadeUp 0.4s ease-out both;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 窄屏：卡片内标题与周期切换换行 */
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
}
</style>

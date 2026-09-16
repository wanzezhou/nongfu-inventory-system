<template>
  <div class="profit-type-page">
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
        利润口径：<b>{{ label.main }}</b> —— {{ label.formula }}。{{ label.desc }}。统计范围：<b>{{ rangeLabel }}</b>，均不含已取消订单。
        <span v-if="isMachineType" class="warn-note">（机台营收按销量日期统计，机台成本按供货订单日期统计）</span>
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div v-for="card in summaryCards" :key="card.key" class="summary-card">
        <div class="card-label">
          <el-icon><component :is="card.icon" /></el-icon>
          <span>{{ card.label }}</span>
        </div>
        <div class="card-value" :class="{ total: card.total, negative: card.value < 0, positive: card.total && card.value >= 0 }">
          <template v-if="card.count">{{ card.value }}</template>
          <template v-else>¥{{ fmtMoney(card.value) }}</template>
        </div>
        <div class="card-desc">{{ card.desc }}</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>{{ typeName }}利润明细</span>
          <span class="header-sub" v-if="!isMachineType">共 {{ summary.orderCount }} 单</span>
        </div>
      </template>

      <el-empty v-if="isMachineType" description="机台利润为营收与成本的整体差额，无订单级明细（详见成本页与营收页）" :image-size="70" />

      <el-table v-else :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip />
        <el-table-column v-if="orderType === 2" prop="stationName" label="水站" min-width="130" show-overflow-tooltip />
        <el-table-column v-else prop="customerName" label="客户" min-width="120" show-overflow-tooltip />
        <el-table-column prop="totalQty" label="数量" width="75" align="right" />

        <!-- 类型2：营收1/营收2、成本1/成本2、利润1/利润2 -->
        <template v-if="orderType === 2">
          <el-table-column prop="revenue1" label="营收1" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.revenue1) }}</template>
          </el-table-column>
          <el-table-column prop="cost1" label="成本1" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.cost1) }}</template>
          </el-table-column>
          <el-table-column prop="profit1" label="利润1" width="105" align="right">
            <template #default="{ row }"><span :class="row.profit1 < 0 ? 'neg' : 'pos'">¥{{ fmtMoney(row.profit1) }}</span></template>
          </el-table-column>
          <el-table-column prop="revenue2" label="营收2" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.revenue2) }}</template>
          </el-table-column>
          <el-table-column prop="cost2" label="成本2" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.cost2) }}</template>
          </el-table-column>
          <el-table-column prop="profit2" label="利润2" width="105" align="right">
            <template #default="{ row }"><span :class="row.profit2 < 0 ? 'neg' : 'pos'">¥{{ fmtMoney(row.profit2) }}</span></template>
          </el-table-column>
        </template>

        <!-- 其他类型：营收 / 成本 / 利润 -->
        <template v-else>
          <el-table-column prop="revenue" label="营收" width="115" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.revenue) }}</template>
          </el-table-column>
          <el-table-column v-if="orderType === 3" prop="costA" label="成本A" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.costA) }}</template>
          </el-table-column>
          <el-table-column v-if="orderType === 3" prop="costB" label="成本B" width="105" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.costB) }}</template>
          </el-table-column>
          <el-table-column prop="costTotal" label="成本合计" width="115" align="right">
            <template #default="{ row }">¥{{ fmtMoney(row.costTotal) }}</template>
          </el-table-column>
        </template>

        <el-table-column prop="profitTotal" label="利润" width="120" align="right" fixed="right">
          <template #default="{ row }">
            <span :class="row.profitTotal < 0 ? 'neg' : 'pos'" class="bold">¥{{ fmtMoney(row.profitTotal) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="下单时间" width="165" />
      </el-table>
      <el-empty v-if="!isMachineType && !rows.length && !loading" description="当前区间无利润数据" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Money, Wallet, TrendCharts, Goods, DataLine } from '@element-plus/icons-vue'
import { toQuery, rangeText } from '@/utils/dateRange'
import { getProfitByType } from '@/api/profit'

const props = defineProps({
  orderType: { type: Number, required: true },
  typeName: { type: String, default: '' }
})

const loading = ref(false)
const query = reactive({ range: 'month' })
const customRange = ref([])
const rows = ref([])
const summary = reactive({
  revenue: 0, revenue1: 0, revenue2: 0, costTotal: 0, cost1: 0, cost2: 0,
  costA: 0, costB: 0, profit: 0, profit1: 0, profit2: 0,
  orderCount: 0, totalQty: 0, saleQty: 0, supplyQty: 0
})
const label = reactive({ main: '利润', formula: '营收 − 成本', desc: '' })

const isMachineType = computed(() => props.orderType === 4 || props.orderType === 6)
const rangeLabel = computed(() => rangeText({ range: query.range, startDate: customRange.value?.[0], endDate: customRange.value?.[1] }))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const marginOf = (profit, revenue) => (revenue > 0 ? `毛利率 ${(Math.round((profit / revenue) * 10000) / 100).toFixed(2)}%` : '毛利率 -')

const summaryCards = computed(() => {
  if (props.orderType === 2) {
    return [
      { key: 'r1', label: '营收1（返货价值+总包配送费）', value: summary.revenue1, desc: '水票抵扣商品的（进货价+总包配送费）', icon: Money },
      { key: 'c1', label: '成本1', value: summary.cost1, desc: '抵扣商品成本', icon: Wallet },
      { key: 'p1', label: '利润1', value: summary.profit1, desc: `营收1 − 成本1，${marginOf(summary.profit1, summary.revenue1)}`, icon: DataLine },
      { key: 'r2', label: '营收2（分销价合计）', value: summary.revenue2, desc: '未抵扣商品分销价合计', icon: Money },
      { key: 'c2', label: '成本2', value: summary.cost2, desc: '未抵扣商品成本', icon: Wallet },
      { key: 'p2', label: '利润2', value: summary.profit2, desc: `营收2 − 成本2，${marginOf(summary.profit2, summary.revenue2)}`, icon: DataLine },
      { key: 'total', label: '利润合计', value: summary.profit, desc: `利润1 + 利润2，${marginOf(summary.profit, summary.revenue)}`, icon: TrendCharts, total: true }
    ]
  }
  if (isMachineType.value) {
    return [
      { key: 'rev', label: '机台营收', value: summary.revenue, desc: `按机台销量统计，共 ${summary.saleQty} 件`, icon: Money },
      { key: 'cost', label: '机台成本', value: summary.costTotal, desc: `按供货订单商品统计，共 ${summary.supplyQty} 件`, icon: Wallet },
      { key: 'total', label: '利润', value: summary.profit, desc: `营收 − 成本，${marginOf(summary.profit, summary.revenue)}`, icon: TrendCharts, total: true }
    ]
  }
  const cards = [
    { key: 'rev', label: '营收', value: summary.revenue, desc: '按营收口径统计', icon: Money }
  ]
  if (props.orderType === 3) {
    cards.push({ key: 'ca', label: '成本A（自有员工配送）', value: summary.costA, desc: '（进货价+工人零售配送费）× 数量', icon: Wallet })
    cards.push({ key: 'cb', label: '成本B（无需配送）', value: summary.costB, desc: '进货价 × 数量', icon: Wallet })
  }
  cards.push({ key: 'cost', label: '成本合计', value: summary.costTotal, desc: label.desc, icon: Wallet })
  cards.push({ key: 'total', label: '利润', value: summary.profit, desc: `营收 − 成本，${marginOf(summary.profit, summary.revenue)}`, icon: TrendCharts, total: true })
  return cards
})

const buildParams = () => {
  const q = toQuery({ range: query.range, startDate: customRange.value?.[0], endDate: customRange.value?.[1] })
  return { ...q, orderType: props.orderType }
}

const fetchData = async () => {
  if (query.range === 'custom' && !(customRange.value?.[0] && customRange.value?.[1])) {
    ElMessage.warning('请选择起止日期')
    return
  }
  loading.value = true
  try {
    const res = await getProfitByType(buildParams())
    const d = res.data || {}
    rows.value = d.list || []
    Object.assign(summary, d.summary || {})
    if (d.label) Object.assign(label, d.label)
  } catch (e) {
    console.error('利润查询失败:', e)
    ElMessage.error(e.response?.data?.message || '利润查询失败')
  } finally {
    loading.value = false
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
.profit-type-page { padding: 0; }
.filter-card { margin-bottom: 14px; border-radius: var(--radius-md); }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.range-picker { max-width: 300px; }
.filter-hint { margin-top: 10px; font-size: 12px; color: var(--text-2); line-height: 1.7; }
.warn-note { color: var(--gold); }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-bottom: 14px; }
.summary-card {
  border-radius: var(--radius-lg); padding: 16px 18px; background: var(--card);
  border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: border-color 0.2s ease;
}
.summary-card:hover { border-color: rgba(168, 32, 26, 0.25); }
.card-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); }
.card-label .el-icon { color: var(--text-2); }
.card-value { font-size: 25px; font-weight: 700; margin: 6px 0 4px; line-height: 1.2; color: var(--text); font-variant-numeric: tabular-nums; }
.card-value.total { font-size: 30px; }
.card-value.positive { color: var(--gold); }
.card-value.negative { color: var(--green); }
.card-desc { font-size: 12px; color: var(--text-3); line-height: 1.5; }
.detail-card { border-radius: var(--radius-md); }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.header-sub { font-size: 12px; color: var(--text-3); font-weight: 400; }
.pos { color: var(--gold); }
.neg { color: var(--green); }
.bold { font-weight: 600; }

@media (max-width: 768px) {
  .filter-bar { flex-direction: column; align-items: stretch; }
  .range-picker { max-width: 100%; }
  .summary-grid { grid-template-columns: 1fr; }
}
</style>

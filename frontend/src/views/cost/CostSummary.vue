<template>
  <div class="cost-summary">
    <!-- 筛选 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-row">
        <DateRangeFilter v-model="rangeState" @change="fetchData" />
        <el-button type="primary" style="margin-left: 12px;" @click="fetchData">
          <el-icon><Search /></el-icon>查询
        </el-button>
        <span class="tip">成本合计 = 直营水站成本（成本1 水票抵扣商品 + 成本2 未抵扣商品） + 员工工资（订单配送费） + 其他支出</span>
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><OfficeBuilding /></el-icon><span>直营水站成本</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.stationCost) }}</div>
        <div class="card-desc">成本1 水票抵扣商品 + 成本2 未抵扣商品</div>
      </div>
      <div class="summary-card card-purple">
        <div class="card-label"><el-icon><Money /></el-icon><span>员工工资</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.salaryCost) }}</div>
        <div class="card-desc">配送员工配送费合计（按订单配送费）</div>
      </div>
      <div class="summary-card card-orange">
        <div class="card-label"><el-icon><Wallet /></el-icon><span>其他支出</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.otherExpense) }}</div>
        <div class="card-desc">手动录入的其他支出（{{ summary.expenseCount }} 笔）</div>
      </div>
      <div class="summary-card card-gold">
        <div class="card-label"><el-icon><TrendCharts /></el-icon><span>成本合计</span></div>
        <div class="card-value total">¥{{ fmtMoney(totalCost) }}</div>
        <div class="card-desc">{{ rangeLabel }} 总成本</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="其他支出明细" name="expense">
          <el-table :data="expenseRows" border stripe size="small">
            <el-table-column prop="expenseName" label="支出名称" min-width="150" show-overflow-tooltip />
            <el-table-column prop="category" label="类别" width="110" />
            <el-table-column prop="amount" label="金额" width="120" align="right">
              <template #default="{ row }"><span class="fee-text">¥{{ fmtMoney(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="expenseDate" label="支出日期" width="110" />
            <el-table-column prop="accountName" label="支出账户" width="110">
              <template #default="{ row }">{{ row.accountName || '-' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!expenseRows.length" description="当前区间无其他支出" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane label="直营水站成本明细" name="station">
          <el-table :data="stationRows" border stripe size="small">
            <el-table-column prop="stationName" label="水站名称" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.stationName || '未关联水站' }}</template>
            </el-table-column>
            <el-table-column prop="orderCount" label="订单数" width="100" align="center" />
            <el-table-column prop="totalQty" label="商品件数" width="110" align="center" />
            <el-table-column prop="ticketQty" label="抵扣件数" width="110" align="center" />
            <el-table-column prop="cost1" label="成本1" width="120" align="right">
              <template #default="{ row }"><span class="fee-text">¥{{ fmtMoney(row.cost1) }}</span></template>
            </el-table-column>
            <el-table-column prop="cost2" label="成本2" width="120" align="right">
              <template #default="{ row }"><span class="fee-text">¥{{ fmtMoney(row.cost2) }}</span></template>
            </el-table-column>
            <el-table-column prop="costTotal" label="成本合计" width="130" align="right">
              <template #default="{ row }"><span class="fee-text">¥{{ fmtMoney(row.costTotal) }}</span></template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!stationRows.length" description="当前区间无直营水站成本" :image-size="60" />
        </el-tab-pane>
        <el-tab-pane label="员工工资明细" name="salary">
          <el-table :data="salaryRows" border stripe size="small">
            <el-table-column prop="workerName" label="员工" min-width="110" />
            <el-table-column prop="phone" label="电话" width="130" />
            <el-table-column prop="orderCount" label="配送订单数" width="120" align="center" />
            <el-table-column prop="totalQty" label="配送件数" width="110" align="center" />
            <el-table-column prop="deliveryFee" label="配送费" width="130" align="right">
              <template #default="{ row }"><span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span></template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!salaryRows.length" description="当前区间无配送工资" :image-size="60" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Money, Wallet, OfficeBuilding, TrendCharts } from '@element-plus/icons-vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import { defaultRange, toQuery, rangeText } from '@/utils/dateRange'
import { getCostOverview, getCostByType } from '@/api/cost'
import { getSalarySummary } from '@/api/salary'
import { getExpenses } from '@/api/expense'

const rangeState = ref(defaultRange())
const loading = ref(false)
const activeTab = ref('expense')
const summary = reactive({ stationCost: 0, salaryCost: 0, otherExpense: 0, expenseCount: 0 })
const stationRows = ref([])
const salaryRows = ref([])
const expenseRows = ref([])

const rangeLabel = computed(() => rangeText(rangeState.value))

const totalCost = computed(() =>
  Math.round((summary.stationCost + summary.salaryCost + summary.otherExpense) * 100) / 100
)

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 直营水站成本按水站维度聚合：取类型2 的按订单明细，前端汇总到水站
// （原「水站成本明细」页删除后，此处保留按水站汇总的能力，口径与直营水站销售页一致）
const buildStationRows = async (q) => {
  try {
    const res = await getCostByType({ ...q, orderType: 2 })
    const map = new Map()
    ;(res.data?.list || []).forEach((o) => {
      const key = o.stationName || '未关联水站'
      const cur = map.get(key) || { stationName: key, orderCount: 0, totalQty: 0, ticketQty: 0, cost1: 0, cost2: 0, costTotal: 0 }
      cur.orderCount += 1
      cur.totalQty += Number(o.totalQty) || 0
      cur.ticketQty += Number(o.ticketQty) || 0
      cur.cost1 += Number(o.cost1) || 0
      cur.cost2 += Number(o.cost2) || 0
      cur.costTotal += Number(o.costTotal) || 0
      map.set(key, cur)
    })
    return [...map.values()]
      .map((x) => ({
        ...x,
        cost1: Math.round(x.cost1 * 100) / 100,
        cost2: Math.round(x.cost2 * 100) / 100,
        costTotal: Math.round(x.costTotal * 100) / 100
      }))
      .sort((a, b) => b.costTotal - a.costTotal)
  } catch (e) {
    console.error('直营水站成本明细失败:', e)
    return []
  }
}

const fetchData = async () => {
  if (rangeState.value.range === 'custom' && !(rangeState.value.startDate && rangeState.value.endDate)) {
    ElMessage.warning('请选择起止日期')
    return
  }
  loading.value = true
  try {
    const q = toQuery(rangeState.value)
    const [ov, sa, ex] = await Promise.all([
      getCostOverview(q),
      getSalarySummary(q),
      // 明细表仅预览前 500 条；卡片金额与笔数取后端全量聚合（sumAmount / total）
      getExpenses({ ...q, page: 1, pageSize: 500 })
    ])
    // 直营水站成本：取 /cost/overview 中类型 2（直营水站销售）的成本合计，
    // 口径与「成本统计 → 直营水站销售」页完全一致（成本1 抵扣 + 成本2 未抵扣）。
    const t2 = (ov.data?.list || []).find((x) => Number(x.orderType) === 2)
    summary.stationCost = Number(t2?.costTotal) || 0
    summary.salaryCost = sa.data?.summary?.totalDeliveryFee || 0
    salaryRows.value = sa.data?.list || []
    summary.otherExpense = ex.data?.sumAmount || 0
    summary.expenseCount = ex.data?.total || 0
    expenseRows.value = ex.data?.list || []
    // 水站维度明细：复用 /cost/by-type 的按订单列表在前端按水站聚合
    stationRows.value = await buildStationRows(q)
  } catch (e) {
    console.error('成本汇总失败:', e)
    ElMessage.error(e.response?.data?.message || '成本汇总查询失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.cost-summary {
  padding: 0;
}
.filter-card {
  margin-bottom: 14px;
  border-radius: var(--radius-md);
}
.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.tip {
  margin-left: 16px;
  font-size: 12px;
  color: var(--text-2);
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
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
  font-size: 25px;
  font-weight: 700;
  margin: 6px 0 4px;
  line-height: 1.2;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.card-value.total {
  font-size: 30px;
}
.card-desc {
  font-size: 12px;
  color: var(--text-3);
}
.card-blue { --accent: var(--text-2); }
.card-purple { --accent: var(--text-2); }
.card-orange { --accent: var(--gold); }
.card-gold { --accent: var(--gold); }
.detail-card {
  border-radius: var(--radius-md);
}
.fee-text {
  color: var(--gold);
  font-weight: 600;
}
</style>

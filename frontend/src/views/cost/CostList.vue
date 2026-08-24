<template>
  <div class="page-container">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="query.range" @change="handleSearch">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="day">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
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
        <el-button type="success" :loading="exporting" @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
      </div>
      <div class="filter-hint">
        当前成本类型：<b>{{ currentTypeName }}</b> —— 单件成本 = 进货价 + {{ deliveryFeeName }}。统计范围：<b>{{ rangeText }}</b>。均不含已取消订单。
      </div>
    </el-card>

    <!-- 汇总卡片：进货价合计 / 配送费合计 / 成本合计 -->
    <div class="summary-grid">
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><Coin /></el-icon>进货价合计</div>
        <div class="card-value">¥{{ fmtMoney(cardData.purchaseTotal) }}</div>
        <div class="card-desc">商品进货成本</div>
      </div>
      <div class="summary-card card-green">
        <div class="card-label"><el-icon><Van /></el-icon>{{ deliveryFeeName }}合计</div>
        <div class="card-value">¥{{ fmtMoney(cardData.deliveryTotal) }}</div>
        <div class="card-desc">配送成本</div>
      </div>
      <div class="summary-card card-red">
        <div class="card-label"><el-icon><Money /></el-icon>成本总计</div>
        <div class="card-value">¥{{ fmtMoney(cardData.cost) }}</div>
        <div class="card-desc">进货价 + {{ deliveryFeeName }}</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <el-table :data="orderRows" v-loading="loading" border stripe size="small">
        <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="handleViewOrder(row)">{{ row.orderNo }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="typeName" label="订单类型" width="130" />
        <el-table-column prop="customerName" label="客户" min-width="110" show-overflow-tooltip />
        <el-table-column prop="totalQty" label="数量" width="80" align="center">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="handleViewOrder(row)">{{ row.totalQty }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="purchaseTotal" label="进货价合计" width="115" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.purchaseTotal) }}</template>
        </el-table-column>
        <el-table-column prop="deliveryTotal" label="配送费合计" width="115" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.deliveryTotal) }}</template>
        </el-table-column>
        <el-table-column prop="cost" label="成本" width="120" align="right">
          <template #default="{ row }">
            <el-tooltip :content="`进货价 ¥${fmtMoney(row.purchaseTotal)} + ${deliveryFeeName} ¥${fmtMoney(row.deliveryTotal)}`" placement="top">
              <span class="cost-text">¥{{ fmtMoney(row.cost) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="下单时间" width="165" />
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleViewOrder(row)">
              <el-icon><View /></el-icon>详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="orderTotal"
          :page-size="orderQuery.pageSize"
          :current-page="orderQuery.page"
          @current-change="(p) => { orderQuery.page = p; fetchOrders() }"
        />
      </div>
    </el-card>

    <!-- 订单详情弹窗 -->
    <el-dialog v-model="detailVisible" title="订单详情" width="720px" :close-on-click-modal="false">
      <div v-if="currentOrder" class="order-detail">
        <el-descriptions title="基本信息" :column="2" border class="detail-section">
          <el-descriptions-item label="订单号">{{ currentOrder.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="订单类型">{{ currentOrder.typeName }}</el-descriptions-item>
          <el-descriptions-item label="下单时间">{{ currentOrder.createTime }}</el-descriptions-item>
          <el-descriptions-item label="客户/水站">{{ currentOrder.customerName }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ currentOrder.customerPhone }}</el-descriptions-item>
          <el-descriptions-item label="配送地址">{{ currentOrder.customerAddress }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-section">
          <div class="section-title">商品明细</div>
          <el-table :data="currentOrder.items" border size="small">
            <el-table-column prop="productName" label="商品名称" min-width="150" />
            <el-table-column prop="spec" label="规格" width="100" />
            <el-table-column prop="quantity" label="数量" width="80" align="center" />
            <el-table-column prop="unitPrice" label="单价" width="100" align="right">
              <template #default="{ row }">¥{{ fmtMoney(row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column prop="subtotal" label="小计" width="100" align="right">
              <template #default="{ row }">¥{{ fmtMoney(row.subtotal) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <div class="amount-summary">
          <div class="amount-row"><span>订单金额：</span><span>¥{{ fmtMoney(currentOrder.orderAmount) }}</span></div>
          <div class="amount-row"><span>配送费：</span><span>¥{{ fmtMoney(currentOrder.deliveryFee) }}</span></div>
          <div class="amount-row total"><span>应收总额：</span><span>¥{{ fmtMoney(currentOrder.totalAmount) }}</span></div>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Download, View, Coin, Van, Money } from '@element-plus/icons-vue'
import { getCostSummary, getCostOrders, exportCost } from '@/api/cost'
import { getOrderDetail } from '@/api/order'
import { downloadBlob } from '@/api/excel'

const props = defineProps({
  orderType: { type: Number, required: true }
})

const TYPE_NAME = { 1: '线上平台销售', 2: '线下水站分销', 3: '线下零售', 4: '量贩机供货', 5: '线下水站返货', 6: '零售机供货' }
const DELIVERY_NAME = {
  1: '工人零售配送费', 2: '工人水站配送费', 3: '工人零售配送费',
  4: '工人零售机配送费', 5: '水站分销配送费', 6: '工人零售机配送费'
}

const currentTypeName = computed(() => TYPE_NAME[props.orderType] || `类型${props.orderType}`)
const deliveryFeeName = computed(() => DELIVERY_NAME[props.orderType] || '配送费')

const loading = ref(false)
const exporting = ref(false)
const query = reactive({ range: 'all', startDate: '', endDate: '' })
const customRange = ref([])
const rangeText = computed(() => {
  if (query.range === 'all') return '全部时间'
  if (query.range === 'custom' && customRange.value?.length === 2) return `${customRange.value[0]} ~ ${customRange.value[1]}`
  return { day: '今日', week: '本周', month: '本月', year: '今年' }[query.range] || ''
})

const cardData = reactive({ purchaseTotal: 0, deliveryTotal: 0, cost: 0 })
const orderRows = ref([])
const orderTotal = ref(0)
const orderQuery = reactive({ page: 1, pageSize: 10 })

const detailVisible = ref(false)
const currentOrder = ref(null)

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const buildParams = () => {
  if (query.range === 'custom' && customRange.value?.length === 2) {
    return { range: 'custom', startDate: customRange.value[0], endDate: customRange.value[1] }
  }
  return { range: query.range }
}

const fetchSummary = async () => {
  try {
    const res = await getCostSummary({ ...buildParams(), orderType: props.orderType })
    const item = (res.data?.list || []).find((x) => x.orderType === props.orderType)
    if (item) {
      cardData.purchaseTotal = item.purchaseTotal
      cardData.deliveryTotal = item.deliveryTotal
      cardData.cost = item.cost
    } else {
      cardData.purchaseTotal = 0; cardData.deliveryTotal = 0; cardData.cost = 0
    }
  } catch (e) {
    console.error('获取成本汇总失败:', e)
    ElMessage.error('获取成本汇总失败')
  }
}

const fetchOrders = async () => {
  loading.value = true
  try {
    const res = await getCostOrders({ ...buildParams(), orderType: props.orderType, page: orderQuery.page, pageSize: orderQuery.pageSize })
    if (res.data) {
      orderRows.value = res.data.list || []
      orderTotal.value = res.data.total || 0
    }
  } catch (e) {
    console.error('获取成本明细失败:', e)
    ElMessage.error('获取成本明细失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  orderQuery.page = 1
  fetchSummary()
  fetchOrders()
}
const handleReset = () => {
  query.range = 'all'
  customRange.value = []
  handleSearch()
}

const handleExport = async () => {
  exporting.value = true
  try {
    const res = await exportCost({ ...buildParams(), orderType: props.orderType })
    downloadBlob(res.data, `${currentTypeName.value}_成本_${Date.now()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (e) {
    console.error('导出失败:', e)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

const handleViewOrder = async (row) => {
  try {
    const res = await getOrderDetail(row.orderId || row.orderNo)
    const d = res.data
    currentOrder.value = {
      orderNo: d.orderNo || d.id,
      typeName: d.orderTypeName || TYPE_NAME[d.orderType] || `类型${d.orderType}`,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerAddress: d.customerAddress,
      createTime: d.createTime,
      items: d.items || [],
      orderAmount: d.orderAmount,
      deliveryFee: d.deliveryFee,
      totalAmount: d.totalAmount
    }
    detailVisible.value = true
  } catch (e) {
    console.error('获取订单详情失败:', e)
    ElMessage.error('获取订单详情失败')
  }
}

onMounted(() => {
  fetchSummary()
  fetchOrders()
})
watch(() => props.orderType, () => {
  orderQuery.page = 1
  fetchSummary()
  fetchOrders()
})
</script>

<style scoped>
.page-container { display: flex; flex-direction: column; gap: 16px; }
.filter-card { border-radius: 10px; }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.range-picker { width: 280px; }
.filter-hint { margin-top: 10px; font-size: 12px; color: #909399; line-height: 1.6; }

.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.summary-card { border-radius: 10px; padding: 16px 18px; color: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); transition: transform 0.2s; }
.summary-card:hover { transform: translateY(-2px); }
.card-label { display: flex; align-items: center; gap: 6px; font-size: 13px; opacity: 0.95; }
.card-value { font-size: 22px; font-weight: 700; margin: 8px 0 4px; word-break: break-all; }
.card-desc { font-size: 11px; opacity: 0.85; }
.card-blue { background: linear-gradient(135deg, #409eff, #2f6fe0); }
.card-green { background: linear-gradient(135deg, #67c23a, #4cae1f); }
.card-red { background: linear-gradient(135deg, #f56c6c, #e64340); }

.detail-card { border-radius: 10px; }
.cost-text { color: #e64340; font-weight: 600; cursor: help; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }

.order-detail { max-height: 62vh; overflow-y: auto; }
.detail-section { margin-bottom: 14px; }
.section-title { font-weight: 600; margin-bottom: 8px; }
.amount-summary { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; padding: 8px 12px; background: #f7f8fa; border-radius: 6px; }
.amount-row { font-size: 13px; color: #606266; }
.amount-row.total { font-size: 15px; font-weight: 700; color: #e64340; }

@media screen and (max-width: 768px) {
  .filter-bar { flex-direction: column; align-items: stretch; }
  .filter-bar .el-radio-group, .range-picker { width: 100%; }
  .summary-grid { grid-template-columns: 1fr; gap: 10px; }
}
</style>

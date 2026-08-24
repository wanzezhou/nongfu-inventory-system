<template>
  <div class="page-container">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="query.range" @change="handleSearch">
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
        当前统计类型：<b>{{ currentTypeName }}</b> —— {{ currentTypeDesc }}。均不含已取消订单。
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div v-for="card in summaryCards" :key="card.orderType" class="summary-card" :class="card.cls">
        <div class="card-label">
          <el-icon><component :is="card.icon" /></el-icon>
          <span>{{ card.typeName }}</span>
        </div>
        <div class="card-value">¥{{ fmtMoney(card.revenue) }}</div>
        <div class="card-desc">{{ card.desc }}</div>
      </div>
      <div class="summary-card card-total">
        <div class="card-label">
          <el-icon><Histogram /></el-icon>
          <span>总营收</span>
        </div>
        <div class="card-value">¥{{ fmtMoney(summary.overall.totalRevenue) }}</div>
        <div class="card-desc">统计期内全部营收</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <el-tabs v-model="activeTab">
        <el-tab-pane v-if="!isMachineType" label="订单营收明细" name="orders">
          <el-table :data="orderRows" v-loading="loading" border stripe size="small">
            <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip />
            <el-table-column prop="typeName" label="订单类型" width="130" />
            <el-table-column prop="customerName" label="客户" min-width="110" show-overflow-tooltip />
            <el-table-column prop="customerPhone" label="电话" width="120" />
            <el-table-column prop="totalQty" label="数量" width="80" align="right" />
            <el-table-column prop="revenue" label="营收" width="110" align="right">
              <template #default="{ row }">
                <span class="revenue-text">¥{{ fmtMoney(row.revenue) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="createTime" label="下单时间" width="165" />
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
        </el-tab-pane>

        <el-tab-pane v-else label="机台销量明细" name="machine">
          <div class="tab-toolbar">
            <span class="tab-hint">量贩机/零售机销量在各自系统中显示，此处为手动录入（营收 = 机台售价 × 销量）</span>
            <el-button type="primary" @click="openCreate">
              <el-icon><Plus /></el-icon>录入销量
            </el-button>
          </div>
          <el-table :data="machineRows" v-loading="machineLoading" border stripe size="small">
            <el-table-column prop="saleDate" label="销售日期" width="105" />
            <el-table-column prop="machineTypeName" label="机台类型" width="90" />
            <el-table-column prop="stationName" label="机台" min-width="120" show-overflow-tooltip />
            <el-table-column prop="productName" label="商品" min-width="130" show-overflow-tooltip />
            <el-table-column prop="specification" label="规格" width="95" />
            <el-table-column prop="quantity" label="销量" width="75" align="right" />
            <el-table-column prop="salePrice" label="售价" width="90" align="right">
              <template #default="{ row }">¥{{ fmtMoney(row.salePrice) }}</template>
            </el-table-column>
            <el-table-column prop="revenue" label="营收" width="105" align="right">
              <template #default="{ row }">
                <span class="revenue-text">¥{{ fmtMoney(row.revenue) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="100" show-overflow-tooltip />
            <el-table-column label="操作" width="70" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="danger" @click="handleDelete(row)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="machineTotal"
              :page-size="machineQuery.pageSize"
              :current-page="machineQuery.page"
              @current-change="(p) => { machineQuery.page = p; fetchMachine() }"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 机台销量录入弹窗 -->
    <el-dialog v-model="createVisible" title="录入机台销量" :width="dialogWidth" class="create-sale-dialog" @closed="resetSaleForm">
      <el-form ref="saleFormRef" :model="saleForm" :rules="saleRules" label-width="90px">
        <el-form-item label="机台类型" prop="machineType">
          <el-radio-group v-model="saleForm.machineType" disabled>
            <el-radio :value="1">量贩机</el-radio>
            <el-radio :value="2">零售机</el-radio>
          </el-radio-group>
          <span class="unit-label">{{ currentTypeName }}（固定）</span>
        </el-form-item>
        <el-form-item label="机台" prop="machineId">
          <el-select v-model="saleForm.machineId" filterable placeholder="请选择机台" style="width: 100%">
            <el-option v-for="m in machineOptions" :key="m.machineId" :label="m.stationName" :value="m.machineId">
              <span>{{ m.stationName }}</span>
              <span class="option-sub">{{ m.address || '' }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="商品" prop="productId">
          <el-select v-model="saleForm.productId" filterable placeholder="请选择商品" style="width: 100%" @change="onProductChange">
            <el-option v-for="p in productOptions" :key="p.id" :label="`${p.name}（${p.spec || ''}）`" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="售价" prop="salePrice">
          <el-input-number v-model="saleForm.salePrice" :min="0" :precision="2" :step="0.5" style="width: 100%" />
          <span class="unit-label">元（按商品档案机台价带出，可修改）</span>
        </el-form-item>
        <el-form-item label="销量" prop="quantity">
          <el-input-number v-model="saleForm.quantity" :min="1" :precision="0" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item label="销售日期" prop="saleDate">
          <el-date-picker v-model="saleForm.saleDate" type="date" value-format="YYYY-MM-DD" placeholder="选择销售日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="saleForm.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, Refresh, Download, Plus, Delete,
  Van, Goods, ShoppingCart, Coin, Wallet, Money, Histogram
} from '@element-plus/icons-vue'
import { getFinanceSummary, getFinanceOrders, getMachineSales, createMachineSale, deleteMachineSale, exportFinance } from '@/api/finance'
import { getProductList } from '@/api/product'
import { getMachineStations } from '@/api/machineStation'
import { downloadBlob } from '@/api/excel'

// 当前营收类型（路由 props 传入：1-线上平台销售 2-线下水站分销 3-线下零售 4-量贩机 5-线下水站返货 6-零售机）
const props = defineProps({
  orderType: { type: Number, required: true }
})

const loading = ref(false)
const machineLoading = ref(false)
const exporting = ref(false)

// 机台类型页面（4-量贩机/6-零售机）默认机台销量 Tab
const isMachineType = computed(() => props.orderType === 4 || props.orderType === 6)
const activeTab = ref(isMachineType.value ? 'machine' : 'orders')
// 机台销量录入弹窗的机台类型：4-量贩机(1)，6-零售机(2)
const saleMachineType = computed(() => (props.orderType === 6 ? 2 : 1))
const currentTypeName = computed(() => ORDER_TYPE_NAME[props.orderType] || `类型${props.orderType}`)
const currentTypeDesc = computed(() => CARD_META[props.orderType]?.desc || '')

const query = reactive({ range: 'month', startDate: '', endDate: '' })
const customRange = ref([])

const summary = reactive({ list: [], overall: { totalRevenue: 0 } })
const orderRows = ref([])
const orderTotal = ref(0)
const orderQuery = reactive({ page: 1, pageSize: 10 })
const machineRows = ref([])
const machineTotal = ref(0)
const machineQuery = reactive({ page: 1, pageSize: 10 })

const createVisible = ref(false)
const saving = ref(false)
const saleFormRef = ref(null)
const machineOptions = ref([])
const productOptions = ref([])
const saleForm = reactive({
  machineType: 1,
  machineId: '',
  productId: '',
  salePrice: 0,
  quantity: 1,
  saleDate: '',
  remark: ''
})
const saleRules = {
  machineType: [{ required: true, message: '请选择机台类型', trigger: 'change' }],
  machineId: [{ required: true, message: '请选择机台', trigger: 'change' }],
  productId: [{ required: true, message: '请选择商品', trigger: 'change' }],
  salePrice: [{ required: true, message: '请输入售价', trigger: 'blur' }],
  quantity: [{ required: true, message: '请输入销量', trigger: 'blur' }],
  saleDate: [{ required: true, message: '请选择销售日期', trigger: 'change' }]
}

// 指标卡定义（与后端口径一致）
const ORDER_TYPE_NAME = {
  1: '线上平台销售',
  2: '线下水站分销',
  3: '线下零售',
  4: '量贩机',
  5: '线下水站返货',
  6: '零售机'
}
const CARD_META = {
  1: { icon: Van, cls: 'card-red', desc: '进货价 + 总包配送费' },
  2: { icon: Goods, cls: 'card-blue', desc: '分销价 × 数量' },
  3: { icon: ShoppingCart, cls: 'card-green', desc: '零售价（手动填写）× 数量' },
  4: { icon: Wallet, cls: 'card-gold', desc: '机台售价 × 销量（手动录入）' },
  5: { icon: Coin, cls: 'card-purple', desc: '进货价 + 总包配送费' },
  6: { icon: Van, cls: 'card-teal', desc: '机台售价 × 销量（手动录入）' }
}

const summaryCards = computed(() => {
  const item = summary.list.find((x) => x.orderType === props.orderType)
  if (!item) return []
  const meta = CARD_META[item.orderType] || { icon: Money, cls: 'card-gray', desc: '' }
  return [{ ...item, icon: meta.icon, cls: meta.cls, desc: meta.desc }]
})

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '520px'))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const buildParams = () => {
  if (query.range === 'custom' && customRange.value && customRange.value.length === 2) {
    return { range: 'custom', startDate: customRange.value[0], endDate: customRange.value[1] }
  }
  return { range: query.range }
}

const fetchSummary = async () => {
  try {
    const res = await getFinanceSummary({ ...buildParams(), orderType: props.orderType })
    if (res.data) {
      summary.list = res.data.list || []
      summary.overall = res.data.overall || { totalRevenue: 0 }
    }
  } catch (error) {
    console.error('获取营收汇总失败:', error)
    ElMessage.error('获取营收汇总失败')
  }
}

const fetchOrders = async () => {
  loading.value = true
  try {
    const res = await getFinanceOrders({ ...buildParams(), orderType: props.orderType, page: orderQuery.page, pageSize: orderQuery.pageSize })
    if (res.data) {
      orderRows.value = res.data.list || []
      orderTotal.value = res.data.total || 0
    }
  } catch (error) {
    console.error('获取订单营收明细失败:', error)
    ElMessage.error('获取订单营收明细失败')
  } finally {
    loading.value = false
  }
}

const fetchMachine = async () => {
  machineLoading.value = true
  try {
    const res = await getMachineSales({ ...buildParams(), machineType: saleMachineType.value, page: machineQuery.page, pageSize: machineQuery.pageSize })
    if (res.data) {
      machineRows.value = res.data.list || []
      machineTotal.value = res.data.total || 0
    }
  } catch (error) {
    console.error('获取机台销量明细失败:', error)
    ElMessage.error('获取机台销量明细失败')
  } finally {
    machineLoading.value = false
  }
}

const handleSearch = () => {
  orderQuery.page = 1
  machineQuery.page = 1
  fetchSummary()
  fetchOrders()
  fetchMachine()
}

const handleReset = () => {
  query.range = 'month'
  customRange.value = []
  handleSearch()
}

const handleExport = async () => {
  exporting.value = true
  try {
    const res = await exportFinance(buildParams())
    downloadBlob(res.data, `营收统计_${Date.now()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

// ---- 机台销量录入 ----
const loadMachines = async () => {
  try {
    const res = await getMachineStations({ type: saleForm.machineType, status: 1, pageSize: 100 })
    machineOptions.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取机台列表失败:', error)
    machineOptions.value = []
  }
}

const loadProducts = async () => {
  try {
    const res = await getProductList({ status: 1, pageSize: 200 })
    productOptions.value = res.data?.list || res.data || []
  } catch (error) {
    console.error('获取商品列表失败:', error)
    productOptions.value = []
  }
}

const onProductChange = (pid) => {
  const p = productOptions.value.find((x) => String(x.id) === String(pid))
  saleForm.salePrice = p ? Number(p.vendingPrice || p.machinePrice || 0) : 0
}

const openCreate = () => {
  saleForm.machineType = saleMachineType.value
  createVisible.value = true
  loadMachines()
  if (productOptions.value.length === 0) loadProducts()
  saleForm.saleDate = new Date().toISOString().slice(0, 10)
}

const resetSaleForm = () => {
  saleForm.machineType = saleMachineType.value
  saleForm.machineId = ''
  saleForm.productId = ''
  saleForm.salePrice = 0
  saleForm.quantity = 1
  saleForm.saleDate = ''
  saleForm.remark = ''
  saleFormRef.value?.clearValidate()
}

const handleSave = async () => {
  const valid = await saleFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    await createMachineSale({
      machineId: saleForm.machineId,
      productId: saleForm.productId,
      quantity: saleForm.quantity,
      salePrice: saleForm.salePrice,
      saleDate: saleForm.saleDate,
      remark: saleForm.remark
    })
    ElMessage.success('录入成功')
    createVisible.value = false
    fetchSummary()
    fetchMachine()
  } catch (error) {
    console.error('录入失败:', error)
    ElMessage.error(error.response?.data?.message || '录入失败')
  } finally {
    saving.value = false
  }
}

const handleDelete = (row) => {
  ElMessageBox.confirm(`确认删除该条销量记录（${row.stationName} - ${row.productName}）？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
    cancelButtonText: '取消'
  })
    .then(async () => {
      await deleteMachineSale(row.saleId)
      ElMessage.success('删除成功')
      fetchSummary()
      fetchMachine()
    })
    .catch(() => {})
}

onMounted(() => {
  fetchSummary()
  fetchOrders()
  fetchMachine()
})
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-card {
  border-radius: 10px;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.range-picker {
  width: 280px;
}

.filter-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.summary-card {
  border-radius: 10px;
  padding: 16px 18px;
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  transition: transform 0.2s;
}

.summary-card:hover {
  transform: translateY(-2px);
}

.card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.95;
}

.card-value {
  font-size: 22px;
  font-weight: 700;
  margin: 8px 0 4px;
  word-break: break-all;
}

.card-desc {
  font-size: 11px;
  opacity: 0.85;
}

.card-red { background: linear-gradient(135deg, #f56c6c, #e64340); }
.card-blue { background: linear-gradient(135deg, #409eff, #2f6fe0); }
.card-green { background: linear-gradient(135deg, #67c23a, #4cae1f); }
.card-gold { background: linear-gradient(135deg, #e6a23c, #d07f12); }
.card-purple { background: linear-gradient(135deg, #9b59b6, #7d3c98); }
.card-teal { background: linear-gradient(135deg, #13c2c2, #08979c); }
.card-gray { background: linear-gradient(135deg, #909399, #6c6f73); }
.card-total { background: linear-gradient(135deg, #303133, #1f1f21); }

.detail-card {
  border-radius: 10px;
}

.tab-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.tab-hint {
  font-size: 12px;
  color: #909399;
}

.revenue-text {
  color: #e64340;
  font-weight: 600;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.unit-label {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}

.option-sub {
  float: right;
  color: #8492a6;
  font-size: 12px;
}

@media screen and (max-width: 768px) {
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .filter-bar .el-radio-group,
  .range-picker {
    width: 100%;
  }

  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .card-value {
    font-size: 18px;
  }
}
</style>

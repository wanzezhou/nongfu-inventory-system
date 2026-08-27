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
        当前统计类型：<b>{{ currentTypeName }}</b> —— {{ currentTypeDesc }}。统计范围：<b>{{ rangeText }}</b>（与订单管理对比时请保持一致口径）。均不含已取消订单。
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
        </el-tab-pane>

        <el-tab-pane v-if="isMachineType" label="机台销量明细" name="machine">
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

        <el-tab-pane v-if="isMachineType" label="对应订单明细" name="orderRef">
          <div class="tab-toolbar">
            <span class="tab-hint">与{{ currentTypeName }}对应的供货订单（配货给机台，供对应核对；营收仍按机台销量统计）</span>
          </div>
          <el-table :data="orderRows" v-loading="loading" border stripe size="small">
            <el-table-column prop="orderNo" label="订单号" min-width="170" show-overflow-tooltip />
            <el-table-column prop="typeName" label="订单类型" width="130" />
            <el-table-column prop="customerName" label="客户" min-width="110" show-overflow-tooltip />
            <el-table-column prop="customerPhone" label="电话" width="120" />
            <el-table-column prop="totalQty" label="数量" width="80" align="right" />
            <el-table-column prop="revenue" label="供货金额" width="110" align="right">
              <template #default="{ row }">
                <span class="revenue-text">¥{{ fmtMoney(row.revenue) }}</span>
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
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 机台销量录入弹窗（批量） -->
    <el-dialog v-model="createVisible" title="录入机台销量" :width="dialogWidth" class="create-sale-dialog" @closed="resetSaleForm">
      <el-form ref="saleFormRef" :model="saleForm" label-width="90px">
        <el-form-item label="机台类型">
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
        <el-form-item label="销售日期" prop="saleDate">
          <el-date-picker v-model="saleForm.saleDate" type="date" value-format="YYYY-MM-DD" placeholder="选择销售日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="商品明细">
          <div class="sale-items">
            <div v-for="(item, idx) in saleForm.items" :key="idx" class="sale-item-row">
              <el-select v-model="item.productId" filterable placeholder="商品" style="width: 42%" @change="(pid) => onProductChange(item, pid)">
                <el-option v-for="p in productOptions" :key="p.id" :label="`${p.name}（${p.spec || ''}）`" :value="p.id" />
              </el-select>
              <el-input-number v-model="item.salePrice" :min="0" :precision="2" :step="0.5" :controls="false" placeholder="售价" style="width: 24%" />
              <el-input-number v-model="item.quantity" :min="1" :precision="0" :step="1" :controls="false" placeholder="销量" style="width: 20%" />
              <el-button link type="danger" :disabled="saleForm.items.length === 1" @click="removeSaleItem(idx)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <el-button type="primary" plain size="small" @click="addSaleItem">
              <el-icon><Plus /></el-icon>添加商品
            </el-button>
          </div>
          <span class="unit-label">每行：商品 / 售价（带出可改）/ 销量；可一次录入多个商品</span>
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
          <div class="amount-row">
            <span>商品金额：</span>
            <span>¥{{ fmtMoney(currentOrder.orderAmount) }}</span>
          </div>
          <div class="amount-row">
            <span>总包配送费（按商品）：</span>
            <span>¥{{ fmtMoney(calcOrderRevenue(currentOrder) - currentOrder.orderAmount) }}</span>
          </div>
          <div class="amount-row total">
            <span>应收总额：</span>
            <span>¥{{ fmtMoney(calcOrderRevenue(currentOrder)) }}</span>
          </div>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, Refresh, Download, Plus, Delete, View,
  Van, Goods, ShoppingCart, Coin, Wallet, Money, Histogram
} from '@element-plus/icons-vue'
import { getFinanceSummary, getFinanceOrders, getMachineSales, createMachineSale, deleteMachineSale, exportFinance } from '@/api/finance'
import { getProductList } from '@/api/product'
import { getMachineStations } from '@/api/machineStation'
import { getOrderDetail } from '@/api/order'
import { downloadBlob } from '@/api/excel'

// 当前营收类型（路由 props 传入：1-官方平台销售 2-直营水站销售 3-线下零售 4-量贩机供货 6-零售机供货）
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

const query = reactive({ range: 'all', startDate: '', endDate: '' })
const customRange = ref([])

// 当前统计范围文案（默认"全部"与订单管理默认口径一致）
const rangeText = computed(() => {
  if (query.range === 'all') return '全部时间'
  if (query.range === 'custom' && customRange.value && customRange.value.length === 2) {
    return `${customRange.value[0]} ~ ${customRange.value[1]}`
  }
  const map = { day: '今日', week: '本周', month: '本月', year: '今年' }
  return map[query.range] || ''
})

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
  saleDate: '',
  remark: '',
  items: [{ productId: '', salePrice: 0, quantity: 1 }]
})

// 订单详情弹窗
const detailVisible = ref(false)
const currentOrder = ref(null)

// 指标卡定义（与后端口径一致）
const ORDER_TYPE_NAME = {
  1: '官方平台销售',
  2: '直营水站销售',
  3: '线下零售',
  4: '量贩机',
  6: '零售机'
}
const CARD_META = {
  1: { icon: Van, cls: 'card-red', desc: '进货价之和 + 总包配送费（整单）' },
  2: { icon: Goods, cls: 'card-blue', desc: '分销价之和；水票抵扣：进货价之和 + 总包配送费' },
  3: { icon: ShoppingCart, cls: 'card-green', desc: '零售价之和（手动填写）' },
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
  query.range = 'all'
  customRange.value = []
  handleSearch()
}

const handleExport = async () => {
  exporting.value = true
  try {
    const res = await exportFinance({ ...buildParams(), orderType: props.orderType })
    downloadBlob(res.data, `${currentTypeName.value}_营收_${Date.now()}.xlsx`)
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

const onProductChange = (item, pid) => {
  const p = productOptions.value.find((x) => String(x.id) === String(pid))
  item.salePrice = p ? Number(p.vendingPrice || p.machinePrice || 0) : 0
}

const addSaleItem = () => {
  saleForm.items.push({ productId: '', salePrice: 0, quantity: 1 })
}

const removeSaleItem = (idx) => {
  if (saleForm.items.length > 1) saleForm.items.splice(idx, 1)
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
  saleForm.saleDate = ''
  saleForm.remark = ''
  saleForm.items = [{ productId: '', salePrice: 0, quantity: 1 }]
}

const handleSave = async () => {
  if (!saleForm.machineId) {
    ElMessage.warning('请选择机台')
    return
  }
  if (!saleForm.saleDate) {
    ElMessage.warning('请选择销售日期')
    return
  }
  const items = saleForm.items.filter((x) => x.productId && x.quantity > 0)
  if (items.length === 0) {
    ElMessage.warning('请至少填写一条商品明细')
    return
  }
  const invalid = items.some((x) => !x.productId || x.quantity <= 0 || isNaN(Number(x.salePrice)))
  if (invalid) {
    ElMessage.warning('请完善每条商品明细（商品/售价/销量）')
    return
  }
  saving.value = true
  try {
    await createMachineSale({
      machineId: saleForm.machineId,
      saleDate: saleForm.saleDate,
      remark: saleForm.remark,
      items: items.map((x) => ({ productId: x.productId, quantity: x.quantity, salePrice: x.salePrice }))
    })
    ElMessage.success(`录入成功（${items.length} 条）`)
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

// 查看订单详情
const handleViewOrder = async (row) => {
  try {
    const res = await getOrderDetail(row.orderId || row.orderNo)
    const d = res.data
    currentOrder.value = {
      orderNo: d.orderNo || d.id,
      orderType: Number(d.orderType),
      typeName: d.orderTypeName || ORDER_TYPE_NAME[d.orderType] || `类型${d.orderType}`,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerAddress: d.customerAddress,
      createTime: d.createTime,
      items: d.items || [],
      orderAmount: d.orderAmount,
      deliveryFee: d.deliveryFee
    }
    detailVisible.value = true
  } catch (error) {
    console.error('获取订单详情失败:', error)
    ElMessage.error('获取订单详情失败')
  }
}

// 按营收统计口径计算订单应收（与财务列表营收一致，2026-08-27）：
//   类型1 = Σ((进货价+总包配送费)×数量)
//   类型2 = Σ(分销价×非抵扣件数) + Σ((进货价+总包配送费)×抵扣件数)，旧整单抵扣按 (进货价+总包配送费)×数量
//   类型3 = Σ(零售价×数量)；类型4/6 = Σ(进货价×数量)
const calcOrderRevenue = (order) => {
  const t = Number(order.orderType)
  let total = 0
  for (const it of order.items || []) {
    const q = Number(it.quantity) || 0
    const pp = Number(it.purchasePrice) || 0
    const wp = Number(it.wholesalePrice) || 0
    const rp = Number(it.retailPrice) || 0
    const df = Number(it.totalDeliveryFee) || 0
    const tq = Number(it.ticketQty) || 0
    if (t === 1) {
      total += (pp + df) * q
    } else if (t === 2) {
      if (tq > 0) total += (pp + df) * tq + wp * (q - tq)
      else if (Number(it.pricingType) === 2) total += (pp + df) * q
      else total += wp * q
    } else if (t === 3) {
      total += rp * q
    } else {
      total += pp * q
    }
  }
  return Math.round(total * 100) / 100
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

// 6 个子路由复用同一组件：切换二级菜单时 props.orderType 变化，需重新拉取对应类型数据
watch(() => props.orderType, () => {
  orderQuery.page = 1
  machineQuery.page = 1
  activeTab.value = isMachineType.value ? 'machine' : 'orders'
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

.sale-items {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sale-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.order-detail {
  max-height: 62vh;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 14px;
}

.section-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.amount-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
  padding: 8px 12px;
  background: #f7f8fa;
  border-radius: 6px;
}

.amount-row {
  font-size: 13px;
  color: #606266;
}

.amount-row.total {
  font-size: 15px;
  font-weight: 700;
  color: #e64340;
}

@media screen and (max-width: 768px) {
  .sale-item-row {
    flex-wrap: wrap;
  }

  .sale-item-row .el-select,
  .sale-item-row .el-input-number {
    width: 100% !important;
  }
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

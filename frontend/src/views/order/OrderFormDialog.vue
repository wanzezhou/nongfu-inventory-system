<template>
  <el-dialog
    v-model="visible"
    :title="isEditMode ? '修改订单' : '新建订单'"
    width="750px"
    :close-on-click-modal="false"
    destroy-on-close
    class="create-order-dialog"
  >
    <div class="form-sections">
      <div class="form-section">
        <div class="section-title">基本信息</div>
        <el-form
          ref="basicFormRef"
          :model="orderForm"
          :rules="getBasicRules()"
          label-width="120px"
          class="step-form"
        >
          <el-form-item label="订单类型" prop="orderType">
            <el-radio-group v-model="orderForm.orderType" @change="onOrderTypeChange">
              <el-radio :value="1">送水到府</el-radio>
              <el-radio :value="5">水公社</el-radio>
              <el-radio :value="2">直营水站销售</el-radio>
              <el-radio :value="3">线下零售</el-radio>
              <el-radio :value="4">量贩机供货</el-radio>
              <el-radio :value="6">零售机供货</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="创建人" prop="createdById">
            <el-select
              v-model="orderForm.createdById"
              placeholder="请选择创建人"
              filterable
              clearable
              style="width: 50%"
            >
              <el-option
                v-for="item in staffOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 2" label="水站名称" prop="stationId">
            <el-select
              v-model="orderForm.stationId"
              placeholder="请选择水站"
              filterable
              style="width: 70%"
              @change="handleStationChange"
            >
              <el-option
                v-for="item in stationOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 2" label="联系人">
            <el-input v-model="orderForm.contactName" placeholder="选择水站后自动带出" disabled style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 2" label="联系电话">
            <el-input v-model="orderForm.customerPhone" placeholder="选择水站后自动带出" disabled style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 2" label="水站地址">
            <el-input
              v-model="orderForm.customerAddress"
              type="textarea"
              :rows="2"
              placeholder="选择水站后自动带出"
              disabled
              style="width: 80%"
            />
          </el-form-item>
          <!-- 线下零售：客户姓名/电话/地址（无联系人字段） -->
          <el-form-item v-if="orderForm.orderType === 3" label="客户姓名" prop="customerName">
            <el-input v-model="orderForm.customerName" placeholder="请输入客户姓名" style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 3" label="客户电话" prop="customerPhone">
            <el-input v-model="orderForm.customerPhone" placeholder="请输入客户电话" style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 3" label="客户地址" prop="customerAddress">
            <el-input v-model="orderForm.customerAddress" type="textarea" :rows="2" placeholder="请输入客户地址" style="width: 80%" />
          </el-form-item>

          <!-- 送水到府(1)/水公社(5)：客户姓名/电话/地址 -->
          <el-form-item v-if="isHomeDelivery" label="客户姓名" prop="customerName">
            <el-input v-model="orderForm.customerName" placeholder="请输入客户姓名" style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="isHomeDelivery" label="客户电话" prop="customerPhone">
            <el-input v-model="orderForm.customerPhone" placeholder="请输入客户电话" style="width: 50%" />
          </el-form-item>
          <el-form-item v-if="isHomeDelivery" label="客户地址" prop="customerAddress">
            <el-input v-model="orderForm.customerAddress" type="textarea" :rows="2" placeholder="请输入客户地址" style="width: 80%" />
          </el-form-item>

          <!-- 量贩机供货(4)/零售机供货(6)：站点名称关联机台模块，站点地址自动带出 -->
          <el-form-item v-if="orderForm.orderType === 4" label="站点名称" prop="machineStationId">
            <el-select v-model="orderForm.machineStationId" placeholder="请选择量贩机" filterable style="width: 70%" @change="handleBulkMachineChange">
              <el-option v-for="item in bulkMachineOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 6" label="站点名称" prop="machineStationId">
            <el-select v-model="orderForm.machineStationId" placeholder="请选择零售机" filterable style="width: 70%" @change="handleRetailMachineChange">
              <el-option v-for="item in retailMachineOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="orderForm.orderType === 4 || orderForm.orderType === 6" label="站点地址">
            <el-input v-model="orderForm.customerAddress" type="textarea" :rows="2" placeholder="选择机台后自动带出" disabled style="width: 80%" />
          </el-form-item>
        </el-form>
      </div>

      <div class="form-section">
        <div class="product-list-header">
          <span class="title">商品明细</span>
          <el-button type="primary" size="small" @click="addProductItem">
            <el-icon><Plus /></el-icon>
            添加商品
          </el-button>
        </div>
        <el-table :data="orderForm.items" border class="product-table">
          <el-table-column label="商品" min-width="200">
            <template #default="{ row, $index }">
              <el-select
                v-model="row.productId"
                placeholder="请选择商品"
                filterable
                style="width: 100%"
                @change="handleProductChange($index)"
              >
                <el-option
                  v-for="item in productOptions"
                  :key="item.id"
                  :label="`${item.name} (${item.code})`"
                  :value="item.id"
                  :disabled="item.stock <= 0"
                  :class="{ 'option-out-of-stock': item.stock <= 0 }"
                >
                  <span :style="{ color: item.stock <= 0 ? 'var(--text-3)' : '' }">{{ item.name }} ({{ item.code }})</span>
                  <span v-if="item.stock <= 0" style="color: var(--text-3); font-size: 12px; margin-left: 8px;">无库存</span>
                  <span v-else style="color: var(--el-color-success); font-size: 12px; margin-left: 8px;">库存: {{ item.stock }}</span>
                </el-option>
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="120">
            <template #default="{ row }">
              <!-- 直营水站销售勾选水票抵扣：数量上限 = 该商品可用水票张数（2026-09-09） -->
              <el-input-number v-model="row.quantity" :min="1" :max="getQuantityMax(row)" :precision="0" :step="1" style="width: 100%" @change="onItemQuantityChange(row)" />
            </template>
          </el-table-column>
          <!-- 直营水站销售：行级水票抵扣（是否使用水票 + 抵扣张数，未抵扣部分按分销价） -->
          <template v-if="orderForm.orderType === 2">
            <el-table-column label="是否使用水票" width="120" align="center">
              <template #default="{ row }">
                <el-checkbox
                  v-model="row.useTicket"
                  :disabled="!row.productId || (ticketMap[row.productId] || 0) <= 0"
                  @change="onTicketToggle(row)"
                />
              </template>
            </el-table-column>
            <el-table-column label="剩余水票" width="140">
              <template #default="{ row }">
                <!-- 勾选即全额抵扣（ticketQty=数量），不再提供张数输入，仅展示剩余可用水票（2026-09-09） -->
                <template v-if="row.useTicket">
                  <div class="ticket-sub">
                    <span class="ticket-left" :class="{ 'ticket-tight': (getTicketRemaining(row) ?? 0) <= 0 }">剩余 {{ getTicketRemaining(row) ?? 0 }} 张</span>
                  </div>
                </template>
                <span v-else class="ticket-empty">—</span>
              </template>
            </el-table-column>
          </template>
          <!-- 价格列：类型2 分销价只读（自动带出商品档案，水票抵扣行不显示价格）；类型3/5 零售价可编辑 -->
          <el-table-column v-if="[2, 3, 5].includes(orderForm.orderType)" :label="getPriceColumnLabel()" width="130">
            <template #default="{ row }">
              <!-- 类型2 使用水票抵扣：不显示任何价格（2026-08-28） -->
              <span v-if="orderForm.orderType === 2 && row.useTicket" class="ticket-empty">-</span>
              <el-input-number
                v-else-if="orderForm.orderType === 3 || orderForm.orderType === 5"
                v-model="row.unitPrice"
                :min="0"
                :precision="2"
                :step="0.5"
                style="width: 100%"
              />
              <span v-else class="price-readonly">¥{{ formatMoney(row.unitPrice) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="[2, 3, 5].includes(orderForm.orderType)" label="小计" width="130">
            <template #default="{ row }">
              <!-- 类型2 使用水票抵扣：不显示金额（未抵扣件数仍计入合计，2026-08-28） -->
              <span v-if="orderForm.orderType === 2 && row.useTicket" class="ticket-empty">-</span>
              <span v-else class="subtotal-text">¥{{ formatMoney(calculateItemSubtotal(row)) }}</span>
              <div v-if="orderForm.orderType === 2 && row.useTicket && row.ticketQty > 0" class="ticket-sub">
                <span class="ticket-left">水票 {{ row.ticketQty }} 件（不计金额）</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="removeProductItem($index)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="[2, 3, 5].includes(orderForm.orderType)" class="order-total">
          合计金额：<span class="total-amount">¥{{ formatMoney(calculateTotalAmount()) }}</span>
        </div>
      </div>

      <div class="form-section">
        <div class="section-title">配送信息</div>
        <el-form
          ref="deliveryFormRef"
          :model="orderForm"
          :rules="getDeliveryRules()"
          label-width="120px"
          class="step-form"
        >
          <el-form-item label="配送方式" prop="deliveryMethod">
            <!-- 送水到府(1)/水公社(5)：自有员工配送（固定） -->
            <el-radio-group v-if="isHomeDelivery" v-model="orderForm.deliveryMethod">
              <el-radio :value="1">自有员工配送</el-radio>
            </el-radio-group>
            <!-- 直营水站销售：水站配送（固定） -->
            <el-radio-group v-else-if="orderForm.orderType === 2" v-model="orderForm.deliveryMethod">
              <el-radio :value="2">水站配送</el-radio>
            </el-radio-group>
            <!-- 线下零售：自有员工配送 / 无需配送 -->
            <el-radio-group v-else-if="orderForm.orderType === 3" v-model="orderForm.deliveryMethod">
              <el-radio :value="1">自有员工配送</el-radio>
              <el-radio :value="3">无需配送</el-radio>
            </el-radio-group>
            <!-- 量贩机供货：量贩机配送（固定） -->
            <el-radio-group v-else-if="orderForm.orderType === 4" v-model="orderForm.deliveryMethod">
              <el-radio :value="2">量贩机配送</el-radio>
            </el-radio-group>
            <!-- 零售机供货：零售机配送（固定） -->
            <el-radio-group v-else-if="orderForm.orderType === 6" v-model="orderForm.deliveryMethod">
              <el-radio :value="2">零售机配送</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="orderForm.deliveryMethod === 1 || orderForm.deliveryMethod === 2" label="配送员工" prop="deliveryStaffId">
            <el-select
              v-model="orderForm.deliveryStaffId"
              placeholder="请选择配送员工"
              filterable
              style="width: 50%"
            >
              <el-option
                v-for="item in staffOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <div class="form-section">
        <div class="section-title">备注</div>
        <el-form :model="orderForm" label-width="120px" class="step-form">
          <el-form-item label="备注">
            <el-input
              v-model="orderForm.remark"
              type="textarea"
              :rows="3"
              placeholder="请输入备注"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-dropdown
        split-button
        type="primary"
        :button-props="{ loading: submitLoading }"
        :disabled="submitLoading"
        @click="handleSubmitOrder(false)"
        @command="(cmd) => handleSubmitOrder(cmd === 'print')"
      >
        {{ isEditMode ? '保存修改' : '提交订单' }}
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="print">
              {{ isEditMode ? '保存并打印' : '提交并打印' }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </template>
  </el-dialog>
</template>

<script setup>
// 新建/修改订单弹窗（2026-09-09 自 OrderList 拆分）：自包含表单域全部状态与逻辑。
// 对外 API：openCreate() / openEdit(order)；事件：saved({ print, savedId })。
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { createOrder, updateOrder } from '@/api/order'
import { getTicketInventory } from '@/api/waterTicket'
import { getProductOptions } from '@/api/product'
import { getInventoryOptions } from '@/api/inventory'
import { getAllMachineStations } from '@/api/machineStation'
import { getAllStations } from '@/api/station'
import { getAllWorkers } from '@/api/worker'
import { formatMoney } from './orderText'

const emit = defineEmits(['saved'])

const visible = ref(false)
const submitLoading = ref(false)
const isEditMode = ref(false)
const editingOrderId = ref(null)

// 送水到府(1) / 水公社(5)：客户姓名/电话/地址必填，配送方式固定自有员工配送
const isHomeDelivery = computed(() => [1, 5].includes(Number(orderForm.orderType)))

const basicFormRef = ref(null)
const deliveryFormRef = ref(null)

const productOptions = ref([])
const stationOptions = ref([])
const bulkMachineOptions = ref([])
const retailMachineOptions = ref([])
const staffOptions = ref([])

const orderForm = reactive({
  orderType: 3,
  platformOrderNo: '',
  stationId: null,
  machineStationId: null,
  contactName: '',
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  createdById: null,
  items: [],
  deliveryMethod: 1,
  deliveryStaffId: null,
  remark: ''
})

// 动态校验：按订单类型设置必填项
// - 创建人：所有类型必填
// - 送水到府(1)/水公社(5)：客户姓名/电话/地址必填（配送方式固定自有员工配送）
// - 直营水站销售(2)：水站必填（信息自动带出）
// - 线下零售(3)：客户信息必填
// - 量贩机供货(4)/零售机供货(6)：机台必填（站点名称/地址自动带出）
const getBasicRules = () => {
  const rules = {
    orderType: [{ required: true, message: '请选择订单类型', trigger: 'change' }],
    createdById: [{ required: true, message: '请选择创建人', trigger: 'change' }]
  }
  const t = Number(orderForm.orderType)
  if (t === 1 || t === 5) {
    rules.customerName = [{ required: true, message: '请输入客户姓名', trigger: 'blur' }]
    rules.customerPhone = [{ required: true, message: '请输入客户电话', trigger: 'blur' }]
    rules.customerAddress = [{ required: true, message: '请输入客户地址', trigger: 'blur' }]
  } else if (t === 2) {
    rules.stationId = [{ required: true, message: '请选择水站', trigger: 'change' }]
  } else if (t === 3) {
    rules.customerName = [{ required: true, message: '请输入客户姓名', trigger: 'blur' }]
    rules.customerPhone = [{ required: true, message: '请输入客户电话', trigger: 'blur' }]
    rules.customerAddress = [{ required: true, message: '请输入客户地址', trigger: 'blur' }]
  } else if (t === 4 || t === 6) {
    rules.machineStationId = [{ required: true, message: '请选择机台', trigger: 'change' }]
  }
  return rules
}

// 动态校验：配送员工在配送方式需要员工时必填（自有员工配送/水站配送/机台配送）
const getDeliveryRules = () => {
  const rules = { ...deliveryRules }
  if (orderForm.deliveryMethod === 1 || orderForm.deliveryMethod === 2) {
    rules.deliveryStaffId = [{ required: true, message: '请选择配送员工', trigger: 'change' }]
  }
  return rules
}

const deliveryRules = {
  deliveryMethod: [{ required: true, message: '请选择配送方式', trigger: 'change' }]
}

const fetchProductOptions = async () => {
  try {
    // 选项类数据走专用全量接口（2026-09-18 代码审查 #1）：
    // 原先用 getProductList({ pageSize: 100 })，而本库已有 159 个商品 ——
    // 会导致下拉里选不到第 101 个之后的商品，且不报错、不提示。
    const [productRes, inventoryRes] = await Promise.all([
      getProductOptions(),
      getInventoryOptions()
    ])
    let products = []
    if (productRes.data) {
      products = productRes.data.list || productRes.data || []
    }
    // 构建库存映射表 product_id -> stock
    // 库存接口 formatInventory 输出的 id 即为 product_id，字段名为 stock
    const stockMap = {}
    if (inventoryRes.data) {
      const list = inventoryRes.data.list || inventoryRes.data || []
      list.forEach(item => {
        stockMap[item.id] = Number(item.stock) || 0
      })
    }
    // 将库存量合并到每个商品上（商品 id 同为 product_id 值）
    products.forEach(p => {
      p.stock = stockMap[p.id] ?? 0
    })
    // 有库存在前，无库存在后；同库存按名称排序
    productOptions.value = products.sort((a, b) => {
      const aHasStock = a.stock > 0 ? 0 : 1
      const bHasStock = b.stock > 0 ? 0 : 1
      if (aHasStock !== bHasStock) return aHasStock - bHasStock
      return (a.name || '').localeCompare(b.name || '', 'zh-CN')
    })
  } catch (error) {
    // ⚠️ 失败时**绝不**塞伪造数据（红线 R1）：曾经这里 fallback 到 generateProductMockData()，
    // 结果接口一挂，用户会拿着「农夫山泉天然水 550ml」这类假商品把订单提交进台账。
    // 正确做法：置空 + 明确告知失败，让用户知道此刻不能开单。
    console.error('获取商品/库存选项失败:', error)
    productOptions.value = []
    ElMessage.error('商品列表加载失败，暂时无法开单，请刷新重试')
  }
}

const fetchStationOptions = async () => {
  try {
    // 选项类数据走专用全量接口（2026-09-18 代码审查 #1）
    const res = await getAllStations()
    if (res.data) {
      const rawList = res.data.list || res.data || []
      stationOptions.value = rawList.map(item => ({
        id: item.station_id,
        name: item.station_name,
        contact: item.contact_name || '',
        phone: item.phone || '',
        address: item.address || ''
      }))
    }
  } catch (error) {
    console.error('获取水站列表失败:', error)
    stationOptions.value = []
  }
}

const handleStationChange = () => {
  const station = stationOptions.value.find(s => s.id === orderForm.stationId)
  if (station) {
    orderForm.contactName = station.contact
    orderForm.customerName = station.name
    orderForm.customerPhone = station.phone
    orderForm.customerAddress = station.address
  }
  fetchTicketAvailable()
}

// 直营水站销售：行级水票抵扣（2026-08-27，2026-09-09 改为勾选即全额抵扣）
//   商品级可用水票数（productId -> available），选水站后拉取，用于勾选/数量上限
const ticketMap = ref({})
// 编辑态：本单原抵扣量（productId -> Σ原ticketQty）。保存时后端先还原本单旧核销票再重新核销，
// 因此编辑态「有效可用 = 当前可用 + 本单原抵扣」，否则历史订单会被误判超票导致无法编辑（2026-09-09 修复）
const editTicketBonus = ref({})
// 有效可用票数：ticketMap 未拉到该商品时返回 null（不设限，避免异步间隙 max=0 锁死输入框）
const getEffectiveAvail = (row) => {
  if (!(row.productId in ticketMap.value)) return null
  return Number(ticketMap.value[row.productId] || 0) + Number(editTicketBonus.value[row.productId] || 0)
}
// 行级剩余水票展示：有效可用 − 本单同商品所有勾选行已占用数量（随数量输入自适应增减）
const getTicketRemaining = (row) => {
  const avail = getEffectiveAvail(row)
  if (avail === null) return null
  const used = orderForm.items.reduce((sum, r) => {
    if (r.useTicket && r.productId === row.productId) return sum + Number(r.quantity || 0)
    return sum
  }, 0)
  return avail - used
}
const fetchTicketAvailable = async () => {
  if (Number(orderForm.orderType) !== 2 || !orderForm.stationId) return
  try {
    const res = await getTicketInventory({ stationId: orderForm.stationId })
    const list = res.data?.list || []
    const map = {}
    list.forEach((x) => { map[x.productId] = Number(x.available) || 0 })
    ticketMap.value = map
    // 新建态：水票余额变化后收敛行数据（数量=抵扣张数 且不超过可用票数）
    // 编辑态：不静默修改历史行数据，超票与否交给提交校验（有效可用已含本单原抵扣）
    if (isEditMode.value) return
    orderForm.items.forEach((row) => {
      if (row.useTicket) {
        const avail = map[row.productId] || 0
        if (avail <= 0) {
          row.useTicket = false
          row.ticketQty = 0
          return
        }
        if (row.quantity > avail) row.quantity = avail
        row.ticketQty = row.quantity
      }
    })
  } catch (e) {
    console.error('查询水票失败:', e)
    ticketMap.value = {}
  }
}
// 行级：勾选「是否使用水票」即全额抵扣——数量不超过可用票数（超出自动收敛并提示），抵扣张数=数量
const onTicketToggle = (row) => {
  if (row.useTicket) {
    const avail = getEffectiveAvail(row)
    if (avail === null) return
    if (avail <= 0) {
      ElMessage.warning('该水站此商品无可用水票')
      row.useTicket = false
      row.ticketQty = 0
      return
    }
    if (row.quantity > avail) {
      row.quantity = avail
      ElMessage.warning(`该商品可用水票仅 ${avail} 张，数量已调整为 ${avail}`)
    }
    row.ticketQty = row.quantity
  } else {
    row.ticketQty = 0
  }
}
// 明细行数量变化：抵扣张数始终跟随数量（上限已由 max 约束，这里做兜底收敛）
const onItemQuantityChange = (row) => {
  if (row.useTicket) {
    const avail = getEffectiveAvail(row)
    if (avail !== null && row.quantity > avail) {
      row.quantity = avail
      ElMessage.warning(`该商品可用水票仅 ${avail} 张，数量已调整为 ${avail}`)
    }
    row.ticketQty = row.quantity
  }
}
// 数量上限：直营水站销售勾选水票抵扣时 = 有效可用票数（不低于当前值，避免静默钳制）；其余不限
const getQuantityMax = (row) => {
  if (Number(orderForm.orderType) === 2 && row.useTicket) {
    const avail = getEffectiveAvail(row)
    if (avail === null) return Infinity
    return Math.max(avail, row.quantity || 1)
  }
  return Infinity
}

// 拉取量贩机/零售机列表，用于订单表单的机台关联下拉
const fetchMachineOptions = async () => {
  try {
    const [bulkRes, retailRes] = await Promise.all([
      // 选项类数据走专用全量接口（2026-09-18 代码审查 #1）
      getAllMachineStations({ type: 1, status: 1 }),
      getAllMachineStations({ type: 2, status: 1 })
    ])
    const map = (res) => {
      const list = res.data?.list || res.data || []
      return list.map(item => ({
        id: item.machine_id,
        name: item.station_name,
        address: item.address || '',
        manager: item.manager || '',
        managerPhone: item.manager_phone || ''
      }))
    }
    bulkMachineOptions.value = map(bulkRes)
    retailMachineOptions.value = map(retailRes)
  } catch (error) {
    console.error('获取机台列表失败:', error)
    bulkMachineOptions.value = []
    retailMachineOptions.value = []
  }
}

// 选择量贩机/零售机后，自动带出站点名称与地址
const handleBulkMachineChange = () => {
  const m = bulkMachineOptions.value.find(x => x.id === orderForm.machineStationId)
  fillMachineToOrder(m)
}

const handleRetailMachineChange = () => {
  const m = retailMachineOptions.value.find(x => x.id === orderForm.machineStationId)
  fillMachineToOrder(m)
}

const fillMachineToOrder = (m) => {
  if (m) {
    orderForm.customerName = m.name
    orderForm.customerAddress = m.address
    orderForm.contactName = m.manager
    orderForm.customerPhone = m.managerPhone
  }
}

const fetchStaffOptions = async () => {
  try {
    const res = await getAllWorkers()
    if (res.data) {
      staffOptions.value = res.data || []
    }
  } catch (error) {
    console.error('获取员工列表失败:', error)
    staffOptions.value = []
  }
}

const resetOrderForm = () => {
  Object.assign(orderForm, {
    orderType: 3,
    platformOrderNo: '',
    stationId: null,
    machineStationId: null,
    contactName: '',
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    createdById: null,
    items: [],
    deliveryMethod: 1,
    deliveryStaffId: null,
    remark: ''
  })
  ticketMap.value = {}
  editTicketBonus.value = {}
  basicFormRef.value?.resetFields()
  deliveryFormRef.value?.resetFields()
}

const addProductItem = () => {
  orderForm.items.push({
    productId: null,
    quantity: 1,
    unitPrice: 0,
    useTicket: false,
    ticketQty: 0
  })
}

const removeProductItem = (index) => {
  orderForm.items.splice(index, 1)
}

const handleProductChange = (index) => {
  const product = productOptions.value.find(p => p.id === orderForm.items[index].productId)
  if (product) {
    let price = 0
    switch (Number(orderForm.orderType)) {
      case 1:
        price = product.purchasePrice || 0
        break
      case 2:
        // 直营水站销售：分销价自动关联商品档案，禁止修改（只读）
        price = product.wholesalePrice || 0
        break
      case 3:
      case 5: // 水公社：与线下零售同口径——零售价（可手填）
        price = product.retailPrice || 0
        break
      case 4: // 量贩机供货：不计算商品价格（2026-08-27）
      case 6: // 零售机供货：不计算商品价格（2026-08-27）
        price = 0
        break
      default:
        price = product.retailPrice || 0
    }
    const item = orderForm.items[index]
    item.unitPrice = price
    item.useTicket = false
    item.ticketQty = 0
  }
}

const getPriceColumnLabel = () => {
  switch (Number(orderForm.orderType)) {
    case 2:
      return '分销价'
    case 3:
    case 5: // 水公社：与线下零售同口径，零售价可手填
      return '零售价'
    default:
      return '单价'
  }
}

// 行级小计：类型2 水票抵扣件数不计金额，仅未抵扣件数按分销价；类型3 零售价×数量
const calculateItemSubtotal = (item) => {
  if (Number(orderForm.orderType) === 2 && item.useTicket && item.ticketQty > 0) {
    return item.unitPrice * (item.quantity - item.ticketQty)
  }
  return item.quantity * item.unitPrice || 0
}

// 订单类型变更时设置默认配送方式
const onOrderTypeChange = () => {
  const orderType = Number(orderForm.orderType)
  // 离开机台供货类型时清空已选机台
  if (orderType !== 4 && orderType !== 6) {
    orderForm.machineStationId = null
  }
  switch (orderType) {
    case 1: // 送水到府 -> 自有员工配送
    case 5: // 水公社 -> 自有员工配送（固定）
      orderForm.deliveryMethod = 1
      break
    case 2: // 直营水站销售 -> 水站配送
      orderForm.deliveryMethod = 2
      break
    case 3: // 线下零售 -> 默认自有员工配送
      orderForm.deliveryMethod = 1
      break
    case 4: // 量贩机供货 -> 量贩机配送（用2=水站配送占位）
      orderForm.deliveryMethod = 2
      break
    case 6: // 零售机供货 -> 零售机配送（用2=水站配送占位）
      orderForm.deliveryMethod = 2
      break
  }
  // 切换订单类型：重置行级水票抵扣状态
  orderForm.items.forEach((row) => {
    row.useTicket = false
    row.ticketQty = 0
  })
  ticketMap.value = {}
  if (orderType === 2) fetchTicketAvailable()
}

const calculateTotalAmount = () => {
  return orderForm.items.reduce((sum, item) => {
    return sum + calculateItemSubtotal(item)
  }, 0)
}

const handleSubmitOrder = async (print = false) => {
  // 单页表单：提交时统一校验基本信息、商品明细、配送信息
  try {
    await basicFormRef.value?.validate()
  } catch (error) {
    ElMessage.warning('请完善基本信息')
    return
  }
  if (orderForm.items.length === 0) {
    ElMessage.warning('请至少添加一个商品')
    return
  }
  const hasInvalidProduct = orderForm.items.some(item => !item.productId || item.quantity <= 0)
  if (hasInvalidProduct) {
    ElMessage.warning('请完善所有商品信息')
    return
  }
  // 直营水站销售：行级水票抵扣校验（勾选即全额抵扣：抵扣张数=数量，同商品多行合计 ≤ 有效可用票数）
  // 编辑态有效可用已加回本单原抵扣（保存时先还原再核销），票数未拉到时不拦截
  if (Number(orderForm.orderType) === 2) {
    const usedByProduct = {}
    for (const row of orderForm.items) {
      if (row.useTicket && row.ticketQty > 0) {
        if (row.ticketQty > row.quantity) {
          ElMessage.warning('水票抵扣张数不能大于商品数量')
          return
        }
        usedByProduct[row.productId] = (usedByProduct[row.productId] || 0) + row.ticketQty
      }
    }
    for (const pid of Object.keys(usedByProduct)) {
      const avail = getEffectiveAvail({ productId: Number(pid) })
      if (avail !== null && usedByProduct[pid] > avail) {
        ElMessage.warning('水票抵扣张数超过该水站可用票数，请减少数量')
        return
      }
    }
  }
  try {
    await deliveryFormRef.value?.validate()
  } catch (error) {
    ElMessage.warning('请完善配送信息')
    return
  }

  submitLoading.value = true
  try {
    const orderData = {
      ...orderForm,
      orderAmount: calculateTotalAmount(),
      totalAmount: calculateTotalAmount()
    }
    let savedId = null
    if (isEditMode.value) {
      savedId = editingOrderId.value
      await updateOrder(savedId, orderData)
      ElMessage.success('订单修改成功')
    } else {
      const res = await createOrder(orderData)
      savedId = res.data?.id ?? res.data?.orderNo
      ElMessage.success('订单创建成功')
    }
    visible.value = false
    emit('saved', { print, savedId })
  } catch (error) {
    console.error(isEditMode.value ? '修改订单失败:' : '创建订单失败:', error)
    ElMessage.error(error.response?.data?.message || (isEditMode.value ? '订单修改失败' : '订单创建失败'))
  } finally {
    submitLoading.value = false
  }
}

// 对外 API：新建（重置表单）
const openCreate = () => {
  isEditMode.value = false
  editingOrderId.value = null
  resetOrderForm()
  visible.value = true
}

// 对外 API：编辑（由父组件拉好详情后传入回显）
const openEdit = (order) => {
  isEditMode.value = true
  editingOrderId.value = order.id || order.orderNo
  const items = (order.items || []).map(item => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice || 0,
    // 行级水票抵扣回显：pricing_type=2 且 ticket_qty>0 -> 勾选并按 ticket_qty 抵扣
    useTicket: Number(item.pricingType || item.pricing_type) === 2 && Number(item.ticketQty) > 0,
    ticketQty: Number(item.pricingType || item.pricing_type) === 2 ? (Number(item.ticketQty) || 0) : 0
  }))
  // 记录本单原抵扣量（按商品合计）：编辑态有效可用 = 当前可用 + 本单原抵扣（保存时先还原再核销）
  const bonus = {}
  items.forEach((item) => {
    if (item.useTicket && item.ticketQty > 0) {
      bonus[item.productId] = (bonus[item.productId] || 0) + Number(item.ticketQty)
    }
  })
  editTicketBonus.value = bonus
  Object.assign(orderForm, {
    orderType: order.orderType,
    platformOrderNo: order.platformOrderNo || '',
    stationId: order.stationId,
    machineStationId: order.machineStationId || null,
    contactName: order.contactName || '',
    customerName: order.customerName,
    customerPhone: order.customerPhone || '',
    customerAddress: order.customerAddress || '',
    createdById: order.createdById || null,
    items,
    deliveryMethod: order.deliveryMethod || 1,
    deliveryStaffId: order.deliveryStaffId,
    remark: order.remark || ''
  })
  ticketMap.value = {}
  fetchTicketAvailable()
  visible.value = true
}

defineExpose({ openCreate, openEdit })

onMounted(() => {
  fetchProductOptions()
  fetchStationOptions()
  fetchMachineOptions()
  fetchStaffOptions()
})
</script>

<style scoped>
.form-sections {
  padding: 0 4px;
}

.form-section {
  margin-bottom: 12px;
  padding: 8px 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.create-order-dialog :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow-y: auto;
}

.step-form {
  padding: 10px 20px;
}

.product-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding: 0 5px;
}

.product-list-header .title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
}

.product-table {
  margin-bottom: 15px;
}

/* 商品下拉：无库存项暗淡显示 */
.option-out-of-stock {
  opacity: 0.5;
}

:deep(.el-select-dropdown__item.is-disabled) {
  color: var(--text-3);
}

.order-total {
  text-align: right;
  padding-right: 20px;
  font-size: 15px;
}

.total-amount {
  color: var(--el-color-danger);
  font-weight: 600;
  font-size: 18px;
  margin-left: 8px;
}

.subtotal-text {
  color: var(--el-color-danger);
  font-weight: 500;
}

.section-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text);
  margin-bottom: 12px;
  padding-left: 5px;
}

.ticket-sub { font-size: 12px; line-height: 1.4; }
.ticket-left { color: var(--text-2); }
.ticket-left.ticket-tight { color: var(--el-color-danger); font-weight: 600; }
.ticket-empty { font-size: 12px; color: var(--text-3); }

/* ===== 移动端 / 窄屏适配 ===== */
@media screen and (max-width: 768px) {
  .create-order-dialog {
    width: 94vw !important;
    max-width: 94vw !important;
    margin-top: 4vh !important;
    margin-bottom: 4vh !important;
  }
  .create-order-dialog :deep(.el-dialog__body) {
    max-height: 82vh;
  }
  /* 表单标签转顶部布局，避免窄屏横向挤压 */
  .create-order-dialog :deep(.el-form-item) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .create-order-dialog :deep(.el-form-item__label) {
    width: auto !important;
    text-align: left;
    justify-content: flex-start;
    padding: 0 0 4px 0 !important;
    line-height: 1.4;
  }
  .create-order-dialog :deep(.el-form-item__content) {
    margin-left: 0 !important;
    flex-wrap: wrap;
  }
  .create-order-dialog :deep(.el-input),
  .create-order-dialog :deep(.el-select),
  .create-order-dialog :deep(.el-input-number) {
    width: 100% !important;
  }
  .create-order-dialog :deep(.el-radio-group) {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .product-list-header {
    flex-wrap: wrap;
    gap: 8px;
  }
  /* 对话框底部按钮在窄屏允许换行，避免分割按钮被挤压 */
  .create-order-dialog :deep(.el-dialog__footer) {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
}
</style>

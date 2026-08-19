<template>
  <div class="order-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="订单号/客户名"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="订单类型">
          <el-select
            v-model="queryForm.orderType"
            placeholder="全部类型"
            clearable
            style="width: 160px"
          >
            <el-option label="线上平台销售" :value="1" />
            <el-option label="线下水站分销" :value="2" />
            <el-option label="线下零售" :value="3" />
            <el-option label="量贩机供货" :value="4" />
            <el-option label="线下水站返货" :value="5" />
            <el-option label="零售机供货" :value="6" />
          </el-select>
        </el-form-item>
        <el-form-item label="下单时间">
          <el-date-picker
            v-model="queryForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 280px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            搜索
          </el-button>
          <el-button @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-form-item>
        <el-form-item class="toolbar-right">
          <el-button type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon>
            新建订单
          </el-button>
          <el-button @click="handleExport" :loading="exporting">
            <el-icon><Download /></el-icon>
            导出
          </el-button>
          <el-button @click="importDialogVisible = true">
            <el-icon><Upload /></el-icon>
            导入
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
      >
        <el-table-column prop="orderNo" label="订单号" width="160" />
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.remark">{{ row.remark }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="orderType" label="订单类型" width="130">
          <template #default="{ row }">
            <el-tag :type="getOrderTypeTagType(row.orderType)" size="small">
              {{ getOrderTypeText(row.orderType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdByName" label="创建人" width="110" align="center">
          <template #default="{ row }">
            <span v-if="row.createdByName">{{ row.createdByName }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="customerName" label="客户/水站" min-width="130" />
        <el-table-column prop="orderAmount" label="订单金额" width="100" align="right">
          <template #default="{ row }">
            <span class="money-text">¥{{ formatMoney(row.orderAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="false" prop="deliveryFee" label="配送费" width="90" align="right">
          <template #default="{ row }">
            <span>¥{{ formatMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalAmount" label="应收总额" width="100" align="right">
          <template #default="{ row }">
            <span class="total-text">¥{{ formatMoney(row.totalAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="下单时间" width="170" />
        <el-table-column label="操作" width="280" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleViewDetail(row)">
              <el-icon><View /></el-icon>
              详情
            </el-button>
            <el-button
              type="warning"
              link
              @click="handleEdit(row)"
            >
              <el-icon><Edit /></el-icon>
              修改
            </el-button>
            <el-button
              type="danger"
              link
              @click="handleHardDelete(row)"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="createDialogVisible"
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
                <el-radio :value="1">线上平台销售</el-radio>
                <el-radio :value="2">线下水站分销</el-radio>
                <el-radio :value="3">线下零售</el-radio>
                <el-radio :value="4">量贩机供货</el-radio>
                <el-radio :value="5">线下水站返货</el-radio>
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
            <el-form-item v-if="orderForm.orderType === 1" label="平台类型" prop="platformType">
              <el-select v-model="orderForm.platformType" placeholder="请选择平台" filterable style="width: 70%">
                <el-option label="淘宝" :value="4" />
                <el-option label="天猫" :value="5" />
                <el-option label="京东" :value="6" />
                <el-option label="拼多多" :value="7" />
                <el-option label="抖音电商" :value="8" />
                <el-option label="快手电商" :value="9" />
                <el-option label="小红书" :value="10" />
                <el-option label="唯品会" :value="11" />
                <el-option label="苏宁易购" :value="12" />
                <el-option label="美团" :value="1" />
                <el-option label="饿了么" :value="2" />
                <el-option label="京东到家" :value="13" />
                <el-option label="美团闪购" :value="14" />
                <el-option label="盒马鲜生" :value="15" />
                <el-option label="叮咚买菜" :value="16" />
                <el-option label="朴朴超市" :value="17" />
                <el-option label="多点" :value="18" />
                <el-option label="淘鲜达" :value="19" />
                <el-option label="山姆会员店" :value="20" />
                <el-option label="本来生活" :value="21" />
                <el-option label="其他" :value="3" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="orderForm.orderType === 2 || orderForm.orderType === 5" label="水站名称" prop="stationId">
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
            <el-form-item v-if="orderForm.orderType === 2 || orderForm.orderType === 5" label="联系人">
              <el-input v-model="orderForm.contactName" placeholder="选择水站后自动带出" disabled style="width: 50%" />
            </el-form-item>
            <el-form-item v-if="orderForm.orderType === 2 || orderForm.orderType === 5" label="联系电话">
              <el-input v-model="orderForm.customerPhone" placeholder="选择水站后自动带出" disabled style="width: 50%" />
            </el-form-item>
            <el-form-item v-if="orderForm.orderType === 2 || orderForm.orderType === 5" label="水站地址">
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

            <!-- 线上平台销售：客户姓名/电话/地址 -->
            <el-form-item v-if="orderForm.orderType === 1" label="客户姓名" prop="customerName">
              <el-input v-model="orderForm.customerName" placeholder="请输入客户姓名" style="width: 50%" />
            </el-form-item>
            <el-form-item v-if="orderForm.orderType === 1" label="客户电话" prop="customerPhone">
              <el-input v-model="orderForm.customerPhone" placeholder="请输入客户电话" style="width: 50%" />
            </el-form-item>
            <el-form-item v-if="orderForm.orderType === 1" label="客户地址" prop="customerAddress">
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
                    <span :style="{ color: item.stock <= 0 ? '#c0c4cc' : '' }">{{ item.name }} ({{ item.code }})</span>
                    <span v-if="item.stock <= 0" style="color: #c0c4cc; font-size: 12px; margin-left: 8px;">无库存</span>
                    <span v-else style="color: #67c23a; font-size: 12px; margin-left: 8px;">库存: {{ item.stock }}</span>
                  </el-option>
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="数量" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.quantity" :min="1" :precision="0" :step="1" style="width: 100%" @change="calculateDeliveryFee" />
              </template>
            </el-table-column>
            <el-table-column v-if="[2, 3].includes(orderForm.orderType)" :label="getPriceColumnLabel()" width="130">
              <template #default="{ row }">
                <el-input-number
                  v-if="orderForm.orderType === 2 || orderForm.orderType === 3"
                  v-model="row.unitPrice"
                  :min="0"
                  :precision="2"
                  :step="0.5"
                  style="width: 100%"
                />
                <span v-else>¥{{ formatMoney(row.unitPrice) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="[2, 3].includes(orderForm.orderType)" label="小计" width="120">
              <template #default="{ row }">
                <span class="subtotal-text">¥{{ formatMoney(calculateItemSubtotal(row)) }}</span>
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
          <div v-if="[2, 3].includes(orderForm.orderType)" class="order-total">
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
              <!-- 线上平台销售：自有员工配送（固定） -->
              <el-radio-group v-if="orderForm.orderType === 1" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
                <el-radio :value="1">自有员工配送</el-radio>
              </el-radio-group>
              <!-- 线下水站分销：水站配送（固定） -->
              <el-radio-group v-else-if="orderForm.orderType === 2" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
                <el-radio :value="2">水站配送</el-radio>
              </el-radio-group>
              <!-- 线下零售：自有员工配送 / 无需配送 -->
              <el-radio-group v-else-if="orderForm.orderType === 3" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
                <el-radio :value="1">自有员工配送</el-radio>
                <el-radio :value="3">无需配送</el-radio>
              </el-radio-group>
              <!-- 量贩机供货：量贩机配送（固定） -->
              <el-radio-group v-else-if="orderForm.orderType === 4" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
                <el-radio :value="2">量贩机配送</el-radio>
              </el-radio-group>
              <!-- 线下水站返货：水站配送（固定） -->
              <el-radio-group v-else-if="orderForm.orderType === 5" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
                <el-radio :value="2">水站配送</el-radio>
              </el-radio-group>
              <!-- 零售机供货：零售机配送（固定） -->
              <el-radio-group v-else-if="orderForm.orderType === 6" v-model="orderForm.deliveryMethod" @change="calculateDeliveryFee">
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
            <el-form-item v-if="false" label="配送费" prop="deliveryFee">
              <el-input-number v-model="orderForm.deliveryFee" :min="0" :precision="2" :step="1" />
              <span class="unit-label">元</span>
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
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmitOrder">
          {{ isEditMode ? '保存修改' : '提交订单' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="detailDialogVisible"
      title="订单详情"
      width="700px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <div v-if="currentOrder" class="order-detail">
        <el-descriptions title="基本信息" :column="2" border class="detail-section">
          <el-descriptions-item label="订单号">{{ currentOrder.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="订单类型">{{ getOrderTypeText(currentOrder.orderType) }}</el-descriptions-item>
          <el-descriptions-item label="下单时间">{{ currentOrder.createTime }}</el-descriptions-item>
          <el-descriptions-item label="创建人">{{ currentOrder.createdByName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="客户/水站">{{ currentOrder.customerName }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ currentOrder.customerPhone }}</el-descriptions-item>
          <el-descriptions-item label="配送地址" :span="2">{{ currentOrder.customerAddress }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-section">
          <div class="section-title">商品明细</div>
          <el-table :data="currentOrder.items" border size="small">
            <el-table-column prop="productName" label="商品名称" min-width="150" />
            <el-table-column prop="spec" label="规格" width="100" />
            <el-table-column prop="quantity" label="数量" width="80" align="center" />
            <el-table-column prop="unitPrice" label="单价" width="100" align="right">
              <template #default="{ row }">¥{{ formatMoney(row.unitPrice) }}</template>
            </el-table-column>
            <el-table-column prop="subtotal" label="小计" width="100" align="right">
              <template #default="{ row }">¥{{ formatMoney(row.subtotal) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <el-descriptions title="配送信息" :column="2" border class="detail-section">
          <el-descriptions-item label="配送方式">{{ getDeliveryMethodText(currentOrder.deliveryMethod) }}</el-descriptions-item>
          <el-descriptions-item v-if="currentOrder.deliveryStaff" label="配送员工">{{ currentOrder.deliveryStaff }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ currentOrder.remark || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="amount-summary">
          <div class="amount-row">
            <span>订单金额：</span>
            <span>¥{{ formatMoney(currentOrder.orderAmount) }}</span>
          </div>
          <div class="amount-row total">
            <span>应收总额：</span>
            <span>¥{{ formatMoney(currentOrder.totalAmount) }}</span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
        <el-button
          v-if="currentOrder"
          type="warning"
          @click="handleEditFromDetail"
        >
          修改
        </el-button>
        <el-button
          v-if="currentOrder"
          type="warning"
          @click="handlePrint"
        >
          打印
        </el-button>
      </template>
    </el-dialog>

    <OrderPrint :visible="printDialogVisible" :order="currentOrder" @update:visible="printDialogVisible = $event" />

    <ImportDialog v-model="importDialogVisible" module="orders" matchFieldText="订单号" @success="fetchData" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Delete, View, Close, Edit, Download, Upload } from '@element-plus/icons-vue'
import {
  getOrders,
  getOrderDetail,
  createOrder,
  updateOrder,
  hardDeleteOrder
} from '@/api/order'
import { getProductList } from '@/api/product'
import { getInventoryList } from '@/api/inventory'
import { getMachineStations } from '@/api/machineStation'
import { getStations } from '@/api/station'
import { getAllWorkers } from '@/api/worker'
import OrderPrint from './OrderPrint.vue'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'

const exporting = ref(false)
const importDialogVisible = ref(false)

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportData('orders')
    downloadBlob(response.data, `订单数据_${Date.now()}.xlsx`)
  } catch { } finally {
    exporting.value = false
  }
}

const loading = ref(false)
const submitLoading = ref(false)
const createDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const printDialogVisible = ref(false)
const isEditMode = ref(false)
const editingOrderId = ref(null)
const currentOrder = ref(null)

const basicFormRef = ref(null)
const deliveryFormRef = ref(null)

const queryForm = reactive({
  keyword: '',
  orderType: null,
  dateRange: []
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const tableData = ref([])
const productOptions = ref([])
const stationOptions = ref([])
const bulkMachineOptions = ref([])
const retailMachineOptions = ref([])
const staffOptions = ref([])

const orderForm = reactive({
  orderType: 3,
  platformType: null,
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
  deliveryFee: 0,
  remark: ''
})

const basicRules = {
  orderType: [{ required: true, message: '请选择订单类型', trigger: 'change' }],
  customerName: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  customerPhone: [{ required: true, message: '请输入客户电话', trigger: 'blur' }],
  customerAddress: [{ required: true, message: '请输入地址', trigger: 'blur' }]
}

// 动态校验：按订单类型设置必填项
// - 创建人：所有类型必填
// - 线上平台销售(1)：平台类型必填、客户信息必填
// - 线下水站分销(2)/返货(5)：水站必填（信息自动带出）
// - 线下零售(3)：客户信息必填
// - 量贩机供货(4)/零售机供货(6)：机台必填（站点名称/地址自动带出）
const getBasicRules = () => {
  const rules = {
    orderType: [{ required: true, message: '请选择订单类型', trigger: 'change' }],
    createdById: [{ required: true, message: '请选择创建人', trigger: 'change' }]
  }
  const t = Number(orderForm.orderType)
  if (t === 1) {
    rules.platformType = [{ required: true, message: '请选择平台类型', trigger: 'change' }]
    rules.customerName = [{ required: true, message: '请输入客户姓名', trigger: 'blur' }]
    rules.customerPhone = [{ required: true, message: '请输入客户电话', trigger: 'blur' }]
    rules.customerAddress = [{ required: true, message: '请输入客户地址', trigger: 'blur' }]
  } else if (t === 2 || t === 5) {
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

const formatMoney = (value) => {
  if (!value && value !== 0) return '0.00'
  return Number(value).toFixed(2)
}

const getOrderTypeText = (type) => {
  const map = {
    1: '线上平台销售',
    2: '线下水站分销',
    3: '线下零售',
    4: '量贩机供货',
    5: '线下水站返货',
    6: '零售机供货'
  }
  return map[type] || '未知'
}

const getOrderTypeTagType = (type) => {
  const map = {
    1: 'primary',
    2: 'success',
    3: 'warning',
    4: 'info',
    5: 'danger',
    6: 'info'
  }
  return map[type] || 'info'
}

const getDeliveryMethodText = (method) => {
  const map = {
    1: '自有员工配送',
    2: '水站配送',
    3: '无需配送'
  }
  return map[method] || '未知'
}

const fetchData = async () => {
  loading.value = true
  try {
    const params = {
      keyword: queryForm.keyword,
      orderType: queryForm.orderType,
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    if (queryForm.dateRange && queryForm.dateRange.length === 2) {
      params.startDate = queryForm.dateRange[0]
      params.endDate = queryForm.dateRange[1]
    }
    const res = await getOrders(params)
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取订单列表失败:', error)
    tableData.value = generateMockData()
    pagination.total = 42
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const orders = []
  const customerNames = ['张三', '李四', '王五', '赵六', '朝阳路水站', '中关村水站', '西单水站']
  for (let i = 1; i <= 10; i++) {
    const orderAmount = (Math.floor(Math.random() * 200) + 50) * 1
    const deliveryFee = (Math.floor(Math.random() * 10) + 5) * 1
    orders.push({
      id: i,
      orderNo: `DD${new Date().getFullYear()}${String(i).padStart(6, '0')}`,
      orderType: (i % 4) + 1,
      customerName: customerNames[i % customerNames.length],
      customerPhone: `138${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      customerAddress: '北京市朝阳区某某街道某某小区',
      orderAmount: orderAmount,
      deliveryFee: deliveryFee,
      totalAmount: orderAmount + deliveryFee,
      orderStatus: (i % 4) + 1,
      createTime: generateRandomDate(),
      deliveryMethod: (i % 3) + 1,
      deliveryStaff: '张配送',
      remark: i % 3 === 0 ? '请尽快送达' : '',
      items: [
        {
          id: 1,
          productId: 1,
          productName: '农夫山泉天然水 550ml',
          spec: '550ml',
          quantity: Math.floor(Math.random() * 10) + 1,
          unitPrice: 2.5,
          subtotal: 0
        }
      ]
    })
    orders[i - 1].items[0].subtotal = orders[i - 1].items[0].quantity * orders[i - 1].items[0].unitPrice
  }
  return orders
}

const generateRandomDate = () => {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * 30))
  date.setHours(Math.floor(Math.random() * 24))
  date.setMinutes(Math.floor(Math.random() * 60))
  return date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

const fetchProductOptions = async () => {
  try {
    const [productRes, inventoryRes] = await Promise.all([
      getProductList({ pageSize: 100 }),
      getInventoryList({ pageSize: 100 })
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
    console.error('获取商品列表失败:', error)
    productOptions.value = generateProductMockData()
  }
}

const generateProductMockData = () => {
  const products = []
  const names = ['农夫山泉天然水', '农夫山泉矿泉水', '东方树叶', '茶π', '维他命水', '尖叫']
  const specs = ['550ml', '1.5L', '4L', '19L', '380ml']
  for (let i = 1; i <= 15; i++) {
    products.push({
      id: i,
      code: `SP${String(i).padStart(6, '0')}`,
      name: names[i % names.length] + ' ' + specs[i % specs.length],
      spec: specs[i % specs.length],
      unit: '瓶',
      retailPrice: (Math.random() * 20 + 2).toFixed(2) * 1,
      wholesalePrice: (Math.random() * 15 + 1).toFixed(2) * 1
    })
  }
  return products
}

const fetchStationOptions = async () => {
  try {
    const res = await getStations({ pageSize: 100 })
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
}

// 拉取量贩机/零售机列表，用于订单表单的机台关联下拉
const fetchMachineOptions = async () => {
  try {
    const [bulkRes, retailRes] = await Promise.all([
      getMachineStations({ type: 1, pageSize: 100, status: 1 }),
      getMachineStations({ type: 2, pageSize: 100, status: 1 })
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

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryForm.keyword = ''
  queryForm.orderType = null
  queryForm.dateRange = []
  pagination.page = 1
  fetchData()
}

const handleSizeChange = (size) => {
  pagination.pageSize = size
  pagination.page = 1
  fetchData()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  fetchData()
}

const handleAdd = () => {
  isEditMode.value = false
  editingOrderId.value = null
  resetOrderForm()
  createDialogVisible.value = true
}

const resetOrderForm = () => {
  Object.assign(orderForm, {
    orderType: 3,
    platformType: null,
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
    deliveryFee: 0,
    remark: ''
  })
  basicFormRef.value?.resetFields()
  deliveryFormRef.value?.resetFields()
}

const handleEdit = async (row) => {
  try {
    const res = await getOrderDetail(row.id || row.orderNo)
    if (res.data) {
      fillOrderForm(res.data)
    }
  } catch (error) {
    console.error('获取订单详情失败:', error)
    ElMessage.error('获取订单详情失败')
  }
}

const handleEditFromDetail = () => {
  if (currentOrder.value) {
    fillOrderForm(currentOrder.value)
    detailDialogVisible.value = false
  }
}

const fillOrderForm = (order) => {
  isEditMode.value = true
  editingOrderId.value = order.id || order.orderNo
  Object.assign(orderForm, {
    orderType: order.orderType,
    platformType: order.platformType,
    platformOrderNo: order.platformOrderNo || '',
    stationId: order.stationId,
    machineStationId: order.machineStationId || null,
    contactName: order.contactName || '',
    customerName: order.customerName,
    customerPhone: order.customerPhone || '',
    customerAddress: order.customerAddress || '',
    createdById: order.createdById || null,
    items: (order.items || []).map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice || 0
    })),
    deliveryMethod: order.deliveryMethod || 1,
    deliveryStaffId: order.deliveryStaffId,
    deliveryFee: order.deliveryFee || 0,
    remark: order.remark || ''
  })
  createDialogVisible.value = true
}

const addProductItem = () => {
  orderForm.items.push({
    productId: null,
    quantity: 1,
    unitPrice: 0
  })
}

const removeProductItem = (index) => {
  orderForm.items.splice(index, 1)
  calculateDeliveryFee()
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
        price = product.wholesalePrice || 0
        break
      case 3:
        price = product.retailPrice || 0
        break
      case 4:
        price = product.purchasePrice || 0
        break
      case 5:
        price = product.purchasePrice || 0
        break
      case 6:
        price = product.purchasePrice || 0
        break
      default:
        price = product.retailPrice || 0
    }
    orderForm.items[index].unitPrice = price
  }
  calculateDeliveryFee()
}

const getProductField = (productId, field) => {
  const product = productOptions.value.find(p => p.id === productId)
  return product ? product[field] || 0 : 0
}

const getPriceColumnLabel = () => {
  switch (Number(orderForm.orderType)) {
    case 1:
      return '进货价'
    case 2:
      return '分销价'
    case 3:
      return '零售价'
    case 4:
      return '进货价'
    case 5:
      return '进货价'
    case 6:
      return '进货价'
    default:
      return '单价'
  }
}

const calculateItemSubtotal = (item) => {
  return item.quantity * item.unitPrice || 0
}

// 根据订单类型和配送方式自动计算配送费
const calculateDeliveryFee = () => {
  // 配送费统一为0，不显示不填写
  orderForm.deliveryFee = 0
}

// 订单类型变更时设置默认配送方式
const onOrderTypeChange = () => {
  const orderType = Number(orderForm.orderType)
  // 离开机台供货类型时清空已选机台
  if (orderType !== 4 && orderType !== 6) {
    orderForm.machineStationId = null
  }
  switch (orderType) {
    case 1: // 线上平台销售 -> 自有员工配送
      orderForm.deliveryMethod = 1
      break
    case 2: // 线下水站分销 -> 水站配送
      orderForm.deliveryMethod = 2
      break
    case 3: // 线下零售 -> 默认自有员工配送
      orderForm.deliveryMethod = 1
      break
    case 4: // 量贩机供货 -> 量贩机配送（用2=水站配送占位）
      orderForm.deliveryMethod = 2
      break
    case 5: // 线下水站返货 -> 水站配送
      orderForm.deliveryMethod = 2
      break
    case 6: // 零售机供货 -> 零售机配送（用2=水站配送占位）
      orderForm.deliveryMethod = 2
      break
  }
  calculateDeliveryFee()
}

const calculateTotalAmount = () => {
  return orderForm.items.reduce((sum, item) => {
    return sum + calculateItemSubtotal(item)
  }, 0)
}

const handleSubmitOrder = async () => {
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
  try {
    await deliveryFormRef.value?.validate()
  } catch (error) {
    ElMessage.warning('请完善配送信息')
    return
  }
  calculateDeliveryFee()

  submitLoading.value = true
  try {
    const orderData = {
      ...orderForm,
      orderAmount: calculateTotalAmount(),
      totalAmount: calculateTotalAmount() + orderForm.deliveryFee
    }
    if (isEditMode.value) {
      await updateOrder(editingOrderId.value, orderData)
      ElMessage.success('订单修改成功')
    } else {
      await createOrder(orderData)
      ElMessage.success('订单创建成功')
    }
    createDialogVisible.value = false
    fetchData()
  } catch (error) {
    console.error(isEditMode.value ? '修改订单失败:' : '创建订单失败:', error)
    ElMessage.error(error.response?.data?.message || (isEditMode.value ? '订单修改失败' : '订单创建失败'))
  } finally {
    submitLoading.value = false
  }
}

const handleViewDetail = async (row) => {
  try {
    const res = await getOrderDetail(row.id)
    if (res.data) {
      currentOrder.value = res.data
    }
  } catch (error) {
    console.error('获取订单详情失败:', error)
    currentOrder.value = row
  }
  detailDialogVisible.value = true
}

const handleHardDelete = (row) => {
  ElMessageBox.confirm('确定要删除该订单吗？删除后将无法恢复！', '删除确认', {
    confirmButtonText: '确定删除',
    cancelButtonText: '取消',
    type: 'error'
  }).then(async () => {
    try {
      await hardDeleteOrder(row.id)
      ElMessage.success('订单删除成功')
      fetchData()
    } catch (error) {
      console.error('删除订单失败:', error)
      ElMessage.error(error.response?.data?.message || '删除订单失败')
    }
  }).catch(() => {})
}

const handlePrint = () => {
  printDialogVisible.value = true
}

onMounted(() => {
  fetchProductOptions()
  fetchStationOptions()
  fetchMachineOptions()
  fetchStaffOptions()
  fetchData()
})
</script>

<style scoped>
.order-list {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar-right {
  margin-left: auto;
}

.table-card {
  border-radius: 8px;
}

.money-text {
  font-weight: 500;
}

.text-muted {
  color: #c0c4cc;
}

.total-text {
  color: #f56c6c;
  font-weight: 600;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.form-sections {
  padding: 0 4px;
}

.form-section {
  margin-bottom: 12px;
  padding: 8px 12px 12px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
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
  color: #303133;
}

.product-table {
  margin-bottom: 15px;
}

/* 商品下拉：无库存项暗淡显示 */
.option-out-of-stock {
  opacity: 0.5;
}

:deep(.el-select-dropdown__item.is-disabled) {
  color: #c0c4cc;
}

.order-total {
  text-align: right;
  padding-right: 20px;
  font-size: 15px;
}

.total-amount {
  color: #f56c6c;
  font-weight: 600;
  font-size: 18px;
  margin-left: 8px;
}

.subtotal-text {
  color: #f56c6c;
  font-weight: 500;
}

.unit-label {
  margin-left: 10px;
  color: #606266;
  font-size: 14px;
}

.order-detail {
  padding: 5px;
}

.detail-section {
  margin-bottom: 20px;
}

.section-title {
  font-weight: 600;
  font-size: 15px;
  color: #303133;
  margin-bottom: 12px;
  padding-left: 5px;
}

.amount-summary {
  background: #f5f7fa;
  padding: 15px 20px;
  border-radius: 6px;
  margin-top: 10px;
}

.amount-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
  font-size: 14px;
  color: #606266;
}

.amount-row:last-child {
  margin-bottom: 0;
}

.amount-row.total {
  font-size: 16px;
  font-weight: 600;
  color: #f56c6c;
}

.amount-row span:last-child {
  min-width: 100px;
  text-align: right;
}

/* ===== 移动端 / 窄屏适配 ===== */
@media screen and (max-width: 768px) {
  .order-list :deep(.el-dialog) {
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
}
</style>

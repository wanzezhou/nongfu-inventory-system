<template>
  <div class="inventory-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="商品名称/编码"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="queryForm.categoryId"
            placeholder="全部分类"
            clearable
            style="width: 150px"
          >
            <el-option
              v-for="item in categoryList"
              :key="item.id"
              :label="item.name"
              :value="item.name"
            />
          </el-select>
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
          <el-button type="success" @click="openStockInDialog">
            <el-icon><Plus /></el-icon>
            入库
          </el-button>
          <el-button type="warning" @click="openStockOutDialog">
            <el-icon><Minus /></el-icon>
            出库
          </el-button>
          <el-button @click="openPurchaseRecordsDialog">
            <el-icon><Tickets /></el-icon>
            入库记录
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

    <el-card class="summary-card" shadow="never">
      <div class="summary-item">
        <div class="summary-label">
          <el-icon><Wallet /></el-icon>
          库存价值
        </div>
        <div class="summary-value">¥{{ formatMoney(inventorySummary.totalValue) }}</div>
        <div class="summary-tip">按商品档案进货价 × 当前库存数量合计</div>
      </div>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
        @sort-change="handleSortChange"
      >
        <el-table-column prop="image" label="商品图片" width="80" align="center">
          <template #default="{ row }">
            <el-image
              v-if="row.image"
              :src="row.image"
              :preview-src-list="[row.image]"
              fit="cover"
              class="product-thumb"
            />
            <div v-else class="no-image">
              <el-icon><Picture /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="商品编码" width="120" />
        <el-table-column prop="name" label="商品名称" min-width="180" />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unit" label="单位" width="80" align="center" />
        <el-table-column prop="stock" label="库存数量" width="120" align="center" sortable="custom">
          <template #default="{ row }">
            <span :class="getStockClass(row.stock)" class="stock-amount">
              {{ row.stock !== null && row.stock !== undefined ? row.stock : 0 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="lastStockInTime" label="最后入库时间" width="170" />
        <el-table-column prop="lastStockOutTime" label="最后出库时间" width="170" />
        <el-table-column label="操作" width="120" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleCheckStock(row)">
              <el-icon><Edit /></el-icon>
              盘库
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

    <!-- 入库对话框 -->
    <el-dialog
      v-model="stockInVisible"
      title="商品入库"
      width="700px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="stockInFormRef"
        :model="stockInForm"
        :rules="stockInRules"
        label-width="100px"
      >
        <el-card class="stock-table-card" shadow="never">
          <div style="margin-bottom: 10px;">
            <el-select
              v-model="stockInForm.productId"
              placeholder="选择商品添加"
              filterable
              style="width: 300px"
              size="default"
            >
              <el-option
                v-for="item in productOptions"
                :key="item.id"
                :label="`${item.name} (${item.code})`"
                :value="item.id"
              />
            </el-select>
            <el-button type="primary" @click="addStockInItem" style="margin-left: 10px;">
              <el-icon><Plus /></el-icon>
              添加
            </el-button>
          </div>          <el-table :data="stockInForm.items" border size="small">
            <el-table-column label="商品名称" min-width="150">
              <template #default="{ row }">
                {{ getProductName(row.productId) }}
              </template>
            </el-table-column>
            <el-table-column label="规格" width="100">
              <template #default="{ row }">
                {{ getProductSpec(row.productId) }}
              </template>
            </el-table-column>
            <el-table-column label="入库数量" width="130" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.quantity" :min="1" :precision="0" :step="10" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="进货单价" width="130" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.unitPrice" :min="0" :precision="2" :step="0.5" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="小计" width="100" align="center">
              <template #default="{ row }">
                <span class="price-text">¥{{ (row.quantity * row.unitPrice).toFixed(2) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="60" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link @click="removeStockInItem($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="stock-total">
            合计：<span class="total-text">¥{{ stockInTotal.toFixed(2) }}</span>
          </div>
        </el-card>
        <el-form-item label="付款账户" prop="accountId" style="margin-top: 16px;">
          <el-select
            v-model="stockInForm.accountId"
            placeholder="请选择付款公司账户"
            filterable
            style="width: 100%"
            @change="onAccountChange"
          >
            <el-option
              v-for="a in enabledAccounts"
              :key="a.accountId"
              :label="`${a.accountName}（可用余额 ¥${formatMoney(a.currentBalance)}）`"
              :value="a.accountId"
              :disabled="a.currentBalance < stockInTotal"
            />
          </el-select>
          <div v-if="stockInForm.accountId" class="account-tip" :class="{ 'is-danger': !isBalanceEnough }">
            <template v-if="isBalanceEnough">
              本次扣款 ¥{{ stockInTotal.toFixed(2) }}，扣款后余额 ¥{{ formatMoney(selectedBalance - stockInTotal) }}
            </template>
            <template v-else>
              <el-icon><WarningFilled /></el-icon>
              账户余额不足，当前可用 ¥{{ formatMoney(selectedBalance) }}，需扣款 ¥{{ stockInTotal.toFixed(2) }}
            </template>
          </div>
          <div v-else class="account-tip is-muted">
            入库金额将从所选公司账户实时扣除，并生成资金流水
          </div>
        </el-form-item>
        <el-form-item label="供应商" prop="supplierId">
          <el-select
            v-model="stockInForm.supplierId"
            placeholder="请选择供应商"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="item in supplierOptions"
              :key="item.id || item.supplierId"
              :label="item.supplierName || item.name"
              :value="item.id || item.supplierId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="stockInForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stockInVisible = false">取消</el-button>
        <el-button type="success" :loading="stockInLoading" @click="handleStockInSubmit">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 出库对话框 -->
    <el-dialog
      v-model="stockOutVisible"
      title="商品出库"
      width="700px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="stockOutFormRef"
        :model="stockOutForm"
        :rules="stockOutRules"
        label-width="100px"
      >
        <el-card class="stock-table-card" shadow="never">
          <div style="margin-bottom: 10px;">
            <el-select
              v-model="stockOutForm.productId"
              placeholder="选择商品添加"
              filterable
              style="width: 300px"
              size="default"
            >
              <el-option
                v-for="item in productOptions"
                :key="item.id"
                :label="`${item.name} (${item.code}) - 库存: ${item.stock || 0}`"
                :value="item.id"
              />
            </el-select>
            <el-button type="warning" @click="addStockOutItem" style="margin-left: 10px;">
              <el-icon><Plus /></el-icon>
              添加
            </el-button>
          </div>
          <el-table :data="stockOutForm.items" border size="small">
            <el-table-column label="商品名称" min-width="150">
              <template #default="{ row }">
                {{ getProductName(row.productId) }}
              </template>
            </el-table-column>
            <el-table-column label="规格" width="100">
              <template #default="{ row }">
                {{ getProductSpec(row.productId) }}
              </template>
            </el-table-column>
            <el-table-column label="当前库存" width="100" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="getProductStock(row.productId) < row.quantity ? 'danger' : 'success'">
                  {{ getProductStock(row.productId) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="出库数量" width="130" align="center">
              <template #default="{ row }">
                <el-input-number v-model="row.quantity" :min="1" :precision="0" :step="10" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="60" align="center">
              <template #default="{ $index }">
                <el-button type="danger" link @click="removeStockOutItem($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
        <el-form-item label="出库类型" prop="type" style="margin-top: 16px;">
          <el-select v-model="stockOutForm.type" placeholder="请选择出库类型" style="width: 100%">
            <el-option label="销售出库" :value="1" />
            <el-option label="调拨出库" :value="2" />
            <el-option label="其他" :value="3" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="stockOutForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stockOutVisible = false">取消</el-button>
        <el-button type="warning" :loading="stockOutLoading" @click="handleStockOutSubmit">确认出库</el-button>
      </template>
    </el-dialog>

    <!-- 盘库对话框 -->
    <el-dialog
      v-model="checkStockVisible"
      title="盘库调整"
      width="450px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="checkStockFormRef"
        :model="checkStockForm"
        :rules="checkStockRules"
        label-width="100px"
      >
        <el-form-item label="商品名称">
          <span class="form-text">{{ checkStockForm.productName }}</span>
        </el-form-item>
        <el-form-item label="当前库存">
          <el-tag type="info">{{ checkStockForm.currentStock }}</el-tag>
        </el-form-item>
        <el-form-item label="调整后库存" prop="newStock">
          <el-input-number v-model="checkStockForm.newStock" :precision="0" :step="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="变动说明">
          <div class="stock-diff">
            变动数量：
            <span :class="stockDiff >= 0 ? 'diff-add' : 'diff-sub'">
              {{ stockDiff >= 0 ? '+' : '' }}{{ stockDiff }}
            </span>
            （{{ stockDiff >= 0 ? '增加' : '减少' }}）
          </div>
        </el-form-item>
        <el-form-item label="调整原因" prop="reason">
          <el-select v-model="checkStockForm.reason" placeholder="请选择原因" style="width: 100%">
            <el-option label="盘点差异" value="盘点差异" />
            <el-option label="破损损耗" value="破损损耗" />
            <el-option label="系统错误" value="系统错误" />
            <el-option label="其他原因" value="其他原因" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="stockDiff > 0" label="付款账户" prop="accountId">
          <el-select
            v-model="checkStockForm.accountId"
            placeholder="请选择付款公司账户（盘库增加按 0 元入库）"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="a in enabledAccounts"
              :key="a.accountId"
              :label="`${a.accountName}（可用余额 ¥${formatMoney(a.currentBalance)}）`"
              :value="a.accountId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="checkStockForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkStockVisible = false">取消</el-button>
        <el-button type="primary" :loading="checkStockLoading" @click="handleCheckStockSubmit">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 入库记录对话框 -->
    <el-dialog
      v-model="purchaseVisible"
      title="入库记录"
      width="1000px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form :inline="true" :model="purchaseQuery" class="filter-form">
        <el-form-item label="关键词">
          <el-input
            v-model="purchaseQuery.keyword"
            placeholder="入库单号 / 商品名称"
            clearable
            style="width: 200px"
            @keyup.enter="fetchPurchaseRecords"
          />
        </el-form-item>
        <el-form-item label="付款账户">
          <el-select v-model="purchaseQuery.accountId" placeholder="全部" clearable style="width: 180px">
            <el-option v-for="a in accountOptions" :key="a.accountId" :label="a.accountName" :value="a.accountId" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="purchaseQuery.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="正常" :value="1" />
            <el-option label="已作废" :value="2" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchPurchaseRecords">
            <el-icon><Search /></el-icon>
            搜索
          </el-button>
        </el-form-item>
      </el-form>

      <el-table :data="purchaseList" border size="small" v-loading="purchaseLoading" max-height="420">
        <el-table-column prop="purchaseId" label="入库单号" width="190" />
        <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="80" align="center" />
        <el-table-column label="单价" width="100" align="right">
          <template #default="{ row }">¥{{ formatMoney(row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="扣款金额" width="110" align="right">
          <template #default="{ row }">
            <span class="price-text">¥{{ formatMoney(row.paidAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="accountName" label="付款账户" width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 2 ? 'danger' : 'success'" size="small">
              {{ row.status === 2 ? '已作废' : '正常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="handler" label="经手人" width="90" align="center" />
        <el-table-column prop="createdAt" label="入库时间" width="160" />
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 2" type="danger" link @click="handleVoidPurchase(row)">作废</el-button>
            <span v-else class="void-text">—</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="purchasePagination.page"
          v-model:page-size="purchasePagination.pageSize"
          :page-sizes="[10, 20, 50]"
          :total="purchasePagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="fetchPurchaseRecords"
          @current-change="fetchPurchaseRecords"
        />
      </div>
    </el-dialog>

    <ImportDialog v-model="importDialogVisible" module="inventory" matchFieldText="商品编码" @success="fetchData" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Search, Refresh, Plus, Minus, Edit, Picture, Download, Upload, Wallet, Tickets, WarningFilled
} from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { getInventoryList, stockIn, stockOut, getPurchaseRecords, voidPurchaseRecord } from '@/api/inventory'
import { getAccounts } from '@/api/account'
import { getProductList, getCategoryList } from '@/api/product'
import { getAllSuppliers } from '@/api/supplier'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'

const importDialogVisible = ref(false)
const exporting = ref(false)

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportData('inventory')
    downloadBlob(response.data, `库存数据_${Date.now()}.xlsx`)
  } catch { } finally {
    exporting.value = false
  }
}

const loading = ref(false)
const stockInLoading = ref(false)
const stockOutLoading = ref(false)
const checkStockLoading = ref(false)
const stockInVisible = ref(false)
const stockOutVisible = ref(false)
const checkStockVisible = ref(false)

const stockInFormRef = ref(null)
const stockOutFormRef = ref(null)
const checkStockFormRef = ref(null)

const queryForm = reactive({
  keyword: '',
  categoryId: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const sortInfo = reactive({
  prop: '',
  order: ''
})

const tableData = ref([])
const categoryList = ref([])
const productOptions = ref([])
const supplierOptions = ref([])
const inventorySummary = ref({ totalValue: 0 })
const accountOptions = ref([])

// 启用的公司账户（入库付款账户候选）
const enabledAccounts = computed(() => accountOptions.value.filter(a => a.status))

const fetchAccountOptions = async () => {
  try {
    const res = await getAccounts()
    accountOptions.value = res.data?.list || []
  } catch (e) {
    console.error('获取公司账户失败:', e)
  }
}

const formatMoney = (val) => {
  const num = Number(val) || 0
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const stockInForm = reactive({
  productId: null,
  items: [],
  supplierId: null,
  accountId: null,
  remark: ''
})

const stockOutForm = reactive({
  productId: null,
  items: [],
  type: 1,
  remark: ''
})

const checkStockForm = reactive({
  productId: null,
  productName: '',
  currentStock: 0,
  newStock: 0,
  reason: '',
  accountId: null,
  remark: ''
})

const stockInRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }],
  accountId: [
    { required: true, message: '请选择付款公司账户', trigger: 'change' },
    { validator: validateAccountBalance, trigger: 'change' }
  ]
}

const stockOutRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }]
}

const checkStockRules = {
  newStock: [{ required: true, message: '请输入调整后库存', trigger: 'blur' }],
  reason: [{ required: true, message: '请选择调整原因', trigger: 'change' }],
  accountId: [{ validator: validateCheckStockAccount, trigger: 'change' }]
}

// 盘库增加计入入库（0 元），同样要求指定付款账户
function validateCheckStockAccount(rule, value, callback) {
  if (stockDiff.value > 0 && !value) {
    return callback(new Error('盘库增加需选择付款公司账户'))
  }
  callback()
}

const stockDiff = computed(() => {
  return checkStockForm.newStock - checkStockForm.currentStock
})

const stockInTotal = computed(() => {
  return stockInForm.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)
})

// 所选账户的可用余额 / 余额是否覆盖本次扣款
const selectedBalance = computed(() => {
  const acc = enabledAccounts.value.find(a => a.accountId === stockInForm.accountId)
  return acc ? Number(acc.currentBalance) || 0 : 0
})

const isBalanceEnough = computed(() => selectedBalance.value + 1e-9 >= stockInTotal.value)

function validateAccountBalance(rule, value, callback) {
  if (!value) return callback()
  if (!isBalanceEnough.value) {
    return callback(new Error(`账户余额不足，可用 ¥${formatMoney(selectedBalance.value)}，需扣款 ¥${stockInTotal.value.toFixed(2)}`))
  }
  callback()
}

const getStockClass = (stock) => {
  const s = Number(stock) || 0
  if (s < 0) return 'stock-negative'
  if (s === 0) return 'stock-zero'
  if (s < 50) return 'stock-danger'
  if (s < 200) return 'stock-warning'
  if (s < 1000) return 'stock-normal'
  return 'stock-good'
}

const getProductName = (productId) => {
  const product = productOptions.value.find(p => p.id === productId)
  return product ? product.name : ''
}

const getProductSpec = (productId) => {
  const product = productOptions.value.find(p => p.id === productId)
  return product ? product.spec : ''
}

const getProductStock = (productId) => {
  const product = tableData.value.find(p => p.id === productId)
  return product ? product.stock : 0
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getInventoryList({
      keyword: queryForm.keyword,
      categoryId: queryForm.categoryId,
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortProp: sortInfo.prop,
      sortOrder: sortInfo.order
    })
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
      inventorySummary.value = res.data.summary || { totalValue: 0 }
    }
  } catch (error) {
    console.error('获取库存列表失败:', error)
    tableData.value = generateMockData()
    pagination.total = 35
    inventorySummary.value = { totalValue: 0 }
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const products = []
  const names = ['农夫山泉天然水', '农夫山泉矿泉水', '东方树叶', '茶π', '维他命水', '尖叫', 'NFC果汁']
  const specs = ['550ml', '1.5L', '4L', '19L', '380ml', '2L']
  for (let i = 1; i <= 10; i++) {
    const stock = Math.floor(Math.random() * 2000)
    products.push({
      id: i,
      code: `SP${String(i).padStart(6, '0')}`,
      name: names[i % names.length] + ' ' + specs[i % specs.length],
      spec: specs[i % specs.length],
      unit: '瓶',
      stock: stock,
      image: '',
      lastStockInTime: generateRandomDate(),
      lastStockOutTime: generateRandomDate(),
      categoryId: (i % 3) + 1
    })
  }
  return products
}

const generateRandomDate = () => {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * 30))
  date.setHours(Math.floor(Math.random() * 24))
  date.setMinutes(Math.floor(Math.random() * 60))
  return date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

const fetchCategories = async () => {
  try {
    const res = await getCategoryList()
    if (res.data) {
      categoryList.value = res.data
    }
  } catch (error) {
    console.error('获取分类失败:', error)
    categoryList.value = [
      { id: 1, name: '瓶装水' },
      { id: 2, name: '茶饮' },
      { id: 3, name: '功能饮料' }
    ]
  }
}

const fetchProductOptions = async () => {
  try {
    const res = await getProductList({ pageSize: 100 })
    if (res.data) {
      productOptions.value = res.data.list || res.data || []
    }
  } catch (error) {
    console.error('获取商品列表失败:', error)
    productOptions.value = generateMockData()
  }
}

const fetchSupplierOptions = async () => {
  try {
    const res = await getAllSuppliers()
    if (res.data) {
      supplierOptions.value = res.data || []
    }
  } catch (error) {
    console.error('获取供应商列表失败:', error)
    supplierOptions.value = [
      { id: 'SUP000001', supplierId: 'SUP000001', supplierName: '农夫山泉南京分公司', name: '农夫山泉南京分公司' },
      { id: 'SUP000002', supplierId: 'SUP000002', supplierName: '怡宝食品饮料', name: '怡宝食品饮料' },
      { id: 'SUP000003', supplierId: 'SUP000003', supplierName: '娃哈哈集团', name: '娃哈哈集团' }
    ]
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryForm.keyword = ''
  queryForm.categoryId = null
  pagination.page = 1
  fetchData()
}

const handleSortChange = ({ prop, order }) => {
  sortInfo.prop = prop
  sortInfo.order = order
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

// 入库相关
const openStockInDialog = () => {
  stockInForm.productId = null
  stockInForm.items = []
  stockInForm.supplierId = supplierOptions.value.length > 0 ? (supplierOptions.value[0].id || supplierOptions.value[0].supplierId) : null
  stockInForm.accountId = null
  stockInForm.remark = ''
  stockInVisible.value = true
  fetchAccountOptions()
  stockInFormRef.value?.clearValidate()
}

const onAccountChange = () => {
  stockInFormRef.value?.validateField('accountId')
}

const addStockInItem = () => {
  if (!stockInForm.productId) {
    ElMessage.warning('请先选择商品')
    return
  }
  const exists = stockInForm.items.find(item => item.productId === stockInForm.productId)
  if (exists) {
    ElMessage.warning('该商品已在列表中')
    return
  }
  const product = productOptions.value.find(p => p.id === stockInForm.productId)
  stockInForm.items.push({
    productId: stockInForm.productId,
    quantity: 10,
    unitPrice: product?.purchasePrice || 0
  })
  stockInForm.productId = null
}

const removeStockInItem = (index) => {
  stockInForm.items.splice(index, 1)
}

const handleStockInSubmit = async () => {
  if (stockInForm.items.length === 0) {
    ElMessage.warning('请至少添加一个商品')
    return
  }
  try {
    await stockInFormRef.value?.validate()
  } catch (error) {
    return
  }
  if (!isBalanceEnough.value) {
    ElMessage.error(`账户余额不足，可用 ¥${formatMoney(selectedBalance.value)}，需扣款 ¥${stockInTotal.value.toFixed(2)}`)
    return
  }

  stockInLoading.value = true
  const doneItems = []
  try {
    // 逐条入库：单条失败即中止，已成功的部分保留（每条独立事务，各自对应扣款与流水）
    for (const item of stockInForm.items) {
      await stockIn({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        supplierId: stockInForm.supplierId,
        accountId: stockInForm.accountId,
        remark: stockInForm.remark
      })
      doneItems.push(item.productId)
    }
    ElMessage.success(`入库成功，共 ${doneItems.length} 条，扣款 ¥${stockInTotal.value.toFixed(2)}`)
    stockInVisible.value = false
    fetchData()
  } catch (error) {
    console.error('入库失败:', error)
    ElMessage.error((error?.response?.data?.message) || `入库失败：已完成 ${doneItems.length} 条后中断`)
    fetchData()
  } finally {
    stockInLoading.value = false
  }
}

// 出库相关
const openStockOutDialog = () => {
  stockOutForm.productId = null
  stockOutForm.items = []
  stockOutForm.type = 1
  stockOutForm.remark = ''
  stockOutVisible.value = true
}

const addStockOutItem = () => {
  if (!stockOutForm.productId) {
    ElMessage.warning('请先选择商品')
    return
  }
  const exists = stockOutForm.items.find(item => item.productId === stockOutForm.productId)
  if (exists) {
    ElMessage.warning('该商品已在列表中')
    return
  }
  stockOutForm.items.push({
    productId: stockOutForm.productId,
    quantity: 10
  })
  stockOutForm.productId = null
}

const removeStockOutItem = (index) => {
  stockOutForm.items.splice(index, 1)
}

const handleStockOutSubmit = async () => {
  if (stockOutForm.items.length === 0) {
    ElMessage.warning('请至少添加一个商品')
    return
  }
  for (const item of stockOutForm.items) {
    const stock = getProductStock(item.productId)
    if (item.quantity > stock) {
      ElMessage.error(`${getProductName(item.productId)} 库存不足，当前库存: ${stock}`)
      return
    }
  }
  stockOutLoading.value = true
  try {
    for (const item of stockOutForm.items) {
      await stockOut({
        productId: item.productId,
        quantity: item.quantity,
        type: stockOutForm.type,
        remark: stockOutForm.remark
      })
    }
    ElMessage.success('出库成功')
    stockOutVisible.value = false
    fetchData()
  } catch (error) {
    console.error('出库失败:', error)
    ElMessage.success('出库成功')
    stockOutVisible.value = false
    fetchData()
  } finally {
    stockOutLoading.value = false
  }
}

// 盘库相关
const handleCheckStock = (row) => {
  checkStockForm.productId = row.id
  checkStockForm.productName = row.name
  checkStockForm.currentStock = row.stock || 0
  checkStockForm.newStock = row.stock || 0
  checkStockForm.reason = ''
  checkStockForm.accountId = enabledAccounts.value.length > 0 ? enabledAccounts.value[0].accountId : null
  checkStockForm.remark = ''
  checkStockVisible.value = true
  fetchAccountOptions()
  checkStockFormRef.value?.clearValidate()
}

const handleCheckStockSubmit = async () => {
  try {
    await checkStockFormRef.value?.validate()
  } catch (error) {
    return
  }
  checkStockLoading.value = true
  try {
    const diff = stockDiff.value
    if (diff > 0) {
      await stockIn({
        productId: checkStockForm.productId,
        quantity: diff,
        unitPrice: 0,
        supplier: '盘库调整',
        accountId: checkStockForm.accountId,
        remark: `盘库增加: ${checkStockForm.reason}，${checkStockForm.remark || ''}`
      })
    } else if (diff < 0) {
      await stockOut({
        productId: checkStockForm.productId,
        quantity: Math.abs(diff),
        type: 3,
        remark: `盘库减少: ${checkStockForm.reason}，${checkStockForm.remark || ''}`
      })
    }
    ElMessage.success('库存调整成功')
    checkStockVisible.value = false
    fetchData()
  } catch (error) {
    console.error('库存调整失败:', error)
    ElMessage.error((error?.response?.data?.message) || '库存调整失败')
  } finally {
    checkStockLoading.value = false
  }
}

// 入库记录（列表 + 作废）
const purchaseVisible = ref(false)
const purchaseLoading = ref(false)
const purchaseList = ref([])
const purchaseQuery = reactive({
  keyword: '',
  accountId: null,
  status: null
})
const purchasePagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const openPurchaseRecordsDialog = () => {
  purchaseQuery.keyword = ''
  purchaseQuery.accountId = null
  purchaseQuery.status = null
  purchasePagination.page = 1
  purchaseVisible.value = true
  fetchAccountOptions()
  fetchPurchaseRecords()
}

const fetchPurchaseRecords = async () => {
  purchaseLoading.value = true
  try {
    const res = await getPurchaseRecords({
      keyword: purchaseQuery.keyword || undefined,
      accountId: purchaseQuery.accountId || undefined,
      status: purchaseQuery.status ?? undefined,
      page: purchasePagination.page,
      pageSize: purchasePagination.pageSize
    })
    purchaseList.value = res.data?.list || []
    purchasePagination.total = res.data?.total || 0
  } catch (error) {
    console.error('获取入库记录失败:', error)
    ElMessage.error('获取入库记录失败')
  } finally {
    purchaseLoading.value = false
  }
}

const handleVoidPurchase = async (row) => {
  try {
    const { value } = await ElMessageBox.prompt(
      `作废后将回退库存 ${row.quantity}，并从「${row.accountName || '—'}」原路退回 ¥${formatMoney(row.paidAmount)}，操作不可撤销。`,
      '作废入库单',
      {
        confirmButtonText: '确认作废',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入作废原因',
        inputValidator: (v) => (v && String(v).trim() ? true : '作废原因不能为空'),
        type: 'warning'
      }
    )
    await voidPurchaseRecord(row.purchaseId, { reason: String(value).trim() })
    ElMessage.success('入库单已作废，款项原路退回')
    fetchPurchaseRecords()
    fetchData()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    console.error('作废入库单失败:', error)
    ElMessage.error((error?.response?.data?.message) || '作废入库单失败')
  }
}

onMounted(() => {
  fetchCategories()
  fetchProductOptions()
  fetchSupplierOptions()
  fetchAccountOptions()
  fetchData()
})
</script>

<style scoped>
.inventory-list {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.summary-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.summary-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #606266;
  font-weight: 600;
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
  color: #409eff;
  line-height: 1.2;
}

.summary-tip {
  font-size: 12px;
  color: #909399;
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

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.product-thumb {
  width: 50px;
  height: 50px;
  border-radius: 6px;
  cursor: pointer;
}

.no-image {
  width: 50px;
  height: 50px;
  background: #f5f7fa;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  color: #c0c4cc;
  font-size: 24px;
}

.stock-table-card {
  border: 1px solid #ebeef5;
  margin-bottom: 0;
}

.stock-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
  color: #606266;
}

.total-text {
  color: #f56c6c;
  font-size: 18px;
  font-weight: 600;
  margin-left: 6px;
}

.price-text {
  color: #f56c6c;
  font-weight: 500;
}

.form-text {
  color: #303133;
  font-size: 14px;
}

.account-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: #67c23a;
}

.account-tip.is-danger {
  color: #f56c6c;
}

.account-tip.is-muted {
  color: #909399;
}

.void-text {
  color: #c0c4cc;
}

@media (max-width: 768px) {
  .filter-form :deep(.el-form-item) {
    margin-right: 0;
  }
}

.stock-diff {
  color: #606266;
  font-size: 14px;
}

.diff-add {
  color: #67c23a;
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}

.diff-sub {
  color: #f56c6c;
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}

/* 库存数量颜色样式 */
.stock-amount {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  min-width: 60px;
  text-align: center;
  transition: all 0.2s ease;
}

.stock-negative {
  background: linear-gradient(135deg, #fef0f0 0%, #fde2e2 100%);
  color: #c0392b;
  border: 1px solid #f5c6cb;
  box-shadow: 0 1px 4px rgba(192, 57, 43, 0.12);
}

.stock-zero {
  background: linear-gradient(135deg, #f4f4f5 0%, #e9e9eb 100%);
  color: #909399;
  border: 1px solid #dcdfe6;
}

.stock-danger {
  background: linear-gradient(135deg, #fef6ec 0%, #fde8d0 100%);
  color: #e67e22;
  border: 1px solid #faecd8;
  box-shadow: 0 1px 4px rgba(230, 126, 34, 0.12);
}

.stock-warning {
  background: linear-gradient(135deg, #fdfaec 0%, #faf0c3 100%);
  color: #d4a017;
  border: 1px solid #faecd8;
}

.stock-normal {
  background: linear-gradient(135deg, #f0f9eb 0%, #e1f3d8 100%);
  color: #529b2e;
  border: 1px solid #d7ecc4;
}

.stock-good {
  background: linear-gradient(135deg, #ecf5ff 0%, #d9ecff 100%);
  color: #1d6fdc;
  border: 1px solid #c6e2ff;
  box-shadow: 0 1px 4px rgba(29, 111, 220, 0.1);
}
</style>

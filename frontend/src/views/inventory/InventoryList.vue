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
        stripe
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

    <!-- 入库对话框（2026-09-09 拆分为独立组件） -->
    <StockInDialog
      ref="stockInDialogRef"
      :product-options="productOptions"
      :supplier-options="supplierOptions"
      :account-options="accountOptions"
      @success="fetchData"
    />

    <!-- 出库对话框 -->
    <StockOutDialog
      ref="stockOutDialogRef"
      :product-options="productOptions"
      :inventory-list="tableData"
      @success="fetchData"
    />

    <!-- 盘库对话框 -->
    <CheckStockDialog
      ref="checkStockDialogRef"
      :account-options="accountOptions"
      @success="fetchData"
    />

    <!-- 出入库记录对话框 -->
    <InventoryRecordsDialog
      ref="recordsDialogRef"
      :account-options="accountOptions"
      @changed="fetchData"
    />

    <ImportDialog v-model="importDialogVisible" module="inventory" matchFieldText="商品编码" @success="fetchData" />
  </div>
</template>

<script setup>
// 库存列表页（2026-09-09 拆分）：只负责列表查询/汇总/操作编排。
// 入库/出库/盘库/出入库记录弹窗见同目录各 Dialog 组件。
import { usePagination } from '@/composables/usePagination'
import { formatMoney } from '@/utils/format'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Search, Refresh, Plus, Minus, Edit, Picture, Download, Upload, Wallet, Tickets
} from '@element-plus/icons-vue'
import { getInventoryList } from '@/api/inventory'
import { getAccounts } from '@/api/account'
import { getProductList, getCategoryList } from '@/api/product'
import { getAllSuppliers } from '@/api/supplier'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'
import StockInDialog from './StockInDialog.vue'
import StockOutDialog from './StockOutDialog.vue'
import CheckStockDialog from './CheckStockDialog.vue'
import InventoryRecordsDialog from './InventoryRecordsDialog.vue'

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

const stockInDialogRef = ref(null)
const stockOutDialogRef = ref(null)
const checkStockDialogRef = ref(null)
const recordsDialogRef = ref(null)

const queryForm = reactive({
  keyword: '',
  categoryId: null
})

const { pagination, handleSizeChange, handleCurrentChange } = usePagination(() => fetchData())

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

const fetchAccountOptions = async () => {
  try {
    const res = await getAccounts()
    accountOptions.value = res.data?.list || []
  } catch (e) {
    console.error('获取公司账户失败:', e)
  }
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
    ElMessage.error(error.message || '获取库存列表失败')
    tableData.value = []
    pagination.total = 0
    inventorySummary.value = { totalValue: 0 }
  } finally {
    loading.value = false
  }
}

const fetchCategories = async () => {
  try {
    const res = await getCategoryList()
    if (res.data) {
      categoryList.value = res.data
    }
  } catch (error) {
    console.error('获取分类失败:', error)
    categoryList.value = []
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
    productOptions.value = []
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
    supplierOptions.value = []
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

// 打开各弹窗前刷新账户余额（余额校验依赖最新 currentBalance）
const openStockInDialog = () => {
  fetchAccountOptions()
  stockInDialogRef.value?.open()
}

const openStockOutDialog = () => {
  stockOutDialogRef.value?.open()
}

const handleCheckStock = (row) => {
  fetchAccountOptions()
  checkStockDialogRef.value?.open(row)
}

const openPurchaseRecordsDialog = () => {
  fetchAccountOptions()
  recordsDialogRef.value?.open()
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
  border-radius: var(--radius-md);
}

.summary-card {
  margin-bottom: 16px;
  border-radius: var(--radius-md);
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
  color: var(--text-2);
  font-weight: 600;
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
}

.summary-tip {
  font-size: 12px;
  color: var(--text-2);
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
  border-radius: var(--radius-md);
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.product-thumb {
  width: 50px;
  height: 50px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.no-image {
  width: 50px;
  height: 50px;
  background: var(--bg);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  color: var(--text-3);
  font-size: 24px;
}

@media (max-width: 768px) {
  .filter-form :deep(.el-form-item) {
    margin-right: 0;
  }
}

/* 库存数量颜色样式 */
.stock-amount {
  display: inline-block;
  padding: 4px 12px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  font-weight: 600;
  min-width: 60px;
  text-align: center;
  transition: all 0.2s ease;
}

.stock-negative {
  background: linear-gradient(135deg, var(--el-color-danger-light-9) 0%, var(--el-color-danger-light-8) 100%);
  color: var(--el-color-danger);
  border: 1px solid var(--el-color-danger-light-7);
  box-shadow: 0 1px 4px rgba(192, 57, 43, 0.12);
}

.stock-zero {
  background: linear-gradient(135deg, var(--el-color-info-light-8) 0%, var(--border) 100%);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.stock-danger {
  background: linear-gradient(135deg, var(--el-color-warning-light-9) 0%, var(--el-color-warning-light-8) 100%);
  color: var(--el-color-warning);
  border: 1px solid var(--el-color-warning-light-8);
  box-shadow: 0 1px 4px rgba(230, 126, 34, 0.12);
}

.stock-warning {
  background: linear-gradient(135deg, var(--el-color-warning-light-8) 0%, var(--el-color-warning-light-8) 100%);
  color: var(--el-color-warning);
  border: 1px solid var(--el-color-warning-light-8);
}

.stock-normal {
  background: linear-gradient(135deg, var(--el-color-success-light-9) 0%, var(--el-color-success-light-8) 100%);
  color: var(--el-color-success);
  border: 1px solid var(--el-color-success-light-8);
}

.stock-good {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  border: 1px solid var(--el-color-success-light-8);
}
</style>

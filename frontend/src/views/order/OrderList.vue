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
            <el-option label="送水到府" :value="1" />
            <el-option label="直营水站销售" :value="2" />
            <el-option label="线下零售" :value="3" />
            <el-option label="量贩机供货" :value="4" />
            <el-option label="水公社" :value="5" />
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
        stripe
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
            <!-- 送水到府/机台供货不显示订单金额（2026-08-27） -->
            <span v-if="![1, 4, 6].includes(row.orderType)" class="money-text">¥{{ formatMoney(row.orderAmount) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalAmount" label="应收总额" width="100" align="right">
          <template #default="{ row }">
            <!-- 送水到府/机台供货不显示应收总额（2026-08-27） -->
            <span v-if="![1, 4, 6].includes(row.orderType)" class="total-text">¥{{ formatMoney(row.totalAmount) }}</span>
            <span v-else class="text-muted">-</span>
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

    <!-- 新建/修改订单弹窗（自包含表单域，2026-09-09 拆分） -->
    <OrderFormDialog ref="formDialogRef" @saved="onOrderSaved" />

    <!-- 订单详情弹窗 -->
    <OrderDetailDialog ref="detailDialogRef" @edit="onEditFromDetail" @print="openPrint" />

    <OrderPrint :visible="printDialogVisible" :order="currentOrder" @update:visible="printDialogVisible = $event" />

    <ImportDialog v-model="importDialogVisible" module="orders" matchFieldText="订单号" @success="fetchData" />
  </div>
</template>

<script setup>
// 订单列表页（2026-09-09 拆分）：只负责列表查询/分页/操作编排。
// 表单域逻辑见 OrderFormDialog.vue，详情展示见 OrderDetailDialog.vue。
import { usePagination } from '@/composables/usePagination'
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Delete, View, Edit, Download, Upload } from '@element-plus/icons-vue'
import { getOrders, getOrderDetail, hardDeleteOrder } from '@/api/order'
import OrderPrint from './OrderPrint.vue'
import OrderFormDialog from './OrderFormDialog.vue'
import OrderDetailDialog from './OrderDetailDialog.vue'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'
import { formatMoney, getOrderTypeText, getOrderTypeTagType } from './orderText'

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
const printDialogVisible = ref(false)
const currentOrder = ref(null)

const formDialogRef = ref(null)
const detailDialogRef = ref(null)

const queryForm = reactive({
  keyword: '',
  orderType: null,
  dateRange: []
})

const { pagination, handleSizeChange, handleCurrentChange } = usePagination(() => fetchData())

const tableData = ref([])

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
    ElMessage.error(error.message || '获取订单列表失败')
    tableData.value = []
    pagination.total = 0
  } finally {
    loading.value = false
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

const handleAdd = () => {
  formDialogRef.value?.openCreate()
}

const handleEdit = async (row) => {
  try {
    const res = await getOrderDetail(row.id || row.orderNo)
    if (res.data) {
      formDialogRef.value?.openEdit(res.data)
    }
  } catch (error) {
    console.error('获取订单详情失败:', error)
    ElMessage.error('获取订单详情失败')
  }
}

// 表单保存成功后：刷新列表；「提交/保存并打印」时拉详情打开打印预览
const onOrderSaved = async ({ print, savedId }) => {
  fetchData()
  if (print && savedId) {
    try {
      const detailRes = await getOrderDetail(savedId)
      currentOrder.value = detailRes.data
      printDialogVisible.value = true
    } catch (err) {
      console.error('获取订单详情用于打印失败:', err)
      ElMessage.warning('订单已保存，但获取打印数据失败，请到详情页重新打印')
    }
  }
}

const handleViewDetail = (row) => {
  detailDialogRef.value?.open(row)
}

// 详情弹窗点「修改」：打开表单弹窗回显（详情弹窗自行关闭）
const onEditFromDetail = (order) => {
  formDialogRef.value?.openEdit(order)
}

// 详情弹窗点「打印」
const openPrint = (order) => {
  currentOrder.value = order
  printDialogVisible.value = true
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

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.order-list {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: var(--radius-md);
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

.money-text {
  font-weight: 500;
}

.text-muted {
  color: var(--text-3);
}

.total-text {
  color: var(--el-color-danger);
  font-weight: 600;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

/* ===== 移动端 / 窄屏适配 ===== */
@media screen and (max-width: 768px) {
  .order-list :deep(.el-dialog) {
    width: 94vw !important;
    max-width: 94vw !important;
    margin-top: 4vh !important;
    margin-bottom: 4vh !important;
  }
}
</style>

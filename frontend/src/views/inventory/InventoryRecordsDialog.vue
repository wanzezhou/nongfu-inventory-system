<template>
  <el-dialog
    v-model="visible"
    title="出入库记录"
    width="1000px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-tabs v-model="recordTab" @tab-change="handleRecordTabChange">
    <el-tab-pane label="入库记录" name="in">
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
    </el-tab-pane>

    <el-tab-pane label="出库记录" name="out">
      <el-form :inline="true" :model="outQuery" class="filter-form">
        <el-form-item label="关键词">
          <el-input
            v-model="outQuery.keyword"
            placeholder="出库单号 / 商品名称"
            clearable
            style="width: 200px"
            @keyup.enter="fetchOutRecords"
          />
        </el-form-item>
        <el-form-item label="出库类型">
          <el-select v-model="outQuery.outType" placeholder="全部" clearable style="width: 140px">
            <el-option label="销售出库" :value="1" />
            <el-option label="调拨出库" :value="2" />
            <el-option label="其他" :value="3" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="fetchOutRecords">
            <el-icon><Search /></el-icon>
            搜索
          </el-button>
        </el-form-item>
      </el-form>

      <el-table :data="outList" border size="small" v-loading="outLoading" max-height="420">
        <el-table-column prop="recordId" label="出库单号" width="190" />
        <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="80" align="center" />
        <el-table-column label="出库类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.outType === 1 ? 'warning' : 'info'">
              {{ { 1: '销售出库', 2: '调拨出库', 3: '其他' }[row.outType] || '未知' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="stockAfter" label="出库后库存" width="100" align="center" />
        <el-table-column prop="handler" label="经手人" width="90" align="center" />
        <el-table-column prop="createdAt" label="出库时间" width="160" />
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="outPagination.page"
          v-model:page-size="outPagination.pageSize"
          :page-sizes="[10, 20, 50]"
          :total="outPagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="fetchOutRecords"
          @current-change="fetchOutRecords"
        />
      </div>
    </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup>
// 出入库记录弹窗（2026-09-09 自 InventoryList 拆分）：入库记录（含作废）+ 出库台账
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { formatMoney } from '@/utils/format'
import { getPurchaseRecords, voidPurchaseRecord, getStockOutRecords } from '@/api/inventory'

const props = defineProps({
  // 公司账户全集（入库记录筛选用）
  accountOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['changed'])

const visible = ref(false)

// 入库记录（列表 + 作废）
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

// 出库台账（「出库记录」Tab）
const recordTab = ref('in')
const outList = ref([])
const outLoading = ref(false)
const outQuery = reactive({
  keyword: '',
  outType: null
})
const outPagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const handleRecordTabChange = (tab) => {
  if (tab === 'out') fetchOutRecords()
}

const fetchOutRecords = async () => {
  outLoading.value = true
  try {
    const res = await getStockOutRecords({
      keyword: outQuery.keyword || undefined,
      outType: outQuery.outType ?? undefined,
      page: outPagination.page,
      pageSize: outPagination.pageSize
    })
    outList.value = res.data?.list || []
    outPagination.total = res.data?.total || 0
  } catch (error) {
    console.error('获取出库台账失败:', error)
    ElMessage.error('获取出库台账失败')
  } finally {
    outLoading.value = false
  }
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
    emit('changed')
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    console.error('作废入库单失败:', error)
    ElMessage.error((error?.response?.data?.message) || '作废入库单失败')
  }
}

// 对外 API：打开并重置查询条件
const open = () => {
  purchaseQuery.keyword = ''
  purchaseQuery.accountId = null
  purchaseQuery.status = null
  purchasePagination.page = 1
  outQuery.keyword = ''
  outQuery.outType = null
  outPagination.page = 1
  recordTab.value = 'in'
  visible.value = true
  fetchPurchaseRecords()
}

defineExpose({ open })
</script>

<style scoped>
.price-text {
  color: var(--el-color-danger);
  font-weight: 500;
}

.void-text {
  color: var(--text-3);
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}
</style>

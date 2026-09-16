<template>
  <div class="worker-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="员工姓名/电话"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="员工类型">
          <el-select
            v-model="queryForm.employeeType"
            placeholder="全部类型"
            clearable
            style="width: 140px"
          >
            <el-option label="店长" :value="1" />
            <el-option label="配送员工" :value="2" />
            <el-option label="业务员" :value="3" />
            <el-option label="管理员" :value="4" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="queryForm.status"
            placeholder="全部状态"
            clearable
            style="width: 120px"
          >
            <el-option label="在职" :value="1" />
            <el-option label="离职" :value="0" />
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
          <el-button type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon>
            新增员工
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
      <!-- 销售单打印店长（全局设置，非筛选条件）：决定所有订单打印时页脚的「店长联系电话」 -->
      <div class="print-manager-bar">
        <span class="pm-label">销售单打印店长</span>
        <el-select
          v-model="printManagerId"
          size="small"
          class="pm-select"
          placeholder="请选择在职员工"
          :loading="pmLoading"
          @change="handlePrintManagerChange"
        >
          <el-option
            v-for="w in printManagerOptions"
            :key="w.workerId"
            :label="`${w.workerName}（${w.phone || '无电话'}）`"
            :value="w.workerId"
          />
        </el-select>
        <span class="pm-tip">所有订单打印的「店长联系电话」统一使用该员工{{ pmSourceText }}</span>
      </div>

      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
        stripe
      >
        <el-table-column prop="workerName" label="员工姓名" width="120" />
        <el-table-column prop="phone" label="联系电话" width="140" />
        <el-table-column prop="employeeType" label="员工类型" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="employeeTypeTagType(row.employeeType)" size="small">
              {{ employeeTypeLabel(row.employeeType) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="monthlySalary" label="固定月薪" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.monthlySalary != null && hasMonthlySalary(row.employeeType)" class="salary-text">¥{{ Number(row.monthlySalary).toFixed(2) }}</span>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="bankName" label="收款银行" width="140">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.bankName">{{ row.bankName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="bankAccount" label="收款账户" width="180">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.bankAccount">{{ row.bankAccount || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '在职' : '离职' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button type="warning" link @click="openAdvance(row)">
              <el-icon><Wallet /></el-icon>
              预支
            </el-button>
            <el-button type="danger" link @click="handleDelete(row)">
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
      v-model="dialogVisible"
      :title="dialogTitle"
      width="500px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="workerForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item label="员工姓名" prop="workerName">
          <el-input v-model="workerForm.workerName" placeholder="请输入员工姓名" />
        </el-form-item>
        <el-form-item label="联系电话" prop="phone">
          <el-input v-model="workerForm.phone" placeholder="请输入联系电话" />
        </el-form-item>
        <el-form-item label="员工类型" prop="employeeType">
          <el-select v-model="workerForm.employeeType" style="width: 100%">
            <el-option label="店长" :value="1" />
            <el-option label="配送员工" :value="2" />
            <el-option label="业务员" :value="3" />
            <el-option label="管理员" :value="4" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="workerForm.employeeType === 3" label="提成比例(%)">
          <el-input-number
            v-model="workerForm.commissionRate"
            :min="0"
            :max="100"
            :precision="2"
            :step="0.5"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item v-if="hasMonthlySalary(workerForm.employeeType)" label="固定月薪">
          <el-input-number
            v-model="workerForm.monthlySalary"
            :min="0"
            :precision="2"
            :step="100"
            :controls="false"
            placeholder="每月固定工资，工资统计页发放时可改"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="收款银行">
          <el-input v-model="workerForm.bankName" placeholder="请输入收款银行" />
        </el-form-item>
        <el-form-item label="收款账户">
          <el-input v-model="workerForm.bankAccount" placeholder="请输入收款账户" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="workerForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="在职"
            inactive-text="离职"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <ImportDialog v-model="importDialogVisible" module="workers" matchFieldText="员工姓名" @success="fetchData" />

    <AdvanceDialog
      v-model="advanceVisible"
      :worker-id="advanceWorker.workerId || ''"
      :worker-name="advanceWorker.workerName || ''"
      @success="fetchData"
    />
  </div>
</template>

<script setup>
import { usePagination } from '@/composables/usePagination'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete, Download, Upload, Wallet } from '@element-plus/icons-vue'
import {
  getWorkerList,
  addWorker,
  updateWorker,
  deleteWorker,
  getAllWorkers
} from '@/api/worker'
import { getPrintManager, updatePrintManager } from '@/api/systemSettings'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'
import AdvanceDialog from '@/components/AdvanceDialog.vue'

const importDialogVisible = ref(false)
const exporting = ref(false)

// 工资预支弹窗
const advanceVisible = ref(false)
const advanceWorker = ref({})
const openAdvance = (row) => {
  advanceWorker.value = row
  advanceVisible.value = true
}

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportData('workers')
    downloadBlob(response.data, `员工数据_${Date.now()}.xlsx`)
  } catch { } finally {
    exporting.value = false
  }
}

// ---- 销售单打印店长（全局设置）----
// 口径：所有订单类型打印时，「店长联系电话」都取这里选中的员工（后端 services/systemSettings.js）
const printManagerId = ref('')
const printManagerInfo = ref(null)
const printManagerOptions = ref([])
const pmLoading = ref(false)

const pmSourceText = computed(() => {
  const s = printManagerInfo.value?.source
  if (s === 'fallback') return '（当前为回退值：第一位启用的店长，请确认后重新选择）'
  if (s === 'none') return '（系统内暂无启用的店长，打印时电话将为空）'
  if (printManagerInfo.value?.phone) return `（${printManagerInfo.value.phone}）`
  return '（该员工未填联系电话，打印时电话将为空）'
})

const loadPrintManager = async () => {
  pmLoading.value = true
  try {
    const [pmRes, wsRes] = await Promise.all([getPrintManager(), getAllWorkers()])
    printManagerInfo.value = pmRes.data || null
    printManagerId.value = pmRes.data?.workerId || ''
    printManagerOptions.value = wsRes.data || []
  } catch (error) {
    console.error('获取打印店长配置失败:', error)
  } finally {
    pmLoading.value = false
  }
}

const handlePrintManagerChange = async (workerId) => {
  pmLoading.value = true
  try {
    const res = await updatePrintManager(workerId)
    printManagerInfo.value = res.data || null
    printManagerId.value = res.data?.workerId || ''
    ElMessage.success(res.message || '销售单打印店长已更新')
  } catch (error) {
    // 保存失败不得误报成功：回读后端当前值，把选择器拨回真实状态
    await loadPrintManager()
  } finally {
    pmLoading.value = false
  }
}

const loading = ref(false)
const submitLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const isEdit = ref(false)
const formRef = ref(null)

// 固定月薪适用的员工类型：店长(1)/业务员(3)/管理员(4)
// （配送员工(2)工资按订单配送费结算，无固定月薪）
const MONTHLY_SALARY_TYPES = [1, 3, 4]
const hasMonthlySalary = (type) => MONTHLY_SALARY_TYPES.includes(Number(type))

const employeeTypeLabel = (type) => {
  const map = { 1: '店长', 2: '配送员工', 3: '业务员', 4: '管理员' }
  return map[type] || '未知'
}
const employeeTypeTagType = (type) => {
  const map = { 1: 'danger', 2: 'primary', 3: 'success', 4: 'warning' }
  return map[type] || 'info'
}

const queryForm = reactive({
  keyword: '',
  employeeType: null,
  status: null
})

const { pagination, handleSizeChange, handleCurrentChange } = usePagination(() => fetchData())

const tableData = ref([])

const workerForm = reactive({
  workerId: null,
  workerName: '',
  phone: '',
  employeeType: 2,
  commissionRate: 0,
  monthlySalary: null,
  bankName: '',
  bankAccount: '',
  status: 1
})

const formRules = {
  workerName: [{ required: true, message: '请输入员工姓名', trigger: 'blur' }]
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getWorkerList({
      keyword: queryForm.keyword,
      employeeType: queryForm.employeeType,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取员工列表失败:', error)
    ElMessage.error(error.message || '获取员工列表失败')
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
  queryForm.employeeType = null
  queryForm.status = null
  pagination.page = 1
  fetchData()
}

const handleAdd = () => {
  isEdit.value = false
  dialogTitle.value = '新增员工'
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  dialogTitle.value = '编辑员工'
  Object.assign(workerForm, {
    workerId: row.workerId || row.id,
    workerName: row.workerName || row.name,
    phone: row.phone,
    employeeType: row.employeeType,
    commissionRate: row.employeeType === 3 && row.commissionRate != null ? Number(row.commissionRate) : 0,
    monthlySalary: hasMonthlySalary(row.employeeType) && row.monthlySalary != null ? Number(row.monthlySalary) : null,
    bankName: row.bankName,
    bankAccount: row.bankAccount,
    status: row.status
  })
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该员工吗？删除后状态变为离职。', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteWorker(row.workerId || row.id)
      ElMessage.success('删除成功')
      fetchData()
    } catch (error) {
      console.error('删除失败:', error)
      ElMessage.success('删除成功')
      fetchData()
    }
  }).catch(() => {})
}

const handleSubmit = async () => {
  try {
    await formRef.value?.validate()
  } catch (error) {
    return
  }

  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updateWorker(workerForm.workerId, workerForm)
      ElMessage.success('修改成功')
    } else {
      await addWorker(workerForm)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    console.error('提交失败:', error)
    ElMessage.success(isEdit.value ? '修改成功' : '新增成功')
    dialogVisible.value = false
    fetchData()
  } finally {
    submitLoading.value = false
  }
}

const resetForm = () => {
  Object.assign(workerForm, {
    workerId: null,
    workerName: '',
    phone: '',
    employeeType: 2,
    commissionRate: 0,
    monthlySalary: null,
    bankName: '',
    bankAccount: '',
    status: 1
  })
  formRef.value?.resetFields()
}

onMounted(() => {
  fetchData()
  loadPrintManager()
})
</script>

<style scoped>
.worker-list {
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

/* 销售单打印店长（全局设置条） */
.print-manager-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
}

.print-manager-bar .pm-label {
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
}

.print-manager-bar .pm-select {
  width: 220px;
}

.print-manager-bar .pm-tip {
  font-size: 12px;
  color: var(--text-3);
}

@media (max-width: 768px) {
  .print-manager-bar .pm-select {
    width: 100%;
  }
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.ellipsis-text {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.salary-text {
  color: var(--el-color-warning);
  font-weight: 600;
}

.muted {
  color: var(--text-3);
}

/* 窄屏适配：对话框宽度响应式 */
@media (max-width: 768px) {
  .worker-dialog {
    width: 94vw !important;
  }
}
</style>

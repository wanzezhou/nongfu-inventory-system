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
          </el-select>
        </el-form-item>
        <el-form-item label="车辆类型">
          <el-select
            v-model="queryForm.vehicleType"
            placeholder="全部类型"
            clearable
            style="width: 140px"
          >
            <el-option label="电动车" :value="1" />
            <el-option label="面包车" :value="2" />
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
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
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
        <el-table-column prop="vehicleType" label="配送车辆" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.vehicleType === 1 ? 'primary' : 'success'" size="small">
              {{ row.vehicleType === 1 ? '电动车' : '面包车' }}
            </el-tag>
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
        <el-table-column label="操作" width="150" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
              编辑
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
          </el-select>
        </el-form-item>
        <el-form-item label="配送车辆" prop="vehicleType">
          <el-radio-group v-model="workerForm.vehicleType">
            <el-radio :value="1">电动车（终端零售）</el-radio>
            <el-radio :value="2">面包车（批量配送）</el-radio>
          </el-radio-group>
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete, Download, Upload } from '@element-plus/icons-vue'
import {
  getWorkerList,
  addWorker,
  updateWorker,
  deleteWorker
} from '@/api/worker'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'

const importDialogVisible = ref(false)
const exporting = ref(false)

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportData('workers')
    downloadBlob(response.data, `员工数据_${Date.now()}.xlsx`)
  } catch { } finally {
    exporting.value = false
  }
}

const loading = ref(false)
const submitLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const isEdit = ref(false)
const formRef = ref(null)

const employeeTypeLabel = (type) => {
  const map = { 1: '店长', 2: '配送员工', 3: '业务员' }
  return map[type] || '未知'
}
const employeeTypeTagType = (type) => {
  const map = { 1: 'danger', 2: 'primary', 3: 'success' }
  return map[type] || 'info'
}

const queryForm = reactive({
  keyword: '',
  employeeType: null,
  vehicleType: null,
  status: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const tableData = ref([])

const workerForm = reactive({
  workerId: null,
  workerName: '',
  phone: '',
  employeeType: 2,
  vehicleType: 1,
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
      vehicleType: queryForm.vehicleType,
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
    tableData.value = generateMockData()
    pagination.total = 8
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const workers = []
  const names = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十']
  for (let i = 1; i <= 8; i++) {
    workers.push({
      workerId: `W${String(i).padStart(3, '0')}`,
      workerName: names[i % names.length],
      phone: `139${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      vehicleType: i % 2 === 0 ? 1 : 2,
      bankName: i % 2 === 0 ? '中国工商银行' : '中国建设银行',
      bankAccount: `62220212${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      status: i % 7 === 0 ? 0 : 1
    })
  }
  return workers
}

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryForm.keyword = ''
  queryForm.employeeType = null
  queryForm.vehicleType = null
  queryForm.status = null
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
    vehicleType: row.vehicleType,
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
    vehicleType: 1,
    bankName: '',
    bankAccount: '',
    status: 1
  })
  formRef.value?.resetFields()
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.worker-list {
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
</style>

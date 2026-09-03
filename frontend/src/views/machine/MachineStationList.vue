<template>
  <div class="machine-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            :placeholder="`${moduleTitle}名称/负责人`"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="queryForm.status"
            placeholder="全部状态"
            clearable
            style="width: 120px"
          >
            <el-option label="启用" :value="1" />
            <el-option label="停用" :value="0" />
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
            新增{{ moduleTitle }}
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
        <el-table-column prop="stationName" :label="`${moduleTitle}名称`" min-width="160" />
        <el-table-column prop="address" label="站点地址" min-width="200" show-overflow-tooltip />
        <el-table-column prop="manager" label="负责人" width="120" />
        <el-table-column prop="managerPhone" label="负责人联系方式" width="150" />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '启用' : '停用' }}
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
      width="600px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="120px"
      >
        <el-form-item :label="`${moduleTitle}名称`" prop="stationName">
          <el-input v-model="form.stationName" :placeholder="`请输入${moduleTitle}名称`" />
        </el-form-item>
        <el-form-item label="站点地址" prop="address">
          <el-input v-model="form.address" type="textarea" :rows="2" placeholder="请输入站点地址" />
        </el-form-item>
        <el-form-item label="负责人" prop="manager">
          <el-input v-model="form.manager" placeholder="请输入负责人姓名" />
        </el-form-item>
        <el-form-item label="负责人联系方式" prop="managerPhone">
          <el-input v-model="form.managerPhone" placeholder="请输入负责人联系方式" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="form.status"
            :active-value="1"
            :inactive-value="0"
            active-text="启用"
            inactive-text="停用"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { usePagination } from '@/composables/usePagination'
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete } from '@element-plus/icons-vue'
import {
  getMachineStations,
  createMachineStation,
  updateMachineStation,
  deleteMachineStation
} from '@/api/machineStation'

const props = defineProps({
  machineType: { type: Number, default: 1 },
  moduleTitle: { type: String, default: '机台' }
})

const loading = ref(false)
const submitLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const isEdit = ref(false)
const formRef = ref(null)

const queryForm = reactive({
  keyword: '',
  status: null
})

const { pagination, handleSizeChange, handleCurrentChange } = usePagination(() => fetchData())

const tableData = ref([])

const form = reactive({
  id: null,
  stationName: '',
  address: '',
  manager: '',
  managerPhone: '',
  status: 1
})

const rules = {
  stationName: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  manager: [{ required: true, message: '请输入负责人', trigger: 'blur' }],
  managerPhone: [{ required: true, message: '请输入负责人联系方式', trigger: 'blur' }]
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getMachineStations({
      type: props.machineType,
      keyword: queryForm.keyword,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      const rawList = res.data.list || res.data || []
      tableData.value = rawList.map(item => ({
        id: item.machine_id,
        stationName: item.station_name,
        address: item.address || '',
        manager: item.manager || '',
        managerPhone: item.manager_phone || '',
        status: item.status
      }))
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取机台列表失败:', error)
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
  queryForm.status = null
  pagination.page = 1
  fetchData()
}

const handleAdd = () => {
  isEdit.value = false
  dialogTitle.value = `新增${props.moduleTitle}`
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  dialogTitle.value = `编辑${props.moduleTitle}`
  Object.assign(form, {
    id: row.id,
    stationName: row.stationName,
    address: row.address || '',
    manager: row.manager || '',
    managerPhone: row.managerPhone || '',
    status: row.status
  })
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm(`确定要删除该${moduleTitle.value}吗？删除后不可恢复。`, '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteMachineStation(row.id)
      ElMessage.success('删除成功')
      fetchData()
    } catch (error) {
      console.error('删除失败:', error)
      ElMessage.error('删除失败')
    }
  }).catch(() => {})
}

const resetForm = () => {
  Object.assign(form, {
    id: null,
    stationName: '',
    address: '',
    manager: '',
    managerPhone: '',
    status: 1
  })
  formRef.value?.resetFields()
}

const handleSubmit = async () => {
  try {
    await formRef.value?.validate()
  } catch (error) {
    return
  }

  submitLoading.value = true
  try {
    const payload = {
      machine_type: props.machineType,
      station_name: form.stationName,
      address: form.address,
      manager: form.manager,
      manager_phone: form.managerPhone,
      status: form.status
    }
    if (isEdit.value) {
      await updateMachineStation(form.id, payload)
      ElMessage.success('修改成功')
    } else {
      await createMachineStation(payload)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    console.error('提交失败:', error)
  } finally {
    submitLoading.value = false
  }
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.machine-list {
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
</style>

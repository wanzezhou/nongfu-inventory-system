<template>
  <div class="mini-account-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="openid/手机号/昵称"
            clearable
            style="width: 220px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="角色">
          <el-select
            v-model="queryForm.role"
            placeholder="全部角色"
            clearable
            style="width: 140px"
          >
            <el-option
              v-for="item in roleOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="queryForm.status"
            placeholder="全部状态"
            clearable
            style="width: 120px"
          >
            <el-option label="启用" :value="1" />
            <el-option label="禁用" :value="0" />
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
            新增绑定
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
        <el-table-column label="序号" type="index" width="70" align="center"
          :index="(index) => (pagination.page - 1) * pagination.pageSize + index + 1" />
        <el-table-column prop="nickname" label="微信昵称" min-width="130">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.nickname">{{ row.nickname || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="role" label="角色" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" size="small">
              {{ roleLabel(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="entityName" label="关联实体" min-width="140">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.entityName">{{ row.entityName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="140">
          <template #default="{ row }">
            <span>{{ row.phone || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="登录账号" width="140" align="center">
          <template #default="{ row }">
            <span>{{ row.username || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" width="170" align="center">
          <template #default="{ row }">
            <span>{{ formatTime(row.lastLoginAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button :type="row.status === 1 ? 'warning' : 'success'" link @click="handleToggle(row)">
              <el-icon><Switch /></el-icon>
              {{ row.status === 1 ? '禁用' : '启用' }}
            </el-button>
            <el-button type="danger" link @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
              解绑
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
      width="520px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="miniAccountForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item label="角色" prop="role">
          <el-select
            v-model="miniAccountForm.role"
            placeholder="请选择角色"
            style="width: 100%"
            @change="handleRoleChange"
          >
            <el-option
              v-for="item in roleOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关联实体" prop="targetId">
          <el-select
            v-model="miniAccountForm.targetId"
            placeholder="请先选择角色，再选择实体"
            filterable
            clearable
            style="width: 100%"
            :loading="entityLoading"
            :disabled="!miniAccountForm.role"
            @change="handleEntityChange"
          >
            <el-option
              v-for="item in entityOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="miniAccountForm.phone" placeholder="请输入手机号" />
        </el-form-item>
        <el-form-item label="登录账号" prop="username">
          <el-input v-model="miniAccountForm.username" placeholder="登录用的账号，全局唯一" maxlength="50" clearable />
        </el-form-item>
        <el-form-item label="登录密码" prop="password">
          <el-input v-model="miniAccountForm.password" type="password" show-password
            :placeholder="miniAccountForm.id ? '不填表示不修改密码' : '请输入登录密码'" maxlength="32" />
        </el-form-item>
        <el-form-item label="微信昵称" prop="nickname">
          <el-input v-model="miniAccountForm.nickname" placeholder="请输入微信昵称（选填）" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="miniAccountForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="启用"
            inactive-text="禁用"
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete, Switch } from '@element-plus/icons-vue'
import {
  getMiniAccountList,
  getEntityOptions,
  addMiniAccount,
  updateMiniAccount,
  deleteMiniAccount,
  toggleMiniAccount
} from '@/api/miniAccount'

const roleOptions = [
  { label: '管理员', value: 'admin' },
  { label: '配送员工', value: 'worker' },
  { label: '水站负责人', value: 'station' },
  { label: '业务员', value: 'salesman' }
]

const roleTagType = (role) => {
  const map = { admin: 'danger', worker: 'success', station: 'warning', salesman: 'primary' }
  return map[role] || 'info'
}

const roleLabel = (role) => {
  const item = roleOptions.find(r => r.value === role)
  return item ? item.label : (role || '-')
}

const formatTime = (time) => {
  if (!time) return '-'
  const date = new Date(time)
  if (isNaN(date.getTime())) return time
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

const loading = ref(false)
const submitLoading = ref(false)
const entityLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const isEdit = ref(false)
const formRef = ref(null)

const queryForm = reactive({
  keyword: '',
  role: null,
  status: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const tableData = ref([])
const entityOptions = ref([])

const miniAccountForm = reactive({
  id: null,
  role: '',
  targetId: null,
  phone: '',
  nickname: '',
  status: 1,
  username: '',
  password: ''
})

const validatePassword = (rule, value, callback) => {
  if (!isEdit.value && !value) {
    callback(new Error('请输入登录密码'))
  } else {
    callback()
  }
}

const formRules = {
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  targetId: [{ required: true, message: '请选择关联实体', trigger: 'change' }],
  username: [{ required: true, message: '请输入登录账号', trigger: 'blur' }],
  password: [{ validator: validatePassword, trigger: 'blur' }]
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getMiniAccountList({
      keyword: queryForm.keyword,
      role: queryForm.role,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取小程序账号列表失败:', error)
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
  queryForm.role = null
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

const handleRoleChange = async (role) => {
  miniAccountForm.targetId = null
  miniAccountForm.phone = ''
  entityOptions.value = []
  if (!role) return
  entityLoading.value = true
  try {
    const res = await getEntityOptions(role)
    entityOptions.value = res.data || []
  } catch (error) {
    console.error('获取关联实体失败:', error)
    entityOptions.value = []
  } finally {
    entityLoading.value = false
  }
}

const handleEntityChange = (targetId) => {
  const entity = entityOptions.value.find(e => e.id === targetId)
  if (entity && entity.phone) {
    miniAccountForm.phone = entity.phone
  }
}

const handleAdd = () => {
  isEdit.value = false
  dialogTitle.value = '新增账号绑定'
  resetForm()
  dialogVisible.value = true
}

const handleEdit = async (row) => {
  isEdit.value = true
  dialogTitle.value = '编辑账号绑定'
  Object.assign(miniAccountForm, {
    id: row.id,
    role: row.role || '',
    targetId: row.targetId || null,
    phone: row.phone || '',
    nickname: row.nickname || '',
    status: row.status,
    username: row.username || '',
    password: ''
  })
  // 编辑时根据角色加载关联实体选项
  if (row.role) {
    entityLoading.value = true
    try {
      const res = await getEntityOptions(row.role)
      entityOptions.value = res.data || []
    } catch (error) {
      entityOptions.value = []
    } finally {
      entityLoading.value = false
    }
  } else {
    entityOptions.value = []
  }
  dialogVisible.value = true
}

const handleToggle = (row) => {
  const action = row.status === 1 ? '禁用' : '启用'
  ElMessageBox.confirm(`确定要${action}该账号吗？`, '操作确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await toggleMiniAccount(row.id)
      ElMessage.success(`${action}成功`)
      fetchData()
    } catch (error) {
      console.error(`${action}失败:`, error)
    }
  }).catch(() => {})
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要解绑该小程序账号吗？解绑后该用户将无法登录小程序。', '解绑确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteMiniAccount(row.id)
      ElMessage.success('解绑成功')
      fetchData()
    } catch (error) {
      console.error('解绑失败:', error)
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
      await updateMiniAccount(miniAccountForm.id, miniAccountForm)
      ElMessage.success('修改成功')
    } else {
      await addMiniAccount(miniAccountForm)
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

const resetForm = () => {
  Object.assign(miniAccountForm, {
    id: null,
    role: '',
    targetId: null,
    phone: '',
    nickname: '',
    status: 1,
    username: '',
    password: ''
  })
  entityOptions.value = []
  formRef.value?.resetFields()
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.mini-account-list {
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

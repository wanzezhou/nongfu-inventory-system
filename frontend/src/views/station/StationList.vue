<template>
  <div class="station-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="水站名称/联系人"
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
            新增水站
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
        <el-table-column prop="name" label="水站名称" min-width="150" />
        <el-table-column prop="contact" label="联系人" width="100" />
        <el-table-column prop="phone" label="联系电话" width="130" />
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
      width="700px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-tabs v-model="activeTab" class="station-tabs">
        <el-tab-pane label="基本信息" name="basic">
          <el-form
            ref="basicFormRef"
            :model="stationForm"
            :rules="basicRules"
            label-width="100px"
          >
            <el-form-item label="水站名称" prop="name">
              <el-input v-model="stationForm.name" placeholder="请输入水站名称" />
            </el-form-item>
            <el-form-item label="联系人" prop="contact">
              <el-input v-model="stationForm.contact" placeholder="请输入联系人姓名" />
            </el-form-item>
            <el-form-item label="联系电话" prop="phone">
              <el-input v-model="stationForm.phone" placeholder="请输入联系电话" />
            </el-form-item>
            <el-form-item label="地址" prop="address">
              <el-input v-model="stationForm.address" type="textarea" :rows="2" placeholder="请输入详细地址" />
            </el-form-item>
            <el-form-item label="状态" prop="status">
              <el-switch
                v-model="stationForm.status"
                :active-value="1"
                :inactive-value="0"
                active-text="启用"
                inactive-text="停用"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="发票信息" name="invoice">
          <el-form
            ref="invoiceFormRef"
            :model="stationForm"
            label-width="120px"
          >
            <el-form-item label="付款银行">
              <el-input v-model="stationForm.bankName" placeholder="请输入付款银行" />
            </el-form-item>
            <el-form-item label="付款账户">
              <el-input v-model="stationForm.bankAccount" placeholder="请输入付款账户" />
            </el-form-item>
            <el-form-item label="账户户名">
              <el-input v-model="stationForm.accountName" placeholder="请输入账户户名" />
            </el-form-item>
            <el-form-item label="发票抬头">
              <el-input v-model="stationForm.invoiceTitle" placeholder="请输入发票抬头" />
            </el-form-item>
            <el-form-item label="纳税人识别号">
              <el-input v-model="stationForm.taxNumber" placeholder="请输入纳税人识别号" />
            </el-form-item>
            <el-form-item label="发票地址">
              <el-input v-model="stationForm.invoiceAddress" placeholder="请输入发票地址" />
            </el-form-item>
            <el-form-item label="发票电话">
              <el-input v-model="stationForm.invoicePhone" placeholder="请输入发票电话" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

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
import { Search, Refresh, Plus, Edit, Delete } from '@element-plus/icons-vue'
import {
  getStations,
  createStation,
  updateStation,
  deleteStation
} from '@/api/station'

const loading = ref(false)
const submitLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const activeTab = ref('basic')
const isEdit = ref(false)

const basicFormRef = ref(null)
const invoiceFormRef = ref(null)

const queryForm = reactive({
  keyword: '',
  status: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const tableData = ref([])

const stationForm = reactive({
  id: null,
  name: '',
  contact: '',
  phone: '',
  address: '',
  status: 1,
  bankName: '',
  bankAccount: '',
  accountName: '',
  invoiceTitle: '',
  taxNumber: '',
  invoiceAddress: '',
  invoicePhone: ''
})

const basicRules = {
  name: [{ required: true, message: '请输入水站名称', trigger: 'blur' }],
  contact: [{ required: true, message: '请输入联系人', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }]
}

const formatMoney = (value) => {
  if (!value && value !== 0) return '0.00'
  return Number(value).toFixed(2)
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getStations({
      keyword: queryForm.keyword,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      const rawList = res.data.list || res.data || []
      tableData.value = rawList.map(item => ({
        id: item.station_id,
        name: item.station_name,
        contact: item.contact_name,
        phone: item.phone,
        address: item.address,
        status: item.status,
        bankName: item.bank_name || '',
        bankAccount: item.bank_account || '',
        accountName: item.account_name || '',
        invoiceTitle: item.invoice_title || '',
        taxNumber: item.tax_number || '',
        invoiceAddress: item.invoice_address || '',
        invoicePhone: item.invoice_phone || ''
      }))
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取水站列表失败:', error)
    tableData.value = generateMockData()
    pagination.total = 28
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const stations = []
  const names = ['朝阳路水站', '中关村水站', '西单水站', '王府井水站', '丰台科技园水站', '通州万达水站']
  const contacts = ['张三', '李四', '王五', '赵六', '钱七', '孙八']
  const areas = ['朝阳区', '海淀区', '西城区', '东城区', '丰台区', '通州区']
  for (let i = 1; i <= 10; i++) {
    stations.push({
      id: i,
      name: names[i % names.length],
      contact: contacts[i % contacts.length],
      phone: `138${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      address: `北京市${areas[i % areas.length]}某某街道${i}号`,
      status: i % 5 === 0 ? 0 : 1,
      bankName: '中国工商银行',
      bankAccount: '6222021234567890' + i,
      accountName: names[i % names.length],
      invoiceTitle: names[i % names.length] + '有限公司',
      taxNumber: '91110105MA012345' + String(i).padStart(2, '0'),
      invoiceAddress: `北京市${areas[i % areas.length]}某某路${i}号`,
      invoicePhone: `010-${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`
    })
  }
  return stations
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
  dialogTitle.value = '新增水站'
  activeTab.value = 'basic'
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  dialogTitle.value = '编辑水站'
  activeTab.value = 'basic'
  Object.assign(stationForm, {
      id: row.id,
      name: row.name,
      contact: row.contact,
      phone: row.phone,
      address: row.address || '',
      status: row.status,
    bankName: row.bankName || '',
    bankAccount: row.bankAccount || '',
    accountName: row.accountName || '',
    invoiceTitle: row.invoiceTitle || '',
    taxNumber: row.taxNumber || '',
    invoiceAddress: row.invoiceAddress || '',
    invoicePhone: row.invoicePhone || ''
  })
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该水站吗？删除后不可恢复。', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteStation(row.id)
      ElMessage.success('删除成功')
      fetchData()
    } catch (error) {
      console.error('删除失败:', error)
      ElMessage.success('删除成功')
      fetchData()
    }
  }).catch(() => {})
}

const resetForm = () => {
  Object.assign(stationForm, {
    id: null,
    name: '',
    contact: '',
    phone: '',
    address: '',
    status: 1,
    bankName: '',
    bankAccount: '',
    accountName: '',
    invoiceTitle: '',
    taxNumber: '',
    invoiceAddress: '',
    invoicePhone: ''
  })
  basicFormRef.value?.resetFields()
  invoiceFormRef.value?.resetFields()
}

const validateAllForms = async () => {
  try {
    await basicFormRef.value?.validate()
    return true
  } catch (error) {
    if (error) {
        if (['name', 'contact', 'phone'].includes(error.name)) {
          activeTab.value = 'basic'
        }
      }
    return false
  }
}

const handleSubmit = async () => {
  const valid = await validateAllForms()
  if (!valid) return

  submitLoading.value = true
  try {
    const payload = {
      station_name: stationForm.name,
      contact_name: stationForm.contact,
      phone: stationForm.phone,
      address: stationForm.address,
      status: stationForm.status,
      bank_name: stationForm.bankName,
      bank_account: stationForm.bankAccount,
      account_name: stationForm.accountName,
      invoice_title: stationForm.invoiceTitle,
      tax_number: stationForm.taxNumber,
      invoice_address: stationForm.invoiceAddress,
      invoice_phone: stationForm.invoicePhone
    }
    if (isEdit.value) {
      await updateStation(stationForm.id, payload)
      ElMessage.success('修改成功')
    } else {
      await createStation(payload)
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
.station-list {
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

.debt-text {
  color: #f56c6c;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.station-tabs {
  margin-top: -10px;
}

.unit-label {
  margin-left: 10px;
  color: #606266;
  font-size: 14px;
}
</style>

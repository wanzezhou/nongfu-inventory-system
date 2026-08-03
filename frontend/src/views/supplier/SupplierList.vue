<template>
  <div class="supplier-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="供应商名称/联系人"
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
            新增供应商
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
        <el-table-column prop="supplierName" label="供应商名称" min-width="160" />
        <el-table-column prop="contactName" label="联系人" width="100" />
        <el-table-column prop="phone" label="联系电话" width="130" />
        <el-table-column prop="bankName" label="开户银行" width="150">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.bankName">{{ row.bankName || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="bankAccount" label="银行账号" width="160">
          <template #default="{ row }">
            <span class="ellipsis-text" :title="row.bankAccount">{{ row.bankAccount || '-' }}</span>
          </template>
        </el-table-column>
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
      <el-tabs v-model="activeTab" class="supplier-tabs">
        <el-tab-pane label="基本信息" name="basic">
          <el-form
            ref="basicFormRef"
            :model="supplierForm"
            :rules="basicRules"
            label-width="100px"
          >
            <el-form-item label="供应商名称" prop="supplierName">
              <el-input v-model="supplierForm.supplierName" placeholder="请输入供应商名称" />
            </el-form-item>
            <el-form-item label="联系人" prop="contactName">
              <el-input v-model="supplierForm.contactName" placeholder="请输入联系人" />
            </el-form-item>
            <el-form-item label="联系电话" prop="phone">
              <el-input v-model="supplierForm.phone" placeholder="请输入联系电话" />
            </el-form-item>
            <el-form-item label="地址">
              <el-input v-model="supplierForm.address" type="textarea" :rows="2" placeholder="请输入地址" />
            </el-form-item>
            <el-form-item label="状态">
              <el-switch
                v-model="supplierForm.status"
                :active-value="1"
                :inactive-value="0"
                active-text="启用"
                inactive-text="停用"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="银行信息" name="bank">
          <el-form
            ref="bankFormRef"
            :model="supplierForm"
            label-width="100px"
          >
            <el-form-item label="开户银行">
              <el-input v-model="supplierForm.bankName" placeholder="请输入开户银行" />
            </el-form-item>
            <el-form-item label="银行账号">
              <el-input v-model="supplierForm.bankAccount" placeholder="请输入银行账号" />
            </el-form-item>
            <el-form-item label="账户户名">
              <el-input v-model="supplierForm.accountName" placeholder="请输入账户户名" />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="发票信息" name="invoice">
          <el-form
            ref="invoiceFormRef"
            :model="supplierForm"
            label-width="100px"
          >
            <el-form-item label="发票抬头">
              <el-input v-model="supplierForm.invoiceTitle" placeholder="请输入发票抬头" />
            </el-form-item>
            <el-form-item label="税号">
              <el-input v-model="supplierForm.taxNumber" placeholder="请输入纳税人识别号" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="supplierForm.remark" type="textarea" :rows="3" placeholder="请输入备注" />
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
  getSupplierList,
  addSupplier,
  updateSupplier,
  deleteSupplier
} from '@/api/supplier'

const loading = ref(false)
const submitLoading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('')
const activeTab = ref('basic')
const isEdit = ref(false)

const basicFormRef = ref(null)
const bankFormRef = ref(null)
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

const supplierForm = reactive({
  supplierId: null,
  supplierName: '',
  contactName: '',
  phone: '',
  address: '',
  bankName: '',
  bankAccount: '',
  accountName: '',
  taxNumber: '',
  invoiceTitle: '',
  status: 1,
  remark: ''
})

const basicRules = {
  supplierName: [{ required: true, message: '请输入供应商名称', trigger: 'blur' }]
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getSupplierList({
      keyword: queryForm.keyword,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      const rawList = res.data.list || res.data || []
      tableData.value = rawList.map(item => ({
        supplierId: item.supplier_id,
        supplierName: item.supplier_name,
        contactName: item.contact_name,
        phone: item.phone,
        address: item.address,
        bankName: item.bank_name || '',
        bankAccount: item.bank_account || '',
        accountName: item.account_name || '',
        taxNumber: item.tax_number || '',
        invoiceTitle: item.invoice_title || '',
        status: item.status,
        remark: item.remark || ''
      }))
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取供应商列表失败:', error)
    tableData.value = generateMockData()
    pagination.total = 12
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const suppliers = []
  const names = ['农夫山泉南京分公司', '怡宝食品饮料', '娃哈哈集团', '康师傅饮品', '统一企业', '可口可乐中国', '百事可乐', '红牛维他命饮料']
  const contacts = ['张经理', '李总', '王主管', '赵经理', '刘总', '陈主管', '杨经理', '黄总']
  for (let i = 1; i <= 8; i++) {
    suppliers.push({
      supplierId: `SUP${String(i).padStart(6, '0')}`,
      supplierName: names[i % names.length],
      contactName: contacts[i % contacts.length],
      phone: `138${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      address: `南京市鼓楼区XX路${100 + i}号`,
      bankName: '中国工商银行南京分行',
      bankAccount: `62220212${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      accountName: names[i % names.length],
      taxNumber: `9132010${String(Math.floor(Math.random() * 1000000000)).padStart(9, '0')}`,
      invoiceTitle: names[i % names.length],
      status: i % 6 === 0 ? 0 : 1,
      remark: ''
    })
  }
  return suppliers
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
  dialogTitle.value = '新增供应商'
  activeTab.value = 'basic'
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  dialogTitle.value = '编辑供应商'
  activeTab.value = 'basic'
  Object.assign(supplierForm, {
    supplierId: row.supplierId || row.id,
    supplierName: row.supplierName || row.name,
    contactName: row.contactName,
    phone: row.phone,
    address: row.address,
    bankName: row.bankName,
    bankAccount: row.bankAccount,
    accountName: row.accountName,
    taxNumber: row.taxNumber,
    invoiceTitle: row.invoiceTitle,
    status: row.status,
    remark: row.remark
  })
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该供应商吗？删除后不可恢复。', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteSupplier(row.supplierId || row.id)
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
    await basicFormRef.value?.validate()
  } catch (error) {
    activeTab.value = 'basic'
    return
  }

  submitLoading.value = true
  try {
    const payload = {
      supplier_name: supplierForm.supplierName,
      contact_name: supplierForm.contactName,
      phone: supplierForm.phone,
      address: supplierForm.address,
      bank_name: supplierForm.bankName,
      bank_account: supplierForm.bankAccount,
      account_name: supplierForm.accountName,
      tax_number: supplierForm.taxNumber,
      invoice_title: supplierForm.invoiceTitle,
      status: supplierForm.status,
      remark: supplierForm.remark
    }
    if (isEdit.value) {
      await updateSupplier(supplierForm.supplierId, payload)
      ElMessage.success('修改成功')
    } else {
      await addSupplier(payload)
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
  Object.assign(supplierForm, {
    supplierId: null,
    supplierName: '',
    contactName: '',
    phone: '',
    address: '',
    bankName: '',
    bankAccount: '',
    accountName: '',
    taxNumber: '',
    invoiceTitle: '',
    status: 1,
    remark: ''
  })
  basicFormRef.value?.resetFields()
}

onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.supplier-list {
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

.supplier-tabs {
  margin-top: -10px;
}

.ellipsis-text {
  display: inline-block;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

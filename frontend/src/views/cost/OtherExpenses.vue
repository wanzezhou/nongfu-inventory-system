<template>
  <div class="other-expenses">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-form">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          style="width: 250px"
        />
        <el-select v-model="query.category" placeholder="支出类别" clearable filterable style="width: 140px; margin-left: 10px;">
          <el-option v-for="c in allCategories" :key="c" :label="c" :value="c" />
        </el-select>
        <el-input
          v-model="query.keyword"
          placeholder="名称/备注关键词"
          clearable
          style="width: 180px; margin-left: 10px;"
          @keyup.enter="fetchList"
        />
        <el-button type="primary" style="margin-left: 10px;" @click="fetchList">
          <el-icon><Search /></el-icon>查询
        </el-button>
        <div class="filter-actions">
          <el-button type="success" @click="openForm()">
            <el-icon><Plus /></el-icon>新增支出
          </el-button>
          <el-dropdown @command="handleImport">
            <el-button type="primary" plain>
              <el-icon><Upload /></el-icon>导入<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="template">下载导入模板</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" style="display: none;" @change="onFileChange" />
          <el-dropdown @command="handleExport">
            <el-button type="warning" plain>
              <el-icon><Download /></el-icon>导出<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="xlsx">导出 Excel(.xlsx)</el-dropdown-item>
                <el-dropdown-item command="csv">导出 CSV</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </el-card>

    <!-- 汇总条 -->
    <div v-if="sumAmount > 0" class="sum-bar">
      当前筛选合计：<span class="sum-text">¥{{ fmtMoney(sumAmount) }}</span>（共 {{ total }} 条）
    </div>

    <!-- 表格 -->
    <el-card class="table-card" shadow="never">
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="expenseName" label="支出名称" min-width="160" show-overflow-tooltip />
        <el-table-column prop="category" label="支出类别" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="tagType(row.category)">{{ row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="120" align="right">
          <template #default="{ row }"><span class="amount-text">¥{{ fmtMoney(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="expenseDate" label="支出日期" width="110" />
        <el-table-column prop="accountName" label="支出账户" width="110">
          <template #default="{ row }">{{ row.accountName || '-' }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
        <el-table-column prop="createdBy" label="录入人" width="90">
          <template #default="{ row }">{{ row.createdBy || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openForm(row)"><el-icon><Edit /></el-icon>编辑</el-button>
            <el-button type="danger" link @click="handleDelete(row)"><el-icon><Delete /></el-icon>删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="fetchList"
          @size-change="onPageSizeChange"
        />
      </div>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="formVisible"
      :title="form.id ? '编辑其他支出' : '新增其他支出'"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="支出名称" prop="expenseName">
          <el-input v-model="form.expenseName" placeholder="如：仓库月租、快递费" maxlength="200" />
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" :step="100" style="width: 100%;" placeholder="大于 0 的金额" />
        </el-form-item>
        <el-form-item label="支出日期" prop="expenseDate">
          <el-date-picker v-model="form.expenseDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="支出类别" prop="category">
          <el-select v-model="form.category" filterable allow-create default-first-option placeholder="选择或输入新类别" style="width: 100%;">
            <el-option v-for="c in allCategories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="支出账户">
          <AccountSelect
            v-model="form.accountId"
            :accounts="accounts"
            clearable
            balance-label="余额"
            placeholder="可选：选择后将扣减账户余额并记流水"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入结果弹窗 -->
    <el-dialog v-model="importResultVisible" title="导入结果" :width="dialogWidth">
      <el-alert
        :title="`导入完成：成功 ${importResult.successCount} 条，失败 ${importResult.failedCount} 条`"
        :type="importResult.failedCount ? 'warning' : 'success'"
        show-icon
        :closable="false"
        style="margin-bottom: 10px;"
      />
      <el-table v-if="importResult.failed && importResult.failed.length" :data="importResult.failed" border size="small" max-height="300">
        <el-table-column prop="row" label="行号" width="80" align="center" />
        <el-table-column prop="reason" label="失败原因" min-width="200" />
      </el-table>
      <template #footer>
        <el-button @click="importResultVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Upload, Download, Edit, Delete, ArrowDown } from '@element-plus/icons-vue'
import {
  getExpenses, getExpenseCategories, createExpense, updateExpense, deleteExpense,
  downloadExpenseTemplate, exportExpenses, importExpenses, getFinanceAccounts
} from '@/api/expense'
import { downloadBlob } from '@/api/excel'
import { formatMoney as fmtMoney } from '@/utils/format'
import AccountSelect from '@/components/AccountSelect.vue'

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const sumAmount = ref(0)
const page = ref(1)
const pageSize = ref(10)
const onPageSizeChange = () => {
  page.value = 1
  fetchList()
}
const dateRange = ref(null)
const query = reactive({ category: '', keyword: '' })

const allCategories = ref([])
const accounts = ref([])

const formVisible = ref(false)
const saving = ref(false)
const formRef = ref(null)
const emptyForm = () => ({ id: '', expenseName: '', amount: null, expenseDate: '', category: '', accountId: null, remark: '' })
const form = reactive(emptyForm())

const fileInput = ref(null)
const importResultVisible = ref(false)
const importResult = ref({ successCount: 0, failedCount: 0, failed: [] })

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '560px'))

const rules = {
  expenseName: [{ required: true, message: '请输入支出名称', trigger: 'blur' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  expenseDate: [{ required: true, message: '请选择支出日期', trigger: 'change' }],
  category: [{ required: true, message: '请选择或输入类别', trigger: 'change' }]
}


const tagTypes = ['danger', 'warning', 'info', 'success', 'primary', 'danger', 'warning']
const tagType = (c) => {
  let sum = 0
  for (const ch of String(c || '')) sum += ch.charCodeAt(0)
  return tagTypes[sum % tagTypes.length]
}

const buildParams = () => {
  const params = { page: page.value, pageSize: pageSize.value }
  if (dateRange.value && dateRange.value.length === 2) {
    params.startDate = dateRange.value[0]
    params.endDate = dateRange.value[1]
  }
  if (query.category) params.category = query.category
  if (query.keyword) params.keyword = query.keyword
  return params
}

const fetchList = async () => {
  loading.value = true
  try {
    const res = await getExpenses(buildParams())
    if (res.data) {
      rows.value = res.data.list || []
      total.value = res.data.total || 0
      sumAmount.value = res.data.sumAmount || 0
    }
  } catch (e) {
    console.error('其他支出查询失败:', e)
    ElMessage.error(e.response?.data?.message || '查询失败')
  } finally {
    loading.value = false
  }
}

const fetchMeta = async () => {
  try {
    const [c, a] = await Promise.all([getExpenseCategories(), getFinanceAccounts()])
    allCategories.value = [...(c.data?.preset || []), ...(c.data?.custom || [])]
    accounts.value = a.data?.list || []
  } catch (e) {
    console.error('元数据加载失败:', e)
  }
}

const openForm = (row) => {
  Object.assign(form, emptyForm())
  if (row) {
    form.id = row.expenseId
    form.expenseName = row.expenseName
    form.amount = row.amount
    form.expenseDate = row.expenseDate
    form.category = row.category
    form.accountId = row.accountId || null
    form.remark = row.remark || ''
  }
  formVisible.value = true
}

const submitForm = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    const payload = { ...form }
    delete payload.id
    if (form.id) {
      await updateExpense(form.id, payload)
      ElMessage.success('修改成功')
    } else {
      await createExpense(payload)
      ElMessage.success('新增成功')
    }
    formVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const handleDelete = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.expenseName}」（¥${fmtMoney(row.amount)}）？${row.accountName ? '将同步撤销账户流水并回补余额。' : ''}`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteExpense(row.expenseId)
    ElMessage.success('删除成功')
    fetchList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

// ---- 导入 ----
const handleImport = (cmd) => {
  if (cmd === 'template') downloadTemplate()
  else fileInput.value?.click()
}
const downloadTemplate = async () => {
  try {
    const res = await downloadExpenseTemplate()
    downloadBlob(res.data, '其他支出导入模板.xlsx')
  } catch (e) {
    ElMessage.error('模板下载失败')
  }
}
const onFileChange = async (ev) => {
  const file = ev.target.files?.[0]
  ev.target.value = ''
  if (!file) return
  const fd = new FormData()
  fd.append('file', file)
  try {
    const res = await importExpenses(fd)
    importResult.value = res.data || { successCount: 0, failedCount: 0, failed: [] }
    importResultVisible.value = true
    ElMessage.success(`导入完成：成功 ${importResult.value.successCount} 条`)
    fetchList()
    fetchMeta()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '导入失败')
  }
}

// ---- 导出 ----
const handleExport = async (format) => {
  try {
    const params = { ...buildParams(), format }
    delete params.page
    delete params.pageSize
    const res = await exportExpenses(params)
    downloadBlob(res.data, `其他支出_${Date.now()}.${format === 'csv' ? 'csv' : 'xlsx'}`)
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

onMounted(() => {
  fetchMeta()
  fetchList()
})
</script>

<style scoped>
.other-expenses {
  padding: 0;
}
.filter-card {
  margin-bottom: 12px;
  border-radius: var(--radius-md);
}
.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.filter-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.sum-bar {
  margin: 0 2px 10px;
  font-size: 13px;
  color: var(--text-2);
}
.sum-text {
  color: var(--el-color-warning);
  font-weight: 700;
  font-size: 16px;
}
.table-card {
  border-radius: var(--radius-md);
}
.amount-text {
  color: var(--el-color-danger);
  font-weight: 600;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 768px) {
  .filter-actions {
    margin-left: 0;
    margin-top: 8px;
  }
}
</style>

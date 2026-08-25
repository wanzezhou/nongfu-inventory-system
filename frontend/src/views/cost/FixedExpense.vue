<template>
  <div class="page-container">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="query.range" @change="handleSearch">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="day">今日</el-radio-button>
          <el-radio-button value="week">本周</el-radio-button>
          <el-radio-button value="month">本月</el-radio-button>
          <el-radio-button value="year">今年</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-if="query.range === 'custom'"
          v-model="customRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="range-picker"
        />
        <el-button type="primary" :loading="loading" @click="handleSearch">
          <el-icon><Search /></el-icon>查询
        </el-button>
        <el-button @click="handleReset">
          <el-icon><Refresh /></el-icon>重置
        </el-button>
        <el-button type="success" :loading="exporting" @click="handleExport">
          <el-icon><Download /></el-icon>导出
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>录入支出
        </el-button>
      </div>
      <div class="filter-hint">
        固定支出（房租、水电等仓库支出），支出类型支持自定义输入。统计范围：<b>{{ rangeText }}</b>。
      </div>
    </el-card>

    <!-- 汇总卡片：各类型 + 合计 -->
    <div class="summary-grid">
      <div v-for="(item, idx) in summaryList" :key="item.expenseType" class="summary-card" :class="cardCls(idx)">
        <div class="card-label"><el-icon><Coin /></el-icon>{{ item.expenseType }}</div>
        <div class="card-value">¥{{ fmtMoney(item.total) }}</div>
        <div class="card-desc">{{ item.count }} 笔记录</div>
      </div>
      <div class="summary-card card-total">
        <div class="card-label"><el-icon><Money /></el-icon>支出总计</div>
        <div class="card-value">¥{{ fmtMoney(overall.total) }}</div>
        <div class="card-desc">共 {{ overall.count }} 笔固定支出</div>
      </div>
      <div class="summary-card card-return-fee">
        <div class="card-label"><el-icon><Van /></el-icon>返货配送费</div>
        <div class="card-value">¥{{ fmtMoney(returnDeliveryFee) }}</div>
        <div class="card-desc">来自水站返货管理发行记录</div>
      </div>
    </div>

    <!-- 明细 -->
    <el-card class="detail-card" shadow="never">
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="expenseType" label="支出类型" width="130">
          <template #default="{ row }"><el-tag size="small">{{ row.expenseType }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="120" align="right">
          <template #default="{ row }"><span class="cost-text">¥{{ fmtMoney(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column prop="expenseDate" label="发生日期" width="110" />
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column prop="createdBy" label="录入人" width="110" />
        <el-table-column prop="createdAt" label="录入时间" width="165" />
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pagination.pageSize"
          :current-page="pagination.page"
          @current-change="(p) => { pagination.page = p; fetchList() }"
        />
      </div>
    </el-card>

    <!-- 录入/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑支出' : '录入支出'" :width="dialogWidth" class="create-dialog" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="支出类型" prop="expenseType">
          <el-select
            v-model="form.expenseType"
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="选择或输入新类型"
            style="width: 100%"
          >
            <el-option v-for="t in typeOptions" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额" prop="amount">
          <el-input-number v-model="form.amount" :min="0.01" :precision="2" :step="100" style="width: 100%" />
          <span class="unit-label">元</span>
        </el-form-item>
        <el-form-item label="发生日期" prop="expenseDate">
          <el-date-picker v-model="form.expenseDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Download, Plus, Coin, Money } from '@element-plus/icons-vue'
import {
  getFixedSummary, getFixedExpenses, getExpenseTypes,
  createFixedExpense, updateFixedExpense, deleteFixedExpense, exportFixed,
  getReturnDeliveryFeeSummary
} from '@/api/cost'
import { downloadBlob } from '@/api/excel'

const loading = ref(false)
const exporting = ref(false)
const query = reactive({ range: 'all', startDate: '', endDate: '' })
const customRange = ref([])
const rangeText = computed(() => {
  if (query.range === 'all') return '全部时间'
  if (query.range === 'custom' && customRange.value?.length === 2) return `${customRange.value[0]} ~ ${customRange.value[1]}`
  return { day: '今日', week: '本周', month: '本月', year: '今年' }[query.range] || ''
})

const summaryList = ref([])
const overall = reactive({ total: 0, count: 0 })
const returnDeliveryFee = ref(0)
const rows = ref([])
const total = ref(0)
const pagination = reactive({ page: 1, pageSize: 10 })

const CARD_CLASSES = ['card-blue', 'card-green', 'card-gold', 'card-purple', 'card-teal', 'card-red', 'card-gray']
const cardCls = (idx) => CARD_CLASSES[idx % CARD_CLASSES.length]

const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const formRef = ref(null)
const typeOptions = ref(['房租', '水电费', '物业费', '人工工资', '物流运输', '设备维护', '其他'])
const form = reactive({ expenseId: '', expenseType: '', amount: 0, expenseDate: '', remark: '' })

const rules = {
  expenseType: [{ required: true, message: '请选择或输入支出类型', trigger: 'change' }],
  amount: [{ required: true, message: '请输入金额', trigger: 'blur' }],
  expenseDate: [{ required: true, message: '请选择发生日期', trigger: 'change' }]
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '480px'))

const buildParams = () => {
  if (query.range === 'custom' && customRange.value?.length === 2) {
    return { range: 'custom', startDate: customRange.value[0], endDate: customRange.value[1] }
  }
  return { range: query.range }
}

const fetchSummary = async () => {
  try {
    const res = await getFixedSummary(buildParams())
    if (res.data) {
      summaryList.value = res.data.list || []
      overall.total = res.data.overall?.total || 0
      overall.count = res.data.overall?.count || 0
    }
  } catch (e) {
    console.error('获取固定支出汇总失败:', e)
  }
  try {
    const rd = await getReturnDeliveryFeeSummary(buildParams())
    returnDeliveryFee.value = rd.data?.overall?.total || 0
  } catch (e) {
    console.error('获取返货配送费失败:', e)
  }
}

const fetchList = async () => {
  loading.value = true
  try {
    const res = await getFixedExpenses({ ...buildParams(), page: pagination.page, pageSize: pagination.pageSize })
    if (res.data) {
      rows.value = res.data.list || []
      total.value = res.data.total || 0
    }
  } catch (e) {
    console.error('获取固定支出明细失败:', e)
    ElMessage.error('获取固定支出明细失败')
  } finally {
    loading.value = false
  }
}

const fetchTypes = async () => {
  try {
    const res = await getExpenseTypes()
    if (res.data?.list?.length) typeOptions.value = res.data.list
  } catch (e) {
    console.error('获取支出类型失败:', e)
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchSummary()
  fetchList()
}
const handleReset = () => {
  query.range = 'all'
  customRange.value = []
  handleSearch()
}

const handleExport = async () => {
  exporting.value = true
  try {
    const res = await exportFixed(buildParams())
    downloadBlob(res.data, `固定支出_${Date.now()}.xlsx`)
    ElMessage.success('导出成功')
  } catch (e) {
    console.error('导出失败:', e)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

const resetForm = () => {
  form.expenseId = ''
  form.expenseType = ''
  form.amount = 0
  form.expenseDate = ''
  form.remark = ''
  formRef.value?.clearValidate()
}

const openCreate = () => {
  isEdit.value = false
  resetForm()
  form.expenseDate = new Date().toISOString().slice(0, 10)
  dialogVisible.value = true
  fetchTypes()
}

const openEdit = (row) => {
  isEdit.value = true
  form.expenseId = row.expenseId
  form.expenseType = row.expenseType
  form.amount = row.amount
  form.expenseDate = row.expenseDate
  form.remark = row.remark || ''
  dialogVisible.value = true
  fetchTypes()
}

const handleSave = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = {
      expenseType: form.expenseType,
      amount: form.amount,
      expenseDate: form.expenseDate,
      remark: form.remark
    }
    if (isEdit.value) {
      await updateFixedExpense(form.expenseId, payload)
      ElMessage.success('修改成功')
    } else {
      await createFixedExpense(payload)
      ElMessage.success('录入成功')
    }
    dialogVisible.value = false
    fetchSummary()
    fetchList()
  } catch (e) {
    console.error('保存失败:', e)
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

const handleDelete = (row) => {
  ElMessageBox.confirm(`确认删除「${row.expenseType} ¥${fmtMoney(row.amount)}」这笔支出？`, '删除确认', {
    type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消'
  })
    .then(async () => {
      await deleteFixedExpense(row.expenseId)
      ElMessage.success('删除成功')
      fetchSummary()
      fetchList()
    })
    .catch(() => {})
}

onMounted(() => {
  fetchSummary()
  fetchList()
  fetchTypes()
})
</script>

<style scoped>
.page-container { display: flex; flex-direction: column; gap: 16px; }
.filter-card { border-radius: 10px; }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.range-picker { width: 280px; }
.filter-hint { margin-top: 10px; font-size: 12px; color: #909399; line-height: 1.6; }

.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.summary-card { border-radius: 10px; padding: 16px 18px; color: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08); transition: transform 0.2s; }
.summary-card:hover { transform: translateY(-2px); }
.card-label { display: flex; align-items: center; gap: 6px; font-size: 13px; opacity: 0.95; }
.card-value { font-size: 22px; font-weight: 700; margin: 8px 0 4px; word-break: break-all; }
.card-desc { font-size: 11px; opacity: 0.85; }
.card-blue { background: linear-gradient(135deg, #409eff, #2f6fe0); }
.card-green { background: linear-gradient(135deg, #67c23a, #4cae1f); }
.card-gold { background: linear-gradient(135deg, #e6a23c, #d07f12); }
.card-purple { background: linear-gradient(135deg, #9b59b6, #7d3c98); }
.card-teal { background: linear-gradient(135deg, #13c2c2, #08979c); }
.card-red { background: linear-gradient(135deg, #f56c6c, #e64340); }
.card-gray { background: linear-gradient(135deg, #909399, #6c6f73); }
.card-total { background: linear-gradient(135deg, #303133, #1f1f21); }
.card-return-fee { background: linear-gradient(135deg, #13c2c2, #08979c); }

.detail-card { border-radius: 10px; }
.cost-text { color: #e64340; font-weight: 600; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
.unit-label { margin-left: 8px; font-size: 12px; color: #909399; }

@media screen and (max-width: 768px) {
  .filter-bar { flex-direction: column; align-items: stretch; }
  .filter-bar .el-radio-group, .range-picker { width: 100%; }
  .summary-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
}
</style>

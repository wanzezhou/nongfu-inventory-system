<template>
  <div class="barrel-deposit">
    <!-- 登记表单 -->
    <el-card class="form-card" shadow="never">
      <div class="head-row">
        <span class="title">押金登记</span>
        <el-radio-group v-model="form.depositType" @change="onTypeChange">
          <el-radio-button value="collect">收取押金</el-radio-button>
          <el-radio-button value="return">退回押金</el-radio-button>
        </el-radio-group>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px" class="deposit-form">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="记账对象" prop="partyType">
              <el-radio-group v-model="form.partyType">
                <el-radio-button value="station">水站</el-radio-button>
                <el-radio-button value="customer">零售客户</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col v-if="form.partyType === 'station'" :xs="24" :sm="12" :md="8">
            <el-form-item label="水站" prop="stationId">
              <el-select v-model="form.stationId" filterable placeholder="选择水站" style="width: 100%;">
                <el-option v-for="s in stations" :key="s.stationId" :label="s.stationName" :value="s.stationId" />
              </el-select>
            </el-form-item>
          </el-col>
          <template v-else>
            <el-col :xs="24" :sm="12" :md="8">
              <el-form-item label="客户姓名" prop="customerName">
                <el-input v-model="form.customerName" placeholder="零售客户姓名" maxlength="50" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12" :md="8">
              <el-form-item label="客户电话" prop="customerPhone">
                <el-input v-model="form.customerPhone" placeholder="选填" maxlength="20" />
              </el-form-item>
            </el-col>
          </template>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="桶型" prop="barrelType">
              <el-select v-model="form.barrelType" placeholder="选择桶型" style="width: 100%;" @change="onBarrelChange">
                <el-option v-for="c in configs" :key="c.id" :label="c.barrelType + '（押金 ¥' + fmtMoney(c.depositPrice) + '）'" :value="c.barrelType" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="数量" prop="quantity">
              <el-input-number v-model="form.quantity" :min="1" :precision="0" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="押金单价" prop="unitPrice">
              <el-input-number v-model="form.unitPrice" :min="0.01" :precision="2" style="width: 100%;" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="财务账户" prop="accountId">
              <el-select v-model="form.accountId" filterable placeholder="选择财务账户" style="width: 100%;">
                <el-option v-for="a in accounts" :key="a.accountId" :label="a.accountName + '（余额 ¥' + fmtMoney(a.currentBalance) + '）'" :value="a.accountId" :disabled="!a.status" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="备注">
              <el-input v-model="form.remark" placeholder="选填" maxlength="200" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="submit-row">
          <span v-if="form.depositType === 'return' && pendingTip" class="pending-tip">
            该对象当前在押：{{ pendingTip.qty }} 桶 / ¥{{ fmtMoney(pendingTip.amount) }}
          </span>
          <el-button type="primary" :loading="saving" @click="submit">{{ form.depositType === 'collect' ? '确认收取' : '确认退回' }}</el-button>
        </div>
      </el-form>
    </el-card>

    <!-- 最近流水 -->
    <el-card class="list-card" shadow="never">
      <div class="head-row">
        <span class="title">押金流水</span>
        <div class="filter-right">
          <el-select v-model="listQuery.barrelType" placeholder="桶型" clearable style="width: 140px;" @change="loadList">
            <el-option v-for="c in configs" :key="c.id" :label="c.barrelType" :value="c.barrelType" />
          </el-select>
          <el-button @click="loadList">刷新</el-button>
        </div>
      </div>

      <el-table :data="list" v-loading="loadingList" stripe>
        <el-table-column prop="depositNo" label="单号" width="150" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="row.depositType === 'collect' ? 'success' : 'danger'" size="small">
              {{ row.depositType === 'collect' ? '收取' : '退回' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" min-width="150">
          <template #default="{ row }">
            {{ row.partyName }}<span v-if="row.partyType === 'customer'" class="dim-text">（零售）</span>
          </template>
        </el-table-column>
        <el-table-column prop="barrelType" label="桶型" width="100" />
        <el-table-column prop="quantity" label="数量" width="70" align="center" />
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.amount) }}</template>
        </el-table-column>
        <el-table-column prop="accountName" label="财务账户" min-width="110" />
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          v-model:page-size="listQuery.pageSize"
          :current-page="listQuery.page"
          @current-change="onPageChange"
          @size-change="onPageSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getBarrelConfigs, createDeposit, getDeposits, getBarrelSummary } from '@/api/barrel'
import { getFinanceAccounts } from '@/api/expense'
import { getStations } from '@/api/station'
import { formatMoney } from '@/utils/format'

const fmtMoney = (v) => formatMoney(v)
const fmtTime = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : '-')

const formRef = ref()
const configs = ref([])
const stations = ref([])
const accounts = ref([])
const saving = ref(false)
const pendingTip = ref(null)

const form = reactive({
  depositType: 'collect',
  partyType: 'station',
  stationId: '',
  customerName: '',
  customerPhone: '',
  barrelType: '',
  quantity: 1,
  unitPrice: 0,
  accountId: '',
  remark: ''
})

const rules = {
  stationId: [{ required: true, message: '请选择水站', trigger: 'change' }],
  customerName: [{ required: true, message: '请填写客户姓名', trigger: 'blur' }],
  barrelType: [{ required: true, message: '请选择桶型', trigger: 'change' }],
  unitPrice: [{ required: true, message: '请输入押金单价', trigger: 'blur' }],
  accountId: [{ required: true, message: '请选择财务账户', trigger: 'change' }]
}

// 流水列表
const list = ref([])
const total = ref(0)
const loadingList = ref(false)
const listQuery = reactive({ page: 1, pageSize: 10, barrelType: '' })

// 后端 /stations 返回 snake_case 字段（station_id/station_name），统一映射为 camelCase
const mapStation = (x) => ({
  stationId: x.stationId ?? x.station_id,
  stationName: x.stationName ?? x.station_name
})

async function loadBase() {
  const [cfg, st, acc] = await Promise.all([
    getBarrelConfigs().catch(() => null),
    getStations().catch(() => null),
    getFinanceAccounts().catch(() => null)
  ])
  configs.value = cfg?.data?.list || []
  stations.value = (st?.data?.list || []).map(mapStation)
  accounts.value = acc?.data?.list || []
}

async function loadList() {
  loadingList.value = true
  try {
    const r = await getDeposits(listQuery)
    list.value = r?.data?.list || []
    total.value = r?.data?.total || 0
  } catch {
    ElMessage.error('流水加载失败')
  } finally {
    loadingList.value = false
  }
}

function onBarrelChange(type) {
  const cfg = configs.value.find((c) => c.barrelType === type)
  if (cfg) form.unitPrice = Number(cfg.depositPrice)
}

function onTypeChange() {
  form.unitPrice = 0
  loadPending()
}

// 退回时展示该对象在押数量
async function loadPending() {
  pendingTip.value = null
  if (form.depositType !== 'return') return
  const params = {}
  if (form.partyType === 'station') {
    if (!form.stationId) return
    params.stationId = form.stationId
  } else {
    if (!form.customerName) return
    params.customerName = form.customerName
  }
  if (form.barrelType) params.barrelType = form.barrelType
  try {
    const r = await getBarrelSummary(params)
    const row = (r?.data?.list || []).find((x) => x.barrelType === form.barrelType)
    if (row) pendingTip.value = { qty: row.pendingQty, amount: row.pendingAmount }
  } catch { /* 静默 */ }
}

async function submit() {
  await formRef.value.validate()
  if (!form.unitPrice || form.unitPrice <= 0) {
    ElMessage.warning('请填写押金单价')
    return
  }
  saving.value = true
  try {
    const r = await createDeposit(form)
    ElMessage.success(r?.message || '登记成功')
    formRef.value.resetFields()
    form.depositType = 'collect'
    form.partyType = 'station'
    form.quantity = 1
    pendingTip.value = null
    loadList()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '登记失败')
  } finally {
    saving.value = false
  }
}

function onPageChange(p) {
  listQuery.page = p
  loadList()
}

function onPageSizeChange() {
  listQuery.page = 1
  loadList()
}

onMounted(() => {
  loadBase()
  loadList()
})
</script>

<style scoped>
.barrel-deposit { padding: 4px; }
.form-card, .list-card { margin-bottom: 16px; }
.head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.title { font-size: 15px; font-weight: 600; color: var(--text); }
.deposit-form { max-width: 1100px; }
.submit-row { display: flex; justify-content: flex-end; align-items: center; gap: 16px; margin-top: 4px; }
.pending-tip { color: var(--el-color-warning); font-size: 13px; }
.dim-text { color: var(--text-2); font-size: 12px; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
.filter-right { display: flex; gap: 8px; }
</style>

<template>
  <div class="salary-statistics">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-form">
        <DateRangeFilter v-model="rangeState" @change="handleSearch" />
        <el-button type="primary" style="margin-left: 12px;" @click="handleSearch">
          <el-icon><Search /></el-icon>
          查询
        </el-button>
        <span class="filter-tip">按订单计算员工配送费：官方平台/线下零售=工人零售配送费；直营水站=工人水站配送费；量贩机/零售机=工人零售机配送费</span>
      </div>
    </el-card>

    <!-- 汇总卡片 -->
    <div class="summary-grid">
      <div class="summary-card card-gold">
        <div class="card-label"><el-icon><Money /></el-icon><span>应发工资总额</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.totalDeliveryFee) }}</div>
        <div class="card-desc">{{ rangeLabel }} 全部员工应发合计（{{ multiMonth ? '跨月按应发口径' : '含已发放锁定' }}）</div>
      </div>
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><User /></el-icon><span>参与员工</span></div>
        <div class="card-value">{{ summary.workerCount }} 人</div>
        <div class="card-desc">在职员工总数（应发=当月配送费）</div>
      </div>
      <div class="summary-card card-teal">
        <div class="card-label"><el-icon><List /></el-icon><span>配送订单数</span></div>
        <div class="card-value">{{ summary.orderCount }} 单</div>
        <div class="card-desc">当月计入工资的配送订单</div>
      </div>
      <div class="summary-card card-red">
        <div class="card-label"><el-icon><Wallet /></el-icon><span>待扣预支</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.totalPendingAdvance) }}</div>
        <div class="card-desc">员工未结清预支合计（发工资时抵扣）</div>
      </div>
    </div>

    <!-- 员工汇总表 -->
    <el-card class="table-card" shadow="never">
      <div class="table-header">
        <span class="table-title">员工工资汇总（{{ rangeLabel }}）</span>
        <span class="table-tip">全员应发=区间配送费（发放时可手动调整补加其他工资）；实发=应发-待扣预支，不足时负数挂账下月继续扣{{ multiMonth ? '；跨月区间为统计视图，工资发放/撤销请切换到单个自然月' : '' }}</span>
      </div>
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="workerName" label="员工姓名" min-width="110">
          <template #default="{ row }">
            <el-icon style="vertical-align: -2px; margin-right: 4px;"><User /></el-icon>{{ row.workerName }}
            <el-tag :type="employeeTypeTagType(row.employeeType)" size="small" style="margin-left: 4px;">{{ employeeTypeLabel(row.employeeType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="联系电话" width="130" />
        <el-table-column prop="orderCount" label="配送订单数" width="105" align="center" />
        <el-table-column prop="totalQty" label="配送件数" width="95" align="center" />
        <el-table-column label="应发工资" width="130" align="right">
          <template #default="{ row }">
            <!-- 跨月区间：发放记录按月存储，无法对应单一快照，统一按应发口径展示 -->
            <template v-if="row.multiMonth">
              <span class="fee-text">¥{{ fmtMoney(row.due) }}</span>
              <div class="sub-text">区间配送费 ¥{{ fmtMoney(row.calcFee) }}</div>
            </template>
            <template v-else-if="!row.paid">
              <span class="fee-text">¥{{ fmtMoney(row.due) }}</span>
              <div class="sub-text">当月配送费 ¥{{ fmtMoney(row.calcFee) }}</div>
            </template>
            <template v-else>
              <span class="fee-text">¥{{ fmtMoney(row.paidAmount) }}</span>
              <el-tooltip content="发放锁定金额（发放时快照）" placement="top">
                <el-icon class="lock-icon"><Lock /></el-icon>
              </el-tooltip>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="待扣预支" width="105" align="right">
          <template #default="{ row }">
            <span v-if="(row.multiMonth || !row.paid) && row.pendingAdvance > 0" class="advance-text">-¥{{ fmtMoney(row.pendingAdvance) }}</span>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="实发金额" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.multiMonth || !row.paid" :class="row.net < 0 ? 'net-negative' : 'net-text'">
              ¥{{ fmtMoney(row.net) }}<template v-if="row.net < 0"><span class="sub-text">（挂账下月扣）</span></template>
            </span>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="发放状态" width="210">
          <template #default="{ row }">
            <template v-if="!row.paid">
              <el-tag type="warning" size="small">未发放</el-tag>
              <div v-if="row.multiMonth" class="paid-info">区间内无发放记录</div>
            </template>
            <template v-else-if="row.multiMonth">
              <el-tag type="success" size="small">区间内已发 {{ row.paidMonthCount }} 个月份</el-tag>
              <div class="paid-info">已发合计 ¥{{ fmtMoney(row.paidAmount) }}<br>{{ (row.paidMonths || []).join('、') }}</div>
            </template>
            <template v-else>
              <el-tooltip placement="top" :content="`账户：${row.paidAccount || '-'}｜时间：${formatTime(row.paidAt)}${row.payRemark ? '｜备注：' + row.payRemark : ''}`">
                <el-tag type="success" size="small">已发放</el-tag>
              </el-tooltip>
              <div class="paid-info">¥{{ fmtMoney(row.paidAmount) }} · {{ row.paidAccount }}<br>{{ formatTime(row.paidAt) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="250" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewDetail(row)">
              <el-icon><View /></el-icon>
              明细
            </el-button>
            <!-- 跨月区间为统计视图：发放/撤销按自然月操作，故禁用并提示 -->
            <el-tooltip v-if="row.multiMonth" placement="top" content="跨月区间不支持发放，请切换到单个自然月">
              <span>
                <el-button type="success" link disabled>
                  <el-icon><Money /></el-icon>
                  确认发放
                </el-button>
              </span>
            </el-tooltip>
            <template v-else>
              <el-button v-if="!row.paid" type="success" link @click="openPayDialog(row)">
                <el-icon><Money /></el-icon>
                确认发放
              </el-button>
              <el-button v-else type="danger" link @click="handleRevoke(row)">
                <el-icon><RefreshLeft /></el-icon>
                撤销发放
              </el-button>
            </template>
            <el-button type="warning" link @click="openAdvance(row)">
              <el-icon><Wallet /></el-icon>
              预支
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 确认发放弹窗 -->
    <el-dialog
      v-model="payVisible"
      title="确认发放工资"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-alert
        v-if="payForm.checked"
        :title="'该员工 ' + payForm.month + ' 工资已发放，不能重复发放'"
        type="warning"
        show-icon
        :closable="false"
        style="margin-bottom: 10px;"
      />
      <el-form ref="payFormRef" :model="payForm" :rules="payRules" label-width="100px">
        <el-form-item label="员工">
          <span class="worker-name">{{ currentWorker?.workerName || '' }}</span>
          <el-tag :type="employeeTypeTagType(payForm.employeeType)" size="small" style="margin-left: 8px;">{{ employeeTypeLabel(payForm.employeeType) }}</el-tag>
        </el-form-item>
        <el-form-item label="发放月份" prop="month">
          <el-date-picker v-model="payForm.month" type="month" value-format="YYYY-MM" format="YYYY年MM月" style="width: 100%;" @change="onPayMonthChange" />
        </el-form-item>
        <el-form-item label="应发金额" prop="amount">
          <el-input-number
            v-model="payForm.amount"
            :min="0.01"
            :precision="2"
            :step="100"
            :controls="false"
            placeholder="当月配送费合计（可修改，补加其他工资）"
            style="width: 100%"
          />
          <div class="calc-tip" style="margin-left: 0;">默认为 {{ payForm.month }} 实时配送费合计，可手动修改补加其他工资（仅影响当月）</div>
        </el-form-item>
        <el-form-item v-if="payForm.pendingAdvance > 0" label="预支抵扣">
          <div class="deduct-line">
            应发 ¥{{ fmtMoney(payForm.amount) }} − 待扣预支 <b class="advance-text">¥{{ fmtMoney(payForm.pendingAdvance) }}</b> = 实发
            <span class="amount-big">¥{{ fmtMoney(netAmount) }}</span>
            <span v-if="netAmount < 0" class="sub-text">（不足部分负数挂账，下月继续扣）</span>
          </div>
        </el-form-item>
        <el-form-item label="发放账户" prop="accountId">
          <AccountSelect
            v-model="payForm.accountId"
            :accounts="accounts"
            placeholder="选择发放账户（将产生公司账户支出）"
            balance-label="可用"
            :is-disabled="(a) => a.currentBalance < netAmount"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="payForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="发放备注（可选）" />
        </el-form-item>
      </el-form>
      <div class="pay-hint">确认后将：① 记录该员工 {{ payForm.month }} 工资发放（实发 ¥{{ fmtMoney(netAmount) }}）；② {{ netAmount > 0 ? `从所选账户扣减 ¥${fmtMoney(netAmount)} 并记一笔公司支出` : '无需扣款（实发 ≤ 0，预支已抵扣/负数挂账）' }}；③ 预支按日期顺序抵扣。</div>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="success" :loading="saving" :disabled="payForm.checked || !payForm.amount" @click="submitPay">确认发放</el-button>
      </template>
    </el-dialog>

    <!-- 员工订单明细弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="`配送订单明细：${currentWorker?.workerName || ''}（${rangeLabel}）`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="detailRows" v-loading="detailLoading" border stripe size="small" max-height="420">
        <el-table-column prop="orderId" label="订单号" min-width="160" show-overflow-tooltip />
        <el-table-column prop="orderTypeName" label="订单类型" width="120" />
        <el-table-column prop="customerName" label="客户/水站" min-width="110" show-overflow-tooltip />
        <el-table-column prop="createTime" label="下单时间" width="160">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column prop="totalQty" label="件数" width="70" align="center" />
        <el-table-column prop="deliveryFee" label="配送费" width="110" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewOrderItems(row)">
              <el-icon><View /></el-icon>
              商品明细
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="detail-total">合计配送费：<span class="fee-text">¥{{ fmtMoney(detailTotal) }}</span></div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 订单商品明细弹窗 -->
    <el-dialog
      v-model="itemsVisible"
      :title="`商品配送明细：${currentOrder?.orderId || ''}（${currentOrder?.orderTypeName || ''}）`"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-table :data="itemRows" v-loading="itemsLoading" border stripe size="small" max-height="380">
        <el-table-column prop="productName" label="商品名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unit" label="单位" width="70" align="center">
          <template #default="{ row }">{{ row.unit || '-' }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="80" align="center" />
        <el-table-column prop="feePerUnit" label="配送费率" width="100" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.feePerUnit) }}/件</template>
        </el-table-column>
        <el-table-column prop="deliveryFee" label="配送费" width="110" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="detail-total">合计配送费：<span class="fee-text">¥{{ fmtMoney(itemsTotal) }}</span></div>
      <template #footer>
        <el-button @click="itemsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 工资预支弹窗 -->
    <AdvanceDialog
      v-model="advanceVisible"
      :worker-id="advanceWorker.workerId || ''"
      :worker-name="advanceWorker.workerName || ''"
      @success="fetchSummary"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, User, Money, List, View, Lock, RefreshLeft, Wallet } from '@element-plus/icons-vue'
import { getSalarySummary, getSalaryOrders, getSalaryOrderItems, getWorkerSalarySummary, payWorkerSalary, revokeSalaryPayment } from '@/api/salary'
import { getFinanceAccounts } from '@/api/expense'
import { formatMoney as fmtMoney } from '@/utils/format'
import AccountSelect from '@/components/AccountSelect.vue'
import AdvanceDialog from '@/components/AdvanceDialog.vue'
import DateRangeFilter from '@/components/DateRangeFilter.vue'
import { defaultRange, toQuery, rangeText } from '@/utils/dateRange'

const loading = ref(false)
const rangeState = ref(defaultRange())
// 单月视图下后端解析出的实际月份（用于发放/撤销；跨月区间为空）
const currentMonth = ref('')
const multiMonth = ref(false)
const rows = ref([])
const summary = reactive({ totalDeliveryFee: 0, workerCount: 0, orderCount: 0, totalPendingAdvance: 0 })

const rangeLabel = computed(() => rangeText(rangeState.value))

const employeeTypeLabel = (t) => ({ 1: '店长', 2: '配送员工', 3: '业务员' }[t] || '未知')
const employeeTypeTagType = (t) => ({ 1: 'danger', 2: 'primary', 3: 'success' }[t] || 'info')

// 工资预支弹窗
const advanceVisible = ref(false)
const advanceWorker = ref({})
const openAdvance = (row) => {
  advanceWorker.value = row
  advanceVisible.value = true
}

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailRows = ref([])
const currentWorker = ref(null)

// 订单商品明细
const itemsVisible = ref(false)
const itemsLoading = ref(false)
const itemRows = ref([])
const currentOrder = ref(null)

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '720px'))


const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d)) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const detailTotal = computed(() => detailRows.value.reduce((s, x) => s + (x.deliveryFee || 0), 0))
const itemsTotal = computed(() => itemRows.value.reduce((s, x) => s + (x.deliveryFee || 0), 0))

const fetchSummary = async () => {
  if (rangeState.value.range === 'custom' && !(rangeState.value.startDate && rangeState.value.endDate)) {
    ElMessage.warning('请选择起止日期')
    return
  }
  loading.value = true
  try {
    const res = await getSalarySummary(toQuery(rangeState.value))
    if (res.data) {
      rows.value = res.data.list || []
      Object.assign(summary, res.data.summary || {})
      multiMonth.value = !!res.data.multiMonth
      currentMonth.value = res.data.month || ''
    }
  } catch (e) {
    console.error('工资统计失败:', e)
    ElMessage.error(e.response?.data?.message || '工资统计失败')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  fetchSummary()
}

// ---- 工资发放 ----
const saving = ref(false)
const payVisible = ref(false)
const payFormRef = ref(null)
const payForm = reactive({
  month: '',
  employeeType: 2,
  amount: 0,            // 应发金额（店长/业务员发放时可改）
  pendingAdvance: 0,    // 待扣预支
  accountId: '',
  remark: '',
  checked: false
})
const accounts = ref([])
const payRules = {
  month: [{ required: true, message: '请选择发放月份', trigger: 'change' }]
}

// 实发 = 应发 - 待扣预支（可为负：挂账下月继续扣）
const netAmount = computed(() => fmtMoney(Math.round((Number(payForm.amount || 0) - Number(payForm.pendingAdvance || 0)) * 100) / 100))

const loadAccounts = async () => {
  try {
    const res = await getFinanceAccounts()
    accounts.value = (res.data?.list || []).filter((a) => a.status)
  } catch (e) {
    console.error('账户加载失败:', e)
  }
}

// 打开发放弹窗：默认当前查看月份，加载该员工当月状态与金额
const openPayDialog = async (row) => {
  currentWorker.value = row
  payForm.month = currentMonth.value || ''
  payForm.employeeType = row.employeeType || 2
  payForm.amount = row.due || 0
  payForm.pendingAdvance = row.pendingAdvance || 0
  payForm.accountId = ''
  payForm.remark = ''
  payForm.checked = false
  payVisible.value = true
  await refreshPayWorker(row.workerId)
}

const refreshPayWorker = async (workerId) => {
  try {
    const res = await getWorkerSalarySummary({ month: payForm.month, workerId: workerId || currentWorker.value?.workerId })
    const d = res.data || {}
    payForm.employeeType = d.employeeType || 2
    payForm.amount = d.paid ? d.payAmount : d.due
    payForm.pendingAdvance = d.pendingAdvance || 0
    payForm.checked = !!d.paid // 该员工该月已发放 → 弹窗提示并禁用确认
  } catch (e) {
    console.error('工资状态获取失败:', e)
  }
}

const onPayMonthChange = () => {
  refreshPayWorker()
}

const submitPay = async () => {
  try {
    await payFormRef.value.validate()
  } catch {
    return
  }
  if (payForm.checked) { ElMessage.warning('该员工该月已发放'); return }
  if (netAmount.value > 0 && !payForm.accountId) { ElMessage.warning('请选择发放账户'); return }
  saving.value = true
  try {
    const res = await payWorkerSalary({
      workerId: currentWorker.value.workerId,
      month: payForm.month,
      accountId: payForm.accountId,
      amount: payForm.amount,
      remark: payForm.remark
    })
    ElMessage.success(`发放成功（实发 ¥${fmtMoney(res.data?.amount ?? netAmount.value)}）`)
    payVisible.value = false
    fetchSummary()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '发放失败')
  } finally {
    saving.value = false
  }
}

// 撤销发放
const handleRevoke = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定撤销「${row.workerName}」${currentMonth.value} 工资发放（¥${fmtMoney(row.paidAmount)}）？账户余额将回补，状态回到未发放。`,
      '撤销发放确认',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await revokeSalaryPayment(row.paymentId)
    ElMessage.success('已撤销发放，余额已回补')
    fetchSummary()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '撤销失败')
  }
}

const viewDetail = async (row) => {
  currentWorker.value = row
  detailVisible.value = true
  detailLoading.value = true
  detailRows.value = []
  try {
    const res = await getSalaryOrders({ ...toQuery(rangeState.value), workerId: row.workerId })
    detailRows.value = res.data?.list || []
  } catch (e) {
    console.error('工资明细失败:', e)
    ElMessage.error('获取配送订单明细失败')
  } finally {
    detailLoading.value = false
  }
}

// 订单商品配送明细
const viewOrderItems = async (row) => {
  currentOrder.value = row
  itemsVisible.value = true
  itemsLoading.value = true
  itemRows.value = []
  try {
    const res = await getSalaryOrderItems({ orderId: row.orderId })
    itemRows.value = res.data?.list || []
  } catch (e) {
    console.error('商品明细失败:', e)
    ElMessage.error('获取商品配送明细失败')
  } finally {
    itemsLoading.value = false
  }
}

onMounted(() => {
  loadAccounts()
  fetchSummary()
})
</script>

<style scoped>
.salary-statistics {
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

.filter-tip {
  margin-left: 16px;
  font-size: 12px;
  color: var(--text-2);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: var(--radius-lg);
  padding: 16px 18px;
  background: var(--card);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.2s ease;
}

.summary-card:hover {
  border-color: rgba(168, 32, 26, 0.25);
}

.card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-2);
}

.card-label .el-icon {
  color: var(--accent, var(--text-2));
}

.card-value {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0 4px;
  line-height: 1.2;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.card-desc {
  font-size: 12px;
  color: var(--text-3);
}

.card-gold { --accent: var(--gold); }
.card-blue { --accent: var(--text-2); }
.card-teal { --accent: var(--text-2); }
.card-red { --accent: var(--primary); }

.table-card {
  border-radius: var(--radius-md);
}

.table-header {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
}

.table-tip {
  font-size: 12px;
  color: var(--text-2);
}

.fee-text {
  color: var(--el-color-danger);
  font-weight: 600;
}

.advance-text {
  color: var(--el-color-warning);
  font-weight: 600;
}

.net-text {
  color: var(--el-color-success);
  font-weight: 600;
}

.net-negative {
  color: var(--el-color-danger);
  font-weight: 700;
}

.sub-text {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 400;
}

.muted {
  color: var(--text-3);
}

.deduct-line {
  font-size: 13px;
  line-height: 1.8;
}

.detail-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
}
.lock-icon {
  margin-left: 4px;
  vertical-align: -1px;
  color: var(--text-2);
}
.paid-info {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.4;
  margin-top: 2px;
}
.worker-name {
  font-weight: 600;
  font-size: 15px;
}
.amount-big {
  font-size: 18px;
  font-weight: 700;
  color: var(--el-color-danger);
}
.calc-tip {
  font-size: 12px;
  color: var(--text-2);
  margin-left: 6px;
}
.pay-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
  background: var(--el-color-info-light-8);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
</style>

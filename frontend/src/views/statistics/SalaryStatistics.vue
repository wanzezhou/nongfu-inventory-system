<template>
  <div class="salary-statistics">
    <!-- 筛选区 -->
    <el-card class="filter-card" shadow="never">
      <div class="filter-form">
        <el-date-picker
          v-model="month"
          type="month"
          placeholder="选择统计月份"
          value-format="YYYY-MM"
          format="YYYY年MM月"
          style="width: 180px"
        />
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
        <div class="card-label"><el-icon><Money /></el-icon><span>配送费总额</span></div>
        <div class="card-value">¥{{ fmtMoney(summary.totalDeliveryFee) }}</div>
        <div class="card-desc">{{ month || '本月' }} 员工配送费合计</div>
      </div>
      <div class="summary-card card-blue">
        <div class="card-label"><el-icon><User /></el-icon><span>参与员工</span></div>
        <div class="card-value">{{ summary.workerCount }} 人</div>
        <div class="card-desc">当月有配送订单的员工数</div>
      </div>
      <div class="summary-card card-teal">
        <div class="card-label"><el-icon><List /></el-icon><span>配送订单数</span></div>
        <div class="card-value">{{ summary.orderCount }} 单</div>
        <div class="card-desc">当月计入工资的配送订单</div>
      </div>
    </div>

    <!-- 员工汇总表 -->
    <el-card class="table-card" shadow="never">
      <div class="table-header">
        <span class="table-title">员工配送费汇总（{{ month || '-' }}）</span>
      </div>
      <el-table :data="rows" v-loading="loading" border stripe size="small">
        <el-table-column prop="workerName" label="员工姓名" min-width="110">
          <template #default="{ row }">
            <el-icon style="vertical-align: -2px; margin-right: 4px;"><User /></el-icon>{{ row.workerName }}
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="联系电话" width="130" />
        <el-table-column prop="orderCount" label="配送订单数" width="110" align="center" />
        <el-table-column prop="totalQty" label="配送件数" width="100" align="center" />
        <el-table-column prop="deliveryFee" label="配送费" width="120" align="right">
          <template #default="{ row }">
            <span class="fee-text">¥{{ fmtMoney(row.deliveryFee) }}</span>
            <el-tooltip v-if="row.paid" :content="`发放锁定金额（发放时快照）`" placement="top">
              <el-icon class="lock-icon"><Lock /></el-icon>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="发放状态" width="200">
          <template #default="{ row }">
            <template v-if="!row.paid">
              <el-tag type="warning" size="small">未发放</el-tag>
            </template>
            <template v-else>
              <el-tooltip placement="top" :content="`账户：${row.paidAccount || '-'}｜时间：${formatTime(row.paidAt)}${row.payRemark ? '｜备注：' + row.payRemark : ''}`">
                <el-tag type="success" size="small">已发放</el-tag>
              </el-tooltip>
              <div class="paid-info">¥{{ fmtMoney(row.paidAmount) }} · {{ row.paidAccount }}<br>{{ formatTime(row.paidAt) }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewDetail(row)">
              <el-icon><View /></el-icon>
              明细
            </el-button>
            <el-button v-if="!row.paid" type="success" link @click="openPayDialog(row)">
              <el-icon><Money /></el-icon>
              确认发放
            </el-button>
            <el-button v-else type="danger" link @click="handleRevoke(row)">
              <el-icon><RefreshLeft /></el-icon>
              撤销发放
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
        </el-form-item>
        <el-form-item label="发放月份" prop="month">
          <el-date-picker v-model="payForm.month" type="month" value-format="YYYY-MM" format="YYYY年MM月" style="width: 100%;" @change="onPayMonthChange" />
        </el-form-item>
        <el-form-item label="发放金额">
          <span class="amount-big">¥{{ fmtMoney(payForm.amount) }}</span>
          <span v-if="payForm.calcFee >= 0" class="calc-tip">（{{ payForm.month }} 实时配送费合计）</span>
        </el-form-item>
        <el-form-item label="发放账户" prop="accountId">
          <AccountSelect
            v-model="payForm.accountId"
            :accounts="accounts"
            placeholder="选择发放账户（将产生公司账户支出）"
            balance-label="可用"
            :is-disabled="(a) => a.currentBalance < payForm.amount"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="payForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="发放备注（可选）" />
        </el-form-item>
      </el-form>
      <div class="pay-hint">确认后将：① 记录该员工 {{ payForm.month }} 工资发放；② 从所选账户扣减 ¥{{ fmtMoney(payForm.amount) }} 并记一笔公司支出。</div>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="success" :loading="saving" :disabled="payForm.checked || !payForm.amount" @click="submitPay">确认发放</el-button>
      </template>
    </el-dialog>

    <!-- 员工订单明细弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="`配送订单明细：${currentWorker?.workerName || ''}（${month}）`"
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, User, Money, List, View, Lock, RefreshLeft } from '@element-plus/icons-vue'
import { getSalarySummary, getSalaryOrders, getSalaryOrderItems, getWorkerSalarySummary, payWorkerSalary, revokeSalaryPayment } from '@/api/salary'
import { getFinanceAccounts } from '@/api/expense'
import { formatMoney as fmtMoney } from '@/utils/format'
import AccountSelect from '@/components/AccountSelect.vue'

const loading = ref(false)
const month = ref('')
const rows = ref([])
const summary = reactive({ totalDeliveryFee: 0, workerCount: 0, orderCount: 0 })

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
  if (!month.value) {
    ElMessage.warning('请选择统计月份')
    return
  }
  loading.value = true
  try {
    const res = await getSalarySummary({ month: month.value })
    if (res.data) {
      rows.value = res.data.list || []
      Object.assign(summary, res.data.summary || {})
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
const payForm = reactive({ month: '', amount: 0, calcFee: -1, accountId: '', remark: '', checked: false })
const accounts = ref([])
const payRules = {
  month: [{ required: true, message: '请选择发放月份', trigger: 'change' }],
  accountId: [{ required: true, message: '请选择发放账户', trigger: 'change' }]
}

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
  payForm.month = month.value || ''
  payForm.amount = row.calcFee || row.deliveryFee || 0
  payForm.calcFee = -1
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
    payForm.amount = d.paid ? d.deliveryFee : d.calcFee
    payForm.calcFee = d.calcFee
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
  saving.value = true
  try {
    const res = await payWorkerSalary({
      workerId: currentWorker.value.workerId,
      month: payForm.month,
      accountId: payForm.accountId,
      remark: payForm.remark
    })
    ElMessage.success(`发放成功（¥${fmtMoney(res.data?.amount || payForm.amount)}）`)
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
      `确定撤销「${row.workerName}」${month.value} 工资发放（¥${fmtMoney(row.paidAmount)}）？账户余额将回补，状态回到未发放。`,
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
    const res = await getSalaryOrders({ month: month.value, workerId: row.workerId })
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
  const now = new Date()
  month.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
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
  border-radius: 8px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.filter-tip {
  margin-left: 16px;
  font-size: 12px;
  color: #909399;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.summary-card {
  border-radius: 10px;
  padding: 16px 18px;
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.card-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  opacity: 0.92;
}

.card-value {
  font-size: 26px;
  font-weight: 700;
  margin: 6px 0 4px;
  line-height: 1.2;
}

.card-desc {
  font-size: 12px;
  opacity: 0.85;
}

.card-gold { background: linear-gradient(135deg, #f59e0b, #d97706); }
.card-blue { background: linear-gradient(135deg, #3b82f6, #2563eb); }
.card-teal { background: linear-gradient(135deg, #14b8a6, #0d9488); }

.table-card {
  border-radius: 8px;
}

.table-header {
  margin-bottom: 12px;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
}

.fee-text {
  color: #f56c6c;
  font-weight: 600;
}

.detail-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
}
.lock-icon {
  margin-left: 4px;
  vertical-align: -1px;
  color: #a0a4ab;
}
.paid-info {
  font-size: 11px;
  color: #909399;
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
  color: #f56c6c;
}
.calc-tip {
  font-size: 12px;
  color: #909399;
  margin-left: 6px;
}
.pay-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  background: #f4f4f5;
  border-radius: 6px;
  padding: 8px 10px;
}
</style>

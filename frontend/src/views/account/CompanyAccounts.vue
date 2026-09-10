<template>
  <div class="company-accounts">
    <el-card class="filter-card" shadow="never">
      <div class="head-row">
        <span class="title">公司账户（7 类账户相互独立，支持任意账户间转账）</span>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新增账户
        </el-button>
      </div>
    </el-card>

    <!-- 账户卡片列表 -->
    <div class="account-grid" v-loading="loading">
      <div v-for="acc in accounts" :key="acc.accountId" class="account-card" :class="acc.status ? '' : 'is-disabled'">
        <div class="acc-top">
          <span class="acc-type" :class="acc.accountType >= 5 ? 'type-new' : 'type-fund'">{{ acc.accountTypeName }}</span>
          <el-tag v-if="!acc.status" size="small" type="info">已停用</el-tag>
        </div>
        <div class="acc-name">{{ acc.accountName }}</div>
        <div class="acc-meta">
          <template v-if="acc.bankName || acc.bankAccount">
            <div class="meta-line">{{ acc.bankName || '-' }} {{ acc.bankAccount || '' }}</div>
          </template>
          <div class="meta-line desc">{{ acc.remark || '—' }}</div>
        </div>
        <div class="acc-balance-row">
          <div>
            <div class="balance-label">可用余额</div>
            <div class="balance-value">¥{{ fmtMoney(acc.currentBalance) }}</div>
          </div>
          <div class="acc-actions">
            <el-button size="small" type="primary" :disabled="!acc.status" @click="openTransfer(acc)">转账</el-button>
            <el-dropdown trigger="click" @command="(cmd) => onRowCmd(cmd, acc)">
              <el-button size="small" :disabled="!acc.status" style="margin-left: 6px;">
                更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="income">收入入账</el-dropdown-item>
                  <el-dropdown-item command="expense">支出登记</el-dropdown-item>
                  <el-dropdown-item command="txs">查看流水</el-dropdown-item>
                  <el-dropdown-item command="edit">账户设置</el-dropdown-item>
                  <el-dropdown-item v-if="acc.status" command="disable" divided>停用账户</el-dropdown-item>
                  <el-dropdown-item v-else command="enable" divided>启用账户</el-dropdown-item>
                  <el-dropdown-item command="remove" divided>删除账户</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增账户 -->
    <el-dialog v-model="createVisible" title="新增账户" :width="dialogWidth" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="createRef" :model="createForm" :rules="baseRules" label-width="90px">
        <el-form-item label="账户类型" prop="accountType">
          <el-select v-model="createForm.accountType" placeholder="选择类型" style="width: 100%;">
            <el-option v-for="(n, t) in ACCOUNT_TYPE_MAP" :key="t" :label="n" :value="Number(t)" />
          </el-select>
        </el-form-item>
        <el-form-item label="账户名称" prop="accountName">
          <el-input v-model="createForm.accountName" placeholder="如：备用金账户" maxlength="100" />
        </el-form-item>
        <el-form-item label="开户行">
          <el-input v-model="createForm.bankName" placeholder="可空" maxlength="100" />
        </el-form-item>
        <el-form-item label="账号">
          <el-input v-model="createForm.bankAccount" placeholder="可空" maxlength="100" />
        </el-form-item>
        <el-form-item label="期初余额">
          <el-input-number v-model="createForm.initialBalance" :min="0" :precision="2" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.remark" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">保存</el-button>
      </template>
    </el-dialog>

    <!-- 转账 -->
    <el-dialog v-model="transferVisible" title="账户转账" :width="dialogWidth" :close-on-click-modal="false" destroy-on-close>
      <el-form :model="transferForm" label-width="90px">
        <el-form-item label="转出账户" prop="fromId">
          <el-select v-model="transferForm.fromId" style="width: 100%;">
            <el-option v-for="a in activeAccounts" :key="a.accountId" :label="`${a.accountName}（可用 ¥${fmtMoney(a.currentBalance)}）`" :value="a.accountId" />
          </el-select>
        </el-form-item>
        <el-form-item label="转入账户" prop="toId">
          <el-select v-model="transferForm.toId" style="width: 100%;">
            <el-option v-for="a in targetAccounts" :key="a.accountId" :label="`${a.accountName}（可用 ¥${fmtMoney(a.currentBalance)}）`" :value="a.accountId" />
          </el-select>
        </el-form-item>
        <el-form-item label="转账金额" prop="amount">
          <el-input-number v-model="transferForm.amount" :min="0.01" :precision="2" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="transferForm.remark" type="textarea" :rows="2" maxlength="500" placeholder="转账事由（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitTransfer">确认转账</el-button>
      </template>
    </el-dialog>

    <!-- 人工收支 -->
    <el-dialog v-model="adjustVisible" :title="adjustType === 'income' ? '收入入账' : '支出登记'" :width="dialogWidth" :close-on-click-modal="false" destroy-on-close>
      <el-alert :title="`账户：${current?.accountName || ''}（可用 ¥${fmtMoney(current?.currentBalance || 0)}）`" type="info" :closable="false" style="margin-bottom: 12px;" />
      <el-form :model="adjustForm" label-width="90px">
        <el-form-item label="金额" prop="amount">
          <el-input-number v-model="adjustForm.amount" :min="0.01" :precision="2" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.remark" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button :type="adjustType === 'income' ? 'success' : 'danger'" :loading="saving" @click="submitAdjust">确认</el-button>
      </template>
    </el-dialog>

    <!-- 流水 -->
    <el-dialog v-model="txsVisible" :title="`账户流水：${current?.accountName || ''}`" :width="txsWidth" :close-on-click-modal="false" destroy-on-close>
      <el-table :data="txRows" v-loading="txsLoading" border stripe size="small" max-height="420">
        <el-table-column prop="createdAt" label="时间" width="150">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="txTypeName" label="类型" width="70" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.txType === 1 ? 'success' : row.txType === 2 ? 'danger' : 'warning'">{{ row.txTypeName }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="counterparty" label="对方/来源" min-width="110" />
        <el-table-column prop="amount" label="金额" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.txType === 1 ? 'in-text' : 'out-text'">{{ row.txType === 1 ? '+' : '-' }}¥{{ fmtMoney(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="变动后余额" width="120" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.balanceAfter) }}</template>
        </el-table-column>
        <el-table-column prop="handler" label="经办" width="90" />
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="txPage"
          v-model:page-size="txPageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="txTotal"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="fetchTxs"
          @size-change="onTxSizeChange"
        />
      </div>
      <template #footer>
        <el-button @click="txsVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 账户设置 -->
    <el-dialog v-model="editVisible" :title="`账户设置：${current?.accountName || ''}`" :width="dialogWidth" :close-on-click-modal="false" destroy-on-close>
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="开户行"><el-input v-model="editForm.bankName" maxlength="100" /></el-form-item>
        <el-form-item label="账号"><el-input v-model="editForm.bankAccount" maxlength="100" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="editForm.remark" type="textarea" :rows="2" maxlength="500" /></el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="editForm.status" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, ArrowDown } from '@element-plus/icons-vue'
import {
  getAccounts, createAccount, updateAccount, deleteAccount,
  adjustAccount, transferBetween, getAccountTransactions
} from '@/api/account'

const ACCOUNT_TYPE_MAP = {
  1: '晟之溪公户', 2: '水公社公户', 3: '微信', 4: '其他',
  5: '可上单信用余额', 6: '可上单折扣余额', 7: '自有费用余额'
}

const loading = ref(false)
const accounts = ref([])
const activeAccounts = computed(() => accounts.value.filter((a) => a.status))
const current = ref(null)
const saving = ref(false)

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '520px'))
const txsWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '860px'))

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatTime = (t) => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d)) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const fetchAccounts = async () => {
  loading.value = true
  try {
    const res = await getAccounts()
    accounts.value = res.data?.list || []
  } catch (e) {
    ElMessage.error('账户查询失败')
  } finally {
    loading.value = false
  }
}

// ---- 新增 ----
const createVisible = ref(false)
const createForm = reactive({ accountType: 5, accountName: '', bankName: '', bankAccount: '', initialBalance: 0, remark: '' })
const baseRules = {
  accountName: [{ required: true, message: '请输入账户名称', trigger: 'blur' }],
  accountType: [{ required: true, message: '请选择账户类型', trigger: 'change' }]
}
const openCreate = () => {
  Object.assign(createForm, { accountType: 5, accountName: '', bankName: '', bankAccount: '', initialBalance: 0, remark: '' })
  createVisible.value = true
}
const submitCreate = async () => {
  saving.value = true
  try {
    await createAccount({ ...createForm })
    ElMessage.success('新增成功')
    createVisible.value = false
    fetchAccounts()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '新增失败')
  } finally {
    saving.value = false
  }
}

// ---- 转账 ----
const transferVisible = ref(false)
const transferForm = reactive({ fromId: '', toId: '', amount: null, remark: '' })
const targetAccounts = computed(() => accounts.value.filter((a) => a.accountId !== transferForm.fromId && a.status))
const openTransfer = (acc) => {
  current.value = acc
  Object.assign(transferForm, { fromId: acc.accountId, toId: '', amount: null, remark: '' })
  transferVisible.value = true
}
const submitTransfer = async () => {
  if (!transferForm.fromId || !transferForm.toId) { ElMessage.warning('请选择转出与转入账户'); return }
  if (!transferForm.amount || transferForm.amount <= 0) { ElMessage.warning('请输入正确的转账金额'); return }
  saving.value = true
  try {
    await transferBetween({ ...transferForm })
    ElMessage.success('转账成功')
    transferVisible.value = false
    fetchAccounts()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '转账失败')
  } finally {
    saving.value = false
  }
}

// ---- 人工收支 ----
const adjustVisible = ref(false)
const adjustType = ref('income')
const adjustForm = reactive({ amount: null, remark: '' })
const onRowCmd = (cmd, acc) => {
  current.value = acc
  if (cmd === 'income' || cmd === 'expense') {
    adjustType.value = cmd
    adjustForm.amount = null
    adjustForm.remark = ''
    adjustVisible.value = true
  } else if (cmd === 'txs') {
    openTxs(acc)
  } else if (cmd === 'edit') {
    openEdit(acc)
  } else if (cmd === 'disable' || cmd === 'enable') {
    toggleStatus(acc, cmd === 'enable')
  } else if (cmd === 'remove') {
    handleRemove(acc)
  }
}
const submitAdjust = async () => {
  if (!adjustForm.amount || adjustForm.amount <= 0) { ElMessage.warning('请输入正确的金额'); return }
  saving.value = true
  try {
    await adjustAccount(current.value.accountId, { type: adjustType.value, amount: adjustForm.amount, remark: adjustForm.remark })
    ElMessage.success(adjustType.value === 'income' ? '收入入账成功' : '支出登记成功')
    adjustVisible.value = false
    fetchAccounts()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

// ---- 流水 ----
const txsVisible = ref(false)
const txsLoading = ref(false)
const txRows = ref([])
const txTotal = ref(0)
const txPage = ref(1)
const txPageSize = ref(10)
const onTxSizeChange = () => {
  txPage.value = 1
  fetchTxs()
}
const openTxs = async (acc) => {
  current.value = acc
  txsVisible.value = true
  txPage.value = 1
  fetchTxs()
}
const fetchTxs = async () => {
  txsLoading.value = true
  try {
    const res = await getAccountTransactions(current.value.accountId, { page: txPage.value, pageSize: txPageSize.value })
    txRows.value = res.data?.list || []
    txTotal.value = res.data?.total || 0
  } catch (e) {
    ElMessage.error('流水查询失败')
  } finally {
    txsLoading.value = false
  }
}

// ---- 设置 / 启停 / 删除 ----
const editVisible = ref(false)
const editForm = reactive({ bankName: '', bankAccount: '', remark: '', status: true })
const openEdit = (acc) => {
  Object.assign(editForm, { bankName: acc.bankName, bankAccount: acc.bankAccount, remark: acc.remark, status: acc.status })
  editVisible.value = true
}
const submitEdit = async () => {
  saving.value = true
  try {
    await updateAccount(current.value.accountId, { ...editForm })
    ElMessage.success('保存成功')
    editVisible.value = false
    fetchAccounts()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
const toggleStatus = async (acc, enable) => {
  try {
    await updateAccount(acc.accountId, { bankName: acc.bankName, bankAccount: acc.bankAccount, remark: acc.remark, status: enable })
    ElMessage.success(enable ? '已启用' : '已停用')
    fetchAccounts()
  } catch (e) {
    ElMessage.error('操作失败')
  }
}
const handleRemove = async (acc) => {
  try {
    await ElMessageBox.confirm(`确定删除账户「${acc.accountName}」？仅余额为 0 且无流水的账户可删除。`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteAccount(acc.accountId)
    ElMessage.success('删除成功')
    fetchAccounts()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

onMounted(fetchAccounts)
</script>

<style scoped>
.company-accounts {
  padding: 0;
}
.filter-card {
  margin-bottom: 14px;
  border-radius: var(--radius-md);
}
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.title {
  font-size: 15px;
  font-weight: 600;
}
.account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.account-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.2s;
}
.account-card:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}
.account-card.is-disabled {
  opacity: 0.55;
  background: var(--bg);
}
.acc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.acc-type {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--radius-md);
}
.type-fund {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.type-new {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.acc-name {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4px;
}
.acc-meta .meta-line {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
}
.acc-balance-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 10px;
  flex-wrap: wrap;
  gap: 8px;
}
.balance-label {
  font-size: 12px;
  color: var(--text-2);
}
.balance-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-warning);
}
.in-text {
  color: var(--el-color-success);
  font-weight: 600;
}
.out-text {
  color: var(--el-color-danger);
  font-weight: 600;
}
.pager {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 768px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}
</style>

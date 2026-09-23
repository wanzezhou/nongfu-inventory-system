<template>
  <div class="wallet-manage">
    <el-card class="filter-card" shadow="never">
      <div class="head-row">
        <span class="title">积分钱包（充值积分由管理员在此发放；配送费积分由水站返货发行自动入账）</span>
      </div>
      <div class="filter-row">
        <el-select v-model="query.ownerType" placeholder="全部主体" clearable style="width: 150px" @change="fetchList">
          <el-option label="直营水站" value="STATION" />
          <el-option label="业务员" value="SALESMAN" />
        </el-select>
        <el-input
          v-model="query.keyword"
          placeholder="按名称 / 编号搜索"
          clearable
          style="width: 220px"
          @keyup.enter="fetchList"
          @clear="fetchList"
        />
        <el-button type="primary" @click="fetchList">查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </div>
    </el-card>

    <!-- 汇总 -->
    <div class="summary-grid">
      <div class="sum-card">
        <div class="sum-label">积分总额（启用钱包）</div>
        <div class="sum-value">{{ fmtPoints(totals.total) }}</div>
      </div>
      <div class="sum-card">
        <div class="sum-label">其中 · 充值积分</div>
        <div class="sum-value sum-recharge">{{ fmtPoints(totals.rechargeTotal) }}</div>
      </div>
      <div class="sum-card">
        <div class="sum-label">其中 · 配送费积分</div>
        <div class="sum-value sum-delivery">{{ fmtPoints(totals.deliveryFeeTotal) }}</div>
      </div>
      <div class="sum-card">
        <div class="sum-label">钱包开立情况</div>
        <div class="sum-value">{{ summary.openedCount }} / {{ summary.count }}</div>
        <div class="sum-sub">未开立 {{ summary.unopenedCount }} 个主体</div>
      </div>
    </div>

    <!-- 主体卡片 -->
    <div v-loading="loading" class="owner-grid">
      <div
        v-for="row in list"
        :key="keyOf(row)"
        class="owner-card"
        :class="{ 'is-unopened': !row.opened, 'is-disabled': !row.ownerStatus }"
      >
        <div class="oc-top">
          <span class="oc-type">{{ row.ownerTypeLabel }}</span>
          <el-tag v-if="!row.ownerStatus" size="small" type="info">主体已停用</el-tag>
          <el-tag v-else-if="row.walletStatus === 0" size="small" type="warning">钱包停用</el-tag>
          <el-tag v-else-if="!row.opened" size="small" type="info">未开立</el-tag>
        </div>

        <div class="oc-name">
          {{ row.ownerName }}
          <span class="oc-id">{{ row.ownerId }}</span>
        </div>

        <template v-if="row.opened">
          <div class="oc-total-row">
            <div>
              <div class="oc-label">可用积分</div>
              <div class="oc-value">{{ fmtPoints(row.balance) }}</div>
            </div>
            <div class="oc-split">
              <div class="oc-sub">
                <span class="dot dot-recharge"></span>充值积分
                <b>{{ fmtPoints(row.rechargeBalance) }}</b>
              </div>
              <div class="oc-sub">
                <span class="dot dot-delivery"></span>配送费积分
                <b>{{ fmtPoints(row.deliveryFeeBalance) }}</b>
              </div>
            </div>
          </div>
          <div class="oc-meta">
            流水 {{ row.txCount }} 笔<span v-if="row.lastTxAt"> · 最近 {{ formatTime(row.lastTxAt) }}</span>
          </div>
        </template>

        <div v-else class="oc-empty">尚未开立积分钱包 —— 开立后即可发放充值积分</div>

        <div class="oc-actions">
          <template v-if="row.opened">
            <el-button size="small" type="primary" @click="openAdjust(row)">调整积分</el-button>
            <el-button size="small" @click="openTxs(row)">流水明细</el-button>
          </template>
          <el-button v-else size="small" type="primary" :loading="openingKey === keyOf(row)" @click="doOpen(row)">
            开立钱包
          </el-button>
        </div>
      </div>

      <el-empty v-if="!loading && !list.length" description="没有匹配的主体" />
    </div>

    <!-- 调整积分 -->
    <el-dialog
      v-model="adjustVisible"
      title="调整积分"
      :width="dialogWidth"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-alert
        :title="`${current.ownerName || ''}（${current.ownerTypeLabel || ''}）`"
        type="info"
        :closable="false"
        style="margin-bottom: 12px"
      />
      <el-form :model="adjustForm" :label-position="isNarrow ? 'top' : 'right'" label-width="96px">
        <el-form-item label="积分类型" required>
          <el-radio-group v-model="adjustForm.pointsType">
            <el-radio-button v-for="opt in pointsTypeOptions" :key="opt.value" :label="opt.value">
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
          <div class="form-hint">
            该类型当前余额：{{ fmtPoints(currentBalanceOf(adjustForm.pointsType)) }}
            <span class="hint-weak">（1 积分 = 1 元订货额度）</span>
          </div>
        </el-form-item>
        <el-form-item label="调整方向" required>
          <el-radio-group v-model="adjustForm.direction">
            <el-radio-button label="IN">增加</el-radio-button>
            <el-radio-button label="OUT">扣减</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="积分数量" required>
          <el-input-number v-model="adjustForm.amount" :min="0.01" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="操作原因" required>
          <el-input
            v-model="adjustForm.reason"
            maxlength="60"
            show-word-limit
            placeholder="必填：调账事由会写入审计日志"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="adjustForm.remark" type="textarea" :rows="2" maxlength="200" placeholder="可空" />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="overLimit"
        type="warning"
        :closable="false"
        :title="`扣减数量超过该类型可用积分（${fmtPoints(currentBalanceOf(adjustForm.pointsType))}），请调整`"
      />

      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="overLimit" @click="submitAdjust">
          确认{{ adjustForm.direction === 'IN' ? '增加' : '扣减' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 流水明细 -->
    <el-dialog
      v-model="txsVisible"
      :title="`积分流水：${current.ownerName || ''}`"
      :width="txsWidth"
      :close-on-click-modal="false"
      destroy-on-close
      class="txs-dialog"
    >
      <div v-if="txWallet" class="tx-head">
        <div class="tx-head-item">
          <span class="tx-head-label">可用积分</span>
          <span class="tx-head-value">{{ fmtPoints(txWallet.balance) }}</span>
        </div>
        <div class="tx-head-item">
          <span class="tx-head-label">充值积分</span>
          <span class="tx-head-value">{{ fmtPoints(txWallet.rechargeBalance) }}</span>
        </div>
        <div class="tx-head-item">
          <span class="tx-head-label">配送费积分</span>
          <span class="tx-head-value">{{ fmtPoints(txWallet.deliveryFeeBalance) }}</span>
        </div>
        <div class="tx-head-item">
          <span class="tx-head-label">恒等式</span>
          <el-tag size="small" :type="txWallet.identityOk && txWallet.splitOk ? 'success' : 'danger'">
            {{ txWallet.identityOk && txWallet.splitOk ? '账实一致' : '存在差额' }}
          </el-tag>
        </div>
      </div>

      <el-table :data="txRows" v-loading="txLoading" border stripe size="small" max-height="340">
        <el-table-column prop="createdAt" label="时间" width="140">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="typeLabel" label="类型" width="130" show-overflow-tooltip />
        <el-table-column prop="pointsTypeLabel" label="积分类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.pointsType === 'DELIVERY_FEE' ? 'warning' : 'success'">
              {{ row.pointsTypeLabel || '-' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="pointsMonth" label="发行月份" width="96" align="center">
          <template #default="{ row }">{{ row.pointsMonth || '-' }}</template>
        </el-table-column>
        <el-table-column prop="signedAmount" label="积分变动" width="104" align="right">
          <template #default="{ row }">
            <span :class="row.direction === 1 ? 'in-text' : 'out-text'">
              {{ row.direction === 1 ? '+' : '−' }}{{ fmtPoints(row.amount) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="变动后余额" width="110" align="right">
          <template #default="{ row }">{{ fmtPoints(row.balanceAfter) }}</template>
        </el-table-column>
        <el-table-column prop="operatorId" label="操作人" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ operatorText(row.operatorId) }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.remark || '-' }}</template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="txPage"
          :page-size="txPageSize"
          :total="txTotal"
          layout="total, prev, pager, next"
          background
          @current-change="fetchTxs"
        />
      </div>

      <el-divider content-position="left">配送费积分 · 按月明细（按发行月份归集）</el-divider>
      <el-table :data="monthly" border size="small" max-height="220">
        <el-table-column prop="month" label="发行月份" width="120" />
        <el-table-column prop="credited" label="发放" width="110" align="right">
          <template #default="{ row }">{{ fmtPoints(row.credited) }}</template>
        </el-table-column>
        <el-table-column prop="reverted" label="回冲（作废/减量）" width="150" align="right">
          <template #default="{ row }">{{ fmtPoints(row.reverted) }}</template>
        </el-table-column>
        <el-table-column prop="net" label="净额" width="110" align="right">
          <template #default="{ row }">{{ fmtPoints(row.net) }}</template>
        </el-table-column>
        <el-table-column prop="count" label="笔数" width="80" align="center" />
        <el-table-column label="说明" min-width="180">
          <template #default>净额 = 该月发放后仍留在账面的量（不追踪"消耗属于哪个月"）</template>
        </el-table-column>
      </el-table>
      <div v-if="!monthly.length" class="monthly-empty">该钱包暂无配送费积分发行记录</div>

      <template #footer>
        <el-button @click="txsVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getWallets, openWallet, adjustWallet, getWalletTransactions } from '@/api/wallet'

// ---------------------------------------------------------------------------
// 积分钱包管理（Web 管理端）
//
// ⚠️ 本页是**在线充值下线后**充值积分的唯一发放入口（另一处是小程序管理端），
//    因此「未开立钱包的主体也要能开立」是硬需求：从没用过小程序的水站不会自己长出钱包。
// ⚠️ 幂等键由本页生成（打开调整弹窗时生成一次）：服务端强校验，缺键直接 400。
//    被业务校验拒掉的请求会在服务端**整单回滚**（连幂等键一起），所以失败后原键重试是安全的。
// ---------------------------------------------------------------------------

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const totals = ref({ total: 0, rechargeTotal: 0, deliveryFeeTotal: 0 })
const summary = ref({ count: 0, openedCount: 0, unopenedCount: 0 })
const pointsTypeOptions = ref([
  { value: 'RECHARGE', label: '充值积分' },
  { value: 'DELIVERY_FEE', label: '配送费积分' }
])
const current = ref({})
const openingKey = ref('')

const query = reactive({ ownerType: '', keyword: '' })

// 窄屏适配（用户约定：对话框宽度响应式、表单标签窄屏转顶部）
const isNarrow = ref(typeof window !== 'undefined' && window.innerWidth <= 768)
const onResize = () => {
  isNarrow.value = window.innerWidth <= 768
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const dialogWidth = computed(() => (isNarrow.value ? '94vw' : '520px'))
const txsWidth = computed(() => (isNarrow.value ? '94vw' : '920px'))

const keyOf = row => `${row.ownerType}::${row.ownerId}`
const fmtPoints = v => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const formatTime = t => {
  if (!t) return '-'
  const d = new Date(t)
  if (isNaN(d)) return String(t)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
/** 操作人标识 → 可读文案（web:admin / mini:12 / smoke:… 三种来源） */
const operatorText = id => {
  if (!id) return '-'
  const s = String(id)
  if (s.startsWith('web:')) return `网页端 ${s.slice(4)}`
  if (s.startsWith('mini:')) return `小程序 ${s.slice(5)}`
  return s
}

const fetchList = async () => {
  loading.value = true
  try {
    const res = await getWallets({ ownerType: query.ownerType || undefined, keyword: query.keyword || undefined })
    const data = res.data || {}
    list.value = data.list || []
    totals.value = data.totals || { total: 0, rechargeTotal: 0, deliveryFeeTotal: 0 }
    summary.value = {
      count: data.count || 0,
      openedCount: data.openedCount || 0,
      unopenedCount: data.unopenedCount || 0
    }
    if (Array.isArray(data.pointsTypeOptions) && data.pointsTypeOptions.length) {
      pointsTypeOptions.value = data.pointsTypeOptions
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '积分钱包查询失败')
  } finally {
    loading.value = false
  }
}
const resetQuery = () => {
  query.ownerType = ''
  query.keyword = ''
  fetchList()
}

// ---- 开立钱包 ----
const doOpen = async row => {
  try {
    await ElMessageBox.confirm(
      `为主体「${row.ownerName}」开立积分钱包？开立后即可发放充值积分。\n（重复点击是安全的：同一主体只会有一个钱包）`,
      '开立确认',
      { type: 'info' }
    )
  } catch {
    return
  }
  openingKey.value = keyOf(row)
  try {
    await openWallet({ ownerType: row.ownerType, ownerId: row.ownerId })
    ElMessage.success('积分钱包已开立')
    fetchList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '开立失败')
  } finally {
    openingKey.value = ''
  }
}

// ---- 调整积分 ----
const adjustVisible = ref(false)
const adjustForm = reactive({ pointsType: 'RECHARGE', direction: 'IN', amount: null, reason: '', remark: '' })
// ⚠️ 幂等键：打开弹窗时生成一次；提交成功后作废（下次打开再生成）。
//    业务失败时**沿用同一个键**是安全的 —— 服务端会连幂等键一起回滚。
let idemKey = ''

const newIdemKey = () => `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

const currentBalanceOf = type => {
  if (!current.value) return 0
  return type === 'DELIVERY_FEE'
    ? Number(current.value.deliveryFeeBalance || 0)
    : Number(current.value.rechargeBalance || 0)
}
const overLimit = computed(() => {
  if (adjustForm.direction !== 'OUT') return false
  const amt = Number(adjustForm.amount || 0)
  if (!amt) return false
  return amt > currentBalanceOf(adjustForm.pointsType) + 1e-9
})

const openAdjust = row => {
  current.value = row
  // 默认加充值积分（= 业务口径里「管理员后台设置的那一类」），方向默认增加
  adjustForm.pointsType = pointsTypeOptions.value[0]?.value || 'RECHARGE'
  adjustForm.direction = 'IN'
  adjustForm.amount = null
  adjustForm.reason = ''
  adjustForm.remark = ''
  idemKey = newIdemKey()
  adjustVisible.value = true
}

const submitAdjust = async () => {
  const amt = Number(adjustForm.amount || 0)
  if (!amt || amt <= 0) {
    ElMessage.warning('请输入大于 0 的积分数量')
    return
  }
  // 操作原因必填（§18）：前端先拦一道，服务端同样强校验
  if (!adjustForm.reason.trim()) {
    ElMessage.warning('请填写操作原因')
    return
  }
  if (overLimit.value) {
    ElMessage.warning('扣减数量超过该类型可用积分')
    return
  }
  const dirLabel = adjustForm.direction === 'IN' ? '增加' : '扣减'
  saving.value = true
  try {
    const res = await adjustWallet(current.value.walletId, {
      direction: adjustForm.direction,
      amount: amt,
      pointsType: adjustForm.pointsType,
      reason: adjustForm.reason.trim(),
      remark: adjustForm.remark.trim(),
      clientRequestId: idemKey
    })
    // 服务端对重复请求回 200 + replayed，提示要说清楚，否则管理员会以为没生效又点一次
    if (res.data && res.data.replayed) {
      ElMessage.info('该操作已处理过（重复请求已合并，积分未重复变动）')
    } else {
      ElMessage.success(`积分已${dirLabel}：${fmtPoints(amt)}`)
    }
    idemKey = newIdemKey() // 作废已用键：下一次提交就是一笔新操作
    adjustVisible.value = false
    fetchList()
  } catch (e) {
    ElMessage.error(e.response?.data?.message || `${dirLabel}失败`)
  } finally {
    saving.value = false
  }
}

// ---- 流水 ----
const txsVisible = ref(false)
const txLoading = ref(false)
const txRows = ref([])
const txWallet = ref(null)
const monthly = ref([])
const txTotal = ref(0)
const txPage = ref(1)
const txPageSize = 20

const openTxs = async row => {
  current.value = row
  txsVisible.value = true
  txPage.value = 1
  txRows.value = []
  txWallet.value = null
  monthly.value = []
  fetchTxs()
}
const fetchTxs = async () => {
  txLoading.value = true
  try {
    const res = await getWalletTransactions(current.value.walletId, { page: txPage.value, pageSize: txPageSize })
    const data = res.data || {}
    txRows.value = data.transactions || []
    txTotal.value = data.total || 0
    txWallet.value = data.wallet || null
    monthly.value = data.deliveryFeeMonthly || []
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '积分流水查询失败')
  } finally {
    txLoading.value = false
  }
}

onMounted(fetchList)
</script>

<style scoped>
.wallet-manage {
  padding: 0;
}
.filter-card {
  margin-bottom: 14px;
  border-radius: var(--radius-md);
}
.head-row {
  margin-bottom: 12px;
}
.title {
  font-size: 15px;
  font-weight: 600;
}
.filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

/* 汇总 */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.sum-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card);
  padding: 12px 14px;
}
.sum-label {
  font-size: 12px;
  color: var(--text-2);
}
.sum-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  margin-top: 4px;
}
.sum-recharge {
  color: var(--primary);
}
.sum-delivery {
  color: var(--gold);
}
.sum-sub {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 2px;
}

/* 主体卡片 */
.owner-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
}
.owner-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.2s;
}
.owner-card:hover {
  box-shadow: var(--shadow-md);
}
.owner-card.is-unopened {
  background: var(--bg);
}
.owner-card.is-disabled {
  opacity: 0.6;
}
.oc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 6px;
}
.oc-type {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: var(--primary-light);
  color: var(--primary);
}
.oc-name {
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.oc-id {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-3);
}
.oc-total-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.oc-label {
  font-size: 12px;
  color: var(--text-2);
}
.oc-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1.2;
}
.oc-split {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-2);
}
.oc-sub b {
  color: var(--text);
  margin-left: 4px;
}
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 5px;
  vertical-align: middle;
}
.dot-recharge {
  background: var(--primary);
}
.dot-delivery {
  background: var(--gold);
}
.oc-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}
.oc-empty {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.6;
}
.oc-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

/* 弹窗内 */
.form-hint {
  font-size: 12px;
  color: var(--text-2);
  margin-top: 4px;
  line-height: 1.5;
}
.hint-weak {
  color: var(--text-3);
}
.in-text {
  color: var(--green);
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
.monthly-empty {
  font-size: 13px;
  color: var(--text-3);
  padding: 6px 0;
}
.tx-head {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.tx-head-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tx-head-label {
  font-size: 12px;
  color: var(--text-2);
}
.tx-head-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

@media (max-width: 768px) {
  .owner-grid {
    grid-template-columns: 1fr;
  }
  .oc-actions .el-button {
    flex: 1;
  }
}
</style>

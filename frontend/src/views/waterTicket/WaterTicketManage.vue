<template>
  <div class="page-container">
    <el-card class="filter-card" shadow="never">
      <el-tabs v-model="activeTab">
        <!-- 返货清单/发行 -->
        <el-tab-pane label="返货清单/发行" name="issue">
          <div class="issue-form">
            <el-form label-width="90px" class="issue-form-grid">
              <el-form-item label="水站" required>
                <el-select v-model="issueForm.stationId" filterable placeholder="请选择水站" style="width: 100%">
                  <el-option v-for="s in stationOptions" :key="s.id" :label="s.name" :value="s.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="所属月份" required>
                <el-date-picker v-model="issueForm.month" type="month" value-format="YYYY-MM" placeholder="选择月份" style="width: 100%" />
              </el-form-item>
            </el-form>
            <div class="issue-items">
              <div v-for="(it, idx) in issueForm.items" :key="idx" class="issue-item-row">
                <span class="item-label">商品</span>
                <el-select v-model="it.productId" filterable placeholder="请选择商品" style="width: 36%" @change="(pid) => onIssueProductChange(it, pid)">
                  <el-option v-for="p in productOptions" :key="p.id" :label="`${p.name}（${p.spec || ''}）`" :value="p.id" />
                </el-select>
                <span class="item-label">数量</span>
                <el-input-number v-model="it.quantity" :min="1" :precision="0" :step="1" style="width: 20%" @change="(v) => onIssueQuantityChange(it, v)" />
                <span class="item-label">分销配送费</span>
                <el-input-number v-model="it.distributionDeliveryFee" :min="0" :precision="2" :step="0.5" style="width: 22%" />
                <el-button link type="danger" :disabled="issueForm.items.length === 1" @click="removeIssueItem(idx)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
              <div class="issue-actions">
                <el-button type="primary" plain size="small" @click="addIssueItem">
                  <el-icon><Plus /></el-icon>添加商品
                </el-button>
                <el-button type="primary" :loading="issuing" @click="handleIssue">
                  <el-icon><DocumentAdd /></el-icon>录入并发行水票
                </el-button>
              </div>
              <span class="issue-hint">按每月返货清单录入：商品 × 数量 = 生成等量水票；分销配送费自动带出商品档案（可修改）。</span>
            </div>
          </div>
        </el-tab-pane>

        <!-- 水站账户详情 -->
        <el-tab-pane label="水站账户详情" name="inventory">
          <div class="filter-bar">
            <el-select v-model="invFilter.stationId" filterable clearable placeholder="水站" style="width: 200px">
              <el-option v-for="s in stationOptions" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-button type="primary" @click="fetchInventory"><el-icon><Search /></el-icon>查询</el-button>
          </div>
          <el-table :data="inventoryList" v-loading="loading" border stripe size="small" :span-method="invSpanMethod">
            <el-table-column prop="stationName" label="水站" width="140" />
            <el-table-column prop="productName" label="商品" min-width="180" show-overflow-tooltip />
            <el-table-column prop="specification" label="规格" width="110" />
            <el-table-column prop="available" label="水票余额" width="110" align="center">
              <template #default="{ row }"><el-tag type="success">{{ row.available }} 张</el-tag></template>
            </el-table-column>
            <el-table-column prop="deliveryFeeTotal" label="分销配送费余额" width="140" align="right">
              <template #default="{ row }">¥{{ fmtMoney(row.deliveryFeeTotal) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="90" align="center" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openAdjust(row)">调整</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 发行记录（可编辑） -->
    <el-card class="detail-card" shadow="never" v-if="activeTab === 'issue'">
      <template #header>发行记录（返货清单，管理员可修改）</template>
      <el-table :data="issuanceRows" border stripe size="small">
        <el-table-column prop="month" label="月份" width="90" />
        <el-table-column prop="stationName" label="水站" width="130" />
        <el-table-column prop="productName" label="商品" min-width="180" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量(水票数)" width="110" align="center" />
        <el-table-column prop="distributionDeliveryFee" label="分销配送费" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.distributionDeliveryFee) }}</template>
        </el-table-column>
        <el-table-column prop="createdBy" label="录入人" width="100" />
        <el-table-column prop="createdAt" label="录入时间" width="165" />
        <el-table-column label="操作" width="80" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditIssuance(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="issuanceTotal"
          :page-size="issuancePage.pageSize"
          :current-page="issuancePage.page"
          @current-change="(p) => { issuancePage.page = p; fetchIssuances() }"
        />
      </div>
    </el-card>

    <!-- 编辑发行记录弹窗 -->
    <el-dialog v-model="editIssuanceVisible" title="编辑发行记录" :width="dialogWidth" @closed="resetEditForm">
      <el-form ref="editFormRef" :model="editForm" :rules="editRules" label-width="100px">
        <el-form-item label="水站/商品">
          <span>{{ editForm.stationName }} - {{ editForm.productName }}</span>
        </el-form-item>
        <el-form-item label="数量" prop="quantity">
          <el-input-number v-model="editForm.quantity" :min="1" :precision="0" :step="1" style="width: 100%" @change="onEditQuantityChange" />
          <span class="unit-label">改大自动补发水票；改小作废未用水票（已核销不可减）；分销配送费随数量自动重算</span>
        </el-form-item>
        <el-form-item label="分销配送费" prop="distributionDeliveryFee">
          <el-input-number v-model="editForm.distributionDeliveryFee" :min="0" :precision="2" :step="0.5" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editIssuanceVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSaveIssuance">保存</el-button>
      </template>
    </el-dialog>

    <!-- 水站账户调整弹窗 -->
    <el-dialog v-model="adjustVisible" title="调整水票余额" :width="dialogWidth">
      <el-form label-width="100px">
        <el-form-item label="水站/商品">
          <span>{{ adjustRow.stationName }} - {{ adjustRow.productName }}</span>
        </el-form-item>
        <el-form-item label="当前余额">
          <el-tag type="success">{{ adjustRow.available }} 张</el-tag>
        </el-form-item>
        <el-form-item label="目标数量" required>
          <el-input-number v-model="adjustTarget" :min="0" :precision="0" :step="1" style="width: 100%" />
          <span class="unit-label">改大自动补发；改小作废未用水票</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleAdjust">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Delete, DocumentAdd } from '@element-plus/icons-vue'
import {
  issueTickets, getTicketInventory, getIssuanceList,
  updateIssuance, adjustBalance
} from '@/api/waterTicket'
import { getStations } from '@/api/station'
import { getProductList } from '@/api/product'

const activeTab = ref('issue')

const loading = ref(false)
const issuing = ref(false)
const saving = ref(false)
const stationOptions = ref([])
const productOptions = ref([])
const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '520px'))

// ---- 返货清单/发行 ----
const issueForm = reactive({
  stationId: '',
  month: '',
  items: [{ productId: '', quantity: 1, distributionDeliveryFee: 0, unitDeliveryFee: 0 }]
})
const addIssueItem = () => issueForm.items.push({ productId: '', quantity: 1, distributionDeliveryFee: 0, unitDeliveryFee: 0 })
const removeIssueItem = (idx) => { if (issueForm.items.length > 1) issueForm.items.splice(idx, 1) }
// 选择商品自动带出商品档案的单件分销配送费，并按当前数量计算总额
const onIssueProductChange = (it, pid) => {
  const p = productOptions.value.find((x) => String(x.id) === String(pid))
  it.unitDeliveryFee = p ? Number(p.distributionDeliveryFee || p.distribution_delivery_fee || 0) : 0
  it.distributionDeliveryFee = Number((it.unitDeliveryFee * (it.quantity || 1)).toFixed(2))
}
// 数量变化：分销配送费 = 单件配送费 × 数量（自动联动，可再手改）
const onIssueQuantityChange = (it, v) => {
  it.distributionDeliveryFee = Number((it.unitDeliveryFee * (Number(v) || 1)).toFixed(2))
}

const handleIssue = async () => {
  if (!issueForm.stationId) { ElMessage.warning('请选择水站'); return }
  if (!issueForm.month) { ElMessage.warning('请选择所属月份'); return }
  const items = issueForm.items.filter((x) => x.productId && x.quantity > 0)
  if (items.length === 0) { ElMessage.warning('请至少填写一条返货商品'); return }
  issuing.value = true
  try {
    const res = await issueTickets({
      stationId: issueForm.stationId,
      month: issueForm.month,
      items: items.map((x) => ({ productId: x.productId, quantity: x.quantity, distributionDeliveryFee: x.distributionDeliveryFee || 0 }))
    })
    ElMessage.success(res.message || '发行成功')
    issueForm.items = [{ productId: '', quantity: 1, distributionDeliveryFee: 0 }]
    fetchIssuances()
    fetchInventory()
  } catch (e) {
    console.error('发行失败:', e)
    ElMessage.error(e.response?.data?.message || '发行失败')
  } finally {
    issuing.value = false
  }
}

// ---- 水站账户详情 ----
const invFilter = reactive({ stationId: '' })
const inventoryList = ref([])
const fetchInventory = async () => {
  loading.value = true
  try {
    const res = await getTicketInventory({ stationId: invFilter.stationId || undefined })
    inventoryList.value = res.data?.list || []
  } catch (e) { console.error(e) } finally { loading.value = false }
}

// 水站名称列合并单元格（同一水站连续行合并）
const invSpanMap = computed(() => {
  const map = {}
  const list = inventoryList.value
  let i = 0
  while (i < list.length) {
    const st = list[i].stationId
    let j = i
    while (j + 1 < list.length && list[j + 1].stationId === st) j++
    for (let k = i; k <= j; k++) {
      map[k] = k === i ? { rowspan: j - i + 1, hidden: false } : { rowspan: 0, hidden: true }
    }
    i = j + 1
  }
  return map
})
const invSpanMethod = ({ rowIndex, columnIndex }) => {
  if (columnIndex === 0) {
    const s = invSpanMap.value[rowIndex]
    if (!s) return
    return s.hidden ? { rowspan: 0, colspan: 0 } : { rowspan: s.rowspan, colspan: 1 }
  }
}

// ---- 发行记录 ----
const issuanceRows = ref([])
const issuanceTotal = ref(0)
const issuancePage = reactive({ page: 1, pageSize: 10 })
const fetchIssuances = async () => {
  try {
    const res = await getIssuanceList({ page: issuancePage.page, pageSize: issuancePage.pageSize })
    issuanceRows.value = res.data?.list || []
    issuanceTotal.value = res.data?.total || 0
  } catch (e) { console.error(e) }
}

// ---- 编辑发行记录 ----
const editIssuanceVisible = ref(false)
const editFormRef = ref(null)
const editForm = reactive({ issuanceId: '', stationName: '', productName: '', quantity: 1, distributionDeliveryFee: 0, unitDeliveryFee: 0, remark: '' })
const editRules = {
  quantity: [{ required: true, message: '请输入数量', trigger: 'blur' }],
  distributionDeliveryFee: [{ required: true, message: '请输入分销配送费', trigger: 'blur' }]
}
const openEditIssuance = (row) => {
  editForm.issuanceId = row.issuanceId
  editForm.stationName = row.stationName
  editForm.productName = row.productName
  editForm.quantity = row.quantity
  editForm.distributionDeliveryFee = row.distributionDeliveryFee
  editForm.unitDeliveryFee = Number(row.quantity) > 0 ? Number(row.distributionDeliveryFee) / Number(row.quantity) : 0
  editForm.remark = row.remark || ''
  editIssuanceVisible.value = true
}
// 编辑时数量变化：配送费随单件配送费联动重算
const onEditQuantityChange = (v) => {
  editForm.distributionDeliveryFee = Number((editForm.unitDeliveryFee * (Number(v) || 1)).toFixed(2))
}
const resetEditForm = () => { editFormRef.value?.clearValidate() }
const handleSaveIssuance = async () => {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const res = await updateIssuance(editForm.issuanceId, {
      quantity: editForm.quantity,
      distributionDeliveryFee: editForm.distributionDeliveryFee,
      remark: editForm.remark
    })
    ElMessage.success(res.message || '修改成功')
    editIssuanceVisible.value = false
    fetchIssuances()
    fetchInventory()
  } catch (e) {
    console.error('编辑失败:', e)
    ElMessage.error(e.response?.data?.message || '修改失败')
  } finally {
    saving.value = false
  }
}

// ---- 水站账户调整 ----
const adjustVisible = ref(false)
const adjustRow = reactive({ stationId: '', stationName: '', productId: '', productName: '', available: 0 })
const adjustTarget = ref(0)
const openAdjust = (row) => {
  adjustRow.stationId = row.stationId
  adjustRow.stationName = row.stationName
  adjustRow.productId = row.productId
  adjustRow.productName = row.productName
  adjustRow.available = row.available
  adjustTarget.value = row.available
  adjustVisible.value = true
}
const handleAdjust = async () => {
  if (adjustTarget.value < 0) { ElMessage.warning('目标数量不能为负数'); return }
  saving.value = true
  try {
    const res = await adjustBalance({
      stationId: adjustRow.stationId,
      productId: adjustRow.productId,
      targetQuantity: adjustTarget.value
    })
    ElMessage.success(res.message || '调整成功')
    adjustVisible.value = false
    fetchInventory()
    fetchIssuances()
  } catch (e) {
    console.error('调整失败:', e)
    ElMessage.error(e.response?.data?.message || '调整失败')
  } finally {
    saving.value = false
  }
}

const fmtMoney = (v) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const loadOptions = async () => {
  try {
    const s = await getStations({ pageSize: 100 })
    stationOptions.value = (s.data?.list || s.data || []).map((x) => ({ id: x.station_id || x.stationId, name: x.station_name || x.stationName }))
  } catch (e) { console.error('加载水站失败:', e) }
  try {
    const p = await getProductList({ status: 1, pageSize: 200 })
    productOptions.value = p.data?.list || p.data || []
  } catch (e) { console.error('加载商品失败:', e) }
}

onMounted(() => {
  loadOptions()
  issueForm.month = new Date().toISOString().slice(0, 7)
  fetchIssuances()
  fetchInventory()
})
</script>

<style scoped>
.page-container { display: flex; flex-direction: column; gap: 16px; }
.filter-card, .detail-card { border-radius: 10px; }
.filter-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }
.issue-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
.issue-items { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.issue-item-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.item-label { font-size: 12px; color: #909399; white-space: nowrap; }
.issue-actions { display: flex; align-items: center; gap: 10px; }
.issue-hint { font-size: 12px; color: #909399; }
.unit-label { margin-left: 8px; font-size: 12px; color: #909399; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
@media screen and (max-width: 768px) {
  .issue-form-grid { grid-template-columns: 1fr; }
  .issue-item-row .el-select, .issue-item-row .el-input-number { width: 100% !important; }
}
</style>

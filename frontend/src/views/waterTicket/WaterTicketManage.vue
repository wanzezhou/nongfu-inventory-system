<template>
  <div class="page-container">
    <el-card class="filter-card" shadow="never">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <!-- 返货清单/发行 -->
        <el-tab-pane label="返货清单/发行" name="issue">
          <div class="issue-form">
            <el-form :model="issueForm" label-width="90px" class="issue-form-grid">
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
                <el-select v-model="it.productId" filterable placeholder="请选择商品" style="width: 38%" @change="(pid) => onIssueProductChange(it, pid)">
                  <el-option v-for="p in productOptions" :key="p.id" :label="`${p.name}（${p.spec || ''}）`" :value="p.id" />
                </el-select>
                <span class="item-label">数量</span>
                <el-input-number v-model="it.quantity" :min="1" :precision="0" :step="1" style="width: 22%" />
                <span class="item-label">返货配送费</span>
                <el-input-number v-model="it.returnDeliveryFee" :min="0" :precision="2" :step="5" style="width: 24%" />
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
              <span class="issue-hint">按每月返货清单录入：商品 × 数量 = 生成等量水票；返货配送费随清单记录（计入成本统计）。</span>
            </div>
          </div>
        </el-tab-pane>

        <!-- 水票库存 -->
        <el-tab-pane label="水票库存" name="inventory">
          <div class="filter-bar">
            <el-select v-model="invFilter.stationId" filterable clearable placeholder="水站" style="width: 200px">
              <el-option v-for="s in stationOptions" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-button type="primary" @click="fetchInventory"><el-icon><Search /></el-icon>查询</el-button>
          </div>
          <el-table :data="inventoryList" v-loading="loading" border stripe size="small">
            <el-table-column prop="stationName" label="水站" width="140" />
            <el-table-column prop="productName" label="商品" min-width="180" show-overflow-tooltip />
            <el-table-column prop="specification" label="规格" width="110" />
            <el-table-column prop="available" label="可用水票" width="100" align="center">
              <template #default="{ row }"><el-tag type="success">{{ row.available }} 张</el-tag></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 水票明细/核销流水 -->
        <el-tab-pane label="水票明细/核销流水" name="list">
          <div class="filter-bar">
            <el-select v-model="listFilter.stationId" filterable clearable placeholder="水站" style="width: 180px">
              <el-option v-for="s in stationOptions" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-model="listFilter.status" clearable placeholder="状态" style="width: 120px">
              <el-option label="未用" :value="1" />
              <el-option label="已核销" :value="2" />
              <el-option label="作废" :value="3" />
            </el-select>
            <el-button type="primary" @click="fetchTicketList"><el-icon><Search /></el-icon>查询</el-button>
          </div>
          <el-table :data="ticketRows" v-loading="loading" border stripe size="small">
            <el-table-column prop="ticketId" label="水票编号" width="200" show-overflow-tooltip />
            <el-table-column prop="stationName" label="水站" width="120" />
            <el-table-column prop="productName" label="商品" min-width="160" show-overflow-tooltip />
            <el-table-column prop="month" label="月份" width="80" />
            <el-table-column prop="statusName" label="状态" width="80" align="center">
              <template #default="{ row }">
                <el-tag :type="{ 1: 'success', 2: 'info', 3: 'danger' }[row.status]">{{ row.statusName }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="orderId" label="核销订单" width="170" show-overflow-tooltip />
            <el-table-column prop="usedAt" label="核销时间" width="160" />
            <el-table-column label="操作" width="80" align="center" fixed="right">
              <template #default="{ row }">
                <el-button v-if="row.status === 1" link type="danger" @click="handleCancel(row)">作废</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background
              layout="total, prev, pager, next"
              :total="ticketTotal"
              :page-size="ticketPage.pageSize"
              :current-page="ticketPage.page"
              @current-change="(p) => { ticketPage.page = p; fetchTicketList() }"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 发行记录 -->
    <el-card class="detail-card" shadow="never" v-if="activeTab === 'issue'">
      <template #header>发行记录（返货清单）</template>
      <el-table :data="issuanceRows" border stripe size="small">
        <el-table-column prop="month" label="月份" width="90" />
        <el-table-column prop="stationName" label="水站" width="130" />
        <el-table-column prop="productName" label="商品" min-width="180" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量(水票数)" width="110" align="center" />
        <el-table-column prop="returnDeliveryFee" label="返货配送费" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.returnDeliveryFee) }}</template>
        </el-table-column>
        <el-table-column prop="createdBy" label="录入人" width="100" />
        <el-table-column prop="createdAt" label="录入时间" width="165" />
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Delete, DocumentAdd } from '@element-plus/icons-vue'
import { issueTickets, getTicketInventory, getTicketList, cancelTicket, getIssuanceList } from '@/api/waterTicket'
import { getStations } from '@/api/station'
import { getProductList } from '@/api/product'

const props = defineProps({
  tab: { type: String, default: 'issue' }
})

const activeTab = ref(props.tab || 'issue')
watch(() => props.tab, (v) => { if (v) activeTab.value = v })

const loading = ref(false)
const issuing = ref(false)
const stationOptions = ref([])
const productOptions = ref([])

// ---- 返货清单/发行 ----
const issueForm = reactive({
  stationId: '',
  month: '',
  items: [{ productId: '', quantity: 1, returnDeliveryFee: 0 }]
})
const addIssueItem = () => issueForm.items.push({ productId: '', quantity: 1, returnDeliveryFee: 0 })
const removeIssueItem = (idx) => { if (issueForm.items.length > 1) issueForm.items.splice(idx, 1) }
const onIssueProductChange = () => {}

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
      items: items.map((x) => ({ productId: x.productId, quantity: x.quantity, returnDeliveryFee: x.returnDeliveryFee || 0 }))
    })
    ElMessage.success(res.message || '发行成功')
    issueForm.items = [{ productId: '', quantity: 1, returnDeliveryFee: 0 }]
    fetchIssuances()
    fetchInventory()
  } catch (e) {
    console.error('发行失败:', e)
    ElMessage.error(e.response?.data?.message || '发行失败')
  } finally {
    issuing.value = false
  }
}

// ---- 水票库存 ----
const invFilter = reactive({ stationId: '' })
const inventoryList = ref([])
const fetchInventory = async () => {
  loading.value = true
  try {
    const res = await getTicketInventory({ stationId: invFilter.stationId || undefined })
    inventoryList.value = res.data?.list || []
  } catch (e) { console.error(e) } finally { loading.value = false }
}

// ---- 水票明细 ----
const listFilter = reactive({ stationId: '', status: '' })
const ticketRows = ref([])
const ticketTotal = ref(0)
const ticketPage = reactive({ page: 1, pageSize: 10 })
const fetchTicketList = async () => {
  loading.value = true
  try {
    const res = await getTicketList({
      stationId: listFilter.stationId || undefined,
      status: listFilter.status === '' ? undefined : listFilter.status,
      page: ticketPage.page,
      pageSize: ticketPage.pageSize
    })
    ticketRows.value = res.data?.list || []
    ticketTotal.value = res.data?.total || 0
  } catch (e) { console.error(e) } finally { loading.value = false }
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

const handleCancel = (row) => {
  ElMessageBox.confirm(`确认作废水票 ${row.ticketId}（${row.productName}）？`, '作废确认', {
    type: 'warning', confirmButtonText: '作废', cancelButtonText: '取消'
  })
    .then(async () => {
      await cancelTicket(row.ticketId)
      ElMessage.success('已作废')
      fetchTicketList()
      fetchInventory()
    })
    .catch(() => {})
}

const handleTabChange = () => {
  if (activeTab.value === 'inventory') fetchInventory()
  if (activeTab.value === 'list') fetchTicketList()
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
  fetchTicketList()
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
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
@media screen and (max-width: 768px) {
  .issue-form-grid { grid-template-columns: 1fr; }
  .issue-item-row { flex-wrap: wrap; }
  .issue-item-row .el-select, .issue-item-row .el-input-number { width: 100% !important; }
}
</style>

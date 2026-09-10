<template>
  <div class="barrel-ledger">
    <el-card class="filter-card" shadow="never">
      <div class="head-row">
        <span class="title">押金台账（在押桶数与押金余额）</span>
        <div class="filter-right">
          <el-select v-model="query.partyType" placeholder="对象类型" clearable style="width: 130px;" @change="load">
            <el-option label="水站" value="station" />
            <el-option label="零售客户" value="customer" />
          </el-select>
          <el-select v-model="query.stationId" v-if="query.partyType === 'station'" filterable placeholder="水站" clearable style="width: 170px;" @change="load">
            <el-option v-for="s in stations" :key="s.stationId" :label="s.stationName" :value="s.stationId" />
          </el-select>
          <el-input v-else-if="query.partyType === 'customer'" v-model="query.customerName" placeholder="客户姓名" clearable style="width: 150px;" @keyup.enter="load" @clear="load" />
          <el-select v-model="query.barrelType" placeholder="桶型" clearable style="width: 120px;" @change="load">
            <el-option v-for="c in configs" :key="c.id" :label="c.barrelType" :value="c.barrelType" />
          </el-select>
          <el-button type="primary" @click="load">查询</el-button>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" v-loading="loading">
      <el-table :data="list" stripe>
        <el-table-column label="对象" min-width="180">
          <template #default="{ row }">
            {{ row.partyName }}<span v-if="row.partyType === 'customer'" class="dim-text">（零售）</span>
          </template>
        </el-table-column>
        <el-table-column prop="barrelType" label="桶型" width="100" />
        <el-table-column label="在押桶数" width="110" align="center">
          <template #default="{ row }">
            <span class="qty">{{ row.pendingQty }} 桶</span>
          </template>
        </el-table-column>
        <el-table-column label="押金余额" width="130" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.pendingAmount) }}</template>
        </el-table-column>
        <el-table-column label="押金单价" width="110" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.unitPrice) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && list.length === 0" description="暂无在押押金" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getBarrelSummary } from '@/api/barrel'
import { getBarrelConfigs } from '@/api/barrel'
import { getStations } from '@/api/station'
import { formatMoney } from '@/utils/format'

const fmtMoney = (v) => formatMoney(v)

const list = ref([])
const loading = ref(false)
const stations = ref([])
const configs = ref([])
const query = reactive({ partyType: '', stationId: '', customerName: '', barrelType: '' })

// 后端 /stations 返回 snake_case 字段，统一映射为 camelCase
const mapStation = (x) => ({
  stationId: x.stationId ?? x.station_id,
  stationName: x.stationName ?? x.station_name
})

async function load() {
  loading.value = true
  try {
    const params = {}
    if (query.partyType) params.partyType = query.partyType
    if (query.stationId) params.stationId = query.stationId
    if (query.customerName) params.customerName = query.customerName
    if (query.barrelType) params.barrelType = query.barrelType
    const r = await getBarrelSummary(params)
    list.value = r?.data?.list || []
  } catch {
    // 失败不清空旧数据，静默提示
    list.value = []
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  load()
  const [st, cfg] = await Promise.all([
    getStations().catch(() => null),
    getBarrelConfigs().catch(() => null)
  ])
  stations.value = (st?.data?.list || []).map(mapStation)
  configs.value = cfg?.data?.list || []
})
</script>

<style scoped>
.barrel-ledger { padding: 4px; }
.filter-card { margin-bottom: 16px; }
.head-row { display: flex; justify-content: space-between; align-items: center; }
.title { font-size: 15px; font-weight: 600; color: var(--text); }
.filter-right { display: flex; gap: 8px; flex-wrap: wrap; }
.qty { font-weight: 600; color: var(--primary); }
.dim-text { color: var(--text-2); font-size: 12px; }
</style>

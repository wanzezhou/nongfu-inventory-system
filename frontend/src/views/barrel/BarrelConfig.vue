<template>
  <div class="barrel-config">
    <el-card shadow="never">
      <div class="head-row">
        <span class="title">桶型押金配置</span>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新增桶型
        </el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="barrelType" label="桶型" min-width="140" />
        <el-table-column label="押金单价" width="130" align="right">
          <template #default="{ row }">¥{{ fmtMoney(row.depositPrice) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status ? 'success' : 'info'" size="small">{{ row.status ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sortOrder" label="排序" width="80" align="center" />
        <el-table-column label="操作" width="210" align="center">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" link @click="toggle(row)">{{ row.status ? '停用' : '启用' }}</el-button>
            <el-button size="small" type="danger" link @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑桶型' : '新增桶型'" width="min(480px, 94vw)" :close-on-click-modal="false" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="桶型" prop="barrelType">
          <el-input v-model="form.barrelType" placeholder="如：19L桶" maxlength="50" />
        </el-form-item>
        <el-form-item label="押金单价" prop="depositPrice">
          <el-input-number v-model="form.depositPrice" :min="0" :precision="2" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :precision="0" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getBarrelConfigs, createBarrelConfig, updateBarrelConfig, deleteBarrelConfig } from '@/api/barrel'
import { formatMoney } from '@/utils/format'

const fmtMoney = (v) => formatMoney(v)

const list = ref([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref(null)
const formRef = ref()

const form = reactive({ barrelType: '', depositPrice: 0, sortOrder: 0 })

const rules = {
  barrelType: [{ required: true, message: '请填写桶型', trigger: 'blur' }],
  depositPrice: [{ required: true, message: '请填写押金单价', trigger: 'blur' }]
}

async function load() {
  loading.value = true
  try {
    const r = await getBarrelConfigs()
    list.value = r?.data?.list || []
  } catch {
    ElMessage.error('桶型配置加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  Object.assign(form, { barrelType: '', depositPrice: 0, sortOrder: 0 })
  dialogVisible.value = true
}

function openEdit(row) {
  editingId.value = row.id
  Object.assign(form, { barrelType: row.barrelType, depositPrice: Number(row.depositPrice), sortOrder: Number(row.sortOrder) })
  dialogVisible.value = true
}

async function submit() {
  await formRef.value.validate()
  saving.value = true
  try {
    if (editingId.value) {
      await updateBarrelConfig(editingId.value, form)
    } else {
      await createBarrelConfig(form)
    }
    ElMessage.success('保存成功')
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggle(row) {
  const target = row.status ? 0 : 1
  await ElMessageBox.confirm(`确认${row.status ? '停用' : '启用'}「${row.barrelType}」？`, '提示', { type: 'warning' })
  try {
    await updateBarrelConfig(row.id, { ...row, status: target })
    ElMessage.success('操作成功')
    load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除桶型「${row.barrelType}」？删除后不可恢复。`, '提示', { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' })
  try {
    await deleteBarrelConfig(row.id)
    ElMessage.success('删除成功')
    load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.barrel-config { padding: 4px; }
.head-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.title { font-size: 15px; font-weight: 600; color: var(--text); }
</style>

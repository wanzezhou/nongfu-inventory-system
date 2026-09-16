<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    :width="dialogWidth"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
      <el-form-item label="员工" prop="workerId">
        <el-select
          v-model="form.workerId"
          filterable
          :disabled="!!workerId"
          placeholder="选择员工（全部员工可预支）"
          style="width: 100%"
          @change="onWorkerChange"
        >
          <el-option
            v-for="w in workers"
            :key="w.workerId"
            :label="`${w.workerName}（${employeeTypeLabel(w.employeeType)}）`"
            :value="w.workerId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="预支金额" prop="amount">
        <el-input-number
          v-model="form.amount"
          :min="0.01"
          :precision="2"
          :step="100"
          :controls="false"
          placeholder="预支金额"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="预支日期" prop="advanceDate">
        <el-date-picker
          v-model="form.advanceDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择预支日期"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="付款账户" prop="accountId">
        <AccountSelect
          v-model="form.accountId"
          :accounts="accounts"
          placeholder="选择付款账户（将产生公司账户支出）"
          balance-label="可用"
          :is-disabled="(a) => a.currentBalance < form.amount"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" placeholder="预支备注（可选）" />
      </el-form-item>
    </el-form>
    <div class="advance-hint">
      确认后将：① 从所选账户扣减 <b>¥{{ fmtMoney(form.amount) }}</b> 并记一笔公司支出（工资预支）；② 员工名下挂一笔待扣预支，发工资时从应发中抵扣。
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!form.amount" @click="submit">确认预支</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getAllWorkers } from '@/api/worker'
import { getFinanceAccounts } from '@/api/expense'
import { createSalaryAdvance } from '@/api/salary'
import { formatMoney as fmtMoney } from '@/utils/format'
import AccountSelect from '@/components/AccountSelect.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 预填员工（员工管理页行内发起时传入；工资页不传则下拉选择）
  workerId: { type: String, default: '' },
  workerName: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'success'])

const dialogWidth = computed(() => (window.innerWidth <= 768 ? '94vw' : '520px'))
const title = computed(() => (props.workerId ? `工资预支：${props.workerName || ''}` : '工资预支'))

const formRef = ref(null)
const saving = ref(false)
const workers = ref([])
const accounts = ref([])
const form = reactive({
  workerId: props.workerId,
  workerName: props.workerName,
  amount: 100,
  advanceDate: '',
  accountId: '',
  remark: ''
})

const employeeTypeLabel = (t) => ({ 1: '店长', 2: '配送员工', 3: '业务员', 4: '管理员' }[t] || '未知')

const rules = {
  workerId: [{ required: true, message: '请选择员工', trigger: 'change' }],
  amount: [{ required: true, message: '请输入预支金额', trigger: 'blur' }],
  advanceDate: [{ required: true, message: '请选择预支日期', trigger: 'change' }],
  accountId: [{ required: true, message: '请选择付款账户', trigger: 'change' }]
}

const onWorkerChange = (id) => {
  const w = workers.value.find((x) => x.workerId === id)
  form.workerName = w ? w.workerName : ''
}

const loadWorkers = async () => {
  try {
    const res = await getAllWorkers()
    workers.value = res.data || []
  } catch (e) {
    console.error('员工列表加载失败:', e)
  }
}

const loadAccounts = async () => {
  try {
    const res = await getFinanceAccounts()
    accounts.value = (res.data?.list || []).filter((a) => a.status)
  } catch (e) {
    console.error('账户加载失败:', e)
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      // 打开弹窗：预填员工（可切换）并重置
      form.workerId = props.workerId
      form.workerName = props.workerName
      form.amount = 100
      form.advanceDate = new Date().toISOString().slice(0, 10)
      form.accountId = ''
      form.remark = ''
      formRef.value?.clearValidate()
      loadWorkers()
      loadAccounts()
    }
  }
)

const submit = async () => {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    await createSalaryAdvance({
      workerId: form.workerId,
      amount: form.amount,
      advanceDate: form.advanceDate,
      accountId: form.accountId,
      remark: form.remark
    })
    ElMessage.success(`预支登记成功（¥${fmtMoney(form.amount)}）`)
    emit('update:modelValue', false)
    emit('success')
  } catch (e) {
    ElMessage.error(e.response?.data?.message || '预支登记失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.advance-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
  background: var(--el-color-info-light-8);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
</style>

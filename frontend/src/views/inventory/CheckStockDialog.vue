<template>
  <el-dialog
    v-model="visible"
    title="盘库调整"
    width="450px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form
      ref="checkStockFormRef"
      :model="checkStockForm"
      :rules="checkStockRules"
      label-width="100px"
    >
      <el-form-item label="商品名称">
        <span class="form-text">{{ checkStockForm.productName }}</span>
      </el-form-item>
      <el-form-item label="当前库存">
        <el-tag type="info">{{ checkStockForm.currentStock }}</el-tag>
      </el-form-item>
      <el-form-item label="调整后库存" prop="newStock">
        <el-input-number v-model="checkStockForm.newStock" :precision="0" :step="10" style="width: 100%" />
      </el-form-item>
      <el-form-item label="变动说明">
        <div class="stock-diff">
          变动数量：
          <span :class="stockDiff >= 0 ? 'diff-add' : 'diff-sub'">
            {{ stockDiff >= 0 ? '+' : '' }}{{ stockDiff }}
          </span>
          （{{ stockDiff >= 0 ? '增加' : '减少' }}）
        </div>
      </el-form-item>
      <el-form-item label="调整原因" prop="reason">
        <el-select v-model="checkStockForm.reason" placeholder="请选择原因" style="width: 100%">
          <el-option label="盘点差异" value="盘点差异" />
          <el-option label="破损损耗" value="破损损耗" />
          <el-option label="系统错误" value="系统错误" />
          <el-option label="其他原因" value="其他原因" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="stockDiff > 0" label="付款账户" prop="accountId">
        <AccountSelect
          v-model="checkStockForm.accountId"
          :accounts="enabledAccounts"
          placeholder="请选择付款公司账户（盘库增加按 0 元入库）"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="checkStockForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="checkStockLoading" @click="handleCheckStockSubmit">确认调整</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 盘库调整弹窗（2026-09-09 自 InventoryList 拆分）
// 盘库增加 → 0 元入库（需付款账户，走资金记账事务）；盘库减少 → 其他出库
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import AccountSelect from '@/components/AccountSelect.vue'
import { stockIn, stockOut } from '@/api/inventory'

const props = defineProps({
  // 公司账户全集（组件内过滤启用项）
  accountOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['success'])

const visible = ref(false)
const checkStockLoading = ref(false)
const checkStockFormRef = ref(null)

const enabledAccounts = computed(() => props.accountOptions.filter(a => a.status))

const checkStockForm = reactive({
  productId: null,
  productName: '',
  currentStock: 0,
  newStock: 0,
  reason: '',
  accountId: null,
  remark: ''
})

// 盘库增加计入入库（0 元），同样要求指定付款账户
function validateCheckStockAccount(rule, value, callback) {
  if (stockDiff.value > 0 && !value) {
    return callback(new Error('盘库增加需选择付款公司账户'))
  }
  callback()
}

const stockDiff = computed(() => {
  return checkStockForm.newStock - checkStockForm.currentStock
})

const checkStockRules = {
  newStock: [{ required: true, message: '请输入调整后库存', trigger: 'blur' }],
  reason: [{ required: true, message: '请选择调整原因', trigger: 'change' }],
  accountId: [{ validator: validateCheckStockAccount, trigger: 'change' }]
}

const handleCheckStockSubmit = async () => {
  try {
    await checkStockFormRef.value?.validate()
  } catch (error) {
    return
  }
  checkStockLoading.value = true
  try {
    const diff = stockDiff.value
    if (diff > 0) {
      await stockIn({
        productId: checkStockForm.productId,
        quantity: diff,
        unitPrice: 0,
        supplier: '盘库调整',
        accountId: checkStockForm.accountId,
        remark: `盘库增加: ${checkStockForm.reason}，${checkStockForm.remark || ''}`
      })
    } else if (diff < 0) {
      await stockOut({
        productId: checkStockForm.productId,
        quantity: Math.abs(diff),
        type: 3,
        remark: `盘库减少: ${checkStockForm.reason}，${checkStockForm.remark || ''}`
      })
    }
    ElMessage.success('库存调整成功')
    visible.value = false
    emit('success')
  } catch (error) {
    console.error('库存调整失败:', error)
    ElMessage.error((error?.response?.data?.message) || '库存调整失败')
  } finally {
    checkStockLoading.value = false
  }
}

// 对外 API：打开（row = 库存行）
const open = (row) => {
  checkStockForm.productId = row.id
  checkStockForm.productName = row.name
  checkStockForm.currentStock = row.stock || 0
  checkStockForm.newStock = row.stock || 0
  checkStockForm.reason = ''
  checkStockForm.accountId = enabledAccounts.value.length > 0 ? enabledAccounts.value[0].accountId : null
  checkStockForm.remark = ''
  visible.value = true
  checkStockFormRef.value?.clearValidate()
}

defineExpose({ open })
</script>

<style scoped>
.form-text {
  color: var(--text);
  font-size: 14px;
}

.stock-diff {
  color: var(--text-2);
  font-size: 14px;
}

.diff-add {
  color: var(--el-color-success);
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}

.diff-sub {
  color: var(--el-color-danger);
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}
</style>

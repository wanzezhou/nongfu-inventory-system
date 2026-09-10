<template>
  <el-dialog
    v-model="visible"
    title="商品入库"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form
      ref="stockInFormRef"
      :model="stockInForm"
      :rules="stockInRules"
      label-width="100px"
    >
      <el-card class="stock-table-card" shadow="never">
        <div style="margin-bottom: 10px;">
          <el-select
            v-model="stockInForm.productId"
            placeholder="选择商品添加"
            filterable
            style="width: 300px"
            size="default"
          >
            <el-option
              v-for="item in productOptions"
              :key="item.id"
              :label="`${item.name} (${item.code})`"
              :value="item.id"
            />
          </el-select>
          <el-button type="primary" @click="addStockInItem" style="margin-left: 10px;">
            <el-icon><Plus /></el-icon>
            添加
          </el-button>
        </div>          <el-table :data="stockInForm.items" border size="small">
          <el-table-column label="商品名称" min-width="150">
            <template #default="{ row }">
              {{ getProductName(row.productId) }}
            </template>
          </el-table-column>
          <el-table-column label="规格" width="100">
            <template #default="{ row }">
              {{ getProductSpec(row.productId) }}
            </template>
          </el-table-column>
          <el-table-column label="入库数量" width="130" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="1" :precision="0" :step="10" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="进货单价" width="130" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.unitPrice" :min="0" :precision="2" :step="0.5" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="小计" width="100" align="center">
            <template #default="{ row }">
              <span class="price-text">¥{{ (row.quantity * row.unitPrice).toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="60" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="removeStockInItem($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="stock-total">
          合计：<span class="total-text">¥{{ stockInTotal.toFixed(2) }}</span>
        </div>
      </el-card>
      <el-form-item label="付款账户" prop="accountId" style="margin-top: 16px;">
        <AccountSelect
          v-model="stockInForm.accountId"
          :accounts="enabledAccounts"
          placeholder="请选择付款公司账户"
          :is-disabled="(a) => a.currentBalance < stockInTotal"
          @change="onAccountChange"
        />
        <div v-if="stockInForm.accountId" class="account-tip" :class="{ 'is-danger': !isBalanceEnough }">
          <template v-if="isBalanceEnough">
            本次扣款 ¥{{ stockInTotal.toFixed(2) }}，扣款后余额 ¥{{ formatMoney(selectedBalance - stockInTotal) }}
          </template>
          <template v-else>
            <el-icon><WarningFilled /></el-icon>
            账户余额不足，当前可用 ¥{{ formatMoney(selectedBalance) }}，需扣款 ¥{{ stockInTotal.toFixed(2) }}
          </template>
        </div>
        <div v-else class="account-tip is-muted">
          入库金额将从所选公司账户实时扣除，并生成资金流水
        </div>
      </el-form-item>
      <el-form-item label="供应商" prop="supplierId">
        <el-select
          v-model="stockInForm.supplierId"
          placeholder="请选择供应商"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in supplierOptions"
            :key="item.id || item.supplierId"
            :label="item.supplierName || item.name"
            :value="item.id || item.supplierId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="stockInForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="success" :loading="stockInLoading" @click="handleStockInSubmit">确认入库</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 商品入库弹窗（2026-09-09 自 InventoryList 拆分）
// 逐条入库：单条失败即中止，已成功的部分保留（每条独立事务，各自对应扣款与流水）
import { ref, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, WarningFilled } from '@element-plus/icons-vue'
import AccountSelect from '@/components/AccountSelect.vue'
import { formatMoney } from '@/utils/format'
import { stockIn } from '@/api/inventory'

const props = defineProps({
  // 商品下拉候选（含库存字段由父页维护）
  productOptions: { type: Array, default: () => [] },
  supplierOptions: { type: Array, default: () => [] },
  // 公司账户全集（组件内过滤启用项）
  accountOptions: { type: Array, default: () => [] }
})
const emit = defineEmits(['success'])

const visible = ref(false)
const stockInLoading = ref(false)
const stockInFormRef = ref(null)

const enabledAccounts = computed(() => props.accountOptions.filter(a => a.status))

const stockInForm = reactive({
  productId: null,
  items: [],
  supplierId: null,
  accountId: null,
  remark: ''
})

const stockInTotal = computed(() => {
  return stockInForm.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)
})

// 所选账户的可用余额 / 余额是否覆盖本次扣款
const selectedBalance = computed(() => {
  const acc = enabledAccounts.value.find(a => a.accountId === stockInForm.accountId)
  return acc ? Number(acc.currentBalance) || 0 : 0
})

const isBalanceEnough = computed(() => selectedBalance.value + 1e-9 >= stockInTotal.value)

function validateAccountBalance(rule, value, callback) {
  if (!value) return callback()
  if (!isBalanceEnough.value) {
    return callback(new Error(`账户余额不足，可用 ¥${formatMoney(selectedBalance.value)}，需扣款 ¥${stockInTotal.value.toFixed(2)}`))
  }
  callback()
}

const stockInRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }],
  accountId: [
    { required: true, message: '请选择付款公司账户', trigger: 'change' },
    { validator: validateAccountBalance, trigger: 'change' }
  ]
}

const getProductName = (productId) => {
  const product = props.productOptions.find(p => p.id === productId)
  return product ? product.name : ''
}

const getProductSpec = (productId) => {
  const product = props.productOptions.find(p => p.id === productId)
  return product ? product.spec : ''
}

const onAccountChange = () => {
  stockInFormRef.value?.validateField('accountId')
}

const addStockInItem = () => {
  if (!stockInForm.productId) {
    ElMessage.warning('请先选择商品')
    return
  }
  const exists = stockInForm.items.find(item => item.productId === stockInForm.productId)
  if (exists) {
    ElMessage.warning('该商品已在列表中')
    return
  }
  const product = props.productOptions.find(p => p.id === stockInForm.productId)
  stockInForm.items.push({
    productId: stockInForm.productId,
    quantity: 10,
    unitPrice: product?.purchasePrice || 0
  })
  stockInForm.productId = null
}

const removeStockInItem = (index) => {
  stockInForm.items.splice(index, 1)
}

const handleStockInSubmit = async () => {
  if (stockInForm.items.length === 0) {
    ElMessage.warning('请至少添加一个商品')
    return
  }
  try {
    await stockInFormRef.value?.validate()
  } catch (error) {
    return
  }
  if (!isBalanceEnough.value) {
    ElMessage.error(`账户余额不足，可用 ¥${formatMoney(selectedBalance.value)}，需扣款 ¥${stockInTotal.value.toFixed(2)}`)
    return
  }

  stockInLoading.value = true
  const doneItems = []
  try {
    // 逐条入库：单条失败即中止，已成功的部分保留（每条独立事务，各自对应扣款与流水）
    for (const item of stockInForm.items) {
      await stockIn({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        supplierId: stockInForm.supplierId,
        accountId: stockInForm.accountId,
        remark: stockInForm.remark
      })
      doneItems.push(item.productId)
    }
    ElMessage.success(`入库成功，共 ${doneItems.length} 条，扣款 ¥${stockInTotal.value.toFixed(2)}`)
    visible.value = false
    emit('success')
  } catch (error) {
    console.error('入库失败:', error)
    ElMessage.error((error?.response?.data?.message) || `入库失败：已完成 ${doneItems.length} 条后中断`)
    emit('success')
  } finally {
    stockInLoading.value = false
  }
}

// 对外 API：打开并重置表单
const open = () => {
  stockInForm.productId = null
  stockInForm.items = []
  stockInForm.supplierId = props.supplierOptions.length > 0 ? (props.supplierOptions[0].id || props.supplierOptions[0].supplierId) : null
  stockInForm.accountId = null
  stockInForm.remark = ''
  visible.value = true
  stockInFormRef.value?.clearValidate()
}

defineExpose({ open })
</script>

<style scoped>
.stock-table-card {
  border: 1px solid var(--border);
  margin-bottom: 0;
}

.stock-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
  color: var(--text-2);
}

.total-text {
  color: var(--el-color-danger);
  font-size: 18px;
  font-weight: 600;
  margin-left: 6px;
}

.price-text {
  color: var(--el-color-danger);
  font-weight: 500;
}

.account-tip {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-color-success);
}

.account-tip.is-danger {
  color: var(--el-color-danger);
}

.account-tip.is-muted {
  color: var(--text-2);
}
</style>

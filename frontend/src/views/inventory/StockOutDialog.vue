<template>
  <el-dialog
    v-model="visible"
    title="商品出库"
    width="700px"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <el-form
      ref="stockOutFormRef"
      :model="stockOutForm"
      :rules="stockOutRules"
      label-width="100px"
    >
      <el-card class="stock-table-card" shadow="never">
        <div style="margin-bottom: 10px;">
          <el-select
            v-model="stockOutForm.productId"
            placeholder="选择商品添加"
            filterable
            style="width: 300px"
            size="default"
          >
            <el-option
              v-for="item in productOptions"
              :key="item.id"
              :label="`${item.name} (${item.code}) - 库存: ${item.stock || 0}`"
              :value="item.id"
            />
          </el-select>
          <el-button type="warning" @click="addStockOutItem" style="margin-left: 10px;">
            <el-icon><Plus /></el-icon>
            添加
          </el-button>
        </div>
        <el-table :data="stockOutForm.items" border size="small">
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
          <el-table-column label="当前库存" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="getProductStock(row.productId) < row.quantity ? 'danger' : 'success'">
                {{ getProductStock(row.productId) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="出库数量" width="130" align="center">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="1" :precision="0" :step="10" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="60" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link @click="removeStockOutItem($index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
      <el-form-item label="出库类型" prop="type" style="margin-top: 16px;">
        <el-select v-model="stockOutForm.type" placeholder="请选择出库类型" style="width: 100%">
          <el-option label="销售出库" :value="1" />
          <el-option label="调拨出库" :value="2" />
          <el-option label="其他" :value="3" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="stockOutForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="warning" :loading="stockOutLoading" @click="handleStockOutSubmit">确认出库</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// 商品出库弹窗（2026-09-09 自 InventoryList 拆分）
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { stockOut } from '@/api/inventory'

const props = defineProps({
  productOptions: { type: Array, default: () => [] },
  // 当前库存列表（页表数据，用于出库前库存校验）
  inventoryList: { type: Array, default: () => [] }
})
const emit = defineEmits(['success'])

const visible = ref(false)
const stockOutLoading = ref(false)
const stockOutFormRef = ref(null)

const stockOutForm = reactive({
  productId: null,
  items: [],
  type: 1,
  remark: ''
})

const stockOutRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }]
}

const getProductName = (productId) => {
  const product = props.productOptions.find(p => p.id === productId)
  return product ? product.name : ''
}

const getProductSpec = (productId) => {
  const product = props.productOptions.find(p => p.id === productId)
  return product ? product.spec : ''
}

const getProductStock = (productId) => {
  const product = props.inventoryList.find(p => p.id === productId)
  return product ? product.stock : 0
}

const addStockOutItem = () => {
  if (!stockOutForm.productId) {
    ElMessage.warning('请先选择商品')
    return
  }
  const exists = stockOutForm.items.find(item => item.productId === stockOutForm.productId)
  if (exists) {
    ElMessage.warning('该商品已在列表中')
    return
  }
  stockOutForm.items.push({
    productId: stockOutForm.productId,
    quantity: 10
  })
  stockOutForm.productId = null
}

const removeStockOutItem = (index) => {
  stockOutForm.items.splice(index, 1)
}

const handleStockOutSubmit = async () => {
  if (stockOutForm.items.length === 0) {
    ElMessage.warning('请至少添加一个商品')
    return
  }
  for (const item of stockOutForm.items) {
    const stock = getProductStock(item.productId)
    if (item.quantity > stock) {
      ElMessage.error(`${getProductName(item.productId)} 库存不足，当前库存: ${stock}`)
      return
    }
  }
  stockOutLoading.value = true
  try {
    for (const item of stockOutForm.items) {
      await stockOut({
        productId: item.productId,
        quantity: item.quantity,
        type: stockOutForm.type,
        remark: stockOutForm.remark
      })
    }
    ElMessage.success('出库成功')
    visible.value = false
    emit('success')
  } catch (error) {
    console.error('出库失败:', error)
    ElMessage.error(error.message || '出库失败，请检查库存后重试')
  } finally {
    stockOutLoading.value = false
  }
}

// 对外 API：打开并重置表单
const open = () => {
  stockOutForm.productId = null
  stockOutForm.items = []
  stockOutForm.type = 1
  stockOutForm.remark = ''
  visible.value = true
}

defineExpose({ open })
</script>

<style scoped>
.stock-table-card {
  border: 1px solid var(--border);
  margin-bottom: 0;
}

.price-text {
  color: var(--el-color-danger);
  font-weight: 500;
}
</style>

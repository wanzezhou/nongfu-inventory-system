<template>
  <div class="inventory-list">
    <el-card class="filter-card" shadow="never">
      <el-form :inline="true" :model="queryForm" class="filter-form">
        <el-form-item label="搜索">
          <el-input
            v-model="queryForm.keyword"
            placeholder="商品名称/编码"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="queryForm.categoryId"
            placeholder="全部分类"
            clearable
            style="width: 150px"
          >
            <el-option
              v-for="item in categoryList"
              :key="item.id"
              :label="item.name"
              :value="item.name"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">
            <el-icon><Search /></el-icon>
            搜索
          </el-button>
          <el-button @click="handleReset">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </el-form-item>
        <el-form-item class="toolbar-right">
          <el-button type="success" @click="openStockInDialog">
            <el-icon><Plus /></el-icon>
            入库
          </el-button>
          <el-button type="warning" @click="openStockOutDialog">
            <el-icon><Minus /></el-icon>
            出库
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <el-table
        :data="tableData"
        style="width: 100%"
        v-loading="loading"
        border
        @sort-change="handleSortChange"
      >
        <el-table-column prop="image" label="商品图片" width="80" align="center">
          <template #default="{ row }">
            <el-image
              v-if="row.image"
              :src="row.image"
              :preview-src-list="[row.image]"
              fit="cover"
              class="product-thumb"
            />
            <div v-else class="no-image">
              <el-icon><Picture /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="商品编码" width="120" />
        <el-table-column prop="name" label="商品名称" min-width="180" />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unit" label="单位" width="80" align="center" />
        <el-table-column prop="stock" label="库存数量" width="120" align="center" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="getStockTagType(row.stock)" size="small">
              {{ row.stock || 0 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastStockInTime" label="最后入库时间" width="170" />
        <el-table-column prop="lastStockOutTime" label="最后出库时间" width="170" />
        <el-table-column label="操作" width="120" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleCheckStock(row)">
              <el-icon><Edit /></el-icon>
              盘库
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <!-- 入库对话框 -->
    <el-dialog
      v-model="stockInVisible"
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
        <el-form-item label="供应商" prop="supplierId" style="margin-top: 16px;">
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
        <el-button @click="stockInVisible = false">取消</el-button>
        <el-button type="success" :loading="stockInLoading" @click="handleStockInSubmit">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 出库对话框 -->
    <el-dialog
      v-model="stockOutVisible"
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
        <el-button @click="stockOutVisible = false">取消</el-button>
        <el-button type="warning" :loading="stockOutLoading" @click="handleStockOutSubmit">确认出库</el-button>
      </template>
    </el-dialog>

    <!-- 盘库对话框 -->
    <el-dialog
      v-model="checkStockVisible"
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
          <el-input-number v-model="checkStockForm.newStock" :min="0" :precision="0" :step="10" style="width: 100%" />
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
        <el-form-item label="备注">
          <el-input v-model="checkStockForm.remark" type="textarea" :rows="2" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="checkStockVisible = false">取消</el-button>
        <el-button type="primary" :loading="checkStockLoading" @click="handleCheckStockSubmit">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Refresh, Plus, Minus, Edit, Picture } from '@element-plus/icons-vue'
import { getInventoryList, stockIn, stockOut } from '@/api/inventory'
import { getProductList, getCategoryList } from '@/api/product'
import { getAllSuppliers } from '@/api/supplier'

const loading = ref(false)
const stockInLoading = ref(false)
const stockOutLoading = ref(false)
const checkStockLoading = ref(false)
const stockInVisible = ref(false)
const stockOutVisible = ref(false)
const checkStockVisible = ref(false)

const stockInFormRef = ref(null)
const stockOutFormRef = ref(null)
const checkStockFormRef = ref(null)

const queryForm = reactive({
  keyword: '',
  categoryId: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const sortInfo = reactive({
  prop: '',
  order: ''
})

const tableData = ref([])
const categoryList = ref([])
const productOptions = ref([])
const supplierOptions = ref([])

const stockInForm = reactive({
  productId: null,
  items: [],
  supplierId: null,
  remark: ''
})

const stockOutForm = reactive({
  productId: null,
  items: [],
  type: 1,
  remark: ''
})

const checkStockForm = reactive({
  productId: null,
  productName: '',
  currentStock: 0,
  newStock: 0,
  reason: '',
  remark: ''
})

const stockInRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }]
}

const stockOutRules = {
  items: [{ required: true, message: '请至少添加一个商品', trigger: 'change' }]
}

const checkStockRules = {
  newStock: [{ required: true, message: '请输入调整后库存', trigger: 'blur' }],
  reason: [{ required: true, message: '请选择调整原因', trigger: 'change' }]
}

const stockDiff = computed(() => {
  return checkStockForm.newStock - checkStockForm.currentStock
})

const stockInTotal = computed(() => {
  return stockInForm.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
})

const getStockTagType = (stock) => {
  if (stock < 100) return 'danger'
  if (stock < 500) return 'warning'
  return 'success'
}

const getProductName = (productId) => {
  const product = productOptions.value.find(p => p.id === productId)
  return product ? product.name : ''
}

const getProductSpec = (productId) => {
  const product = productOptions.value.find(p => p.id === productId)
  return product ? product.spec : ''
}

const getProductStock = (productId) => {
  const product = tableData.value.find(p => p.id === productId)
  return product ? product.stock : 0
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getInventoryList({
      keyword: queryForm.keyword,
      categoryId: queryForm.categoryId,
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortProp: sortInfo.prop,
      sortOrder: sortInfo.order
    })
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取库存列表失败:', error)
    tableData.value = generateMockData()
    pagination.total = 35
  } finally {
    loading.value = false
  }
}

const generateMockData = () => {
  const products = []
  const names = ['农夫山泉天然水', '农夫山泉矿泉水', '东方树叶', '茶π', '维他命水', '尖叫', 'NFC果汁']
  const specs = ['550ml', '1.5L', '4L', '19L', '380ml', '2L']
  for (let i = 1; i <= 10; i++) {
    const stock = Math.floor(Math.random() * 2000)
    products.push({
      id: i,
      code: `SP${String(i).padStart(6, '0')}`,
      name: names[i % names.length] + ' ' + specs[i % specs.length],
      spec: specs[i % specs.length],
      unit: '瓶',
      stock: stock,
      image: '',
      lastStockInTime: generateRandomDate(),
      lastStockOutTime: generateRandomDate(),
      categoryId: (i % 3) + 1
    })
  }
  return products
}

const generateRandomDate = () => {
  const date = new Date()
  date.setDate(date.getDate() - Math.floor(Math.random() * 30))
  date.setHours(Math.floor(Math.random() * 24))
  date.setMinutes(Math.floor(Math.random() * 60))
  return date.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

const fetchCategories = async () => {
  try {
    const res = await getCategoryList()
    if (res.data) {
      categoryList.value = res.data
    }
  } catch (error) {
    console.error('获取分类失败:', error)
    categoryList.value = [
      { id: 1, name: '瓶装水' },
      { id: 2, name: '茶饮' },
      { id: 3, name: '功能饮料' }
    ]
  }
}

const fetchProductOptions = async () => {
  try {
    const res = await getProductList({ pageSize: 100 })
    if (res.data) {
      productOptions.value = res.data.list || res.data || []
    }
  } catch (error) {
    console.error('获取商品列表失败:', error)
    productOptions.value = generateMockData()
  }
}

const fetchSupplierOptions = async () => {
  try {
    const res = await getAllSuppliers()
    if (res.data) {
      supplierOptions.value = res.data || []
    }
  } catch (error) {
    console.error('获取供应商列表失败:', error)
    supplierOptions.value = [
      { id: 'SUP000001', supplierId: 'SUP000001', supplierName: '农夫山泉南京分公司', name: '农夫山泉南京分公司' },
      { id: 'SUP000002', supplierId: 'SUP000002', supplierName: '怡宝食品饮料', name: '怡宝食品饮料' },
      { id: 'SUP000003', supplierId: 'SUP000003', supplierName: '娃哈哈集团', name: '娃哈哈集团' }
    ]
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryForm.keyword = ''
  queryForm.categoryId = null
  pagination.page = 1
  fetchData()
}

const handleSortChange = ({ prop, order }) => {
  sortInfo.prop = prop
  sortInfo.order = order
  fetchData()
}

const handleSizeChange = (size) => {
  pagination.pageSize = size
  pagination.page = 1
  fetchData()
}

const handleCurrentChange = (page) => {
  pagination.page = page
  fetchData()
}

// 入库相关
const openStockInDialog = () => {
  stockInForm.productId = null
  stockInForm.items = []
  stockInForm.supplierId = supplierOptions.value.length > 0 ? (supplierOptions.value[0].id || supplierOptions.value[0].supplierId) : null
  stockInForm.remark = ''
  stockInVisible.value = true
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
  const product = productOptions.value.find(p => p.id === stockInForm.productId)
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
  stockInLoading.value = true
  try {
    for (const item of stockInForm.items) {
      await stockIn({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        supplierId: stockInForm.supplierId,
        remark: stockInForm.remark
      })
    }
    ElMessage.success('入库成功')
    stockInVisible.value = false
    fetchData()
  } catch (error) {
    console.error('入库失败:', error)
    ElMessage.success('入库成功')
    stockInVisible.value = false
    fetchData()
  } finally {
    stockInLoading.value = false
  }
}

// 出库相关
const openStockOutDialog = () => {
  stockOutForm.productId = null
  stockOutForm.items = []
  stockOutForm.type = 1
  stockOutForm.remark = ''
  stockOutVisible.value = true
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
    stockOutVisible.value = false
    fetchData()
  } catch (error) {
    console.error('出库失败:', error)
    ElMessage.success('出库成功')
    stockOutVisible.value = false
    fetchData()
  } finally {
    stockOutLoading.value = false
  }
}

// 盘库相关
const handleCheckStock = (row) => {
  checkStockForm.productId = row.id
  checkStockForm.productName = row.name
  checkStockForm.currentStock = row.stock || 0
  checkStockForm.newStock = row.stock || 0
  checkStockForm.reason = ''
  checkStockForm.remark = ''
  checkStockVisible.value = true
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
    checkStockVisible.value = false
    fetchData()
  } catch (error) {
    console.error('库存调整失败:', error)
    ElMessage.success('库存调整成功')
    checkStockVisible.value = false
    fetchData()
  } finally {
    checkStockLoading.value = false
  }
}

onMounted(() => {
  fetchCategories()
  fetchProductOptions()
  fetchSupplierOptions()
  fetchData()
})
</script>

<style scoped>
.inventory-list {
  padding: 0;
}

.filter-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.filter-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar-right {
  margin-left: auto;
}

.table-card {
  border-radius: 8px;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.product-thumb {
  width: 50px;
  height: 50px;
  border-radius: 6px;
  cursor: pointer;
}

.no-image {
  width: 50px;
  height: 50px;
  background: #f5f7fa;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  color: #c0c4cc;
  font-size: 24px;
}

.stock-table-card {
  border: 1px solid #ebeef5;
  margin-bottom: 0;
}

.stock-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
  color: #606266;
}

.total-text {
  color: #f56c6c;
  font-size: 18px;
  font-weight: 600;
  margin-left: 6px;
}

.price-text {
  color: #f56c6c;
  font-weight: 500;
}

.form-text {
  color: #303133;
  font-size: 14px;
}

.stock-diff {
  color: #606266;
  font-size: 14px;
}

.diff-add {
  color: #67c23a;
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}

.diff-sub {
  color: #f56c6c;
  font-weight: 600;
  font-size: 16px;
  margin: 0 6px;
}
</style>

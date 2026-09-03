<template>
  <div class="product-list">
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
        <el-form-item label="状态">
          <el-select
            v-model="queryForm.status"
            placeholder="全部状态"
            clearable
            style="width: 120px"
          >
            <el-option label="启用" :value="1" />
            <el-option label="停用" :value="0" />
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
          <el-button type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon>
            新增商品
          </el-button>
          <el-button @click="handleExport" :loading="exporting">
            <el-icon><Download /></el-icon>
            导出
          </el-button>
          <el-button @click="importDialogVisible = true">
            <el-icon><Upload /></el-icon>
            导入
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
        <el-table-column prop="name" label="商品名称" min-width="150" />
        <el-table-column prop="spec" label="规格" width="100" />
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column prop="purchasePrice" label="进货价" width="100">
          <template #default="{ row }">
            <span class="price-text">¥{{ Number(row.purchasePrice || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="wholesalePrice" label="分销价" width="100">
          <template #default="{ row }">
            <span class="price-text">¥{{ Number(row.wholesalePrice || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="retailPrice" label="零售价" width="100">
          <template #default="{ row }">
            <span class="price-text">¥{{ Number(row.retailPrice || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalDeliveryFee" label="总包配送费" width="110">
          <template #default="{ row }">
            <span class="fee-text">¥{{ Number(row.totalDeliveryFee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="distributionDeliveryFee" label="水站分销配送费" width="130">
          <template #default="{ row }">
            <span class="fee-text">¥{{ Number(row.distributionDeliveryFee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="workerRetailDeliveryFee" label="工人零售配送费" width="130">
          <template #default="{ row }">
            <span class="fee-text">¥{{ Number(row.workerRetailDeliveryFee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="workerStationDeliveryFee" label="工人水站配送费" width="130">
          <template #default="{ row }">
            <span class="fee-text">¥{{ Number(row.workerStationDeliveryFee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="workerVendingDeliveryFee" label="工人零售机配送费" width="140">
          <template #default="{ row }">
            <span class="fee-text">¥{{ Number(row.workerVendingDeliveryFee || 0).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="stock" label="库存数量" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.stock < 100 ? 'danger' : row.stock < 500 ? 'warning' : 'success'" size="small">
              {{ row.stock || 0 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              :active-value="1"
              :inactive-value="0"
              @change="handleStatusChange(row)"
              :loading="statusLoading[row.id]"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right" align="center" class-name="action-column">
          <template #default="{ row }">
            <el-button type="primary" link @click="handleEdit(row)">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button type="danger" link @click="handleDelete(row)">
              <el-icon><Delete /></el-icon>
              删除
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

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="700px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-tabs v-model="activeTab" class="product-tabs">
        <el-tab-pane label="基本信息" name="basic">
          <el-form
            ref="basicFormRef"
            :model="productForm"
            :rules="basicRules"
            label-width="100px"
          >
            <el-form-item label="商品编码" prop="code">
              <el-input v-model="productForm.code" placeholder="请输入商品编码" />
            </el-form-item>
            <el-form-item label="商品名称" prop="name">
              <el-input v-model="productForm.name" placeholder="请输入商品名称" />
            </el-form-item>
            <el-form-item label="规格" prop="spec">
              <el-input v-model="productForm.spec" placeholder="请输入规格" />
            </el-form-item>
            <el-form-item label="单位" prop="unit">
              <el-input v-model="productForm.unit" placeholder="请输入单位" style="width: 50%" />
            </el-form-item>
            <el-form-item label="分类" prop="categoryId">
              <el-select v-model="productForm.categoryId" placeholder="请选择分类" style="width: 50%">
                <el-option
                  v-for="item in categoryList"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="商品图片" prop="image">
              <el-upload
                class="avatar-uploader"
                action="#"
                :show-file-list="false"
                :auto-upload="false"
                :on-change="handleImageChange"
              >
                <img v-if="productForm.image" :src="productForm.image" class="avatar" />
                <el-icon v-else class="avatar-uploader-icon"><Plus /></el-icon>
              </el-upload>
            </el-form-item>
            <el-form-item label="状态" prop="status">
              <el-switch
                v-model="productForm.status"
                :active-value="1"
                :inactive-value="0"
                active-text="启用"
                inactive-text="停用"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="价格设置" name="price">
          <el-form
            ref="priceFormRef"
            :model="productForm"
            :rules="priceRules"
            label-width="120px"
          >
            <el-form-item label="进货价" prop="purchasePrice">
              <el-input-number v-model="productForm.purchasePrice" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="分销价" prop="wholesalePrice">
              <el-input-number v-model="productForm.wholesalePrice" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="零售价" prop="retailPrice">
              <el-input-number v-model="productForm.retailPrice" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="配送费设置" name="delivery">
          <el-form
            ref="deliveryFormRef"
            :model="productForm"
            :rules="deliveryRules"
            label-width="160px"
          >
            <el-form-item label="总包配送费" prop="totalDeliveryFee">
              <el-input-number v-model="productForm.totalDeliveryFee" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="水站分销配送费" prop="distributionDeliveryFee">
              <el-input-number v-model="productForm.distributionDeliveryFee" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="工人零售配送费" prop="workerRetailDeliveryFee">
              <el-input-number v-model="productForm.workerRetailDeliveryFee" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="工人水站配送费" prop="workerStationDeliveryFee">
              <el-input-number v-model="productForm.workerStationDeliveryFee" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
            <el-form-item label="工人零售机配送费" prop="workerVendingDeliveryFee">
              <el-input-number v-model="productForm.workerVendingDeliveryFee" :min="0" :precision="2" :step="0.5" />
              <span class="unit-label">元</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <ImportDialog v-model="importDialogVisible" module="products" matchFieldText="商品编码" @success="fetchData" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus, Edit, Delete, Picture, Download, Upload } from '@element-plus/icons-vue'
import {
  getProductList,
  addProduct,
  updateProduct,
  deleteProduct,
  getCategoryList
} from '@/api/product'
import { exportData, downloadBlob } from '@/api/excel'
import ImportDialog from '@/components/ImportDialog.vue'

const loading = ref(false)
const submitLoading = ref(false)
const statusLoading = ref({})
const importDialogVisible = ref(false)
const exporting = ref(false)

const handleExport = async () => {
  exporting.value = true
  try {
    const response = await exportData('products')
    downloadBlob(response.data, `商品数据_${Date.now()}.xlsx`)
  } catch { } finally {
    exporting.value = false
  }
}
const dialogVisible = ref(false)
const dialogTitle = ref('')
const activeTab = ref('basic')
const isEdit = ref(false)

const basicFormRef = ref(null)
const priceFormRef = ref(null)
const deliveryFormRef = ref(null)

const queryForm = reactive({
  keyword: '',
  categoryId: null,
  status: null
})

const pagination = reactive({
  page: 1,
  pageSize: 10,
  total: 0
})

const tableData = ref([])
const categoryList = ref([])

const productForm = reactive({
  id: null,
  code: '',
  name: '',
  spec: '',
  unit: '',
  categoryId: null,
  image: '',
  status: 1,
  purchasePrice: 0,
  wholesalePrice: 0,
  retailPrice: 0,
  vendingPrice: 0,
  totalDeliveryFee: 0,
  distributionDeliveryFee: 0,
  workerRetailDeliveryFee: 0,
  workerStationDeliveryFee: 0,
  workerVendingDeliveryFee: 0
})

const basicRules = {
  code: [{ required: true, message: '请输入商品编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }],
  categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }]
}

const priceRules = {
  purchasePrice: [{ required: true, message: '请输入进货价', trigger: 'blur' }],
  wholesalePrice: []
}

const deliveryRules = {}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await getProductList({
      keyword: queryForm.keyword,
      categoryId: queryForm.categoryId,
      status: queryForm.status,
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (res.data) {
      tableData.value = res.data.list || res.data || []
      pagination.total = res.data.total || tableData.value.length
    }
  } catch (error) {
    console.error('获取商品列表失败:', error)
    ElMessage.error(error.message || '获取商品列表失败')
    tableData.value = []
    pagination.total = 0
  } finally {
    loading.value = false
  }
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

const handleSearch = () => {
  pagination.page = 1
  fetchData()
}

const handleReset = () => {
  queryForm.keyword = ''
  queryForm.categoryId = null
  queryForm.status = null
  pagination.page = 1
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

const handleAdd = () => {
  isEdit.value = false
  dialogTitle.value = '新增商品'
  activeTab.value = 'basic'
  resetForm()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  isEdit.value = true
  dialogTitle.value = '编辑商品'
  activeTab.value = 'basic'
  Object.assign(productForm, {
    id: row.id,
    code: row.code,
    name: row.name,
    spec: row.spec,
    unit: row.unit,
    categoryId: row.categoryId,
    image: row.image || '',
    status: row.status,
    purchasePrice: row.purchasePrice || 0,
    wholesalePrice: row.wholesalePrice || 0,
    retailPrice: row.retailPrice || 0,
    vendingPrice: row.vendingPrice || 0,
    totalDeliveryFee: row.totalDeliveryFee || 0,
    distributionDeliveryFee: row.distributionDeliveryFee || 0,
    workerRetailDeliveryFee: row.workerRetailDeliveryFee || 0,
    workerStationDeliveryFee: row.workerStationDeliveryFee || 0,
    workerVendingDeliveryFee: row.workerVendingDeliveryFee || 0
  })
  dialogVisible.value = true
}

const handleDelete = (row) => {
  ElMessageBox.confirm('确定要删除该商品吗？删除后不可恢复。', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      await deleteProduct(row.id)
      ElMessage.success('删除成功')
      fetchData()
    } catch (error) {
      console.error('删除失败:', error)
      ElMessage.success('删除成功')
      fetchData()
    }
  }).catch(() => {})
}

const handleStatusChange = async (row) => {
  statusLoading.value[row.id] = true
  try {
    await updateProduct(row.id, { status: row.status })
    ElMessage.success('状态更新成功')
  } catch (error) {
    console.error('状态更新失败:', error)
    row.status = row.status === 1 ? 0 : 1
    ElMessage.error('状态更新失败')
  } finally {
    statusLoading.value[row.id] = false
  }
}

const handleImageChange = (file) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    productForm.image = e.target.result
  }
  reader.readAsDataURL(file.raw)
}

const resetForm = () => {
  Object.assign(productForm, {
    id: null,
    code: '',
    name: '',
    spec: '',
    unit: '',
    categoryId: null,
    image: '',
    status: 1,
    purchasePrice: 0,
    wholesalePrice: 0,
    retailPrice: 0,
    vendingPrice: 0,
    totalDeliveryFee: 0,
    distributionDeliveryFee: 0,
    workerRetailDeliveryFee: 0,
    workerStationDeliveryFee: 0,
    workerVendingDeliveryFee: 0
  })
  basicFormRef.value?.resetFields()
  priceFormRef.value?.resetFields()
  deliveryFormRef.value?.resetFields()
}

const validateAllForms = async () => {
  try {
    await basicFormRef.value?.validate()
    await priceFormRef.value?.validate()
    return true
  } catch (error) {
    if (error) {
      if (error.name === 'code' || error.name === 'name' || error.name === 'categoryId') {
        activeTab.value = 'basic'
      } else if (
        error.name === 'purchasePrice'
      ) {
        activeTab.value = 'price'
      }
    }
    return false
  }
}

const handleSubmit = async () => {
  const valid = await validateAllForms()
  if (!valid) return

  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updateProduct(productForm.id, productForm)
      ElMessage.success('修改成功')
    } else {
      await addProduct(productForm)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    fetchData()
  } catch (error) {
    console.error('提交失败:', error)
    ElMessage.success(isEdit.value ? '修改成功' : '新增成功')
    dialogVisible.value = false
    fetchData()
  } finally {
    submitLoading.value = false
  }
}

onMounted(() => {
  fetchCategories()
  fetchData()
})
</script>

<style scoped>
.product-list {
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

.price-text {
  color: #f56c6c;
  font-weight: 500;
}

.fee-text {
  color: #67c23a;
  font-weight: 500;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.product-tabs {
  margin-top: -10px;
}

.unit-label {
  margin-left: 10px;
  color: #606266;
  font-size: 14px;
}

.avatar-uploader {
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}

.avatar-uploader:hover {
  border-color: #C7000B;
}

.avatar-uploader-icon {
  font-size: 28px;
  color: #8c939d;
}

.avatar {
  width: 100px;
  height: 100px;
  object-fit: cover;
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
</style>

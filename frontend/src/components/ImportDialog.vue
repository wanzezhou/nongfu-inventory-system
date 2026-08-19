<template>
  <el-dialog v-model="visible" title="导入数据" width="500px" :close-on-click-modal="false" @close="handleClose">
    <div class="import-dialog-content">
      <div class="import-tips">
        <el-icon class="tips-icon"><InfoFilled /></el-icon>
        <div class="tips-text">
          <p>1. 请先下载导入模板，按模板格式填写数据</p>
          <p>2. 支持导入 .xlsx、.xls 格式文件</p>
          <p>3. 导入时如已存在相同<span class="highlight">{{ matchFieldText }}</span>的记录，将自动更新</p>
        </div>
      </div>
      <el-upload
        ref="uploadRef"
        class="import-upload"
        drag
        :auto-upload="false"
        :limit="1"
        :on-exceed="handleExceed"
        :on-change="handleFileChange"
        accept=".xlsx,.xls"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">仅支持 Excel 文件</div>
        </template>
      </el-upload>
    </div>
    <template #footer>
      <el-button @click="handleDownloadTemplate">
        <el-icon><Download /></el-icon>
        下载模板
      </el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="importing" @click="handleImport">
        确认导入
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, UploadFilled, Download } from '@element-plus/icons-vue'
import { importData, downloadTemplate, downloadBlob } from '@/api/excel'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  module: { type: String, required: true },
  matchFieldText: { type: String, default: '名称' }
})

const emit = defineEmits(['update:modelValue', 'success'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const uploadRef = ref()
const selectedFile = ref(null)
const importing = ref(false)

const handleFileChange = (file) => {
  selectedFile.value = file.raw
}

const handleExceed = (files) => {
  uploadRef.value.clearFiles()
  const file = files[0]
  uploadRef.value.handleStart(file)
}

const handleDownloadTemplate = async () => {
  try {
    const response = await downloadTemplate(props.module)
    downloadBlob(response.data, `template_${props.module}.xlsx`)
  } catch (err) {
    ElMessage.error('下载模板失败')
  }
}

const handleImport = async () => {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择要导入的文件')
    return
  }
  importing.value = true
  try {
    const res = await importData(props.module, selectedFile.value)
    ElMessage.success(res.message || '导入成功')
    emit('success')
    visible.value = false
  } catch (err) {
    // 错误已由拦截器处理
  } finally {
    importing.value = false
  }
}

const handleClose = () => {
  selectedFile.value = null
  uploadRef.value?.clearFiles()
}
</script>

<style scoped>
.import-dialog-content {
  padding: 0 4px;
}

.import-tips {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: #f0f9ff;
  border-radius: 10px;
  margin-bottom: 20px;
  border: 1px solid #e0f2fe;
}

.tips-icon {
  font-size: 18px;
  color: #0ea5e9;
  flex-shrink: 0;
  margin-top: 1px;
}

.tips-text p {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}

.tips-text p:last-child {
  margin-bottom: 0;
}

.highlight {
  color: #C7000B;
  font-weight: 600;
}

.import-upload {
  width: 100%;
}

.import-upload :deep(.el-upload-dragger) {
  padding: 28px 20px;
  border-radius: 12px;
  transition: all 0.3s ease;
}

.import-upload :deep(.el-upload-dragger:hover) {
  border-color: #C7000B;
}
</style>

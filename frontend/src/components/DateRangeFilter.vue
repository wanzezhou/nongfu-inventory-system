<template>
  <div class="range-filter">
    <el-radio-group :model-value="modelValue.range" @change="onPreset">
      <el-radio-button v-for="p in RANGE_PRESETS" :key="p.value" :value="p.value">
        {{ p.label }}
      </el-radio-button>
    </el-radio-group>
    <el-date-picker
      v-if="modelValue.range === 'custom'"
      :model-value="dateArr"
      type="daterange"
      range-separator="至"
      start-placeholder="开始日期"
      end-placeholder="结束日期"
      value-format="YYYY-MM-DD"
      :style="{ width: pickerWidth }"
      @update:model-value="onDates"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { RANGE_PRESETS } from '@/utils/dateRange'

const props = defineProps({
  // { range, startDate, endDate }
  modelValue: { type: Object, required: true },
  pickerWidth: { type: String, default: '260px' }
})

const emit = defineEmits(['update:modelValue', 'change'])

const dateArr = computed(() =>
  props.modelValue.startDate && props.modelValue.endDate
    ? [props.modelValue.startDate, props.modelValue.endDate]
    : null
)

// 点预设即查；选「自定义」时等日期选完再触发
const onPreset = (key) => {
  const next = { range: key, startDate: '', endDate: '' }
  emit('update:modelValue', next)
  if (key !== 'custom') emit('change', next)
}

const onDates = (v) => {
  const next = { ...props.modelValue, startDate: v?.[0] || '', endDate: v?.[1] || '' }
  emit('update:modelValue', next)
  if (v && v.length === 2) emit('change', next)
}
</script>

<style scoped>
.range-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

/* 窄屏：按钮组允许换行，避免横向溢出 */
@media (max-width: 768px) {
  .range-filter {
    width: 100%;
  }
  .range-filter :deep(.el-radio-group) {
    display: flex;
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .range-filter :deep(.el-date-editor) {
    width: 100% !important;
  }
}
</style>

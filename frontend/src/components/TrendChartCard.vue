<template>
  <!-- data-buckets 暴露当前桶数：便于排障与 UI 冒烟断言（无副作用） -->
  <div class="trend-card" :data-granularity="granularity" :data-buckets="labels.length">
    <div class="trend-header">
      <div class="trend-title-wrap">
        <span class="dot" :style="{ background: dotColor }"></span>
        <span class="trend-title">{{ title }}</span>
        <span class="trend-sub">{{ subtitle }}</span>
      </div>
      <!-- 粒度切换：日/周/月/季/年（每张图独立选择，由父组件负责记忆） -->
      <el-radio-group
        :model-value="granularity"
        size="small"
        class="granularity-switch"
        @update:model-value="$emit('update:granularity', $event)"
      >
        <el-radio-button v-for="opt in GRANULARITY_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="empty" class="trend-empty">{{ emptyText || '所选区间暂无数据' }}</div>
    <div v-show="!empty" ref="chartRef" class="trend-canvas"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import echarts from '@/utils/echarts'
import { formatMoney } from '@/utils/format'

// 粒度选项（与后端 utils/trendBuckets.GRANULARITIES 一致）
const GRANULARITY_OPTIONS = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'quarter', label: '季' },
  { value: 'year', label: '年' }
]

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  // 值类型：money → ¥ 千分位；qty → 整数件数
  valueType: { type: String, default: 'money' },
  unit: { type: String, default: '' },
  // 系列颜色：传 CSS 变量名（如 '--green'），运行时取 token → 视图层不硬编码色值
  colorVar: { type: String, default: '--primary' },
  labels: { type: Array, default: () => [] },
  values: { type: Array, default: () => [] },
  granularity: { type: String, default: 'month' },
  emptyText: { type: String, default: '' }
})

defineEmits(['update:granularity'])

const chartRef = ref(null)
let chart = null
let observer = null

const empty = computed(() => !(props.values || []).some((v) => Number(v) !== 0))
const dotColor = computed(() => `var(${props.colorVar})`)

const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v || '').trim() || fallback
}

// '#A8201A' / 'rgb(168, 32, 26)' → '168, 32, 26'（面积渐变需要 rgba）
const toRgb = (c) => {
  const hex = String(c).trim()
  if (hex.startsWith('#')) {
    const map = hex.replace('#', '').match(/../g) || []
    return map.length >= 3 ? map.slice(0, 3).map((h) => parseInt(h, 16)).join(', ') : '168, 32, 26'
  }
  const m = hex.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  return m ? `${m[1]}, ${m[2]}, ${m[3]}` : '168, 32, 26'
}

const fmtValue = (v) => {
  const n = Number(v) || 0
  return props.valueType === 'money' ? `¥ ${formatMoney(n)}` : `${n} ${props.unit || '件'}`
}

// y 轴：金额超过 1 万时用「万」缩写，避免刻度被长数字挤爆
const axisLabelFmt = (v) => {
  const n = Number(v) || 0
  if (props.valueType !== 'money') return String(n)
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(Math.abs(n) % 10000 === 0 ? 0 : 1)}万`
  return String(n)
}

const buildOption = () => {
  const cMain = cssVar(props.colorVar, '#A8201A')
  const cBorder = cssVar('--border', '#E6E6E6')
  const cText2 = cssVar('--text-2', '#6B6B6B')
  const cCard = cssVar('--card', '#FFFFFF')
  const rgb = toRgb(cMain)

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const p = ps && ps[0]
        if (!p) return ''
        return `${p.axisValue}<br/>${props.title}：${fmtValue(p.value)}`
      }
    },
    grid: { left: '3%', right: '5%', bottom: '3%', top: '14%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: props.labels,
      axisLine: { lineStyle: { color: cBorder } },
      axisTick: { show: false },
      axisLabel: { color: cText2, fontSize: 11 }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: cText2, fontSize: 11, formatter: axisLabelFmt },
      splitLine: { lineStyle: { color: cBorder } }
    },
    series: [
      {
        name: props.title,
        type: 'line',
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        data: props.values,
        lineStyle: { color: cMain, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `rgba(${rgb}, 0.1)` },
            { offset: 1, color: `rgba(${rgb}, 0)` }
          ])
        },
        itemStyle: { color: cMain, borderWidth: 2, borderColor: cCard }
      }
    ]
  }
}

// 渲染：空态下容器是 display:none（v-show），此时不能 init（会拿到 0 尺寸）
const render = async () => {
  if (empty.value) return
  await nextTick()
  if (!chartRef.value) return
  if (!chart) {
    chart = echarts.init(chartRef.value)
    chart.setOption(buildOption())
    return
  }
  chart.resize() // 从空态恢复时容器尺寸刚变回来，先同步尺寸
  chart.setOption(buildOption())
}

onMounted(async () => {
  await render()
  // 侧边栏折叠/窗口变化都会改容器宽度，但它不触发 window.resize（宽度过渡是 CSS 动画）
  if (window.ResizeObserver && chartRef.value) {
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(chartRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})

// 数据/粒度变化即重绘（父组件切粒度后传入新的 labels/values）
watch(
  () => [props.labels, props.values, props.granularity],
  render,
  { deep: true }
)
watch(() => props.colorVar, render)
</script>

<style scoped>
.trend-card {
  background: var(--card);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  height: 100%;
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.trend-title-wrap {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.trend-title-wrap .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.trend-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

.trend-sub {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.granularity-switch {
  flex-shrink: 0;
}

.granularity-switch :deep(.el-radio-button__inner) {
  padding: 3px 9px;
  font-size: 12px;
}

.trend-empty {
  height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 13px;
}

.trend-canvas {
  width: 100%;
  height: 260px;
}

@media (max-width: 768px) {
  .trend-card {
    padding: 14px 14px;
  }

  .trend-header {
    flex-wrap: wrap;
  }

  .trend-canvas,
  .trend-empty {
    height: 220px;
  }
}
</style>

<template>
  <!--
    全局悬浮「新建订单」快捷入口（2026-09-16）
    - 可任意拖动（鼠标 / 触摸），位置记在 localStorage（键 floating_order_btn_pos），刷新后保留
    - 点击（未拖动）打开订单表单；拖动过程中不触发打开
    - 表单与打印预览均挂在本组件内，因此任何页面都能直接开单，不依赖订单列表页
      （OrderFormDialog 自包含，自行拉取商品/水站/员工/水票等选项）；两者用异步组件 +
      v-if 按需加载，首次点击才拉对应 chunk，不增加首屏包体积
    - z-index 低于 Element Plus 弹窗（2000+），弹窗打开时按钮自然被遮住，不会误点
  -->
  <div
    v-show="ready"
    ref="wrapRef"
    class="float-entry"
    :class="{ dragging }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <button
      type="button"
      class="float-btn"
      title="点击新建订单；按住可拖动到任意位置"
      @click="onClick"
    >
      <el-icon class="float-icon"><Plus /></el-icon>
      <span class="float-text">新建订单</span>
    </button>
  </div>

  <!-- 全局订单表单（新建用）与打印预览：按需加载，避免把表单/打印代码打进首屏包 -->
  <component :is="FormDialog" v-if="overlayReady" ref="formRef" @saved="onSaved" />
  <component
    :is="PrintDialog"
    v-if="overlayReady"
    :visible="printVisible"
    :order="printOrder"
    @update:visible="printVisible = $event"
  />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { getOrderDetail } from '@/api/order'
import { useOrderStore } from '@/stores/order'

// 表单与打印预览均为「点了才用」的重量级组件（表单 1000+ 行、自拉商品/水站/员工/水票选项）。
// 用异步组件 + v-if：首次点击才加载对应 chunk，首屏包不受影响。
const FormDialog = defineAsyncComponent(() => import('@/views/order/OrderFormDialog.vue'))
const PrintDialog = defineAsyncComponent(() => import('@/views/order/OrderPrint.vue'))

const orderStore = useOrderStore()
const wrapRef = ref(null)
const formRef = ref(null)
const overlayReady = ref(false)
const pendingOpen = ref(false)
const printVisible = ref(false)
const printOrder = ref({})

// 异步组件加载完成后 formRef 才可用：若用户点得比加载快，挂上后再补开一次
watch(formRef, (inst) => {
  if (inst && pendingOpen.value) {
    pendingOpen.value = false
    inst.openCreate()
  }
})

const POS_KEY = 'floating_order_btn_pos'
const EDGE = 12          // 距视口边缘最小间距
const DRAG_THRESHOLD = 4 // 位移超过该像素判定为拖动（否则视为点击）

const pos = ref({ x: 0, y: 0 })
const dragging = ref(false)
const ready = ref(false) // 定位完成前不渲染，避免闪现到左上角

let dragState = null
let moved = false
let suppressClick = false

const size = () => ({
  w: wrapRef.value?.offsetWidth || 116,
  h: wrapRef.value?.offsetHeight || 44
})

const clamp = (x, y) => {
  const { w, h } = size()
  const maxX = Math.max(EDGE, window.innerWidth - w - EDGE)
  const maxY = Math.max(EDGE, window.innerHeight - h - EDGE)
  return {
    x: Math.min(Math.max(x, EDGE), maxX),
    y: Math.min(Math.max(y, EDGE), maxY)
  }
}

const defaultPos = () => {
  const { w, h } = size()
  // 默认右下角（避开内容区右下角的常见操作区，留 24px）
  return clamp(window.innerWidth - w - 24, window.innerHeight - h - 24)
}

const loadPos = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return clamp(raw.x, raw.y)
  } catch (e) {
    // 脏值按默认位置处理，不阻断渲染
  }
  return null
}

const savePos = () => {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({
      x: Math.round(pos.value.x),
      y: Math.round(pos.value.y)
    }))
  } catch (e) {
    // 隐私模式等写入失败时忽略
  }
}

const onResize = () => { pos.value = clamp(pos.value.x, pos.value.y) }

const onPointerDown = (e) => {
  if (e.button !== undefined && e.button !== 0) return // 仅左键/触摸
  dragState = { startX: e.clientX, startY: e.clientY, originX: pos.value.x, originY: pos.value.y }
  moved = false
  dragging.value = true
  try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch (err) { /* 忽略 */ }
}

const onPointerMove = (e) => {
  if (!dragging.value || !dragState) return
  const dx = e.clientX - dragState.startX
  const dy = e.clientY - dragState.startY
  if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true
  if (!moved) return
  pos.value = clamp(dragState.originX + dx, dragState.originY + dy)
}

const onPointerUp = (e) => {
  if (!dragging.value) return
  dragging.value = false
  try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch (err) { /* 忽略 */ }
  if (moved) {
    savePos()
    // 拖动结束后浏览器仍会派发 click，用一次性开关屏蔽掉，避免误开表单
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 0)
  }
  dragState = null
}

const onClick = () => {
  if (suppressClick || moved) return
  overlayReady.value = true
  if (formRef.value) formRef.value.openCreate()
  else pendingOpen.value = true // 异步组件尚在加载，加载完由 watch 补开
}

// 保存成功后：通知订单列表刷新（若正在显示），并处理「提交并打印」
const onSaved = async ({ print, savedId }) => {
  orderStore.notifyOrderSaved(savedId)
  if (print && savedId) {
    try {
      const res = await getOrderDetail(savedId)
      printOrder.value = res.data
      printVisible.value = true
    } catch (error) {
      console.error('获取订单详情用于打印失败:', error)
      ElMessage.warning('订单已保存，但获取打印数据失败，请到订单管理重新打印')
    }
  }
}

onMounted(() => {
  pos.value = loadPos() || defaultPos()
  ready.value = true
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.float-entry {
  position: fixed;
  z-index: 1500;
  touch-action: none; /* 拖动时不触发页面滚动 */
}

.float-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 18px;
  border: 1px solid var(--primary-dark);
  border-radius: 999px;
  background: var(--primary);
  color: var(--card);
  font-family: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: grab;
  user-select: none;
  box-shadow: var(--shadow-primary);
  transition: background 0.2s ease, transform 0.2s var(--ease-out-expo);
}

.float-btn:hover {
  background: var(--primary-dark);
}

.float-btn:active {
  cursor: grabbing;
}

.float-entry.dragging .float-btn {
  transform: scale(1.04);
  transition: none;
}

.float-icon {
  font-size: 16px;
}

/* 窄屏：只留图标，减少遮挡；仍可拖动 */
@media (max-width: 768px) {
  .float-btn {
    padding: 12px;
  }

  .float-text {
    display: none;
  }

  .float-icon {
    font-size: 18px;
  }
}
</style>

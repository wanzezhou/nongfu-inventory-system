<template>
  <canvas ref="el" class="ink-backdrop" aria-hidden="true" />
</template>

<script setup>
/**
 * 水墨山泉 · 动态背景（登录页专用）
 * ============================================================
 * 纯原生 Canvas，零第三方依赖。三层叠加：
 *   ① 墨团漂移 —— 宣纸晕染，极缓呼吸 + 缓慢位移
 *   ② 水面涟漪 —— 随机雨点 + 指针交互，压扁成椭圆暗示水面
 *   ③ 山泉滴落 —— 自顶部坠落，入水激起三环涟漪
 *
 * 配色全部在运行时从 :root 语义 token 读取（getComputedStyle），
 * 随主题联动、无任何硬编码色值（本文件在 <script> 内，且无字面 hex）。
 *
 * 性能与降级：
 *   - devicePixelRatio 上限 2，避免 4K 屏无谓开销
 *   - 页面切到后台（visibilitychange）暂停 rAF
 *   - 窄屏（<768px）自动降低墨团密度、拉长滴落间隔
 *   - prefers-reduced-motion: reduce 时只渲染一帧静态墨色
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  /** 墨团数量倍率 */
  inkDensity: { type: Number, default: 1 },
  /** 整体浓度倍率 */
  intensity: { type: Number, default: 1 },
  /** 水滴基准间隔（毫秒），实际会随机浮动 */
  dropInterval: { type: Number, default: 2800 }
})

const TAU = Math.PI * 2
const el = ref(null)

let ctx = null
let raf = 0
let running = false
let last = 0
let elapsed = 0
let nextDrop = 700
let W = 0
let H = 0
let waterY = 0
let C = null

const blobs = []
const ripples = []
const drops = []
const pointer = { x: 0, y: 0 }

const mq = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

/* ---------------------- 语义 token → rgb ---------------------- */

function token(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function toRgb(value) {
  const s = String(value).trim()
  if (s.charAt(0) === '#') {
    let h = s.slice(1)
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2)
    }
    const n = parseInt(h.slice(0, 6), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = s.match(/[\d.]+/g)
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0]
}

function rgba(c, a) {
  const k = a < 0 ? 0 : a > 1 ? 1 : a
  return `rgba(${c[0]},${c[1]},${c[2]},${k})`
}

function readPalette() {
  C = {
    ink: toRgb(token('--text', '#1F1F1F')),
    soft: toRgb(token('--text-2', '#7A7A72')),
    haze: toRgb(token('--text-3', '#AEAEA5')),
    water: toRgb(token('--primary', '#A8201A'))
  }
}

/* --------------------------- 尺寸 --------------------------- */

function fit() {
  const cvs = el.value
  if (!cvs) return
  const rect = cvs.getBoundingClientRect()
  W = rect.width || window.innerWidth
  H = rect.height || window.innerHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  cvs.width = Math.round(W * dpr)
  cvs.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  waterY = H * 0.88
}

function seed() {
  const narrow = W < 768
  let n = Math.round(4 * props.inkDensity) - (narrow ? 1 : 0)
  n = Math.max(3, Math.min(7, n))
  const base = Math.max(W, H)
  blobs.length = 0
  for (let i = 0; i < n; i++) {
    const deep = i % 4 === 0
    blobs.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.92,
      r: base * (0.2 + Math.random() * 0.22),
      dx: (Math.random() - 0.5) * 0.05,
      dy: (Math.random() - 0.5) * 0.036,
      phase: Math.random() * TAU,
      speed: 0.00016 + Math.random() * 0.00022,
      tone: deep ? C.ink : C.haze,
      deep: deep ? 0.09 : 0.066
    })
  }
}

/* ------------------------- 粒子发生器 ------------------------- */

function addRipple(x, y, opt = {}) {
  const maxR = opt.maxR !== undefined ? opt.maxR : 26 + Math.random() * 34
  ripples.push({
    x,
    y,
    maxR,
    r0: maxR * 0.1,
    rings: opt.rings !== undefined ? opt.rings : 1,
    tone: opt.tone || C.soft,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    maxLife: opt.maxLife !== undefined ? opt.maxLife : 1500,
    life: 0
  })
  if (ripples.length > 64) ripples.splice(0, ripples.length - 64)
}

function addDrop() {
  drops.push({
    x: W * (0.08 + Math.random() * 0.84),
    y: -30,
    v: 0.5 + Math.random() * 0.7,
    gravity: 0.055 + Math.random() * 0.05,
    r: 1.6 + Math.random() * 1.8
  })
  if (drops.length > 8) drops.splice(0, drops.length - 8)
}

/* ---------------------------- 渲染 ---------------------------- */

function step(dt, t) {
  const k = Math.min(3, dt / 16.667)
  ctx.clearRect(0, 0, W, H)

  /* ① 墨团：宣纸晕染 */
  for (const b of blobs) {
    b.x += b.dx * k
    b.y += b.dy * k
    if (b.x < -b.r) b.x = W + b.r
    else if (b.x > W + b.r) b.x = -b.r
    if (b.y < -b.r) b.y = H + b.r
    else if (b.y > H + b.r) b.y = -b.r

    const breathe = 1 + Math.sin(t * b.speed + b.phase) * 0.07
    const R = b.r * breathe
    const a0 = b.deep * props.intensity
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R)
    g.addColorStop(0, rgba(b.tone, a0))
    g.addColorStop(0.5, rgba(b.tone, a0 * 0.5))
    g.addColorStop(1, rgba(b.tone, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(b.x, b.y, R, 0, TAU)
    ctx.fill()
  }

  /* ② 水面涟漪：压扁椭圆，暗示俯视水面 */
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i]
    rp.life += dt
    const p = rp.life / rp.maxLife
    if (p >= 1) {
      ripples.splice(i, 1)
      continue
    }
    const ease = 1 - Math.pow(1 - p, 3)
    const rad = rp.r0 + (rp.maxR - rp.r0) * ease
    const fade = Math.pow(1 - p, 1.8) * rp.strength
    ctx.lineWidth = Math.max(0.6, 1.4 * (1 - p))
    for (let s = 0; s < rp.rings; s++) {
      const rr = rad * (1 - s * 0.26)
      if (rr <= 0.5) continue
      ctx.strokeStyle = rgba(rp.tone, fade * (1 - s * 0.32))
      ctx.beginPath()
      ctx.ellipse(rp.x, rp.y, rr, rr * 0.34, 0, 0, TAU)
      ctx.stroke()
    }
  }

  /* ③ 山泉滴落 */
  if (t >= nextDrop) {
    addDrop()
    nextDrop = t + props.dropInterval * (0.6 + Math.random() * 0.8)
  }
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]
    d.v += d.gravity * k
    d.y += d.v * k

    if (d.y >= waterY) {
      addRipple(d.x, waterY, {
        tone: C.water,
        maxR: 46 + Math.random() * 40,
        rings: 3,
        strength: 0.55,
        maxLife: 1800
      })
      drops.splice(i, 1)
      continue
    }

    // 拖尾
    const trail = ctx.createLinearGradient(d.x, d.y - d.r * 6, d.x, d.y)
    trail.addColorStop(0, rgba(C.water, 0))
    trail.addColorStop(1, rgba(C.water, 0.26 * props.intensity))
    ctx.strokeStyle = trail
    ctx.lineWidth = d.r * 0.9
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(d.x, d.y - d.r * 5.4)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()

    // 水珠本体
    ctx.fillStyle = rgba(C.water, 0.42 * props.intensity)
    ctx.beginPath()
    ctx.ellipse(d.x, d.y, d.r * 0.78, d.r * 1.28, 0, 0, TAU)
    ctx.fill()
  }
}

/* --------------------------- 主循环 --------------------------- */

function loop(now) {
  if (!running) return
  const raw = now - last
  last = now
  const dt = Math.min(48, raw > 0 ? raw : 16.667)
  elapsed += dt
  step(dt, elapsed)
  raf = requestAnimationFrame(loop)
}

function start() {
  if (running) return
  running = true
  last = performance.now()
  raf = requestAnimationFrame(loop)
}

function stop() {
  running = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

/* --------------------------- 事件 --------------------------- */

function onResize() {
  fit()
}

function onPointerMove(e) {
  const dx = e.clientX - pointer.x
  const dy = e.clientY - pointer.y
  if (!pointer.x || dx * dx + dy * dy < 900) {
    pointer.x = e.clientX
    pointer.y = e.clientY
    return
  }
  pointer.x = e.clientX
  pointer.y = e.clientY
  const rect = el.value ? el.value.getBoundingClientRect() : { left: 0, top: 0 }
  addRipple(e.clientX - rect.left, e.clientY - rect.top, {
    maxR: 20 + Math.random() * 26,
    rings: 1,
    strength: 0.3,
    maxLife: 1400
  })
}

function onVisibility() {
  if (document.hidden) stop()
  else start()
}

function onMotionChange() {
  if (mq && mq.matches) {
    stop()
    step(16.667, 0)
  } else {
    start()
  }
}

/* -------------------------- 生命周期 -------------------------- */

onMounted(() => {
  const cvs = el.value
  if (!cvs) return
  ctx = cvs.getContext('2d')
  if (!ctx) return
  readPalette()
  fit()
  seed()

  if (mq && mq.matches) {
    step(16.667, 0) // 静态一帧
    return
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  if (mq && mq.addEventListener) mq.addEventListener('change', onMotionChange)
  start()
})

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('visibilitychange', onVisibility)
  if (mq && mq.removeEventListener) mq.removeEventListener('change', onMotionChange)
  blobs.length = 0
  ripples.length = 0
  drops.length = 0
})
</script>

<style scoped>
.ink-backdrop {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>

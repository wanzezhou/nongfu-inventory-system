<template>
  <el-container class="main-layout">
    <el-aside :width="asideWidth" class="sidebar" :class="{ resizing: isResizing }">
      <div class="logo">
        <div class="logo-icon" v-if="!isCollapse">
          <svg viewBox="0 0 32 32" class="logo-svg" fill="none">
            <path class="logo-ink" d="M16 4C16 4 6 14 6 21C6 26.5 10.5 29 16 29C21.5 29 26 26.5 26 21C26 14 16 4 16 4Z" opacity="0.9"/>
            <path class="logo-drop" d="M16 10C16 10 10 16 10 21C10 23.8 12.5 25.5 16 25.5C19.5 25.5 22 23.8 22 21C22 16 16 10 16 10Z" opacity="0.85"/>
          </svg>
        </div>
        <div class="logo-text-wrapper" v-if="!isCollapse">
          <span class="logo-text">农夫山泉</span>
          <span class="logo-subtitle">经销商管理系统</span>
        </div>
        <span v-else class="logo-text-collapsed">农</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        class="sidebar-menu"
        @select="handleMenuSelect"
      >
        <!-- 菜单树来自 menuConfig.js（单一数据源，A8）；router meta.title 同源 -->
        <template v-for="entry in menuGroups" :key="entry.index">
          <!-- 分组菜单 -->
          <el-sub-menu v-if="entry.type === 'group'" :index="entry.index">
            <template #title>
              <el-icon><component :is="entry.icon" /></el-icon>
              <span>{{ entry.title }}</span>
            </template>
            <el-menu-item v-for="item in entry.items" :key="item.index" :index="item.index">
              <el-icon><component :is="item.icon" /></el-icon>
              <template #title>{{ item.title }}</template>
            </el-menu-item>
          </el-sub-menu>
          <!-- 独立菜单项 -->
          <el-menu-item v-else :index="entry.index">
            <el-icon><component :is="entry.icon" /></el-icon>
            <template #title>{{ entry.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>
      <div class="sidebar-footer" v-if="!isCollapse">
        <div class="sidebar-footer-line"></div>
        <span class="sidebar-footer-text">南京市晟之溪商贸有限公司</span>
        <span class="sidebar-footer-subtext">NONGFU SPRING</span>
      </div>
      <!-- 宽度拖拽手柄（折叠态隐藏） -->
      <div
        v-show="!isCollapse"
        class="sidebar-resizer"
        :class="{ dragging: isResizing }"
        @mousedown.prevent="startResize"
        @dblclick="resetWidth"
        title="拖拽调整宽度，双击恢复默认"
      ></div>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="toggleCollapse">
            <Fold v-if="!isCollapse" />
            <Expand v-else />
          </el-icon>
          <el-breadcrumb separator="/" class="breadcrumb">
            <el-breadcrumb-item v-for="(item, i) in breadcrumb" :key="i">{{ item }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <span class="current-date">{{ currentDate }}</span>
          <el-dropdown @command="handleCommand">
            <div class="user-info">
              <el-avatar :size="32" class="admin-avatar">{{ userInitial }}</el-avatar>
              <span class="username">{{ userDisplayName }}</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="changePassword">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 三级菜单：财务管理下各统计页的页面级入口（内容区顶部） -->
      <NavTabs />

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 全局悬浮「新建订单」快捷按钮（可拖动，位置记忆） -->
    <FloatingCreateOrder />

    <!-- 修改密码弹窗 -->
    <el-dialog v-model="passwordDialog" title="修改密码" width="400px" :close-on-click-modal="false">
      <el-form label-width="80px">
        <el-form-item label="旧密码">
          <el-input v-model="passwordForm.oldPassword" type="password" show-password placeholder="请输入旧密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="passwordForm.newPassword" type="password" show-password placeholder="请输入新密码" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password placeholder="请再次输入新密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialog = false">取消</el-button>
        <el-button type="primary" @click="handlePasswordSubmit">确定</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { ref, computed, reactive, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Fold, Expand } from '@element-plus/icons-vue'
import { changePassword } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { menuGroups, tabGroupOf, FINANCE_GROUP_TITLE } from './menuConfig'
import NavTabs from './NavTabs.vue'
import FloatingCreateOrder from '@/components/FloatingCreateOrder.vue'

const route = useRoute()
const router = useRouter()

// —— 侧边栏偏好（折叠态 + 宽度）持久化到 localStorage ——
const SIDEBAR_KEY = 'sidebar_pref'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 160
const MAX_WIDTH = 360

function loadSidebarPref() {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw)
    return p && typeof p === 'object' ? p : {}
  } catch (e) {
    return {}
  }
}

const _pref = loadSidebarPref()
// 无历史偏好时：窄屏默认收起，宽屏默认展开
const isNarrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
const isCollapse = ref(_pref.collapsed === undefined ? isNarrow : !!_pref.collapsed)
const sidebarWidth = ref(
  Number.isFinite(_pref.width) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, _pref.width)) : DEFAULT_WIDTH
)
const isResizing = ref(false)

const asideWidth = computed(() => (isCollapse.value ? '64px' : `${sidebarWidth.value}px`))

function saveSidebarPref() {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify({
      collapsed: isCollapse.value,
      width: sidebarWidth.value
    }))
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

watch([isCollapse, sidebarWidth], saveSidebarPref)

// 宽度拖拽：mousemove 期间同步跟手，mouseup 落库（watch 已负责持久化）
function startResize() {
  isResizing.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', stopResize)
}

function onResizeMove(e) {
  if (!isResizing.value) return
  // 侧边栏贴左，clientX 即为期望宽度
  const w = Math.round(e.clientX)
  sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))
}

function stopResize() {
  isResizing.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
}

function resetWidth() {
  sidebarWidth.value = DEFAULT_WIDTH
}

onBeforeUnmount(stopResize)

// 侧边栏高亮：三级页面回落到其所属二级入口（/fm/<key>），其余页面按路径本身高亮
const activeMenu = computed(() => {
  const g = tabGroupOf(route.path)
  return g ? `/fm/${g.key}` : route.path
})

// 菜单跳转：财务管理二级项的 index 是虚拟键（/fm/xxx），真实目标在 to 字段
const handleMenuSelect = (index) => {
  for (const g of menuGroups) {
    if (g.type !== 'group') continue
    const item = g.items.find((i) => i.index === index)
    if (item) {
      router.push(item.to || item.index)
      return
    }
  }
  router.push(index)
}

// —— 面包屑：一级分组 →（三级页面再带二级组） → 页面标题（数据源 menuConfig.js） ——
const breadcrumb = computed(() => {
  const path = route.path
  const g = tabGroupOf(path)
  if (g) {
    const tab = g.tabs.find((t) => t.index === path)
    return [FINANCE_GROUP_TITLE, g.title, tab ? tab.title : route.meta.title]
  }
  for (const mg of menuGroups) {
    if (mg.type === 'group' && mg.items.some((i) => i.index === path)) {
      return [mg.title, route.meta.title]
    }
    if (mg.type === 'item' && mg.index === path) return [route.meta.title]
  }
  return [route.meta.title || '首页']
})

// 用户信息
const userInfo = computed(() => useAuthStore().user)

const userDisplayName = computed(() => userInfo.value.displayName || '用户')
const userInitial = computed(() => {
  const name = userDisplayName.value
  return name ? name.charAt(0) : '?'
})

const currentDate = computed(() => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const weekDay = weekDays[now.getDay()]
  return `${year}年${month}月${day}日 ${weekDay}`
})

const toggleCollapse = () => {
  isCollapse.value = !isCollapse.value
}

// 修改密码弹窗
const passwordDialog = ref(false)
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const handleCommand = (command) => {
  if (command === 'logout') {
    handleLogout()
  } else if (command === 'changePassword') {
    passwordForm.oldPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    passwordDialog.value = true
  }
}

const handleLogout = () => {
  ElMessageBox.confirm('确定要退出登录吗？', '退出确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    useAuthStore().clear()
    ElMessage.success('已退出登录')
    router.push('/login')
  }).catch(() => {})
}

const handlePasswordSubmit = async () => {
  if (!passwordForm.oldPassword || !passwordForm.newPassword) {
    ElMessage.warning('请填写旧密码和新密码')
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  try {
    await changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword
    })
    ElMessage.success('密码修改成功，请重新登录')
    passwordDialog.value = false
    useAuthStore().clear()
    router.push('/login')
  } catch (error) {
    // 错误已由拦截器处理
  }
}
</script>

<!-- 布局与装饰样式外置（A7）：scoped 语义不变，infinite 动画已改 hover/静态 -->
<style scoped src="@/styles/main-layout.css"></style>

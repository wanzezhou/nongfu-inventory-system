<template>
  <el-container class="main-layout">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="sidebar">
      <div class="logo">
        <div class="logo-icon" v-if="!isCollapse">
          <svg viewBox="0 0 32 32" class="logo-svg" fill="none">
            <path d="M16 4C16 4 6 14 6 21C6 26.5 10.5 29 16 29C21.5 29 26 26.5 26 21C26 14 16 4 16 4Z" fill="#C7000B" opacity="0.9"/>
            <path d="M16 10C16 10 10 16 10 21C10 23.8 12.5 25.5 16 25.5C19.5 25.5 22 23.8 22 21C22 16 16 10 16 10Z" fill="#ffffff" opacity="0.85"/>
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
        :background-color="'#1A1A2E'"
        :text-color="'#8E8E9E'"
        :active-text-color="'#ffffff'"
        router
        class="sidebar-menu"
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
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="toggleCollapse">
            <Fold v-if="!isCollapse" />
            <Expand v-else />
          </el-icon>
          <span class="page-title">{{ currentPageTitle }}</span>
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

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

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
import { ref, computed, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Fold, Expand } from '@element-plus/icons-vue'
import { changePassword } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { menuGroups } from './menuConfig'

const route = useRoute()
const router = useRouter()
const isCollapse = ref(false)

const activeMenu = computed(() => route.path)

const currentPageTitle = computed(() => route.meta.title || '农夫山泉进销存管理系统')

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

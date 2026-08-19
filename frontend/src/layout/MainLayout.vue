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
        <el-menu-item index="/dashboard">
          <el-icon><HomeFilled /></el-icon>
          <template #title>仪表盘</template>
        </el-menu-item>
        <el-sub-menu index="/base">
          <template #title>
            <el-icon><Folder /></el-icon>
            <span>基础信息管理</span>
          </template>
          <el-menu-item index="/product">
            <el-icon><Goods /></el-icon>
            <template #title>商品管理</template>
          </el-menu-item>
          <el-menu-item index="/station">
            <el-icon><Shop /></el-icon>
            <template #title>水站管理</template>
          </el-menu-item>
          <el-menu-item index="/bulk-machine">
            <el-icon><Shop /></el-icon>
            <template #title>量贩机管理</template>
          </el-menu-item>
          <el-menu-item index="/retail-machine">
            <el-icon><Shop /></el-icon>
            <template #title>零售机管理</template>
          </el-menu-item>
          <el-menu-item index="/supplier">
            <el-icon><OfficeBuilding /></el-icon>
            <template #title>供应商管理</template>
          </el-menu-item>
          <el-menu-item index="/worker">
            <el-icon><User /></el-icon>
            <template #title>员工管理</template>
          </el-menu-item>
          <el-menu-item index="/salesman">
            <el-icon><Avatar /></el-icon>
            <template #title>业务员管理</template>
          </el-menu-item>
          <el-menu-item index="/mini-account">
            <el-icon><Iphone /></el-icon>
            <template #title>移动端账号</template>
          </el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="/trade">
          <template #title>
            <el-icon><DataAnalysis /></el-icon>
            <span>进销存管理</span>
          </template>
          <el-menu-item index="/inventory">
            <el-icon><Box /></el-icon>
            <template #title>库存管理</template>
          </el-menu-item>
          <el-menu-item index="/order">
            <el-icon><Document /></el-icon>
            <template #title>订单管理</template>
          </el-menu-item>
        </el-sub-menu>
        <el-sub-menu index="/statistics">
          <template #title>
            <el-icon><TrendCharts /></el-icon>
            <span>统计管理</span>
          </template>
          <el-menu-item index="/statistics/product-sales">
            <el-icon><DataLine /></el-icon>
            <template #title>商品销售统计</template>
          </el-menu-item>
        </el-sub-menu>
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
import { changePassword } from '@/api/auth'

const route = useRoute()
const router = useRouter()
const isCollapse = ref(false)

const activeMenu = computed(() => route.path)

const currentPageTitle = computed(() => route.meta.title || '农夫山泉进销存管理系统')

// 用户信息
const userInfo = computed(() => {
  try {
    return JSON.parse(localStorage.getItem('userInfo') || '{}')
  } catch {
    return {}
  }
})

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
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
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
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
    router.push('/login')
  } catch (error) {
    // 错误已由拦截器处理
  }
}
</script>

<style scoped>
.main-layout {
  height: 100vh;
  overflow: hidden;
}

/* ===== 侧边栏：深色质感 + 多层光照 ===== */
.sidebar {
  background: 
    radial-gradient(ellipse at top left, rgba(199, 0, 11, 0.08) 0%, transparent 40%),
    linear-gradient(180deg, #1A1A2E 0%, #12121F 100%);
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  box-shadow: 
    inset 1px 0 0 rgba(255, 255, 255, 0.04),
    inset -1px 0 0 rgba(0, 0, 0, 0.3),
    4px 0 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  position: relative;
}

.sidebar::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 1px;
  height: 100%;
  background: linear-gradient(180deg, 
    rgba(199, 0, 11, 0.15) 0%, 
    rgba(255, 255, 255, 0.03) 30%, 
    rgba(255, 255, 255, 0.02) 70%,
    rgba(199, 0, 11, 0.08) 100%);
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
  position: relative;
}

.logo::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(199, 0, 11, 0.2), transparent);
}

.logo-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  animation: logoFloat 5s ease-in-out infinite;
  position: relative;
}

.logo-icon::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(199, 0, 11, 0.3) 0%, transparent 70%);
  animation: logoPulse 3s ease-in-out infinite;
}

@keyframes logoFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-2px) rotate(1deg); }
}

@keyframes logoPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 0.8; transform: scale(1.1); }
}

.logo-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 2px 8px rgba(199, 0, 11, 0.5));
  position: relative;
  z-index: 1;
}

.logo-text-wrapper {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.logo-text {
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1.2px;
  white-space: nowrap;
  background: linear-gradient(135deg, #ffffff 0%, #E0E0E8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.logo-subtitle {
  color: rgba(142, 142, 158, 0.75);
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.6px;
  white-space: nowrap;
  margin-top: 2px;
}

.logo-text-collapsed {
  color: #C7000B;
  font-size: 24px;
  font-weight: 700;
  text-shadow: 0 0 16px rgba(199, 0, 11, 0.6);
  animation: collapsedGlow 2.5s ease-in-out infinite;
}

@keyframes collapsedGlow {
  0%, 100% { text-shadow: 0 0 12px rgba(199, 0, 11, 0.4); }
  50% { text-shadow: 0 0 20px rgba(199, 0, 11, 0.7); }
}

.sidebar-menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 0;
}

.sidebar-menu::-webkit-scrollbar {
  width: 3px;
}

.sidebar-menu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
}

.sidebar-menu::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}

.sidebar-footer {
  padding: 16px 20px;
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.03);
  position: relative;
}

.sidebar-footer::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
}

.sidebar-footer-line {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
  margin-bottom: 12px;
}

.sidebar-footer-text {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 1.2px;
  font-weight: 600;
  margin-bottom: 4px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.7) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-footer-subtext {
  display: block;
  font-size: 9px;
  color: rgba(199, 0, 11, 0.7);
  letter-spacing: 2px;
  text-transform: uppercase;
  font-weight: 500;
}

/* ===== 顶栏：苹果级毛玻璃 ===== */
.header {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  box-shadow: 
    0 1px 0 rgba(0, 0, 0, 0.04),
    0 4px 20px rgba(0, 0, 0, 0.02);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  height: 60px;
  position: relative;
  z-index: 10;
}

.header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, 
    transparent 0%, 
    rgba(0, 0, 0, 0.04) 20%, 
    rgba(0, 0, 0, 0.04) 80%, 
    transparent 100%);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 18px;
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: #8E8E9E;
  padding: 8px;
  border-radius: 10px;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.collapse-btn:hover {
  color: #C7000B;
  background-color: rgba(199, 0, 11, 0.06);
  transform: scale(1.08);
}

.collapse-btn:active {
  transform: scale(0.9);
  transition-duration: 0.1s;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #1A1A2E;
  letter-spacing: 0.3px;
  animation: titleFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes titleFadeIn {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.current-date {
  color: #9E9EAE;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.3px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  transition: all 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}

.current-date:hover {
  background: rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 5px 14px 5px 5px;
  border-radius: 22px;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  background: rgba(0, 0, 0, 0.02);
}

.user-info:hover {
  background-color: rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.user-info:active {
  transform: scale(0.96);
  transition-duration: 0.1s;
}

.username {
  color: #1A1A2E;
  font-size: 13px;
  font-weight: 500;
}

.admin-avatar {
  background: linear-gradient(135deg, #C7000B 0%, #8A0007 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 
    0 2px 10px rgba(199, 0, 11, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.admin-avatar::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.2) 50%, transparent 70%);
  animation: avatarShine 4s ease-in-out infinite;
}

@keyframes avatarShine {
  0%, 100% { transform: translate(-100%, -100%); }
  50% { transform: translate(0%, 0%); }
}

/* ===== 主内容区 ===== */
.main-content {
  background-color: #F5F5F7;
  padding: 28px;
  overflow-y: auto;
  position: relative;
}

.main-content::-webkit-scrollbar {
  width: 6px;
}

.main-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.page-placeholder {
  background: #fff;
  padding: 60px;
  text-align: center;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
}

.page-placeholder h2 {
  color: #1A1A2E;
  margin-bottom: 12px;
}

.page-placeholder p {
  color: #8E8E9E;
}

/* ===== 页面切换动画：弹性曲线 ===== */
.fade-enter-active {
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-leave-active {
  transition: all 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.98);
  filter: blur(2px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.99);
}

/* ===== 菜单项：苹果级精致交互 ===== */
:deep(.el-menu-item) {
  margin: 4px 10px;
  border-radius: 10px;
  height: 46px;
  line-height: 46px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

:deep(.el-menu-item::before) {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.04), transparent);
  transition: left 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

:deep(.el-menu-item:hover::before) {
  left: 100%;
}

:deep(.el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.05) !important;
  transform: translateX(2px);
}

:deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, #C7000B 0%, #9A0008 100%) !important;
  color: #ffffff !important;
  border-radius: 10px;
  box-shadow: 
    0 6px 16px rgba(199, 0, 11, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  transform: translateX(0);
  animation: activeItemGlow 3s ease-in-out infinite;
}

@keyframes activeItemGlow {
  0%, 100% {
    box-shadow: 
      0 6px 16px rgba(199, 0, 11, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  }
  50% {
    box-shadow: 
      0 8px 20px rgba(199, 0, 11, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1);
  }
}

:deep(.el-menu-item.is-active::after) {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 22px;
  background: #C7000B;
  border-radius: 0 3px 3px 0;
  box-shadow: 
    0 0 10px rgba(199, 0, 11, 0.8),
    0 0 4px rgba(199, 0, 11, 1);
}

/* ===== 子菜单分组样式 ===== */
:deep(.el-sub-menu__title) {
  margin: 4px 10px;
  border-radius: 10px;
  height: 48px;
  line-height: 48px;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  color: #8E8E9E !important;
  font-size: 14px;
  font-weight: 500;
}

:deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

:deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: #ffffff !important;
}

:deep(.el-sub-menu .el-menu) {
  background-color: transparent !important;
}

:deep(.el-sub-menu .el-menu .el-menu-item) {
  margin: 2px 12px;
  padding-left: 46px !important;
  height: 42px;
  line-height: 42px;
  font-size: 13px;
  background-color: transparent !important;
}

:deep(.el-sub-menu .el-menu .el-menu-item .el-icon) {
  font-size: 15px;
}

:deep(.el-sub-menu .el-menu .el-menu-item.is-active) {
  background: linear-gradient(135deg, #C7000B 0%, #9A0008 100%) !important;
  color: #ffffff !important;
  border-radius: 10px;
  box-shadow: 0 6px 16px rgba(199, 0, 11, 0.35);
}

:deep(.el-sub-menu .el-menu .el-menu-item.is-active::before),
:deep(.el-sub-menu .el-menu .el-menu-item.is-active::after) {
  display: none;
}

/* 折叠状态下子菜单标题不显示文本 */
.el-menu--collapse :deep(.el-sub-menu__title) {
  margin: 4px 10px;
  width: auto;
}
</style>

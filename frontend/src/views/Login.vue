<template>
  <div class="login-container">
    <!-- 装饰背景 -->
    <div class="bg-decoration">
      <div class="bg-circle bg-circle-1"></div>
      <div class="bg-circle bg-circle-2"></div>
      <div class="bg-circle bg-circle-3"></div>
    </div>

    <!-- 登录卡片 -->
    <div class="login-card">
      <!-- Logo 区域 -->
      <div class="logo-section">
        <div class="logo-wrapper">
          <svg viewBox="0 0 32 32" class="logo-svg" fill="none">
            <path d="M16 4C16 4 6 14 6 21C6 26.5 10.5 29 16 29C21.5 29 26 26.5 26 21C26 14 16 4 16 4Z" fill="#C7000B" opacity="0.9"/>
            <path d="M16 10C16 10 10 16 10 21C10 23.8 12.5 25.5 16 25.5C19.5 25.5 22 23.8 22 21C22 16 16 10 16 10Z" fill="#ffffff" opacity="0.85"/>
          </svg>
        </div>
        <h1 class="title">农夫山泉</h1>
        <p class="subtitle">经销商管理系统</p>
      </div>

      <!-- 表单区域 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @submit.prevent="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            size="large"
            :prefix-icon="User"
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            size="large"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="loading"
            @click="handleLogin"
          >
            登 录
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 提示 -->
      <div class="login-hint">
        <span>默认账户：admin / admin123</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { login } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const formRef = ref()
const loading = ref(false)

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  try {
    await formRef.value.validate()
    loading.value = true

    const res = await login(form)

    useAuthStore().setAuth(res.data.token, res.data.user)

    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (error) {
    if (error.message) {
      ElMessage.error(error.message)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1A1A2E 0%, #16213E 50%, #0F3460 100%);
  position: relative;
  overflow: hidden;
}

/* 装饰背景圆 */
.bg-decoration {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.bg-circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.15;
}

.bg-circle-1 {
  width: 500px;
  height: 500px;
  background: #C7000B;
  top: -150px;
  left: -100px;
  animation: float1 8s ease-in-out infinite;
}

.bg-circle-2 {
  width: 400px;
  height: 400px;
  background: #E8B400;
  bottom: -100px;
  right: -80px;
  animation: float2 10s ease-in-out infinite;
}

.bg-circle-3 {
  width: 300px;
  height: 300px;
  background: #C7000B;
  top: 40%;
  right: 20%;
  animation: float3 12s ease-in-out infinite;
}

@keyframes float1 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(30px, 40px); }
}

@keyframes float2 {
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-40px, -30px); }
}

@keyframes float3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-20px, 20px) scale(1.1); }
}

/* 登录卡片 */
.login-card {
  width: 400px;
  padding: 48px 40px 36px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  position: relative;
  z-index: 1;
  animation: cardEnter 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes cardEnter {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Logo 区域 */
.logo-section {
  text-align: center;
  margin-bottom: 36px;
}

.logo-wrapper {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #C7000B 0%, #A00009 100%);
  border-radius: 18px;
  box-shadow:
    0 8px 24px rgba(199, 0, 11, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  animation: logoPulse 3s ease-in-out infinite;
}

@keyframes logoPulse {
  0%, 100% { box-shadow: 0 8px 24px rgba(199, 0, 11, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
  50% { box-shadow: 0 8px 32px rgba(199, 0, 11, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
}

.logo-svg {
  width: 36px;
  height: 36px;
}

.title {
  font-size: 26px;
  font-weight: 700;
  color: #1A1A2E;
  margin: 0 0 4px 0;
  letter-spacing: 2px;
}

.subtitle {
  font-size: 14px;
  color: #8E8E93;
  margin: 0;
  letter-spacing: 1px;
}

/* 表单 */
.login-form {
  margin-bottom: 16px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 12px;
  padding: 4px 16px;
  transition: all 0.25s ease;
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #C7000B inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #C7000B inset, 0 0 0 4px rgba(199, 0, 11, 0.1);
}

.login-btn {
  width: 100%;
  height: 46px;
  font-size: 16px;
  letter-spacing: 4px;
  border-radius: 12px;
  background: linear-gradient(135deg, #C7000B 0%, #A00009 100%);
  border: none;
  box-shadow: 0 6px 20px rgba(199, 0, 11, 0.3);
  transition: all 0.25s ease;
}

.login-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(199, 0, 11, 0.4);
}

.login-btn:active {
  transform: translateY(0);
}

/* 提示 */
.login-hint {
  text-align: center;
  font-size: 12px;
  color: #8E8E93;
}
</style>

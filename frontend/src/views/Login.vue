<template>
  <div class="login-container">
    <!-- 登录卡片 -->
    <div class="login-card">
      <!-- Logo 区域 -->
      <div class="logo-section">
        <div class="logo-wrapper">
          <svg viewBox="0 0 32 32" class="logo-svg" fill="none">
            <path d="M16 4C16 4 6 14 6 21C6 26.5 10.5 29 16 29C21.5 29 26 26.5 26 21C26 14 16 4 16 4Z" fill="#A8201A" opacity="0.9"/>
            <path d="M16 10C16 10 10 16 10 21C10 23.8 12.5 25.5 16 25.5C19.5 25.5 22 23.8 22 21C22 16 16 10 16 10Z" fill="#ffffff" opacity="0.85"/>
          </svg>
        </div>
        <h1 class="title font-serif">农夫山泉</h1>
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
  background: var(--bg);
  position: relative;
  overflow: hidden;
  padding: 24px;
}

/* 登录卡片 */
.login-card {
  width: 400px;
  max-width: 94vw;
  padding: 44px 40px 32px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  animation: fadeUp 0.4s ease-out both;
}

/* Logo 区域 */
.logo-section {
  text-align: center;
  margin-bottom: 32px;
}

.logo-wrapper {
  width: 64px;
  height: 64px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-primary);
}

.logo-svg {
  width: 36px;
  height: 36px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 4px 0;
  letter-spacing: 2px;
}

.subtitle {
  font-size: 13px;
  color: var(--text-2);
  margin: 0;
  letter-spacing: 2px;
}

/* 表单 */
.login-form {
  margin-bottom: 12px;
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: 15px;
  letter-spacing: 4px;
  border-radius: var(--radius-md);
}

/* 提示 */
.login-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>

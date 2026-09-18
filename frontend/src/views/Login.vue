<template>
  <div class="login-page">
    <!-- 水墨山泉动态背景 -->
    <InkBackdrop class="login-ink" />

    <main class="login-stage">
      <!-- 品牌区 -->
      <header class="brand">
        <svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path class="mark-ridge" d="M2 30 L13 15.5 L19.5 23.5 L26 13.5 L38 30 Z" />
          <path class="mark-water" d="M20 3.5 C20 3.5 27.2 13.2 27.2 18.9 C27.2 23 23.9 25.4 20 25.4 C16.1 25.4 12.8 23 12.8 18.9 C12.8 13.2 20 3.5 20 3.5 Z" />
        </svg>
        <h1 class="brand-title font-serif">农夫山泉</h1>
        <p class="brand-sub">经销商业务管理系统</p>
      </header>

      <!-- 登录卡片 -->
      <section class="login-card">
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
          <el-form-item class="login-form-submit">
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

        <p class="login-hint">默认账户：admin / admin123</p>
      </section>
    </main>

    <footer class="login-foot">农夫山泉经销商进销存 · 内部系统</footer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Lock, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import InkBackdrop from '@/components/InkBackdrop.vue'
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
    // 登录失败自 2026-09-18 起为 HTTP 401（此前是 HTTP 200 + code 401），
    // 会走 axios 的 error 分支，故文案需从 response.data.message 取；
    // 取不到再退回 Error.message（如网络中断）。
    const msg = error?.response?.data?.message || error?.message
    if (msg) {
      ElMessage.error(msg)
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* ---------------- 页面骨架 ---------------- */
.login-page {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 40px 20px 68px;
  overflow: hidden;
  /* 页面底色（纯白）；水墨背景由 InkBackdrop 绘制 */
  background: var(--page-bg);
}

.login-ink {
  position: fixed;
  inset: 0;
  z-index: 0;
}

.login-stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
  width: 100%;
}

/* ---------------- 品牌区 ---------------- */
.brand {
  text-align: center;
  animation: fadeUp 0.4s ease-out both;
}

.brand-mark {
  display: block;
  width: 46px;
  height: 46px;
  margin: 0 auto 14px;
}

/* SVG 通过 CSS 属性着色（表现属性不支持 var()） */
.mark-ridge {
  fill: var(--text-3);
  opacity: 0.5;
}

.mark-water {
  fill: var(--primary);
}

.brand-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--text);
}

.brand-sub {
  margin: 8px 0 0;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--text-2);
}

/* ---------------- 登录卡片 ---------------- */
.login-card {
  width: 400px;
  max-width: 94vw;
  padding: 34px 34px 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: fadeUp 0.4s ease-out 0.06s both;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 20px;
}

.login-form :deep(.el-form-item__error) {
  padding-top: 4px;
}

.login-form-submit {
  margin-bottom: 16px;
}

.login-btn {
  width: 100%;
  height: 46px;
  font-size: 15px;
  letter-spacing: 6px;
  border-radius: var(--radius-md);
  transition: box-shadow 0.22s var(--ease-out-expo), background-color 0.22s var(--ease-out-expo);
}

.login-btn:hover {
  box-shadow: var(--shadow-primary);
}

.login-btn:active {
  transform: translateY(1px);
}

.login-hint {
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

/* ---------------- 页脚 ---------------- */
.login-foot {
  position: absolute;
  bottom: 22px;
  z-index: 1;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-3);
}

/* ---------------- 窄屏 ---------------- */
@media (max-width: 768px) {
  .login-page {
    padding: 32px 16px 44px;
  }

  .login-stage {
    gap: 20px;
  }

  .brand-mark {
    width: 40px;
    height: 40px;
    margin-bottom: 10px;
  }

  .brand-title {
    font-size: 22px;
    letter-spacing: 4px;
  }

  .brand-sub {
    font-size: 11px;
    letter-spacing: 2px;
  }

  .login-card {
    width: 100%;
    max-width: 94vw;
    padding: 26px 20px 18px;
  }

  .login-foot {
    position: static;
    margin-top: 18px;
  }
}
</style>

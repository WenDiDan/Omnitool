<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-badge">箱</div>
        <h1>工具箱 · 后台管理</h1>
        <p>P1 管理控制台</p>
      </div>

      <!-- 首次初始化：admin_users 为空时展示 -->
      <t-alert v-if="initVisible" theme="info" message="首次部署：请先创建超级管理员账号" style="margin-bottom: 16px" />
      <t-form v-if="initVisible" @submit="onInit">
        <t-form-item label="初始化码" name="initCode">
          <t-input v-model="form.initCode" placeholder="部署时生成的初始化码" />
        </t-form-item>
        <t-form-item label="用户名" name="username">
          <t-input v-model="form.username" placeholder="3-20 位字母数字下划线" />
        </t-form-item>
        <t-form-item label="密码" name="password">
          <t-input v-model="form.password" type="password" placeholder="8 位以上，含字母和数字" />
        </t-form-item>
        <t-button theme="primary" type="submit" block :loading="loading">初始化超管账号</t-button>
      </t-form>

      <t-form v-else @submit="onLogin">
        <t-form-item label="用户名" name="username">
          <t-input v-model="form.username" placeholder="请输入用户名" />
        </t-form-item>
        <t-form-item label="密码" name="password">
          <t-input v-model="form.password" type="password" placeholder="请输入密码" />
        </t-form-item>
        <t-button theme="primary" type="submit" block :loading="loading">登 录</t-button>
      </t-form>

      <div class="login-toggle" @click="initVisible = !initVisible">
        {{ initVisible ? '已有账号？去登录' : '首次部署？初始化超管' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { api } from '../api'

const router = useRouter()
const loading = ref(false)
const initVisible = ref(false)
const form = reactive({ initCode: '', username: '', password: '' })

async function onInit({ validateResult }) {
  if (validateResult && validateResult.errors && validateResult.errors.length) return
  loading.value = true
  const res = await api('admin.init', { ...form })
  loading.value = false
  if (res.ok) {
    MessagePlugin.success(res.message || '初始化成功，请登录')
    initVisible.value = false
  } else {
    MessagePlugin.error(res.error || '初始化失败')
  }
}

async function onLogin({ validateResult }) {
  if (validateResult && validateResult.errors && validateResult.errors.length) return
  loading.value = true
  const res = await api('auth.login', { username: form.username, password: form.password })
  loading.value = false
  if (res.ok) {
    localStorage.setItem('admin_token', res.token)
    localStorage.setItem('admin_user', JSON.stringify({ username: res.username, role: res.role }))
    router.push('/tools')
  } else {
    MessagePlugin.error(res.error || '登录失败')
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f3e7d8 0%, #f9f4eb 420px);
}
.login-card {
  width: 400px;
  max-width: calc(100vw - 32px);   /* 手机窄屏时自动收缩，留出安全边距 */
  background: #fff;
  border: 1px solid #efe3d5;
  border-radius: 18px;
  padding: 36px 32px;
  box-shadow: 0 12px 36px rgba(43, 29, 24, 0.10);
  box-sizing: border-box;
}
@media (max-width: 480px) {
  .login-page { align-items: flex-start; padding-top: 12vh; }
  .login-card { padding: 26px 20px; }
  .login-brand h1 { font-size: 19px; }
}
.login-brand { text-align: center; margin-bottom: 24px; }
.login-brand h1 { font-size: 22px; margin: 12px 0 4px; color: #2b1d18; }
.login-brand p { color: #7d695f; font-size: 13px; margin: 0; }
.brand-badge {
  width: 52px; height: 52px; margin: 0 auto;
  display: flex; align-items: center; justify-content: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #cb5f47, #a8452f);
  color: #fff; font-size: 24px; font-weight: 700;
  box-shadow: 0 8px 20px rgba(192, 85, 61, 0.30);
}
.login-toggle {
  margin-top: 16px; text-align: center;
  color: #7d695f; font-size: 13px; cursor: pointer;
}
.login-toggle:hover { color: #c0553d; }
</style>

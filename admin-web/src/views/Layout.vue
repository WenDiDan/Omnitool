<template>
  <!-- ============ 桌面：左侧栏布局 ============ -->
  <t-layout v-if="!isMobile" style="min-height: 100vh">
    <t-aside width="220px">
      <div class="side-brand">
        <div class="brand-dot"></div>
        <span>工具箱后台</span>
      </div>
      <t-menu :value="active" theme="light" @change="onNav">
        <t-menu-item value="tools"><span>工具配置</span></t-menu-item>
        <t-menu-item value="users"><span>用户管理</span></t-menu-item>
        <t-menu-item value="mutual"><span>互助管理</span></t-menu-item>
        <t-menu-item value="logs"><span>审计日志</span></t-menu-item>
      </t-menu>
      <div class="side-footer">
        <div class="whoami">{{ me.username }}（{{ roleLabel }}）</div>
        <div class="side-actions">
          <t-button variant="text" theme="primary" size="small" @click="openPwd">修改密码</t-button>
          <t-button variant="text" theme="danger" size="small" @click="onLogout">退出登录</t-button>
        </div>
      </div>
    </t-aside>
    <t-layout class="app-main">
      <t-content class="app-content">
        <router-view />
      </t-content>
    </t-layout>
  </t-layout>

  <!-- ============ 手机：顶部标签导航 + 底部用户条 ============ -->
  <div v-else class="m-shell">
    <header class="m-header">
      <div class="m-brand">工具箱后台</div>
      <nav class="m-tabs">
        <div v-for="item in NAV_ITEMS" :key="item.key"
             class="m-tab" :class="{ 'is-active': active === item.key }"
             @click="onNav(item.key)">{{ item.label }}</div>
      </nav>
    </header>

    <main class="m-content">
      <router-view />
    </main>

    <footer class="m-footer">
      <span class="m-user">{{ me.username }}（{{ roleLabel }}）</span>
      <div class="m-actions">
        <t-button variant="text" theme="primary" size="small" @click="openPwd">修改密码</t-button>
        <t-button variant="text" theme="danger" size="small" @click="onLogout">退出</t-button>
      </div>
    </footer>
  </div>

  <!-- 修改密码（两种布局共用） -->
  <t-dialog v-model:visible="pwdVisible" header="修改密码" width="420px"
            :confirm-btn="{ content: '确认修改', loading: pwdSaving }"
            :cancel-btn="{ content: '取消' }" @confirm="submitPwd">
    <t-form label-width="90px" label-align="right">
      <t-form-item label="当前密码">
        <t-input v-model="oldPwd" type="password" clearable placeholder="请输入当前密码" />
      </t-form-item>
      <t-form-item label="新密码">
        <t-input v-model="newPwd" type="password" clearable placeholder="8 位以上，含字母和数字" />
      </t-form-item>
      <t-form-item label="确认新密码">
        <t-input v-model="newPwd2" type="password" clearable placeholder="请再次输入新密码" />
      </t-form-item>
    </t-form>
    <p class="pwd-hint">修改成功后所有已登录设备会被强制退出，需用新密码重新登录。</p>
  </t-dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { api } from '../api'
import { useIsMobile } from '../useIsMobile'

const route = useRoute()
const router = useRouter()
const isMobile = useIsMobile()
const active = computed(() => route.path.replace('/', '') || 'tools')

const NAV_ITEMS = [
  { key: 'tools', label: '工具配置' },
  { key: 'users', label: '用户管理' },
  { key: 'mutual', label: '互助管理' },
  { key: 'logs', label: '审计日志' }
]

const me = JSON.parse(localStorage.getItem('admin_user') || '{}')
const roleLabel = me.role === 'super' ? '超管' : '运营'

function onNav(v) { router.push('/' + v) }

// ===================== 修改密码 =====================
const pwdVisible = ref(false)
const oldPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')
const pwdSaving = ref(false)

function openPwd() {
  oldPwd.value = ''
  newPwd.value = ''
  newPwd2.value = ''
  pwdVisible.value = true
}

async function submitPwd() {
  if (!oldPwd.value) { MessagePlugin.warning('请输入当前密码'); return }
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPwd.value)) {
    MessagePlugin.warning('新密码须 8 位以上且包含字母和数字')
    return
  }
  if (newPwd.value !== newPwd2.value) { MessagePlugin.warning('两次输入的新密码不一致'); return }

  pwdSaving.value = true
  const res = await api('auth.changePassword', { oldPassword: oldPwd.value, newPassword: newPwd.value })
  pwdSaving.value = false
  if (!res.ok) { MessagePlugin.error(res.error || '修改失败'); return }

  pwdVisible.value = false
  MessagePlugin.success('密码已修改，请用新密码重新登录')
  // 后端已作废旧会话，这里同步清理本地凭证
  setTimeout(() => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    router.push('/login')
  }, 1200)
}

function onLogout() {
  const d = DialogPlugin.confirm({
    header: '退出登录',
    body: '确定退出当前账号？',
    onConfirm: () => {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
      router.push('/login')
      d.destroy()
    }
  })
}
</script>

<style scoped>
.side-brand {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px; font-weight: 700; color: #2b1d18;
  border-bottom: 1px solid #efe3d5;
}
.brand-dot {
  width: 14px; height: 14px; border-radius: 4px;
  background: linear-gradient(135deg, #cb5f47, #a8452f);
}
.side-footer {
  position: absolute; bottom: 16px; left: 20px;
  font-size: 13px; color: #7d695f;
}
.whoami { margin-bottom: 4px; }
.side-actions { display: flex; align-items: center; gap: 4px; }
.pwd-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #8b776b;
  line-height: 1.6;
}

/* flex 子项默认 min-width:auto，宽表格会把内容区撑开导致整页横向滚动；
   显式归零后，超宽内容在页面内部滚动，不影响外层布局 */
.app-main { min-width: 0; }
.app-content {
  min-width: 0;
  padding: 24px;
  background: #f9f4eb;
  overflow-x: hidden;
}

/* ============ 手机端独立布局 ============ */
.m-shell {
  min-height: 100vh;
  background: #f9f4eb;
  display: flex;
  flex-direction: column;
}

/* 顶部：品牌 + 横向标签导航（吸顶） */
.m-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #fff;
  border-bottom: 1px solid #efe3d5;
  box-shadow: 0 2px 8px rgba(43, 29, 24, 0.05);
}
.m-brand {
  padding: 10px 14px 8px;
  font-size: 15px;
  font-weight: 700;
  color: #2b1d18;
}
.m-tabs {
  display: flex;
  gap: 4px;
  padding: 0 10px 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.m-tabs::-webkit-scrollbar { display: none; }
.m-tab {
  flex: 0 0 auto;
  padding: 7px 14px;
  font-size: 13px;
  color: #7d695f;
  border-radius: 999px;
  background: #f7ede2;
  white-space: nowrap;
}
.m-tab.is-active {
  color: #fff;
  background: linear-gradient(135deg, #cb5f47, #a8452f);
  font-weight: 600;
}

.m-content {
  flex: 1;
  padding: 12px 12px 76px;   /* 底部留出用户条高度 */
  min-width: 0;
}

/* 底部固定用户条 */
.m-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px calc(8px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #efe3d5;
  box-shadow: 0 -2px 8px rgba(43, 29, 24, 0.05);
}
.m-user {
  font-size: 12px;
  color: #7d695f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.m-actions { display: flex; align-items: center; gap: 2px; flex: none; }
</style>

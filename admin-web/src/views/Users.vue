<template>
  <div class="page-card">
    <div class="page-head">
      <div>
        <h2 class="page-head-title">用户管理</h2>
        <p class="page-head-desc">小程序用户身份、VIP 与封禁管理，所有操作均写入审计日志</p>
      </div>
      <div class="page-head-actions">
        <t-input v-model="keyword" placeholder="搜索昵称 / openid" clearable style="width: 260px"
                 @enter="search" @clear="search" />
        <t-button theme="primary" :loading="loading" @click="search">搜索</t-button>
      </div>
    </div>

    <div class="stat-chips" role="group" aria-label="用户概览">
      <div class="stat-chip is-deep">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ total }}</span>
          <span class="stat-chip-unit">人</span>
        </div>
        <div class="stat-chip-label">用户总数</div>
        <div class="stat-chip-bar"><i style="width: 100%"></i></div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ pageVipCount }}</span>
          <span class="stat-chip-unit">人</span>
        </div>
        <div class="stat-chip-label">本页 VIP</div>
        <div class="stat-chip-bar"><i :style="{ width: pageRatio(pageVipCount) + '%' }"></i></div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ pageAdminCount }}</span>
          <span class="stat-chip-unit">人</span>
        </div>
        <div class="stat-chip-label">本页管理员</div>
        <div class="stat-chip-bar"><i :style="{ width: pageRatio(pageAdminCount) + '%' }"></i></div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ pageBlockedCount }}</span>
          <span class="stat-chip-unit">人</span>
        </div>
        <div class="stat-chip-label">本页封禁</div>
        <div class="stat-chip-bar"><i :style="{ width: pageRatio(pageBlockedCount) + '%' }"></i></div>
      </div>
    </div>
    <p class="stat-note">「本页」统计基于当前分页数据，用于快速判断当前页构成</p>

    <div class="table-caption">共 {{ total }} 位用户 · 本页 {{ users.length }} 条</div>
    <!-- 表格横向滚动约束在容器内，避免列宽总和超出时把整个页面撑宽 -->
    <div class="table-wrap">
    <t-table :data="users" :columns="columns" row-key="_id" :loading="loading" size="medium"
             table-layout="fixed"
             :empty="keyword ? `没有匹配「${keyword}」的用户` : '暂无用户数据'">
      <!-- 插槽内一律用可选链：TDesign 内部文本测量时可能以空 row 调用插槽 -->
      <template #nickName="{ row }">
        <span class="nick">{{ (row && row.nickName) || '未设置昵称' }}</span>
      </template>
      <template #role="{ row }">
        <t-tag :theme="roleTheme(row && row.role)" variant="light-outline">{{ roleLabel(row && row.role) }}</t-tag>
      </template>
      <template #op="{ row }">
        <t-button variant="text" theme="primary" size="small"
                  :loading="busyOf(row, 'vip')" @click="row && openVip(row)">VIP</t-button>
        <t-button variant="text" theme="warning" size="small"
                  :loading="busyOf(row, 'role')" @click="row && openRole(row)">管理员</t-button>
        <t-button v-if="row && row.role !== 'blocked'" variant="text" theme="danger" size="small"
                  :loading="busyOf(row, 'ban')" @click="row && openBan(row)">封禁</t-button>
        <t-button v-else variant="text" theme="success" size="small"
                  :loading="busyOf(row, 'ban')" @click="row && unban(row)">解封</t-button>
      </template>
    </t-table>
    </div>

    <div class="pager">
      <t-pagination :total="total" :current="page" :page-size="20"
                    :page-size-options="[20, 50]" @change="onPage" @page-size-change="onPageSize" />
    </div>

    <!-- 封禁弹窗 -->
    <t-dialog v-model:visible="banDialog" header="封禁用户"
              :confirm-btn="{ content: '确认封禁', theme: 'danger', loading: saving }"
              :cancel-btn="{ content: '取消' }" @confirm="confirmBan">
      <p class="dialog-target">目标：{{ current.nickName || current.openid }}</p>
      <t-input v-model="banReason" placeholder="请填写封禁原因（用户可见）" />
      <p class="hint">封禁后用户无法使用小程序，解封可随时恢复</p>
    </t-dialog>

    <!-- VIP 弹窗 -->
    <t-dialog v-model:visible="vipDialog" header="设置 VIP"
              :confirm-btn="{ content: '确认', loading: saving }" @confirm="confirmVip">
      <p class="dialog-target">目标：{{ current.nickName || current.openid }}</p>
      <t-form label-width="100px">
        <t-form-item label="VIP 状态">
          <t-switch v-model="vipOn" />
        </t-form-item>
        <t-form-item label="有效期(天)">
          <t-input-number v-model="vipDays" :min="0" theme="column" style="width: 160px" :disabled="!vipOn" />
          <span class="hint">0 = 永久 VIP</span>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- 管理员授权弹窗 -->
    <t-dialog v-model:visible="roleDialog" header="小程序内管理员"
              :confirm-btn="{ content: '确认', loading: saving }" @confirm="confirmRole">
      <p class="dialog-target">目标：{{ current.nickName || current.openid }}</p>
      <t-radio-group v-model="roleValue">
        <t-radio value="admin">授予管理员</t-radio>
        <t-radio value="user">回收（设为普通用户）</t-radio>
      </t-radio-group>
      <p class="hint">仅超级管理员可执行此操作</p>
    </t-dialog>

  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { api } from '../api'
import { roleLabel, roleTheme } from '../labels'
import { useIsMobile } from '../useIsMobile'

const me = JSON.parse(localStorage.getItem('admin_user') || '{}')

const users = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const busyKey = ref('')

const banDialog = ref(false)
const banReason = ref('')
const vipDialog = ref(false)
const vipOn = ref(true)
const vipDays = ref(0)
const roleDialog = ref(false)
const roleValue = ref('admin')
const current = reactive({ openid: '', nickName: '' })

const isMobile = useIsMobile()

// 手机端只保留关键列（昵称/身份/操作），避免多列挤压在窄屏里
const MOBILE_COLS = ['nickName', 'role', 'op']

const columns = computed(() => {
  const all = [
    { colKey: 'nickName', title: '昵称', width: 110 },
    // openid 完整显示：等宽字体通过列 className 施加，
    // 不使用自定义插槽 —— TDesign 内部测量时会以空 row 调用插槽导致整表渲染失败
    { colKey: 'openid', title: 'openid', width: 235, className: 'col-openid' },
    { colKey: 'role', title: '身份', width: 70 },
    { colKey: 'banReason', title: '封禁原因', width: 200, ellipsis: true, cell: (_, ctx) => (ctx && ctx.row && ctx.row.banReason) || '-' },
    { colKey: 'vipExpiresAt', title: 'VIP到期', width: 210, cell: (_, ctx) => (ctx && ctx.row && (ctx.row.vipExpiresAt || (ctx.row.role === 'vip' ? '永久' : '-'))) || '-' },
    { colKey: 'createdAt', title: '注册时间', width: 110, cell: (_, ctx) => ((ctx && ctx.row && (ctx.row.createdAt || ctx.row.registeredAt)) || '-').slice(0, 10) },
    { colKey: 'op', title: '操作', width: 200 }
  ]
  return isMobile.value ? all.filter((c) => MOBILE_COLS.includes(c.colKey)) : all
})

const pageVipCount = computed(() => users.value.filter(u => u.role === 'vip').length)
const pageAdminCount = computed(() => users.value.filter(u => u.role === 'admin').length)
const pageBlockedCount = computed(() => users.value.filter(u => u.role === 'blocked').length)
/** 占本页用户数的比例（仅用于统计条宽度展示） */
const pageRatio = (n) => (users.value.length ? Math.round((n / users.value.length) * 100) : 0)


function busyOf(row, action) { return busyKey.value === `${row.openid}:${action}` }

async function load() {
  loading.value = true
  const res = await api('user.list', { page: page.value, size: pageSize.value, keyword: keyword.value })
  loading.value = false
  if (res.ok) {
    users.value = res.users || []
    total.value = res.total || 0
  } else MessagePlugin.error(res.error)
}

/** 搜索必须回到第 1 页，否则会停留在空白页 */
function search() {
  page.value = 1
  load()
}

function onPage(p) { page.value = p; load() }
function onPageSize(size) { pageSize.value = size; page.value = 1; load() }

function openBan(row) {
  current.openid = row.openid
  current.nickName = row.nickName
  banReason.value = ''
  banDialog.value = true
}

async function confirmBan() {
  if (!banReason.value.trim()) { MessagePlugin.warning('封禁必须填写原因'); return }
  saving.value = true
  busyKey.value = `${current.openid}:ban`
  const res = await api('user.ban', { openid: current.openid, ban: true, reason: banReason.value.trim() })
  saving.value = false
  busyKey.value = ''
  banDialog.value = false
  if (res.ok) { MessagePlugin.success(res.message); load() }
  else MessagePlugin.error(res.error)
}

async function unban(row) {
  if (busyKey.value) return
  // 详情抽屉已移除：解封前把封禁原因与时间展示出来，便于核实
  const dlg = DialogPlugin.confirm({
    header: '解除封禁',
    body: `确认解封「${row.nickName || row.openid}」？\n\n封禁原因：${row.banReason || '未填写'}\n封禁时间：${row.bannedAt || '-'}`,
    confirmBtn: { content: '确认解封', theme: 'success' },
    onConfirm: async () => {
      busyKey.value = `${row.openid}:ban`
      const res = await api('user.ban', { openid: row.openid, ban: false })
      busyKey.value = ''
      dlg.destroy()
      if (res.ok) { MessagePlugin.success(res.message); load() }
      else MessagePlugin.error(res.error)
    },
    onClose: () => dlg.destroy()
  })
}

function openVip(row) {
  current.openid = row.openid
  current.nickName = row.nickName
  vipOn.value = row.role === 'vip'
  vipDays.value = 0
  vipDialog.value = true
}

async function confirmVip() {
  saving.value = true
  const res = await api('user.setVip', { openid: current.openid, vip: vipOn.value, expiresDays: vipDays.value })
  saving.value = false
  vipDialog.value = false
  if (res.ok) { MessagePlugin.success(res.message); load() }
  else MessagePlugin.error(res.error)
}

function openRole(row) {
  if (me.role !== 'super') { MessagePlugin.warning('仅超级管理员可授权'); return }
  current.openid = row.openid
  current.nickName = row.nickName
  roleValue.value = row.role === 'admin' ? 'user' : 'admin'
  roleDialog.value = true
}

async function confirmRole() {
  saving.value = true
  const res = await api('user.setRole', { openid: current.openid, role: roleValue.value })
  saving.value = false
  roleDialog.value = false
  if (res.ok) { MessagePlugin.success(res.message); load() }
  else MessagePlugin.error(res.error)
}

onMounted(load)
</script>

<style scoped>
/* .table-wrap 定义在全局 style.css */
.page-head-actions { align-items: center; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
.hint { color: #7d695f; font-size: 12px; margin-top: 8px; }
.nick { color: #2b1d18; font-weight: 500; }
.dialog-target {
  margin: 0 0 12px; font-size: 13px; color: #7d695f;
  background: #f7ede2; border-radius: 8px; padding: 8px 12px;
}

/* openid：等宽字体（列 className 施加，避免使用插槽） */
:deep(.col-openid) {
  font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  color: #5c4a40;
}
</style>

<template>
  <div>
    <!-- 顶部统计 -->
    <div class="page-head">
      <div>
        <h2>互助管理</h2>
        <p class="page-sub">互助资料登记与助力记录核查，独立于微信账号管理</p>
      </div>
      <div class="head-stats">
        <span>共 {{ total }} 个互助账号</span>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="filter-bar">
      <t-input v-model="filterNick" placeholder="淘宝昵称（模糊）" clearable style="width: 220px"
               @enter="search" @clear="search" />
      <t-input v-model="filterSiteNo" placeholder="站内编号（如 1）" clearable style="width: 160px"
               @enter="search" @clear="search" />
      <t-button theme="primary" variant="base" @click="search">查询</t-button>
      <t-button variant="outline" @click="resetFilter">重置</t-button>
    </div>

    <!-- 账号表格 -->
    <!-- 表格横向滚动约束在容器内（.table-wrap 定义于全局 style.css） -->
    <div class="table-wrap">
    <t-table :data="accounts" :columns="columns" row-key="openid" :loading="loading"
             :pagination="{ total, current: page, pageSize: size, showJumper: true }"
             @page-change="onPage">
      <template #avatarNick="{ row }">
        <div class="cell-user">
          <t-avatar :image="row.avatar" size="32px">{{ (row.nick || '淘').slice(0, 1) }}</t-avatar>
          <span class="cell-nick">{{ row.nick || '-' }}</span>
        </div>
      </template>
      <template #role="{ row }">
        <t-tag :theme="roleTheme(row.role)" variant="light" size="small">{{ roleLabel(row.role) }}</t-tag>
      </template>
      <template #pause="{ row }">
        <div class="cell-pause">
          <t-tag v-if="row.pausedSolo" theme="warning" variant="outline" size="small">个人赛已暂停</t-tag>
          <t-tag v-if="row.pausedTeam" theme="warning" variant="outline" size="small">车队已暂停</t-tag>
          <span v-if="!row.pausedSolo && !row.pausedTeam" class="pause-none">正常</span>
        </div>
      </template>
      <template #op="{ row }">
        <t-button variant="text" theme="primary" size="small" @click="openRecords(row)">互助记录</t-button>
      </template>
    </t-table>
    </div>

    <!-- 互助记录抽屉 -->
    <t-drawer :visible="recVisible" width="640px" :confirm-btn="null" :close-btn="true" :footer="true"
              :header="recTitle" @close="recVisible = false">
      <div v-if="recLoading && !recLoaded" class="detail-loading">正在加载互助记录…</div>

      <div v-else-if="recError && !recLoaded" class="detail-error">
        <p>{{ recError }}</p>
        <t-button theme="primary" size="small" @click="retryRecords">重新加载</t-button>
      </div>

      <template v-else-if="recLoaded">
        <!-- 统计 -->
        <div class="detail-stats">
          <div class="dstat">
            <div class="dstat-value"><b>{{ statOf('total') }}</b><em>条</em></div>
            <span>记录总数</span>
          </div>
          <div class="dstat">
            <div class="dstat-value"><b>{{ statOf('help') }}</b><em>次</em></div>
            <span>助人次数</span>
          </div>
          <div class="dstat">
            <div class="dstat-value"><b>{{ statOf('receive') }}</b><em>次</em></div>
            <span>受助次数</span>
          </div>
          <div class="dstat">
            <div class="dstat-value"><b>{{ statOf('done') }}</b><em>条</em></div>
            <span>已完成</span>
          </div>
          <div class="dstat">
            <div class="dstat-value"><b>{{ statOf('ongoing') }}</b><em>条</em></div>
            <span>进行中</span>
          </div>
        </div>

        <!-- 记录列表 -->
        <div class="records-head">
          <span class="records-title">互助记录</span>
          <t-radio-group v-model="recordType" size="small" variant="default-filled" @change="reloadRecords">
            <t-radio-button value="">全部</t-radio-button>
            <t-radio-button value="help">助人</t-radio-button>
            <t-radio-button value="receive">受助</t-radio-button>
          </t-radio-group>
        </div>

        <div v-if="recLoading && !records.length" class="records-empty">正在加载记录…</div>
        <div v-else-if="!records.length" class="records-empty">暂无互助记录</div>

        <div v-else class="record-list">
          <div v-for="r in records" :key="r.id" class="record-item">
            <div class="record-line1">
              <span class="rtype" :class="'is-' + r.type">{{ r.type === 'help' ? '助人' : '受助' }}</span>
              <span class="rstatus" :class="'st-' + r.status">{{ statusText(r.status) }}</span>
              <span class="rdate">{{ r.date || '-' }}</span>
              <span class="rmode">{{ r.mode === 'team' ? '车队' : '个人' }}</span>
            </div>
            <div class="record-line2">
              <span v-if="r.type === 'help'" class="rnick">我为「{{ r.nick }}」助力</span>
              <span v-else class="rnick">「{{ r.nick }}」为我助力</span>
              <span class="rcmd" :class="{ expanded: expandedMap[r.id] }" @click="toggleCmd(r.id)">
                {{ expandedMap[r.id] ? r.command : brief(r.command) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="records.length" class="records-more">
          <t-button v-if="hasMore" variant="outline" size="small"
                    :loading="recLoading" @click="loadMore">加载更多</t-button>
          <span v-else class="no-more">没有更多了</span>
        </div>
      </template>

      <template #footer>
        <t-button variant="outline" @click="recVisible = false">关闭</t-button>
      </template>
    </t-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { api } from '../api'
import { roleLabel, roleTheme, statusText } from '../labels'
import { useIsMobile } from '../useIsMobile'

// ===================== 账号列表 =====================
const accounts = ref([])
const total = ref(0)
const page = ref(1)
const size = 20
const loading = ref(false)
const filterNick = ref('')
const filterSiteNo = ref('')

const isMobile = useIsMobile()

// 手机端只保留关键列，避免 8 列挤在 375px 屏幕里横向滚动
const MOBILE_COLS = ['siteNo', 'avatarNick', 'op']

const columns = computed(() => {
  const all = [
    { colKey: 'siteNo', title: '编号', width: 70 },
    { colKey: 'avatarNick', title: '淘宝昵称', width: 200 },
    { colKey: 'wxNick', title: '微信昵称', width: 160, ellipsis: true },
    { colKey: 'role', title: '身份', width: 90 },
    { colKey: 'pause', title: '受助状态', width: 180 },
    { colKey: 'openidMasked', title: 'openid', width: 150 },
    { colKey: 'updatedAt', title: '更新时间', width: 160 },
    { colKey: 'op', title: '操作', width: 110 }
  ]
  return isMobile.value ? all.filter((c) => MOBILE_COLS.includes(c.colKey)) : all
})

async function load() {
  loading.value = true
  const res = await api('account.list', {
    page: page.value,
    size,
    nick: filterNick.value.trim() || undefined,
    siteNo: Number(filterSiteNo.value) || undefined
  })
  loading.value = false
  if (!res.ok) { MessagePlugin.error(res.error || '加载失败'); return }
  accounts.value = res.accounts || []
  total.value = res.total || 0
}

function search() { page.value = 1; load() }
function resetFilter() { filterNick.value = ''; filterSiteNo.value = ''; search() }
function onPage(p) { page.value = p.current || p; load() }

// ===================== 互助记录抽屉 =====================
const recVisible = ref(false)
const recOpenid = ref('')
const recTitle = ref('互助记录')
const recLoading = ref(false)
const recError = ref('')
const recLoaded = ref(false)
const recordType = ref('')
const records = ref([])
const hasMore = ref(false)
const nextCursor = ref('')
const stats = ref(null)
const expandedMap = reactive({})

let recReqId = 0
let moreReqId = 0

function brief(c) {
  const s = String(c || '')
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}
function statOf(k) { return stats.value ? (stats.value[k] || 0) : '—' }
function toggleCmd(id) { expandedMap[id] = !expandedMap[id] }

function openRecords(row) {
  recOpenid.value = row.openid
  recTitle.value = `互助记录 · ${row.nick || '未命名'}（#${row.siteNo}）`
  recordType.value = ''
  records.value = []
  hasMore.value = false
  nextCursor.value = ''
  stats.value = null
  recError.value = ''
  recLoaded.value = false
  Object.keys(expandedMap).forEach(k => delete expandedMap[k])
  recVisible.value = true
  fetchRecords(true)
}

async function fetchRecords(first) {
  const openid = recOpenid.value
  if (!openid) return
  const reqId = ++recReqId
  recLoading.value = true
  const res = await api('user.detail', { openid, type: recordType.value || undefined, size: 20 })
  if (reqId !== recReqId) return
  recLoading.value = false
  recLoaded.value = true
  if (!res.ok) {
    recError.value = res.error || '加载失败，请重试'
    return
  }
  recError.value = ''
  stats.value = res.stats
  records.value = res.records || []
  hasMore.value = !!res.hasMore
  nextCursor.value = res.nextCursor || ''
}

function retryRecords() { fetchRecords(true) }

function reloadRecords() {
  records.value = []
  hasMore.value = false
  nextCursor.value = ''
  Object.keys(expandedMap).forEach(k => delete expandedMap[k])
  fetchRecords(true)
}

async function loadMore() {
  if (recLoading.value || !hasMore.value || !nextCursor.value) return
  const reqId = ++moreReqId
  recLoading.value = true
  const res = await api('user.detail', {
    openid: recOpenid.value,
    type: recordType.value || undefined,
    size: 20,
    cursor: nextCursor.value
  })
  if (reqId !== moreReqId) return
  recLoading.value = false
  if (!res.ok) { MessagePlugin.error(res.error || '加载失败，请重试'); return }
  const exists = new Set(records.value.map(r => r.id))
  const add = (res.records || []).filter(r => !exists.has(r.id))
  records.value = [...records.value, ...add]
  hasMore.value = !!res.hasMore
  nextCursor.value = res.nextCursor || ''
}

onMounted(load)
</script>

<style scoped>
.page-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 16px;
}
.page-head h2 { margin: 0 0 4px; color: #2b1d18; font-size: 20px; }
.page-sub { margin: 0; font-size: 13px; color: #9c8a80; }
.head-stats { font-size: 13px; color: #7d695f; }

.filter-bar {
  display: flex; gap: 10px; align-items: center;
  margin-bottom: 14px;
}

.cell-user { display: flex; align-items: center; gap: 8px; }
.cell-nick { font-weight: 500; color: #2b1d18; }
.cell-pause { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.pause-none { font-size: 12px; color: #1f7a3d; }

/* ===== 记录抽屉 ===== */
.detail-loading, .detail-error {
  padding: 40px 12px; text-align: center; font-size: 13px; color: #9c8a80;
}
.detail-error p { margin: 0 0 12px; color: #b42318; }

.detail-stats {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;
  margin-bottom: 16px;
}
.dstat {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 6px; background: linear-gradient(135deg, #fdf9f2, #f7ede2);
  border: 1px solid #efe3d5; border-radius: 12px;
}
.dstat-value { display: flex; align-items: baseline; gap: 2px; }
.dstat b { font-family: 'Menlo', 'Consolas', monospace; font-size: 18px; color: #a8452f; line-height: 1; }
.dstat em { font-style: normal; font-size: 10px; color: #9c8a80; }
.dstat span { font-size: 11px; color: #9c8a80; letter-spacing: 0.5px; }

@media (max-width: 820px) {
  .detail-stats { grid-template-columns: repeat(2, 1fr); }
  .dstat:last-child { grid-column: span 2; }
}

.records-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.records-title { font-size: 13px; font-weight: 700; color: #a8452f; }
.records-empty {
  padding: 28px; text-align: center; font-size: 13px; color: #9c8a80;
  background: #fdf8f2; border-radius: 10px;
}
.record-list { display: flex; flex-direction: column; gap: 8px; }
.record-item {
  padding: 10px 12px; border: 1px solid #f2e8dd;
  border-radius: 10px; background: #fff;
}
.record-line1 {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #8b776b; margin-bottom: 6px;
}
.rtype {
  padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
}
.rtype.is-help { background: #e8f0fe; color: #1a4f9c; }
.rtype.is-receive { background: #fdf3e0; color: #8a5b00; }
.rstatus { padding: 1px 8px; border-radius: 4px; font-size: 11px; background: #f2ece6; color: #7d695f; }
.rstatus.st-done { background: #e7f6ec; color: #1f7a3d; }
.rstatus.st-ongoing { background: #e8f0fe; color: #1a4f9c; }
.rstatus.st-pending { background: #fdecc0; color: #8a5b00; }
.rstatus.st-returned { background: #f2ece6; color: #7d695f; }
.rdate { font-family: 'Menlo', 'Consolas', monospace; }
.rmode { margin-left: auto; }
.record-line2 { display: flex; flex-direction: column; gap: 4px; }
.rnick { font-size: 12px; color: #2b1d18; font-weight: 500; }
.rcmd {
  font-size: 12px; color: #6b5a50; line-height: 1.6;
  word-break: break-all; cursor: pointer;
}
.rcmd:not(.expanded) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.records-more { margin-top: 14px; display: flex; justify-content: center; }
.no-more { font-size: 12px; color: #b3a29a; }
</style>

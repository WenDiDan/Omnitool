<template>
  <div class="page-card">
    <div class="page-head">
      <div>
        <h2 class="page-head-title">审计日志</h2>
        <p class="page-head-desc">全部后台写操作的前后快照与来源 IP，记录不可篡改</p>
      </div>
      <div class="page-head-actions">
        <t-select v-model="target" clearable placeholder="目标集合" style="width: 150px" @change="search">
          <t-option value="tools" label="tools" />
          <t-option value="users" label="users" />
          <t-option value="admin_users" label="admin_users" />
        </t-select>
        <t-select v-model="action" clearable filterable creatable placeholder="动作类型" style="width: 170px" @change="search">
          <t-option v-for="a in actionOptions" :key="a.value" :value="a.value" :label="a.label" />
        </t-select>
        <t-input v-model="operator" placeholder="操作人" clearable style="width: 140px"
                 @enter="search" @clear="search" />
        <t-button theme="primary" :loading="loading" @click="search">查询</t-button>
        <t-button variant="outline" :loading="exporting" @click="exportCsv">导出 CSV</t-button>
      </div>
    </div>

    <div class="table-caption">共 {{ total }} 条日志</div>
    <t-table :data="logs" :columns="columns" row-key="_id" :loading="loading" size="medium"
             :empty="hasFilter ? '当前筛选条件下没有日志' : '暂无审计日志'">
      <template #action="{ row }">
        <t-tag :theme="actionTheme(row.action)" variant="light-outline" size="small">{{ row.action }}</t-tag>
      </template>
      <template #detail="{ row }">
        <t-button variant="text" theme="primary" size="small" @click="showDetail(row)">快照</t-button>
      </template>
    </t-table>

    <div class="pager">
      <t-pagination :total="total" :current="page" :page-size="pageSize"
                    :page-size-options="[20, 50, 100]" @change="onPage" @page-size-change="onPageSize" />
    </div>

    <t-dialog v-model:visible="detailDialog" header="操作快照（before → after）" width="720px"
              :confirm-btn="{ content: '关闭' }" :close-on-overlay-click="true">
      <div class="snap-meta">
        <span>{{ detailRow.action }}</span>
        <span>操作人 {{ detailRow.operator }}</span>
        <span>{{ detailRow.createdAt }}</span>
        <span v-if="detailRow.ip">IP {{ detailRow.ip }}</span>
      </div>

      <div class="view-switch">
        <t-radio-group v-model="viewMode" size="small" variant="default-filled">
          <t-radio-button value="diff">仅变化（{{ diffRows.length }}）</t-radio-button>
          <t-radio-button value="raw">完整快照</t-radio-button>
        </t-radio-group>
      </div>

      <template v-if="viewMode === 'diff'">
        <div v-if="diffRows.length" class="diff-list">
          <div v-for="r in diffRows" :key="r.path" class="diff-row" :class="'is-' + r.kind">
            <span class="diff-kind">{{ { add: '新增', mod: '修改', del: '删除' }[r.kind] }}</span>
            <div class="diff-body">
              <div class="diff-path">{{ r.path }}</div>
              <div class="diff-vals">
                <template v-if="r.kind !== 'add'">
                  <span class="val old" :title="r.oldText">{{ r.oldText }}</span>
                </template>
                <span v-if="r.kind === 'mod'" class="arrow">→</span>
                <template v-if="r.kind !== 'del'">
                  <span class="val new" :title="r.newText">{{ r.newText }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="diff-empty">本次操作未产生字段级变化</div>
      </template>

      <pre v-else class="snapshot">{{ detailText }}</pre>
    </t-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { api } from '../api'
import { useIsMobile } from '../useIsMobile'

const logs = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const target = ref('')
const action = ref('')
const operator = ref('')
const loading = ref(false)
const exporting = ref(false)
const detailDialog = ref(false)
const detailText = ref('')
const detailRow = ref({})
const viewMode = ref('diff')

/** 扁平化对象/数组：数组按下标展开，便于逐项比对 */
function flatten(obj, prefix, out) {
  if (prefix === undefined) prefix = ''
  if (out === undefined) out = {}
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    if (prefix) out[prefix] = obj
    return out
  }
  if (Array.isArray(obj)) {
    if (!obj.length) { out[prefix || '(root)'] = []; return out }
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
    return out
  }
  Object.keys(obj).forEach(k => flatten(obj[k], prefix ? `${prefix}.${k}` : k, out))
  return out
}

/** 值展示：数字/布尔原样，字符串加引号，超长截断 */
function fmtVal(v) {
  if (v === undefined || v === null || v === '') return '（空）'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

/** before/after 字段级差异 */
const diffRows = computed(() => {
  const before = detailRow.value.before
  const after = detailRow.value.after
  const fb = before && typeof before === 'object' ? flatten(before) : {}
  const fa = after && typeof after === 'object' ? flatten(after) : {}
  const keys = [...new Set([...Object.keys(fb), ...Object.keys(fa)])].sort()
  const rows = []
  keys.forEach(k => {
    const hasB = Object.prototype.hasOwnProperty.call(fb, k)
    const hasA = Object.prototype.hasOwnProperty.call(fa, k)
    if (!hasB) {
      rows.push({ path: k, kind: 'add', newText: fmtVal(fa[k]) })
    } else if (!hasA) {
      rows.push({ path: k, kind: 'del', oldText: fmtVal(fb[k]) })
    } else if (JSON.stringify(fb[k]) !== JSON.stringify(fa[k])) {
      rows.push({ path: k, kind: 'mod', oldText: fmtVal(fb[k]), newText: fmtVal(fa[k]) })
    }
  })
  return rows
})

const actionOptions = [
  { value: 'tool.save', label: 'tool.save · 工具保存' },
  { value: 'tool.create', label: 'tool.create · 工具新建' },
  { value: 'tool.publish', label: 'tool.publish · 发布上线' },
  { value: 'tool.delete', label: 'tool.delete · 工具删除' },
  { value: 'user.ban', label: 'user.ban · 封禁/解封' },
  { value: 'user.setVip', label: 'user.setVip · 设置 VIP' },
  { value: 'user.setRole', label: 'user.setRole · 授权管理' },
  { value: 'auth.login', label: 'auth.login · 登录' },
  { value: 'auth.changePassword', label: 'auth.changePassword · 改密' },
  { value: 'log.export', label: 'log.export · 导出日志' }
]

const isMobile = useIsMobile()

// 手机端只保留时间/动作/详情
const MOBILE_COLS = ['createdAt', 'action', 'detail']

const columns = computed(() => {
  const all = [
    { colKey: 'createdAt', title: '时间', width: 170 },
    { colKey: 'operator', title: '操作人', width: 110 },
    { colKey: 'role', title: '角色', width: 80 },
    { colKey: 'action', title: '动作', width: 190 },
    { colKey: 'target', title: '目标集合', width: 120 },
    { colKey: 'targetId', title: '目标ID', ellipsis: true },
    { colKey: 'detail', title: '详情', width: 80 }
  ]
  return isMobile.value ? all.filter((c) => MOBILE_COLS.includes(c.colKey)) : all
})

const hasFilter = computed(() => !!(target.value || action.value || operator.value))

function actionTheme(a) {
  if (!a) return 'default'
  if (a.startsWith('tool.delete') || a.startsWith('user.ban')) return 'danger'
  if (a.startsWith('tool')) return 'primary'
  if (a.startsWith('user')) return 'warning'
  return 'default'
}

async function load() {
  loading.value = true
  const res = await api('log.list', {
    page: page.value,
    size: pageSize.value,
    target: target.value || undefined,
    actionFilter: action.value || undefined,
    operator: operator.value.trim() || undefined
  })
  loading.value = false
  if (res.ok) {
    logs.value = res.logs || []
    total.value = res.total || 0
  } else MessagePlugin.error(res.error)
}

/** 筛选条件变化必须回到第 1 页 */
function search() {
  page.value = 1
  load()
}

function onPage(p) { page.value = p; load() }
function onPageSize(size) { pageSize.value = size; page.value = 1; load() }

function showDetail(row) {
  detailRow.value = row
  detailText.value = JSON.stringify({ before: row.before, after: row.after }, null, 2)
  viewMode.value = 'diff'
  detailDialog.value = true
}

async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  const res = await api('log.export', {
    target: target.value || undefined,
    actionFilter: action.value || undefined,
    operator: operator.value.trim() || undefined
  })
  exporting.value = false
  if (!res.ok) { MessagePlugin.error(res.error); return }
  const blob = new Blob(['\ufeff' + res.csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  MessagePlugin.success('CSV 已开始下载')
}

onMounted(load)
</script>

<style scoped>
.page-head-actions { flex-wrap: wrap; align-items: center; }
.pager { margin-top: 16px; display: flex; justify-content: flex-end; }
.snapshot {
  max-height: 380px; overflow: auto; background: #f7ede2;
  border-radius: 8px; padding: 12px; font-size: 12px; margin: 0;
}
.snap-meta {
  display: flex; flex-wrap: wrap; gap: 8px 16px;
  font-size: 12px; color: #7d695f; margin-bottom: 10px;
}
.view-switch { margin-bottom: 10px; }
.diff-list {
  max-height: 400px; overflow: auto;
  border: 1px solid #efe3d5; border-radius: 8px;
}
.diff-row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 12px; border-bottom: 1px solid #f5ece1;
  border-left: 3px solid transparent; background: #fff;
}
.diff-row:last-child { border-bottom: none; }
.diff-row.is-add { border-left-color: #2f9e44; background: #f4fbf6; }
.diff-row.is-del { border-left-color: #e03131; background: #fdf5f5; }
.diff-row.is-mod { border-left-color: #e8a30c; background: #fffbf0; }
.diff-kind {
  flex: none; width: 32px; text-align: center;
  font-size: 11px; line-height: 18px; border-radius: 4px;
  background: #f2e8dd; color: #7d695f;
}
.diff-row.is-add .diff-kind { background: #d8f2df; color: #1f7a3d; }
.diff-row.is-del .diff-kind { background: #fbdedd; color: #b42318; }
.diff-row.is-mod .diff-kind { background: #fdecc0; color: #8a5b00; }
.diff-body { flex: 1; min-width: 0; }
.diff-path {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 12px; color: #a8452f; margin-bottom: 2px;
  word-break: break-all;
}
.diff-vals {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  font-size: 12px; line-height: 1.6;
}
.diff-vals .val {
  max-width: 100%; padding: 1px 6px; border-radius: 4px;
  word-break: break-all;
}
.diff-vals .old { background: #fbeeed; color: #9b2c2c; text-decoration: line-through; }
.diff-vals .new { background: #e7f6ec; color: #1f7a3d; }
.diff-vals .arrow { color: #b3a09a; }
.diff-empty {
  padding: 24px; text-align: center;
  font-size: 13px; color: #9c8a80;
  background: #fdf8f2; border-radius: 8px;
}
</style>

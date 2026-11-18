<template>
  <div class="page-card">
    <div class="page-head">
      <div>
        <h2 class="page-head-title">工具配置</h2>
        <p class="page-head-desc">管理小程序端展示的工具清单，保存或发布后小程序端下拉刷新即生效</p>
      </div>
      <div class="page-head-actions">
        <t-input v-model="keyword" placeholder="搜索 tool_key / 名称" clearable style="width: 220px">
          <template #suffix-icon><search-icon /></template>
        </t-input>
        <t-button variant="outline" :loading="loading" @click="load">
          <template #icon><refresh-icon /></template>
          刷新
        </t-button>
        <t-button theme="primary" @click="openCreate">
          <template #icon><add-icon /></template>
          新建工具
        </t-button>
      </div>
    </div>

    <div class="stat-chips" role="group" aria-label="工具状态分布（点击按状态筛选）">
      <div class="stat-chip is-deep is-clickable" :class="{ active: statusFilter === '' }" @click="statusFilter = ''">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ tools.length }}</span>
          <span class="stat-chip-unit">个</span>
        </div>
        <div class="stat-chip-label">全部工具</div>
        <div class="stat-chip-bar"><i style="width: 100%"></i></div>
      </div>
      <div class="stat-chip is-clickable" :class="{ active: statusFilter === 'online' }" @click="statusFilter = 'online'">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ onlineCount }}</span>
          <span class="stat-chip-unit">个</span>
        </div>
        <div class="stat-chip-label">已上线</div>
        <div class="stat-chip-bar"><i :style="{ width: ratio(onlineCount) + '%' }"></i></div>
      </div>
      <div class="stat-chip is-clickable" :class="{ active: statusFilter === 'offline' }" @click="statusFilter = 'offline'">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ offlineCount }}</span>
          <span class="stat-chip-unit">个</span>
        </div>
        <div class="stat-chip-label">已下线</div>
        <div class="stat-chip-bar"><i :style="{ width: ratio(offlineCount) + '%' }"></i></div>
      </div>
      <div class="stat-chip is-clickable" :class="{ active: statusFilter === 'featured' }" @click="statusFilter = 'featured'">
        <div class="stat-chip-top">
          <span class="stat-chip-num">{{ featuredCount }}</span>
          <span class="stat-chip-unit">个</span>
        </div>
        <div class="stat-chip-label">主推位</div>
        <div class="stat-chip-bar"><i :style="{ width: ratio(featuredCount) + '%' }"></i></div>
      </div>
    </div>

    <p class="stat-note">点击统计卡按状态筛选，再次点击「全部工具」恢复</p>
    <div class="drag-hint" v-if="!canDrag && filteredTools.length">
      当前处于筛选/搜索状态，拖拽排序已暂停（清空筛选后可拖动调整顺序）
    </div>
    <div class="table-caption">显示 {{ filteredTools.length }} / {{ tools.length }} 个工具</div>
    <div ref="tableWrap" :class="['table-wrap', { 'is-reordering': reordering }]">
      <t-table :data="filteredTools" :columns="columns" row-key="tool_key" :loading="loading"
               size="medium" :empty="hasFilter ? '当前筛选条件下没有工具' : '还没有工具，点右上角新建'">
        <template #drag>
          <span class="drag-handle" :class="{ disabled: !canDrag }">⋮⋮</span>
        </template>
        <template #tool_key="{ row }">
          <span class="mono-key">{{ row.tool_key }}</span>
        </template>
        <template #name="{ row }">
          <div v-if="isEditing(row, 'name')" class="cell-edit">
            <t-input v-model="editCell.value" size="small" autofocus
                     @enter="commitCell(row)" @blur="commitCell(row)" @keydown.esc="cancelCell" />
          </div>
          <span v-else class="cell-name" title="双击编辑" @dblclick="startCell(row, 'name')">{{ row.name }}</span>
        </template>
        <template #sort="{ row }">
          <div v-if="isEditing(row, 'sort')" class="cell-edit">
            <t-input-number v-model="editCell.value" size="small" :min="0" theme="normal"
                            style="width: 70px" @blur="commitCell(row)" @enter="commitCell(row)" />
          </div>
          <span v-else class="cell-sort" title="双击编辑" @dblclick="startCell(row, 'sort')">{{ row.sort }}</span>
        </template>
        <template #featured="{ row }">
          <t-switch size="small" :value="!!row.featured" :loading="busyOf(row, 'featured')"
                    :disabled="reordering" @change="v => toggleFeatured(row, v)" />
        </template>
        <template #status="{ row }">
          <div class="status-cell">
            <t-switch size="small" :value="row.status === 'online'" :loading="busyOf(row, 'status')"
                      :disabled="reordering" @change="v => toggleStatus(row, v)" />
            <span class="status-text" :class="row.status === 'online' ? 'is-on' : 'is-off'">
              {{ row.status === 'online' ? '已上线' : '已下线' }}
            </span>
          </div>
        </template>
        <template #op="{ row }">
          <t-button variant="text" theme="primary" size="small" @click="openEdit(row)">编辑</t-button>
          <t-popconfirm content="确定删除该工具？审计日志会保留快照。" @confirm="remove(row)">
            <t-button variant="text" theme="danger" size="small" :loading="busyOf(row, 'delete')">删除</t-button>
          </t-popconfirm>
        </template>
      </t-table>
    </div>

    <!-- 编辑抽屉 -->
    <t-drawer :visible="drawer" :header="editing._id ? `编辑工具 · ${editing.name || editing.tool_key}` : '新建工具'"
              width="600px" :confirm-btn="null" :close-btn="true" :footer="true"
              @close="closeDrawer()">
      <t-form ref="formRef" :data="editing" :rules="rules" label-width="110px" @submit="onSave">
        <div class="form-section">基础信息</div>
        <t-form-item label="tool_key" name="tool_key" :help="editing._id ? '创建后不可修改' : '小写字母/数字/下划线，如 scan'">
          <t-input v-model="editing.tool_key" :disabled="!!editing._id" placeholder="如 scan / regcode" />
        </t-form-item>
        <t-form-item label="名称" name="name">
          <t-input v-model="editing.name" placeholder="卡片标题，如 淘金币互助" />
        </t-form-item>
        <t-form-item label="描述" name="desc">
          <t-input v-model="editing.desc" placeholder="卡片副标题" />
        </t-form-item>
        <t-form-item label="所属应用" name="app_name">
          <t-input v-model="editing.app_name" placeholder="留空则不展示，如 淘宝" />
        </t-form-item>
        <t-form-item label="详细说明" name="summary">
          <t-input v-model="editing.summary" placeholder="选填，用于详情页/搜索" />
        </t-form-item>
        <t-form-item label="分类" name="category">
          <t-input v-model="editing.category" placeholder="如 效率工具 / 淘金币互助" />
        </t-form-item>
        <t-form-item label="图标" name="icon">
          <t-input v-model="editing.icon" placeholder="/images/xxx.png" />
        </t-form-item>
        <t-form-item label="图标底色" name="iconBg">
          <t-input v-model="editing.iconBg" placeholder="#C0553D" />
        </t-form-item>
        <t-form-item label="徽章文字" name="tag">
          <t-input v-model="editing.tag" placeholder="VIP / 金币 / 留空" />
        </t-form-item>
        <t-form-item label="徽章底色" name="badgeColor">
          <t-input v-model="editing.badgeColor" placeholder="#FF6B35（选填）" />
        </t-form-item>

        <div class="form-section">跳转与入口</div>
        <t-form-item label="跳转地址" name="url">
          <t-input v-model="editing.url" :disabled="editing.navType === 'tool'"
                   :placeholder="editing.navType === 'tool' ? '页面内导航无需地址' : '/pages/xxx/xxx 或 https://'" />
        </t-form-item>
        <t-form-item label="跳转方式" name="navType">
          <t-select v-model="editing.navType">
            <t-option value="navigateTo" label="navigateTo（普通页面）" />
            <t-option value="switchTab" label="switchTab（tab 页）" />
            <t-option value="reLaunch" label="reLaunch（重载跳转）" />
            <t-option value="tool" label="tool（页面内导航，如互助）" />
          </t-select>
        </t-form-item>
        <t-form-item label="排序值" name="sort">
          <div class="field-stack">
            <t-input-number v-model="editing.sort" :min="1" theme="column" style="width: 140px" />
            <span class="field-hint">目标位置（第 N 位），保存时自动重排全表序号，也可直接拖拽行调整</span>
          </div>
        </t-form-item>
        <t-form-item label="主推位" name="featured">
          <div class="field-stack">
            <t-switch v-model="editing.featured" />
            <span class="field-hint">开启后占据首页主推大卡</span>
          </div>
        </t-form-item>
        <t-form-item label="状态" name="status">
          <t-radio-group v-model="editing.status">
            <t-radio value="online">上线</t-radio>
            <t-radio value="offline">下线/草稿</t-radio>
          </t-radio-group>
        </t-form-item>

        <!-- 互助类工具扩展字段 -->
        <t-collapse :key="editing._id || 'new'" class="adv-collapse"
                    :default-value="editing._id && isCoinTool ? ['adv'] : []">
          <t-collapse-panel value="adv" header="互助扩展配置（淘金币等互助类工具）">
            <t-form-item label="活动地址" name="activity_url">
              <t-input v-model="editing.activity_url" placeholder="选填，活动页地址" />
            </t-form-item>
            <t-form-item label="展示模式" name="modes">
              <t-input v-model="editing.modes" placeholder="如 个人赛车（加能量） / 车队助力（加里程）" />
            </t-form-item>
            <t-form-item label="模式标签" name="mode_tabs">
              <t-textarea v-model="editing.mode_tabs_text" :autosize="{ minRows: 2, maxRows: 4 }"
                          placeholder="每行一个，对应页面顶部切换标签" />
            </t-form-item>
            <t-form-item label="公告文案" name="board_notice">
              <t-textarea v-model="editing.board_notice" :autosize="{ minRows: 2, maxRows: 4 }"
                          placeholder="首页公告条文案" />
            </t-form-item>
            <t-form-item label="每日发布上限" name="daily_help_limit">
              <t-input-number v-model="editing.daily_help_limit" :min="0" theme="column" style="width: 140px" />
            </t-form-item>
            <t-form-item label="每日领取上限" name="daily_receive_limit">
              <t-input-number v-model="editing.daily_receive_limit" :min="0" theme="column" style="width: 140px" />
            </t-form-item>
            <t-form-item label="单人发布上限" name="daily_help_limit_solo">
              <t-input-number v-model="editing.daily_help_limit_solo" :min="0" theme="column" style="width: 140px" />
            </t-form-item>
            <t-form-item label="单人领取上限" name="daily_receive_limit_solo">
              <t-input-number v-model="editing.daily_receive_limit_solo" :min="0" theme="column" style="width: 140px" />
            </t-form-item>
          </t-collapse-panel>
        </t-collapse>
      </t-form>
      <template #footer>
        <t-button theme="primary" :loading="saving" @click="submitForm">保存</t-button>
        <t-button variant="outline" @click="closeDrawer()">取消</t-button>
      </template>
    </t-drawer>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { DialogPlugin, MessagePlugin } from 'tdesign-vue-next'
import { AddIcon, RefreshIcon, SearchIcon } from 'tdesign-icons-vue-next'
import { api } from '../api'
import { useIsMobile } from '../useIsMobile'

const tools = ref([])
const keyword = ref('')
const statusFilter = ref('')
const loading = ref(false)
const saving = ref(false)
const drawer = ref(false)
const editing = reactive({})
const formRef = ref(null)
const busyKey = ref('')      // 行内操作锁：`tool_key:action`
const snapshot = ref('')     // 打开抽屉时的表单快照，用于未保存提示

// ===== 拖拽排序 =====
const tableWrap = ref(null)
const reordering = ref(false)
const dragFrom = ref(-1)
const dragOverIndex = ref(-1)
/** 筛选/搜索状态下顺序无意义，禁止拖拽 */
const canDrag = computed(() => !keyword.value.trim() && !statusFilter.value)

// ===== 行内编辑（名称/排序）=====
const editCell = reactive({ key: '', field: '', value: '' })
let committing = false

function isEditing(row, field) {
  return editCell.key === row.tool_key && editCell.field === field
}

function startCell(row, field) {
  if (reordering.value || busyKey.value) return
  editCell.key = row.tool_key
  editCell.field = field
  editCell.value = field === 'sort' ? Number(row.sort) || 0 : row.name || ''
}

function cancelCell() {
  editCell.key = ''
  editCell.field = ''
  editCell.value = ''
}

async function commitCell(row) {
  if (committing || !editCell.field) return
  const field = editCell.field
  let value = editCell.value
  if (field === 'sort') {
    value = Number(value)
    if (!Number.isFinite(value) || value < 1) {
      MessagePlugin.warning('排序值需为正整数')
      return
    }
  } else {
    value = String(value || '').trim()
    if (!value) {
      MessagePlugin.warning('名称不能为空')
      return
    }
  }
  const current = field === 'sort' ? (Number(row.sort) || 0) : (row.name || '')
  if (value === current) { cancelCell(); return }

  committing = true
  busyKey.value = `${row.tool_key}:${field}`
  // 排序值 = 目标位置：整体重排为 1..n，不产生重复序号
  const res = field === 'sort'
    ? await reorderByTarget(row, value)
    : await api('tool.save', { tool_key: row.tool_key, expectV: row._v || undefined, [field]: value })
  busyKey.value = ''
  committing = false

  if (res.ok) {
    MessagePlugin.success(field === 'sort' ? '顺序已更新' : '已更新')
    cancelCell()
    load()
  } else if (res.conflict) {
    MessagePlugin.warning('数据已被他人修改，已刷新为最新值')
    cancelCell()
    load()
  } else {
    MessagePlugin.error(res.error)
  }
}

/**
 * 把工具移动到第 targetSort 位（1 起），并对全表按展示顺序重排 sort=1..n 批量保存。
 * 行内编辑与抽屉改排序值都走这里，保证任意入口都不会写出重复序号。
 */
async function reorderByTarget(row, targetSort) {
  const list = tools.value
    .filter(t => t.tool_key !== row.tool_key)
    .map(t => ({ tool_key: t.tool_key }))
  const idx = Math.max(0, Math.min(list.length, (Number(targetSort) || 1) - 1))
  list.splice(idx, 0, { tool_key: row.tool_key })
  return api('tool.reorder', { items: list.map((t, i) => ({ tool_key: t.tool_key, sort: i + 1 })) })
}

/** 给当前渲染出的每一行绑定原生拖拽事件（t-table 无拖拽能力） */
function bindDrag() {
  const root = tableWrap.value
  if (!root) return
  const rows = [...root.querySelectorAll('tbody tr')]
  rows.forEach((tr, index) => {
    tr.draggable = canDrag.value
    tr.classList.toggle('drag-enabled', canDrag.value)
    tr.ondragstart = (e) => {
      if (!canDrag.value) { e.preventDefault(); return }
      dragFrom.value = index
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', String(index)) } catch (_) { /* 兼容 */ }
      tr.classList.add('is-dragging')
    }
    tr.ondragend = () => {
      tr.classList.remove('is-dragging')
      clearDropMark()
      dragFrom.value = -1
    }
    tr.ondragover = (e) => {
      if (!canDrag.value || dragFrom.value < 0) return
      e.preventDefault()
      if (dragOverIndex.value !== index) {
        clearDropMark()
        dragOverIndex.value = index
        tr.classList.add(index > dragFrom.value ? 'drop-after' : 'drop-before')
      }
    }
    tr.ondrop = (e) => {
      e.preventDefault()
      const from = dragFrom.value
      const to = index
      clearDropMark()
      dragFrom.value = -1
      if (!canDrag.value || from < 0 || from === to) return
      applyMove(from, to)
    }
  })
}

function clearDropMark() {
  const root = tableWrap.value
  if (root) root.querySelectorAll('tbody tr').forEach(tr => tr.classList.remove('drop-before', 'drop-after'))
  dragOverIndex.value = -1
}

/** 移动行：按展示顺序重排 sort（步长 1），一次请求批量保存 */
async function applyMove(from, to) {
  const list = [...filteredTools.value]
  const [moved] = list.splice(from, 1)
  if (!moved) return
  list.splice(to, 0, moved)
  const items = list.map((t, i) => ({ tool_key: t.tool_key, sort: i + 1 }))

  reordering.value = true
  const res = await api('tool.reorder', { items })
  reordering.value = false
  if (res.ok) {
    MessagePlugin.success(res.message || '顺序已保存')
    await load()
  } else {
    MessagePlugin.error(res.error)
  }
}

/** 参与「是否有改动」判断的字段（排除 _id/_v 等元数据） */
const DIRTY_FIELDS = [
  'tool_key', 'name', 'desc', 'app_name', 'summary', 'icon', 'iconBg',
  'tag', 'badgeColor', 'url', 'navType', 'activity_url', 'modes', 'mode_tabs_text',
  'board_notice', 'daily_help_limit', 'daily_receive_limit',
  'daily_help_limit_solo', 'daily_receive_limit_solo',
  'category', 'sort', 'status', 'featured'
]

function fingerprint() {
  return JSON.stringify(DIRTY_FIELDS.map(k => {
    const v = editing[k]
    return v === undefined || v === null ? '' : v
  }))
}

function markSnapshot() { snapshot.value = fingerprint() }

/** 关闭抽屉：有未保存改动时先确认 */
function closeDrawer(force) {
  if (force || !snapshot.value || fingerprint() === snapshot.value) {
    drawer.value = false
    return
  }
  const d = DialogPlugin.confirm({
    header: '有未保存的修改',
    body: '关闭后本次修改将丢失，确定放弃吗？',
    confirmBtn: { content: '放弃修改', theme: 'danger' },
    cancelBtn: { content: '继续编辑' },
    onConfirm: () => { drawer.value = false; d.destroy() }
  })
}

const hasFilter = computed(() => !!keyword.value.trim() || !!statusFilter.value)

const isMobile = useIsMobile()

// 手机端只保留名称/状态/操作（拖拽排序在触摸屏上不适用，一并隐藏）
const MOBILE_COLS = ['name', 'status', 'op']

const columns = computed(() => {
  const all = [
    { colKey: 'drag', title: '', width: 42 },
    { colKey: 'tool_key', title: 'tool_key', width: 120 },
    { colKey: 'name', title: '名称', width: 130 },
    { colKey: 'desc', title: '描述', ellipsis: true },
    { colKey: 'category', title: '分类', width: 110, ellipsis: true },
    { colKey: 'sort', title: '排序', width: 70 },
    { colKey: 'featured', title: '主推', width: 70 },
    { colKey: 'status', title: '状态', width: 140 },
    { colKey: 'op', title: '操作', width: 120 }
  ]
  return isMobile.value ? all.filter((c) => MOBILE_COLS.includes(c.colKey)) : all
})

const rules = {
  tool_key: [
    { required: true, message: '请填写 tool_key' },
    { pattern: /^[a-z0-9_]+$/, message: '仅小写字母、数字、下划线' }
  ],
  name: [{ required: true, message: '请填写名称' }],
  url: [{ validator: v => !v || /^(\/|https?:\/\/)/.test(v), message: '需以 / 或 http(s):// 开头' }],
  daily_help_limit: [{ validator: v => v === undefined || v === null || Number(v) >= 0, message: '不能为负' }]
}

const filteredTools = computed(() => {
  let list = tools.value
  if (statusFilter.value === 'online') list = list.filter(t => t.status === 'online')
  if (statusFilter.value === 'offline') list = list.filter(t => t.status !== 'online')
  if (statusFilter.value === 'featured') list = list.filter(t => t.featured)
  const k = keyword.value.trim().toLowerCase()
  if (k) {
    list = list.filter(t => (t.tool_key || '').toLowerCase().includes(k)
      || (t.name || '').toLowerCase().includes(k)
      || (t.category || '').toLowerCase().includes(k))
  }
  return list
})
const onlineCount = computed(() => tools.value.filter(t => t.status === 'online').length)
const offlineCount = computed(() => tools.value.filter(t => t.status !== 'online').length)
const featuredCount = computed(() => tools.value.filter(t => t.featured).length)
/** 占比（仅用于统计条宽度展示，空列表返回 0） */
const ratio = (n) => (tools.value.length ? Math.round((n / tools.value.length) * 100) : 0)
const isCoinTool = computed(() => editing.tool_key === 'tb_coin_pk' || !!editing.daily_help_limit)

function busyOf(row, action) { return busyKey.value === `${row.tool_key}:${action}` }

async function load() {
  loading.value = true
  const res = await api('tool.list')
  loading.value = false
  if (res.ok) {
    tools.value = res.tools
    await nextTick()
    bindDrag()
  } else MessagePlugin.error(res.error)
}

// 数据顺序变化（筛选/刷新/重排）后重新绑定拖拽
watch(filteredTools, () => nextTick(bindDrag))

/** 触发表单校验提交（t-form 无 #submit 插槽，手动触发） */
function submitForm() {
  if (formRef.value && formRef.value.submit) formRef.value.submit()
  else onSave({ validateResult: true })
}

function resetEditing() {
  Object.keys(editing).forEach(k => delete editing[k])
}

function openCreate() {
  resetEditing()
  Object.assign(editing, {
    _id: '', tool_key: '', name: '', desc: '', app_name: '', summary: '',
    icon: '', iconBg: '#C0553D', tag: '', badgeColor: '',
    url: '', navType: 'navigateTo', activity_url: '', modes: '', mode_tabs_text: '',
    board_notice: '', daily_help_limit: 0, daily_receive_limit: 0,
    daily_help_limit_solo: 0, daily_receive_limit_solo: 0,
    category: '', sort: 0, status: 'offline', featured: false
  })
  markSnapshot()
  drawer.value = true
}

function openEdit(row) {
  resetEditing()
  Object.assign(editing, row)
  editing._id = row._id
  editing.mode_tabs_text = (row.mode_tabs || []).join('\n')
  editing._origSort = Number(row.sort) || 0 // 记录原始排序值，保存时判断是否需要重排
  markSnapshot()
  drawer.value = true
}

/** 提交前把 textarea 转回数组、清理展示用临时字段 */
function buildPayload() {
  const p = { ...editing, expectV: editing._v || undefined }
  p.mode_tabs = String(editing.mode_tabs_text || '')
    .split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10)
  delete p.mode_tabs_text
  return p
}

async function onSave({ validateResult }) {
  if (validateResult && validateResult.errors && validateResult.errors.length) {
    MessagePlugin.warning('请先修正表单中标红的字段')
    return
  }
  const payload = buildPayload()
  // 编辑态排序值有变化 → 不随 tool.save 直写（避免重复序号），保存后单独走整体重排
  const sortChanged = payload._id && (Number(payload.sort) || 0) !== (Number(payload._origSort) || 0)
  const targetSort = sortChanged ? payload.sort : null
  if (payload._id) {
    delete payload.sort
    delete payload._origSort
  } else {
    // 新建：追加到当前列表末尾，同样不产生重复
    payload.sort = tools.value.length + 1
  }

  saving.value = true
  const res = await api('tool.save', payload)
  if (res.ok && targetSort !== null) {
    const reorderRes = await reorderByTarget({ tool_key: payload.tool_key }, targetSort)
    if (!reorderRes.ok) MessagePlugin.warning('保存成功，但顺序调整失败：' + (reorderRes.error || '未知错误'))
  }
  saving.value = false
  if (res.ok) {
    MessagePlugin.success(res.message || '保存成功')
    drawer.value = false
    load()
  } else if (res.conflict) {
    MessagePlugin.warning(res.error + '，请刷新后重试')
  } else {
    MessagePlugin.error(res.error)
  }
}

/** 行内快速上下线 */
async function toggleStatus(row, online) {
  if (busyKey.value) return
  busyKey.value = `${row.tool_key}:status`
  const res = await api('tool.save', {
    tool_key: row.tool_key,
    status: online ? 'online' : 'offline',
    expectV: row._v || undefined
  })
  busyKey.value = ''
  if (res.ok) {
    MessagePlugin.success(online ? '已上线' : '已下线')
    load()
  } else MessagePlugin.error(res.error)
}

/** 行内切换主推位 */
async function toggleFeatured(row, featured) {
  if (busyKey.value) return
  busyKey.value = `${row.tool_key}:featured`
  const res = await api('tool.save', {
    tool_key: row.tool_key,
    featured,
    expectV: row._v || undefined
  })
  busyKey.value = ''
  if (res.ok) {
    MessagePlugin.success(featured ? '已设为主推' : '已取消主推')
    load()
  } else MessagePlugin.error(res.error)
}

async function remove(row) {
  if (busyKey.value) return
  busyKey.value = `${row.tool_key}:delete`
  const res = await api('tool.delete', { tool_key: row.tool_key })
  busyKey.value = ''
  if (res.ok) { MessagePlugin.success(res.message); load() }
  else MessagePlugin.error(res.error)
}

onMounted(load)
</script>

<style scoped>
.mono-key {
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  color: #a8452f;
  background: #f7ede2;
  padding: 2px 8px;
  border-radius: 6px;
}
.dim { color: #b3a29a; }
.status-cell { display: flex; align-items: center; gap: 8px; }
.status-text { font-size: 12px; }
.status-text.is-on { color: #2f7a4f; }
.status-text.is-off { color: #b3a29a; }
.form-section {
  font-size: 13px; font-weight: 700; color: #a8452f;
  margin: 6px 0 14px; padding-left: 8px;
  border-left: 3px solid #c0553d;
}
/* 控件+提示的纵向堆叠容器：脱离表单项的 flex 行，提示不再被挤压竖排 */
.field-stack { width: 100%; }

.field-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #9c8a80;
  line-height: 1.5;
}
.adv-collapse { margin-top: 4px; }

/* ===== 拖拽排序 ===== */
.drag-hint {
  margin-bottom: 10px; padding: 8px 12px;
  font-size: 12px; color: #8a5b00;
  background: #fffbf0; border: 1px solid #fdecc0; border-radius: 8px;
}
.table-wrap :deep(tbody tr.drag-enabled) { cursor: move; }
.table-wrap :deep(tbody tr.is-dragging) { opacity: 0.4; }
.table-wrap :deep(tbody tr.drop-before) { box-shadow: inset 0 3px 0 #c0553d; }
.table-wrap :deep(tbody tr.drop-after) { box-shadow: inset 0 -3px 0 #c0553d; }
.table-wrap.is-reordering :deep(tbody tr) { cursor: progress; }
.drag-handle {
  display: inline-block; width: 20px; text-align: center;
  color: #c9b8ad; font-size: 14px; letter-spacing: -2px;
  user-select: none;
}
.drag-handle.disabled { color: #e8ded6; }

/* ===== 行内编辑 ===== */
.cell-name, .cell-sort {
  display: inline-block; min-width: 40px;
  padding: 2px 4px; border-radius: 4px;
  cursor: text;
}
.cell-name:hover, .cell-sort:hover {
  background: #fbf3ea; box-shadow: inset 0 -1px 0 #e6d3c3;
}
.cell-sort { font-family: 'Menlo', 'Consolas', monospace; font-size: 13px; color: #7d695f; }
.cell-edit { min-width: 120px; }
</style>

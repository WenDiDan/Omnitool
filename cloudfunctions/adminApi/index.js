/**
 * adminApi —— 后台管理系统 P1 云函数
 *
 * 调用方式（双兼容）：
 *  1. HTTP 访问服务：POST https://{envId}.service.tcloudbase.com/adminApi
 *     body: { action, token?, ...params }
 *  2. 云端调用：event: { action, token?, ...params }
 *
 * 鉴权：自建 token（bcryptjs 哈希存储，登录 12h 有效，单会话，新登录踢旧会话）
 * 安全：所有写操作二次校验 admin_users 角色 + 写 audit_logs 审计
 */
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { bjTime } = require('./_shared/time')
const { ensureCollection: ensureCollectionShared } = require('./_shared/db')
const { calcRetentionDays } = require('./_shared/retention')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ADMIN_COLLECTION = 'admin_users'
const AUDIT_COLLECTION = 'audit_logs'
const TOOLS_COLLECTION = 'tools'
// 工具清单版本号（与 toolsManage 共用同一集合）：写操作后递增，小程序首页据此自动刷新
const TOOLS_META_COLLECTION = 'tools_meta'
const TOOLS_VERSION_DOC = 'version'
const USERS_COLLECTION = 'users'
const RECORD_COLLECTION = 'tool_records'
const ACCOUNT_COLLECTION = 'tool_accounts'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000      // 会话 12 小时
const MAX_LOGIN_FAILS = 5                      // 连续失败 5 次锁号
const LOCK_MS = 15 * 60 * 1000                 // 锁 15 分钟

/**
 * 初始化码：来自云函数环境变量 ADMIN_INIT_CODE，代码内不放任何明文。
 * 仅 admin_users 为空时可创建超管，init 成功后该 action 自动失效；
 * 未配置环境变量时 admin.init 直接拒绝（新环境请先在控制台设置，用完可删除）。
 */
const INIT_CODE = String(process.env.ADMIN_INIT_CODE || '')

/**
 * CORS 允许来源白名单：来自环境变量 ADMIN_ALLOWED_ORIGINS（逗号分隔），
 * 默认只放行本环境静态托管域名与本地开发端口，不再使用 '*'。
 */
const ALLOWED_ORIGINS = String(
  process.env.ADMIN_ALLOWED_ORIGINS ||
  'https://wendi-d5gnswjf75b25aac0.tcloudbaseapp.com,http://localhost:5173,http://127.0.0.1:5173'
).split(',').map(s => s.trim()).filter(Boolean)

// ============================== 工具函数 ==============================

function nowISO() { return new Date().toISOString() }

/** 集合保障：公共实现见 cloudfunctions/_shared/db.js（部署前同步副本） */
async function ensureCollection(name) {
  return ensureCollectionShared(db, name, 'adminApi')
}

/** 确保所有依赖集合就绪（单次调用幂等） */
let _collectionsReady = false
async function ensureAllCollections() {
  if (_collectionsReady) return true
  const ok = (await ensureCollection(ADMIN_COLLECTION)) &&
             (await ensureCollection(AUDIT_COLLECTION)) &&
             (await ensureCollection(TOOLS_COLLECTION)) &&
             (await ensureCollection(USERS_COLLECTION))
  if (ok) _collectionsReady = true
  return ok
}

/** 下发黑名单：第三方遗留链接不进任何端 */
function isBlacklisted(url) { return !!url && /ujd6\.cn/i.test(url) }

/** 工具表单字段白名单（与 toolsManage pick 字段一致） */
const TOOL_FIELDS = [
  'tool_key', 'name', 'app_name', 'desc', 'summary', 'icon', 'iconBg',
  'badge', 'badgeColor', 'tag', 'url', 'navType', 'activity_url',
  'modes', 'mode_tabs', 'board_notice',
  'daily_help_limit', 'daily_receive_limit', 'daily_help_limit_solo',
  'daily_receive_limit_solo', 'category', 'sort', 'featured', 'status'
]

function pickToolPayload(p) {
  const data = {}
  TOOL_FIELDS.forEach(k => {
    if (p[k] === undefined) return
    if (k === 'mode_tabs') { data[k] = Array.isArray(p[k]) ? p[k].slice(0, 10) : []; return }
    if (k === 'featured') { data[k] = !!p[k]; return }
    if (k === 'sort' || k.startsWith('daily_')) { data[k] = Number(p[k]) || 0; return }
    data[k] = String(p[k]).slice(0, 500)
  })
  // navType 合法值含 'tool'（互助类工具无 url，由页面内导航承载）；未知值保留原值不强改
  if (data.navType && !['navigateTo', 'switchTab', 'reLaunch', 'tool'].includes(data.navType)) {
    data.navType = 'navigateTo'
  }
  return data
}

/** HTTP 模式判断与统一响应 */
function isHttp(event) {
  return event && event.headers && typeof event.body !== 'undefined' && event.requestContext
}

/** 取请求 Origin（HTTP 访问服务的 header 大小写不固定） */
function getOrigin(event) {
  const h = (event && event.headers) || {}
  return String(h.origin || h.Origin || '')
}

/**
 * 构造 CORS 响应头：仅在 Origin 命中白名单时回显，
 * 未命中则不返回 Access-Control-Allow-Origin（浏览器侧直接拒绝）。
 */
function corsHeaders(event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  }
  const origin = getOrigin(event)
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function send(event, payload, status = 200) {
  if (!isHttp(event)) return payload
  return {
    statusCode: status,
    headers: corsHeaders(event),
    body: JSON.stringify(payload)
  }
}

/** 记录审计日志（失败不阻断业务） */
async function audit(operator, role, action, target, targetId, before, after, ip) {
  try {
    await db.collection(AUDIT_COLLECTION).add({
      data: {
        operator: operator || '',
        role: role || '',
        action,
        target: target || '',
        targetId: targetId || '',
        before: before || null,
        after: after || null,
        ip: ip || '',
        createdAt: nowISO()
      }
    })
  } catch (e) {
    console.error('[audit] 写入失败', e.message)
  }
}

// ============================== 鉴权 ==============================

async function requireAuth(token) {
  const t = String(token || '')
  if (!t) return { ok: false, error: '未登录' }
  const { data } = await db.collection(ADMIN_COLLECTION).where({ sessionToken: t }).get()
  const u = data[0]
  if (!u) return { ok: false, error: '会话无效，请重新登录' }
  if (u.status !== 'active') return { ok: false, error: '账号已停用' }
  if (!u.sessionExpiresAt || new Date(u.sessionExpiresAt).getTime() < Date.now()) {
    return { ok: false, error: '会话已过期，请重新登录' }
  }
  return { ok: true, user: u }
}

/** 角色 ≥ admin 的一切管理操作前置校验；superOnly 为 true 时仅超管 */
function requireRole(user, superOnly) {
  if (superOnly && user.role !== 'super') {
    return { ok: false, error: '仅超级管理员可执行此操作' }
  }
  return { ok: true }
}

// ============================== Action 实现 ==============================

/** 定长比较，避免通过响应时间猜测初始化码 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''))
  const bb = Buffer.from(String(b || ''))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

/** 初始化超管：仅集合为空时可用 */
async function adminInit(p, ip) {
  // 未配置初始化码时直接关闭入口，避免任何默认码被猜中
  if (!INIT_CODE) {
    return { ok: false, error: '未配置初始化码，请在云函数环境变量设置 ADMIN_INIT_CODE 后重试' }
  }
  const { total } = await db.collection(ADMIN_COLLECTION).count()
  if (total > 0) return { ok: false, error: '系统已初始化，禁止重复初始化' }
  if (!safeEqual(p.initCode, INIT_CODE)) return { ok: false, error: '初始化码错误' }

  const username = String(p.username || '').trim()
  const password = String(p.password || '')
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return { ok: false, error: '用户名须为 3-20 位字母数字下划线' }
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(password)) return { ok: false, error: '密码须 8 位以上且包含字母和数字' }

  await db.collection(ADMIN_COLLECTION).add({
    data: {
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'super',
      status: 'active',
      loginFails: 0,
      lockUntil: '',
      sessionToken: '',
      sessionExpiresAt: '',
      createdAt: nowISO(),
      lastLoginAt: ''
    }
  })
  await audit(username, 'super', 'admin.init', 'admin_users', username, null, { username }, ip)
  return { ok: true, message: '超管创建成功，请登录' }
}

/** 登录 */
async function authLogin(p, ip) {
  const username = String(p.username || '').trim()
  const password = String(p.password || '')
  const { data } = await db.collection(ADMIN_COLLECTION).where({ username }).get()
  const u = data[0]
  if (!u) return { ok: false, error: '用户名或密码错误' }
  if (u.status !== 'active') return { ok: false, error: '账号已停用' }

  // 失败锁定
  if (u.lockUntil && new Date(u.lockUntil).getTime() > Date.now()) {
    const min = Math.ceil((new Date(u.lockUntil).getTime() - Date.now()) / 60000)
    return { ok: false, error: `账号已锁定，请 ${min} 分钟后重试` }
  }

  if (!bcrypt.compareSync(password, u.passwordHash || '')) {
    const fails = (u.loginFails || 0) + 1
    const lock = fails >= MAX_LOGIN_FAILS ? new Date(Date.now() + LOCK_MS).toISOString() : u.lockUntil || ''
    await db.collection(ADMIN_COLLECTION).where({ username }).update({
      data: { loginFails: fails, lockUntil: lock }
    })
    return { ok: false, error: fails >= MAX_LOGIN_FAILS ? '失败次数过多，账号已锁定 15 分钟' : '用户名或密码错误' }
  }

  // 单会话：新登录覆盖旧 token
  const token = crypto.randomBytes(32).toString('hex')
  await db.collection(ADMIN_COLLECTION).where({ username }).update({
    data: {
      sessionToken: token,
      sessionExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      loginFails: 0,
      lockUntil: '',
      lastLoginAt: nowISO()
    }
  })
  await audit(username, u.role, 'auth.login', 'admin_users', username, null, null, ip)
  return { ok: true, token, role: u.role, username: u.username }
}

/** 修改密码 */
async function changePassword(user, p, ip) {
  const oldPwd = String(p.oldPassword || '')
  const newPwd = String(p.newPassword || '')
  if (!bcrypt.compareSync(oldPwd, user.passwordHash || '')) return { ok: false, error: '原密码错误' }
  if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(newPwd)) return { ok: false, error: '新密码须 8 位以上且包含字母和数字' }
  const hash = bcrypt.hashSync(newPwd, 10)
  // 改密后立即作废旧会话：其他已登录设备需用新密码重新登录
  await db.collection(ADMIN_COLLECTION).where({ username: user.username }).update({
    data: { passwordHash: hash, loginFails: 0, lockUntil: '', sessionToken: '', sessionExpiresAt: '' }
  })
  await audit(user.username, user.role, 'auth.changePassword', 'admin_users', user.username, null, null, ip)
  return { ok: true, message: '密码修改成功，请重新登录' }
}

/** 工具清单版本号 +1（meta 集合/文档不存在时自动创建；与 toolsManage 的 bump 逻辑一致） */
async function bumpToolsVersion() {
  // 服务端 SDK 向不存在的集合写入会失败，必须先建集合（此前版本号永远 0 的根因）
  const ready = await ensureCollection(TOOLS_META_COLLECTION)
  if (!ready) return
  const col = db.collection(TOOLS_META_COLLECTION)
  const res = await col.doc(TOOLS_VERSION_DOC)
    .update({ data: { value: db.command.inc(1), at: nowISO() } })
    .catch(() => null)
  if (!res || !res.stats || !res.stats.updated) {
    await col.add({ data: { _id: TOOLS_VERSION_DOC, value: 1, at: nowISO() } }).catch(() => {})
  }
}

/** 工具列表（全量，含 offline 草稿） */
async function toolList(user) {
  const { data } = await db.collection(TOOLS_COLLECTION)
    .orderBy('sort', 'asc').orderBy('_id', 'asc').limit(100).get()
  return { ok: true, tools: data, count: data.length }
}

/** 工具保存（新建/编辑，带乐观锁；支持部分更新——行内开关只传增量字段） */
async function toolSave(user, p, ip) {
  const toolKey = String(p.tool_key || '')
  const { data } = await db.collection(TOOLS_COLLECTION).where({ tool_key: toolKey }).get()
  const existed = data[0]

  // 部分更新：行内上下线/主推只传增量字段，先与库内现值合并再统一校验，
  // 否则「名称必填」等全量校验会误伤增量请求
  const payload = existed
    ? { ...pickToolPayload(existed), ...pickToolPayload(p) }
    : pickToolPayload(p)
  if (!payload.tool_key || !/^[\w-]{2,30}$/.test(payload.tool_key)) return { ok: false, error: 'tool_key 须为 2-30 位字母数字/下划线/连字符' }
  if (!payload.name) return { ok: false, error: '工具名称不能为空' }
  if (payload.url && isBlacklisted(payload.url)) return { ok: false, error: '链接包含黑名单域名（ujd6.cn），禁止保存' }
  if (payload.activity_url && isBlacklisted(payload.activity_url)) return { ok: false, error: '活动链接包含黑名单域名（ujd6.cn），禁止保存' }
  if (!['online', 'offline'].includes(payload.status || 'online')) return { ok: false, error: 'status 须为 online/offline' }
  payload.status = payload.status || 'online'
  payload.updated_at = nowISO()

  // 乐观锁：编辑时校验版本
  if (existed && typeof p.expectV === 'number' && existed._v !== p.expectV) {
    return { ok: false, error: 'CONFLICT: 工具已被他人修改，请刷新后重试', conflict: true }
  }

  if (existed) {
    const before = { ...existed }
    await db.collection(TOOLS_COLLECTION).where({ tool_key: payload.tool_key }).update({
      data: { ...payload, _v: (existed._v || 0) + 1 }
    })
    await audit(user.username, user.role, 'tool.save', TOOLS_COLLECTION, payload.tool_key, before, payload, ip)
    await bumpToolsVersion()
    return { ok: true, message: '已保存' }
  }

  await db.collection(TOOLS_COLLECTION).add({
    data: { ...payload, _v: 1, created_at: nowISO() }
  })
  await audit(user.username, user.role, 'tool.create', TOOLS_COLLECTION, payload.tool_key, null, payload, ip)
  await bumpToolsVersion()
  return { ok: true, message: '已创建' }
}

/** 工具发布：上线 + 时间戳（小程序端下次 list 自动拉到新配置） */
async function toolPublish(user, p, ip) {
  const toolKey = String(p.tool_key || '')
  const { data } = await db.collection(TOOLS_COLLECTION).where({ tool_key: toolKey }).get()
  const doc = data[0]
  if (!doc) return { ok: false, error: '工具不存在' }
  const before = { ...doc }
  await db.collection(TOOLS_COLLECTION).where({ tool_key: toolKey }).update({
    data: { status: 'online', updated_at: nowISO(), _v: (doc._v || 0) + 1 }
  })
  await audit(user.username, user.role, 'tool.publish', TOOLS_COLLECTION, toolKey, before, { status: 'online' }, ip)
  await bumpToolsVersion()
  return { ok: true, message: '已发布上线，小程序端下次拉取生效' }
}

/** 工具删除（审计留快照） */
async function toolDelete(user, p, ip) {
  const toolKey = String(p.tool_key || '')
  const { data } = await db.collection(TOOLS_COLLECTION).where({ tool_key: toolKey }).get()
  const doc = data[0]
  if (!doc) return { ok: false, error: '工具不存在' }
  await db.collection(TOOLS_COLLECTION).where({ tool_key: toolKey }).remove()
  await audit(user.username, user.role, 'tool.delete', TOOLS_COLLECTION, toolKey, doc, null, ip)
  await bumpToolsVersion()
  return { ok: true, message: '已删除（审计日志保留完整快照）' }
}

/**
 * 批量调整工具排序（拖拽）
 * 一次调用完成多条更新，只写一条 tool.reorder 审计，避免拖动 5 行产生 5 条噪音日志
 */
async function toolReorder(user, p, ip) {
  const items = Array.isArray(p.items) ? p.items : []
  if (!items.length) return { ok: false, error: '缺少排序数据' }
  if (items.length > 200) return { ok: false, error: '单次最多调整 200 个工具' }

  const col = db.collection(TOOLS_COLLECTION)
  const before = []
  const after = []
  let changed = 0

  for (const item of items) {
    const key = String(item.tool_key || '').slice(0, 30)
    const sort = Number(item.sort)
    if (!key || !Number.isFinite(sort) || sort < 0) continue
    const { data } = await col.where({ tool_key: key }).get()
    const doc = data[0]
    if (!doc) continue
    before.push({ tool_key: key, sort: doc.sort || 0 })
    after.push({ tool_key: key, sort })
    if ((doc.sort || 0) === sort) continue
    await col.where({ tool_key: key }).update({
      data: { sort, updated_at: nowISO(), _v: (doc._v || 0) + 1 }
    })
    changed++
  }

  if (!after.length) return { ok: false, error: '没有可更新的工具' }
  if (!changed) return { ok: true, message: '顺序未变化' }

  await audit(
    user.username, user.role, 'tool.reorder', TOOLS_COLLECTION,
    after.map(x => x.tool_key).join(',').slice(0, 200),
    { items: before }, { items: after }, ip
  )
  await bumpToolsVersion()
  return { ok: true, message: `已调整 ${changed} 个工具的排序` }
}

/** 用户列表（分页 + 搜索） */
async function userList(user, p) {
  const page = Math.max(1, Number(p.page) || 1)
  const size = Math.min(50, Math.max(5, Number(p.size) || 20))
  const keyword = String(p.keyword || '').trim()
  const dbQuery = db.collection(USERS_COLLECTION)
  let where = {}
  if (keyword) {
    // 按昵称/openid 模糊（正则限定长度防注入）
    const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    where = _.or([
      { nickName: db.RegExp({ regexp: safe, options: 'i' }) },
      { openid: db.RegExp({ regexp: safe, options: 'i' }) }
    ])
  }
  const { total } = await dbQuery.where(where).count()
  const { data } = await dbQuery.where(where)
    .orderBy('createdAt', 'desc').skip((page - 1) * size).limit(size).get()
  return {
    ok: true,
    total: total,
    page,
    users: data.map(u => ({
      _id: u._id, openid: u.openid, nickName: u.nickName || '',
      avatarUrl: u.avatarUrl || '', role: u.role || 'user',
      vipExpiresAt: u.vipExpiresAt || '', createdAt: u.createdAt || '',
      registeredAt: u.registeredAt || '',
      // 有效保留天数：与小程序端 userManage.listUsers 使用同一 _shared/retention.js 口径
      retentionDays: calcRetentionDays(u),
      // 封禁信息随列表下发：详情抽屉已移除，封禁原因改为列表内悬浮查看
      banReason: u.role === 'blocked' ? (u.ban_reason || '') : '',
      bannedAt: u.role === 'blocked' ? bjTime(u.bannedAt) : ''
    }))
  }
}

/** openid 脱敏：o36Ye5ak...DNzA */
function maskOpenid(id) {
  const s = String(id || '')
  if (!s) return ''
  if (s.length <= 8) return s.slice(0, 2) + '***'
  return s.slice(0, 4) + '***' + s.slice(-4)
}

/**
 * 用户详情：档案（含封禁原因）+ 互助记录（cursor 分页）
 * 分页用 limit(size+1) 探测 hasMore，全程不调用 count()，避免全表扫描；
 * 依赖 tool_records 上的 idx_owner_openid_date(owner_openid:1, date:-1) 索引
 */
async function userDetail(user, p, ip) {
  const openid = String(p.openid || '').slice(0, 64)
  if (!openid) return { ok: false, error: '缺少 openid' }

  let u = null
  try {
    const { data } = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
    u = data[0] || null
  } catch (e) {
    return { ok: false, error: '用户查询失败，请重试' }
  }
  if (!u) return { ok: false, error: '用户不存在或已注销' }

  // 互助资料（未登记不阻断档案展示）
  let acc = null
  try {
    const { data } = await db.collection(ACCOUNT_COLLECTION).where({ openid }).limit(1).get()
    acc = data[0] || null
  } catch (e) { /* 集合不存在等情况忽略 */ }

  const role = u.role || 'user'
  const profile = {
    openid: openid,
    openidMasked: maskOpenid(openid),
    nickName: u.nickName || (acc && acc.tb_nick) || '微信用户',
    avatarUrl: u.avatarUrl || (acc && acc.avatar_url) || '',
    role,
    blocked: role === 'blocked',
    banReason: u.ban_reason || '',
    bannedAt: bjTime(u.bannedAt),
    vipExpiresAt: bjTime(u.vipExpiresAt),
    createdAt: bjTime(u.createdAt),
    registeredAt: bjTime(u.registeredAt),
    hasAccount: !!acc,
    siteNo: (acc && acc.site_no) || 0,
    tbNick: (acc && acc.tb_nick) || ''
  }

  const type = ['help', 'receive'].includes(String(p.type)) ? String(p.type) : ''
  const size = Math.min(50, Math.max(5, Number(p.size) || 20))
  const cursor = String(p.cursor || '')

  const where = { owner_openid: openid }
  if (type) where.type = type
  if (cursor) where.created_at = _.lt(cursor)

  let raw = []
  try {
    // 排序首位对齐索引第二列 date，created_at 作次级排序并作为游标保证唯一
    const { data } = await db.collection(RECORD_COLLECTION)
      .where(where)
      .orderBy('date', 'desc')
      .orderBy('created_at', 'desc')
      .limit(size + 1)
      .get()
    raw = data || []
  } catch (e) {
    return { ok: false, error: '记录查询失败：' + String(e.message || '').slice(0, 60) }
  }

  const hasMore = raw.length > size
  const rows = hasMore ? raw.slice(0, size) : raw
  const records = rows.map(r => ({
    id: r._id,
    date: r.date || '',
    createdAt: r.created_at || '',
    type: r.type || '',
    mode: r.mode || '',
    toolKey: r.tool_key || '',
    nick: r.nick || '淘友',
    command: String(r.command || '').slice(0, 300),
    status: r.status || ''
  }))

  // 统计：一次聚合分组（限定当前用户，成本可控；失败不影响列表）
  let stats = { total: 0, help: 0, receive: 0, done: 0, ongoing: 0, pending: 0, returned: 0 }
  try {
    const $ = db.command.aggregate
    const res = await db.collection(RECORD_COLLECTION).aggregate()
      .match({ owner_openid: openid })
      .group({ _id: { type: '$type', status: '$status' }, n: $.sum(1) })
      .end()
    ;(res.list || []).forEach(item => {
      const n = Number(item.n) || 0
      const t = item._id && item._id.type
      const s = item._id && item._id.status
      stats.total += n
      if (t === 'help') stats.help += n
      if (t === 'receive') stats.receive += n
      if (s === 'done') stats.done += n
      else if (s === 'ongoing') stats.ongoing += n
      else if (s === 'pending') stats.pending += n
      else if (s === 'returned') stats.returned += n
    })
  } catch (e) {
    stats = null
  }

  // 隐私访问留痕（targetId 用脱敏 openid）
  await audit(user.username, user.role, 'user.detail', USERS_COLLECTION,
    profile.openidMasked, null, { type: type || 'all', size, cursor: cursor || '' }, ip)

  return {
    ok: true,
    profile,
    stats,
    records,
    hasMore,
    nextCursor: records.length ? records[records.length - 1].createdAt : ''
  }
}

/**
 * 互助账号列表（互助管理页）：tool_accounts + users 摘要关联
 * 支持按淘宝昵称模糊、站内编号精确搜索；数据量级为登记用户数，分页用 skip 可接受
 */
async function accountList(user, p) {
  const page = Math.max(1, Number(p.page) || 1)
  const size = Math.min(50, Math.max(5, Number(p.size) || 20))
  const where = {}
  if (p.nick) {
    const kw = String(p.nick).trim().slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    where.tb_nick = db.RegExp({ regexp: kw, options: 'i' })
  }
  if (p.siteNo) where.site_no = Number(p.siteNo)

  const { total } = await db.collection(ACCOUNT_COLLECTION).where(where).count()
  const { data } = await db.collection(ACCOUNT_COLLECTION).where(where)
    .orderBy('site_no', 'asc').skip((page - 1) * size).limit(size).get()

  // 关联微信昵称与角色（一次 in 查询）
  const openids = [...new Set(data.map(a => a.owner_openid).filter(Boolean))]
  const userMap = {}
  if (openids.length) {
    try {
      const { data: us } = await db.collection(USERS_COLLECTION).where({ openid: _.in(openids) }).get()
      us.forEach(u => { userMap[u.openid] = u })
    } catch (e) { /* 关联失败不阻断列表 */ }
  }

  const accounts = data.map(a => {
    const u = userMap[a.owner_openid] || {}
    return {
      siteNo: a.site_no || 0,
      nick: a.tb_nick || '',
      avatar: a.avatar_url || '',
      toolKey: a.tool_key || '',
      pausedSolo: !!a.paused_solo,
      pausedTeam: !!a.paused_team,
      updatedAt: bjTime(a.updatedAt),
      createdAt: bjTime(a.createdAt),
      openid: a.owner_openid,
      openidMasked: maskOpenid(a.owner_openid),
      wxNick: u.nickName || '',
      role: u.role || 'user'
    }
  })
  return { ok: true, total, page, accounts }
}

/** 通用用户字段更新（封禁/VIP/角色共用） */
async function updateUser(user, openid, patch, action, ip) {
  const { data } = await db.collection(USERS_COLLECTION).where({ openid }).get()
  const doc = data[0]
  if (!doc) return { ok: false, error: '用户不存在' }
  const before = { ...doc }
  await db.collection(USERS_COLLECTION).where({ openid }).update({ data: patch })
  await audit(user.username, user.role, action, USERS_COLLECTION, openid,
    { role: doc.role, vipExpiresAt: doc.vipExpiresAt }, patch, ip)
  return { ok: true, message: '操作成功' }
}

async function userBan(user, p, ip) {
  const openid = String(p.openid || '')
  const ban = !!p.ban
  const reason = String(p.reason || '').slice(0, 100)
  if (ban && !reason) return { ok: false, error: '封禁必须填写原因' }
  return updateUser(user, openid,
    ban ? { role: 'blocked', ban_reason: reason, bannedAt: nowISO() }
        : { role: 'user', ban_reason: '', bannedAt: '' },
    ban ? 'user.ban' : 'user.unban', ip)
}

async function userSetVip(user, p, ip) {
  const vip = !!p.vip
  // expiresDays 为空 → 永久 VIP
  const days = Number(p.expiresDays) || 0
  return updateUser(user, String(p.openid || ''),
    vip ? { role: 'vip', vipExpiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : '' }
        : { role: 'user', vipExpiresAt: '' },
    vip ? 'user.setVip' : 'user.removeVip', ip)
}

async function userSetRole(user, p, ip) {
  const role = String(p.role || '')
  if (!['user', 'admin'].includes(role)) return { ok: false, error: 'role 须为 user/admin（封禁与 VIP 走专用接口）' }
  const chk = requireRole(user, true)
  if (!chk.ok) return chk
  return updateUser(user, String(p.openid || ''), { role }, 'user.setRole', ip)
}

/** 审计日志列表（筛选 + 分页） */
async function logList(user, p) {
  const page = Math.max(1, Number(p.page) || 1)
  const size = Math.min(100, Math.max(5, Number(p.size) || 20))
  const where = {}
  if (p.operator) where.operator = String(p.operator).slice(0, 30)
  if (p.target) where.target = String(p.target).slice(0, 30)
  if (p.actionFilter) where.action = String(p.actionFilter).slice(0, 40)
  const { total } = await db.collection(AUDIT_COLLECTION).where(where).count()
  const { data } = await db.collection(AUDIT_COLLECTION).where(where)
    .orderBy('createdAt', 'desc').skip((page - 1) * size).limit(size).get()
  // createdAt 落库为 UTC ISO，统一转北京时间后再下发（与其它接口口径一致）
  const logs = data.map(l => ({ ...l, createdAt: bjTime(l.createdAt) }))
  return { ok: true, total, page, logs }
}

/** 审计日志导出（CSV 文本，最多 5000 条） */
async function logExport(user, p, ip) {
  const where = {}
  if (p.operator) where.operator = String(p.operator).slice(0, 30)
  if (p.target) where.target = String(p.target).slice(0, 30)
  if (p.actionFilter) where.action = String(p.actionFilter).slice(0, 40)
  const { data } = await db.collection(AUDIT_COLLECTION).where(where)
    .orderBy('createdAt', 'desc').limit(5000).get()
  const esc = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'
  const rows = [['时间', '操作人', '角色', '动作', '目标集合', '目标ID', 'IP'],
    ...data.map(l => [bjTime(l.createdAt), l.operator, l.role, l.action, l.target, l.targetId, l.ip])]
    .map(r => r.map(esc).join(',')).join('\r\n')
  await audit(user.username, user.role, 'log.export', AUDIT_COLLECTION, '', { count: data.length }, null, ip)
  return { ok: true, csv: rows, count: data.length }
}

// ============================== 主入口 ==============================

exports.main = async (event) => {
  // HTTP 预检请求直接放行（同样只用白名单 CORS 头）
  if (isHttp(event) && event.httpMethod === 'OPTIONS') {
    const headers = corsHeaders(event)
    delete headers['Content-Type']
    return { statusCode: 204, headers, body: '' }
  }

  let p = event
  let ip = ''
  if (isHttp(event)) {
    try {
      p = JSON.parse(event.body || '{}')
    } catch (e) {
      return send(event, { ok: false, error: '请求体不是合法 JSON' }, 400)
    }
    ip = (event.requestContext && event.requestContext.sourceIp) ||
         (event.headers && (event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'])) || ''
  }

  const action = String((p && p.action) || '')

  try {
    // 集合保障（tools/users 已存在，admin_users/audit_logs 首次调用自动创建）
    if (!(await ensureAllCollections())) {
      return send(event, { ok: false, error: '数据库集合不可用' }, 500)
    }

    // 无需鉴权：初始化、登录
    if (action === 'admin.init') return send(event, await adminInit(p, ip))
    if (action === 'auth.login') return send(event, await authLogin(p, ip))

    // 以下均需登录
    const chk = await requireAuth(p.token)
    if (!chk.ok) return send(event, { ok: false, error: chk.error }, 401)
    const user = chk.user

    let result
    switch (action) {
      case 'auth.changePassword': result = await changePassword(user, p, ip); break
      case 'tool.list': result = await toolList(user); break
      case 'tool.save': result = await toolSave(user, p, ip); break
      case 'tool.publish': result = await toolPublish(user, p, ip); break
      case 'tool.delete': result = await toolDelete(user, p, ip); break
      case 'tool.reorder': result = await toolReorder(user, p, ip); break
      case 'user.list': result = await userList(user, p); break
      case 'user.detail': result = await userDetail(user, p, ip); break
      case 'account.list': result = await accountList(user, p); break
      case 'user.ban': result = await userBan(user, p, ip); break
      case 'user.setVip': result = await userSetVip(user, p, ip); break
      case 'user.setRole': result = await userSetRole(user, p, ip); break
      case 'log.list': result = await logList(user, p); break
      case 'log.export': result = await logExport(user, p, ip); break
      default: result = { ok: false, error: '未知 action: ' + action }
    }
    return send(event, result)
  } catch (e) {
    console.error('[adminApi]', action, e.message)
    return send(event, { ok: false, error: '服务异常：' + e.message }, 500)
  }
}

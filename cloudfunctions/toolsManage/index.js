/**
 * 工具清单管理云函数（纯清单：播种 / 下发）
 *
 * 按「每个互助工具 = 独立页面 + 独立数据集合 + 独立云函数」拆分后：
 * 淘金币互助业务已迁至 coinPkApi，多多水果互助业务在 fruitApi，
 * 本函数只负责 tools 集合的默认播种与在线清单下发。
 *
 * 动作：
 *   list   下发在线工具清单（首次调用自动播种 DEFAULT_TOOLS）
 */
const cloud = require('wx-server-sdk')
const { ensureCollection: ensureCollectionShared } = require('./_shared/db')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const COLLECTION = 'tools'
// 工具清单版本号：管理员每次改配置（保存/删除/重排）后递增，
// 小程序首页 onShow 用轻量 version 动作比对，变化才拉全量清单
const META_COLLECTION = 'tools_meta'
const META_DOC_ID = 'version'

/**
 * 首次使用的默认工具（集合为空时自动写入）
 * 之后所有工具以数据库数据为准，前端不再硬编码
 */
const DEFAULT_TOOLS = [
  {
    tool_key: 'scan',
    name: '扫一扫 · 解码',
    desc: '相机扫码 / 相册识别 · 内容解析与编码转换',
    summary: '条码识别与内容解析',
    icon: '/images/nav_scan_white.png',
    iconBg: '#2E6B57',
    tag: '',
    url: '/pages/scan/scan',
    navType: 'navigateTo',
    featured: true,
    category: '扫码识别',
    theme: 0,
    sort: 1,
    status: 'online',
    // 递增后部署可覆盖云端入口字段，恢复被误改的名称/描述
    rules_version: 2
  },
  {
    tool_key: 'regcode',
    name: '注册码',
    desc: '生成 / 解析 / 校验',
    summary: '设备注册码工具',
    icon: '/images/icon_device.png',
    iconBg: '#FFF3E0',
    tag: 'VIP',
    url: '/pages/regcode/regcode',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    theme: 2,
    sort: 3,
    status: 'online'
  },
  {
    tool_key: 'unit_convert',
    name: '单位换算',
    desc: '长度 / 重量 / 温度 / 面积 / 速度实时换算',
    summary: '常用单位实时换算',
    icon: '',
    iconBg: '#F3E7D8',
    badge: '换',
    badgeColor: '#C0553D',
    tag: '',
    url: '/pages/unit-converter/unit-converter',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    theme: 1,
    sort: 5,
    status: 'online'
  },
  {
    tool_key: 'text_tools',
    name: '文本工具箱',
    desc: '去重 / 去空行 / 排序 / 批量替换 / 标点转换',
    summary: '文本整理与格式转换',
    icon: '',
    iconBg: '#EAF0FB',
    badge: '文',
    badgeColor: '#2F6C60',
    tag: '',
    url: '/pages/text-tools/text-tools',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    theme: 1,
    sort: 6,
    status: 'online'
  },
  {
    tool_key: 'date_tools',
    name: '日期工具',
    desc: '日期间隔 / 日期推算 / 时间戳 / 倒计时',
    summary: '日期计算与时间戳转换',
    icon: '',
    iconBg: '#F1E9F7',
    badge: '日',
    badgeColor: '#A8452F',
    tag: '',
    url: '/pages/date-tools/date-tools',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    theme: 1,
    sort: 8,
    status: 'online'
  },
  {
    tool_key: 'pdd_fruit',
    name: '多多水果互助',
    app_name: '拼多多',
    desc: '互填 8-9 位邀请码，组队抽生鲜券',
    summary: '多多果园邀请码互换广场，无任务流转、无配额',
    icon: '',
    iconBg: '#EAF3E8',
    badge: '果',
    badgeColor: '#2F6C60',
    tag: '',
    url: '/pages/fruit/fruit',
    navType: 'navigateTo',
    featured: false,
    category: '互助',
    theme: 1,
    sort: 9,
    status: 'online'
  },  {
      tool_key: 'tb_coin_pk',
      name: '淘金币互助',
      app_name: '淘宝',
      desc: '个人赛车加能量 / 车队助力加里程 · 每日助人、受助各 10 次',
      summary: '按名额发布助力需求，完成后上传明细图供受助者核对',
      icon: '',
      iconBg: '#FFF3E0',
      badge: '金币',
      badgeColor: '#FF6B35',
      tag: '互助',
      url: '/pages/tool/tool?key=tb_coin_pk',
      navType: 'navigateTo',
      modes: '个人赛车（加能量） / 车队助力（加里程）',
      mode_tabs: ['个人赛车（加能量）', '车队助力（加里程）'],
      board_notice: '今日次数已用完，明天零点恢复领取机会；实际助力结果以淘宝明细为准。',
      // 旧字段保留兼容，实际按模式取值
      daily_help_limit: 10,
      daily_receive_limit: 10,
      daily_help_limit_solo: 10,
      daily_help_limit_team: 6,
      daily_receive_limit_solo: 10,
      daily_receive_limit_team: 6,
      task_seconds: 300,
      quota_full_text: '今日受助名额已用完，包含正在助力的任务。',
      claim_title: '今日领取已完成',
      claim_desc: '明天零点恢复领取机会。已有记录可到「今日助人」查看。',
      detail_title: '今日助力明细图',
      detail_desc: '今日次数已用完，可以上传明细图了。还有 10 笔已完成任务没有明细图。',
      detail_note: '自愿补充，不影响任务操作；相关受助者可直接查看完整总图。',
      arrange_text: '今天设置的受助人数已安排完，暂不安排新助力。',
      result_note: '实际助力结果以淘宝明细为准。',
      rules_text: [
        '【互助平台侧 · 两种模式】个人赛车（加能量）与车队助力（加里程）分开参与，在页面顶部切换。',
        '【互助平台侧 · 先助人后发布】受助机会注册即赠 1 次，成功助力他人 +1 次，被他人助力 -1 次；不按天补充，亏欠会原样结转到次日，需继续助力补齐才能发布口令进入受助池。',
        '【互助平台侧 · 今日助人】个人赛每日上限 10 次、车队 PK 每日上限 6 次，用完显示「剩余 0 次」；已用记录可到「今日助人」查看。',
        '【互助平台侧 · 今日受助】个人赛每日上限 10 次、车队 PK 每日上限 6 次，名额包含正在助力的任务；当日名额安排完后不再安排新助力。',
        '【互助平台侧 · 领取与恢复】今日领取完成后，明天零点恢复领取机会；已有记录可在「今日助人」查看。',
        '【互助平台侧 · 助力明细图】次数用完后可上传「今日助力明细图」；属自愿补充，不影响任务操作，相关受助者可直接查看完整总图。',
        '【互助平台侧 · 结果认定】实际助力结果以淘宝明细为准，平台记录仅供参考。',
        '【互助平台侧 · 常用入口】开始助力 / 记录 / 个人中心；可查看今日统计、剩余次数与明日参与，受助人数在「管理」中设置。',
        '【淘宝活动侧 · 助力次数】每个账号每天最多为他人助力 6 次；同一对账号每日仅可互点 1 次；不能给自己助力。',
        '【淘宝活动侧 · 组队与 PK】车队上限 5 人，满队升级能耗最高减 20%；排位前 50 名晋级 1v1 PK，奖励按个人前进值占比分配。',
        '【淘宝活动侧 · 两条奖励线】赛车升级加抵金与 PK 对局奖励分开结算，PK 落败只扣车队线，个人升级奖励不受影响。',
        '【淘宝活动侧 · 时间线（2026 双11）】10.18–10.26 组队升级；10.27–10.29 排位晋级；10.30–11.08 1v1 PK；11.09–11.13 领取加抵金。'
      ].join('\n'),
      proof_label: '助力明细图',
      proof_placeholder: '上传今日助力明细图，或粘贴助力链接 / 淘口令',
      need_min: 1,
      need_max: 5,
      point_default: 1,
      source_note: '平台侧规则依据互助界面截图整理；淘宝活动侧规则依据公开攻略整理。两类次数上限口径不同（平台 10 次 / 官方 6 次），均以各自页面实时显示为准。',
      rules_version: 5,
      featured: false,
      category: '淘金币互助',
      theme: 3,
      sort: 4,
      status: 'online'
    }
]

/** 确保集合存在：公共实现见 cloudfunctions/_shared/db.js（部署前同步副本） */
async function ensureCollection(name) {
  return ensureCollectionShared(db, name || COLLECTION, 'toolsManage')
}

/** 读取工具清单版本号（无记录返回 0） */
async function getToolsVersion() {
  try {
    const { data } = await db.collection(META_COLLECTION).doc(META_DOC_ID).get()
    return (data && data.value) || 0
  } catch (e) {
    return 0
  }
}

/** 工具清单版本号 +1（meta 集合/文档不存在时自动创建） */
async function bumpToolsVersion() {
  // 服务端 SDK 向不存在的集合写入会失败，必须先建集合（此前版本号永远 0 的根因）
  const ready = await ensureCollection(META_COLLECTION)
  if (!ready) return
  const res = await db.collection(META_COLLECTION).doc(META_DOC_ID)
    .update({ data: { value: _.inc(1), at: new Date().toISOString() } })
    .catch(() => null)
  if (!res || !res.stats || !res.stats.updated) {
    await db.collection(META_COLLECTION).add({ data: { _id: META_DOC_ID, value: 1, at: new Date().toISOString() } }).catch(() => {})
  }
}

/**
 * 按 tool_key 补齐 / 升级默认工具
 * - 不存在：新增
 * - 已存在且 rules_version 落后：用默认配置覆盖内置字段（保持 _id 与状态字段不变）
 * - 运营手工把 rules_version 调大即可锁定，避免被后续部署覆盖
 */
async function ensureDefaultTools() {
  try {
    const { data } = await db.collection(COLLECTION).limit(100).get()
    const byKey = {}
    data.forEach(d => { byKey[d.tool_key] = d })

    // 存量数据迁移：分包已合并进主包，修正历史配置里的旧跳转路径（幂等）
    for (const d of data) {
      if (d.url && d.url.indexOf('/package1/pages/') !== -1) {
        const fixed = d.url.replace('/package1/pages/', '/pages/')
        await db.collection(COLLECTION).doc(d._id).update({ data: { url: fixed } })
        if (byKey[d.tool_key]) byKey[d.tool_key].url = fixed
        console.log('[toolsManage] 修正工具跳转路径', d.tool_key, '→', fixed)
      }
    }

    let added = 0
    let upgraded = 0
    for (const tool of DEFAULT_TOOLS) {
      const current = byKey[tool.tool_key]

      if (!current) {
        await db.collection(COLLECTION).add({
          data: { ...tool, createdAt: new Date().toISOString() }
        })
        added++
        continue
      }

      const currentVersion = typeof current.rules_version === 'number' ? current.rules_version : 1
      const defaultVersion = typeof tool.rules_version === 'number' ? tool.rules_version : 1
      if (currentVersion >= defaultVersion) continue

      const { featured, sort, status, ...ruleFields } = tool
      await db.collection(COLLECTION).doc(current._id).update({
        data: { ...ruleFields, updatedAt: new Date().toISOString() }
      })
      upgraded++
    }
    if (added || upgraded) {
      console.log('[toolsManage] 默认工具变更', { added, upgraded })
    }
  } catch (e) {
    console.error('[toolsManage] 同步默认工具失败', e)
  }
}
/** 只保留前端需要的字段，避免把云端内部数据下发 */
function pick(doc) {
  return {
    tool_key: doc.tool_key || '',
    name: doc.name || '',
    app_name: doc.app_name || '',
    desc: doc.desc || doc.summary || '',
    summary: doc.summary || '',
    icon: doc.icon || '',
    iconBg: doc.iconBg || '',
    badge: doc.badge || '',
    badgeColor: doc.badgeColor || '',
    tag: doc.tag || '',
    url: doc.url || '',
    navType: doc.navType || 'navigateTo',
    // 下发过滤：第三方遗留链接不进入小程序
    activity_url: doc.activity_url && !/ujd6\.cn/i.test(doc.activity_url) ? doc.activity_url : '',
    modes: doc.modes || '',
    mode_tabs: Array.isArray(doc.mode_tabs) ? doc.mode_tabs : [],
    board_notice: doc.board_notice || '',
    daily_help_limit: typeof doc.daily_help_limit === 'number' ? doc.daily_help_limit : 0,
    daily_receive_limit: typeof doc.daily_receive_limit === 'number' ? doc.daily_receive_limit : 0,
    daily_help_limit_solo: typeof doc.daily_help_limit_solo === 'number' ? doc.daily_help_limit_solo : 0,
    daily_help_limit_team: typeof doc.daily_help_limit_team === 'number' ? doc.daily_help_limit_team : 0,
    daily_receive_limit_solo: typeof doc.daily_receive_limit_solo === 'number' ? doc.daily_receive_limit_solo : 0,
    daily_receive_limit_team: typeof doc.daily_receive_limit_team === 'number' ? doc.daily_receive_limit_team : 0,
    task_seconds: typeof doc.task_seconds === 'number' && doc.task_seconds >= 60 ? doc.task_seconds : 300,
    quota_full_text: doc.quota_full_text || '',
    claim_title: doc.claim_title || '',
    claim_desc: doc.claim_desc || '',
    detail_title: doc.detail_title || '',
    detail_desc: doc.detail_desc || '',
    detail_note: doc.detail_note || '',
    arrange_text: doc.arrange_text || '',
    result_note: doc.result_note || '',
    rules_text: doc.rules_text || '',
    proof_label: doc.proof_label || '',
    proof_placeholder: doc.proof_placeholder || '',
    need_min: typeof doc.need_min === 'number' ? doc.need_min : 1,
    need_max: typeof doc.need_max === 'number' ? doc.need_max : 30,
    point_default: typeof doc.point_default === 'number' ? doc.point_default : 1,
    source_note: doc.source_note || '',
    featured: !!doc.featured,
    category: doc.category || '',
    theme: doc.theme || 0,
    sort: doc.sort || 999
  }
}

/* ===== 小程序端「工具配置」（管理员） ===== */

/**
 * 管理员判定：users 集合 role=admin/super，或等级 >= 3（与小程序 profile 的 isAdmin 口径一致）
 * 查不到/异常一律拒绝，管理动作不做兜底放行
 */
async function isAdminUser(openid) {
  if (!openid) return false
  try {
    const { data } = await db.collection('users').where({ openid }).limit(1).get()
    const u = data[0]
    if (!u) return false
    if (u.role === 'admin' || u.role === 'super') return true
    return (Number(u.level) || 0) >= 3
  } catch (e) {
    console.warn('[toolsManage] 管理员校验失败', e)
    return false
  }
}

/** 管理端可编辑字段白名单：只允许改入口展示信息，业务集合与规则字段不受影响 */
const ADMIN_STR_FIELDS = {
  name: 40,
  app_name: 20,
  desc: 120,
  summary: 120,
  category: 20,
  tag: 10,
  badge: 6,
  badgeColor: 20,
  icon: 200,
  iconBg: 20,
  url: 200,
  navType: 20
}

/** 管理列表：含下线工具，按排序返回，供小程序编辑 */
async function adminList() {
  await ensureDefaultTools()
  const { data } = await db.collection(COLLECTION)
    .orderBy('sort', 'asc')
    .limit(100)
    .get()

  const list = data
    .filter(doc => doc.tool_key !== 'decode')
    .map(doc => ({
      tool_key: doc.tool_key || '',
      name: doc.name || '',
      app_name: doc.app_name || '',
      desc: doc.desc || doc.summary || '',
      summary: doc.summary || '',
      category: doc.category || '',
      tag: doc.tag || '',
      badge: doc.badge || '',
      badgeColor: doc.badgeColor || '',
      icon: doc.icon || '',
      iconBg: doc.iconBg || '',
      url: doc.url || '',
      navType: doc.navType || 'navigateTo',
      featured: !!doc.featured,
      sort: typeof doc.sort === 'number' ? doc.sort : 999,
      status: doc.status || 'online'
    }))

  return { success: true, tools: list }
}

/** 管理保存：按 tool_key 更新入口展示字段 */
async function adminSave(payload) {
  const toolKey = String((payload && payload.tool_key) || '').trim()
  if (!toolKey) return { success: false, error: '缺少 tool_key' }

  const patch = {}
  for (const field of Object.keys(ADMIN_STR_FIELDS)) {
    if (payload[field] === undefined) continue
    patch[field] = String(payload[field] || '').trim().slice(0, ADMIN_STR_FIELDS[field])
  }

  if (patch.name !== undefined && !patch.name) {
    return { success: false, error: '名称不能为空' }
  }
  if (patch.navType && !['navigateTo', 'switchTab', 'reLaunch', 'tool'].includes(patch.navType)) {
    patch.navType = 'navigateTo'
  }
  if (payload.sort !== undefined) {
    const n = Number(payload.sort)
    if (!Number.isFinite(n) || n < 0 || n > 9999) return { success: false, error: '排序值需为 0~9999' }
    patch.sort = Math.floor(n)
  }
  if (payload.featured !== undefined) patch.featured = !!payload.featured
  if (payload.status !== undefined) {
    if (!['online', 'offline'].includes(payload.status)) return { success: false, error: '状态不合法' }
    patch.status = payload.status
  }
  if (!Object.keys(patch).length) return { success: false, error: '没有需要更新的字段' }

  patch.updatedAt = new Date().toISOString()

  const { data } = await db.collection(COLLECTION).where({ tool_key: toolKey }).limit(1).get()
  if (!data.length) return { success: false, error: '工具不存在' }

  await db.collection(COLLECTION).doc(data[0]._id).update({ data: patch })
  await bumpToolsVersion()
  return { success: true, tool_key: toolKey, patch }
}

/** 管理删除：彻底移除某个工具文档（不可恢复） */
async function adminDelete(payload) {
  const toolKey = String((payload && payload.tool_key) || '').trim()
  if (!toolKey) return { success: false, error: '缺少 tool_key' }

  const { data } = await db.collection(COLLECTION).where({ tool_key: toolKey }).limit(1).get()
  if (!data.length) return { success: false, error: '工具不存在' }

  await db.collection(COLLECTION).doc(data[0]._id).remove()
  return { success: true, tool_key: toolKey }
}

/**
 * 管理批量重排：items = [{ tool_key, sort }]，整体写入 sort
 * 小程序端改排序值时配合「移动到第 N 位」使用，保证全表序号 1..n 唯一
 */
async function adminReorder(payload) {
  const items = Array.isArray(payload && payload.items) ? payload.items : []
  if (!items.length) return { success: false, error: '缺少排序数据' }
  if (items.length > 200) return { success: false, error: '单次最多调整 200 个工具' }

  let changed = 0
  for (const item of items) {
    const key = String((item && item.tool_key) || '').trim().slice(0, 30)
    const sort = Number(item && item.sort)
    if (!key || !Number.isFinite(sort) || sort < 0 || sort > 9999) continue
    const { data } = await db.collection(COLLECTION).where({ tool_key: key }).limit(1).get()
    if (!data.length) continue
    if ((data[0].sort || 0) === sort) continue
    await db.collection(COLLECTION).where({ tool_key: key }).update({
      data: { sort: Math.floor(sort), updatedAt: new Date().toISOString() }
    })
    changed++
  }
  if (changed) await bumpToolsVersion()
  return { success: true, changed }
}

exports.main = async (event) => {
  const action = event.action || 'list'

  try {
    // 小程序端管理动作：先校验管理员，再执行
    if (action === 'adminList' || action === 'adminSave' || action === 'adminDelete' || action === 'adminReorder') {
      const openid = (cloud.getWXContext() || {}).OPENID || ''
      if (!(await isAdminUser(openid))) {
        return { success: false, error: 'FORBIDDEN', message: '需要管理员权限' }
      }
      const readyAdmin = await ensureCollection(COLLECTION)
      if (!readyAdmin) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }
      if (action === 'adminList') return await adminList()
      if (action === 'adminDelete') return await adminDelete(event)
      if (action === 'adminReorder') return await adminReorder(event)
      return await adminSave(event)
    }

    if (action === 'version') {
      // 轻量动作：返回清单版本号，首页 onShow 比对用，无需管理员权限
      return { success: true, version: await getToolsVersion() }
    }

    if (action !== 'list') {
      // 淘金币互助业务已迁至 coinPkApi；本函数仅支持 list 与管理员动作
      return { success: false, error: 'UNKNOWN_ACTION' }
    }

    const ready = await ensureCollection(COLLECTION)
    if (!ready) {
      return { success: false, error: 'COLLECTION_UNAVAILABLE' }
    }

    await ensureDefaultTools()

    // 全量拉取后按状态拆分：上线工具照常下发；
    // 下线工具以 offline_keys 通知前端，避免前端把「已下线的内置工具」当作云端缺失而重新补回
    const { data } = await db.collection(COLLECTION)
      .orderBy('sort', 'asc')
      .limit(100)
      .get()

    // decode 已并入 scan（扫一扫 · 解码），历史残留文档不再下发
    const usable = data.filter(doc => doc.tool_key !== 'decode')
    const online = usable.filter(doc => doc.status !== 'offline')
    const offlineKeys = usable
      .filter(doc => doc.status === 'offline')
      .map(doc => doc.tool_key)

    return {
      success: true,
      tools: online.map(pick),
      count: online.length,
      offline_keys: offlineKeys,
      version: await getToolsVersion()
    }
  } catch (e) {
    console.error('[toolsManage] 操作失败', action, e)
    return { success: false, error: e.message || 'FAILED' }
  }
}
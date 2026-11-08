const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'tools'
const ACCOUNT_COLLECTION = 'tool_accounts'
const COMMAND_COLLECTION = 'tool_commands'
const RECORD_COLLECTION = 'tool_records'
const QUOTA_COLLECTION = 'tool_quota'
const DAILY_COLLECTION = 'tool_daily'

/** 当天日期键（北京时间 UTC+8，按自然日零点失效） */
function todayKey() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return now.toISOString().slice(0, 10)
}

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
    icon: '/images/icon_scan_white.png',
    iconBg: '#2E6B57',
    tag: '',
    url: '/pages/scan/scan',
    navType: 'navigateTo',
    featured: true,
    category: '扫码识别',
    theme: 0,
    sort: 1,
    status: 'online'
  },
  {
    tool_key: 'regcode',
    name: '注册码',
    desc: '生成 / 解析 / 校验',
    summary: '设备注册码工具',
    icon: '/images/icon_device.png',
    iconBg: '#FFF3E0',
    tag: 'VIP',
    url: '/package1/pages/regcode/regcode',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    theme: 2,
    sort: 3,
    status: 'online'
  },
  {
    tool_key: 'tb_coin_pk',
    name: '淘金币互助·赛车助力',
    app_name: '淘宝',
    desc: '个人赛车加能量 / 车队助力加里程 · 每日助人、受助各 10 次',
    summary: '按名额发布助力需求，完成后上传明细图供受助者核对',
    icon: '',
    iconBg: '#FFF3E0',
    badge: '金币',
    badgeColor: '#FF6B35',
    tag: '互助',
    url: '',
    navType: 'tool',
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
    rules_version: 4,
    featured: false,
    category: '淘金币互助',
    theme: 3,
    sort: 4,
    status: 'online'
  }
]

/** 确保集合存在（新环境首次调用时自动建表） */
async function ensureCollection(name) {
  const collection = name || COLLECTION
  try {
    await db.collection(collection).count()
    return true
  } catch (e) {
    try {
      await db.createCollection(collection)
      return true
    } catch (e2) {
      console.error('[toolsManage] 创建集合失败', collection, e2)
      return false
    }
  }
}

/** 读取当前用户登记的工具账号（按 openid 隔离） */
async function getAccount(openid) {
  const { data } = await db.collection(ACCOUNT_COLLECTION)
    .where({ owner_openid: openid })
    .limit(1)
    .get()
  return data[0] || null
}

/**
 * 本站编号 = 登记顺序（1、2、3…）
 * 云函数实例内只校正一次；按 createdAt 升序重排，兼容早期哈希编号（如 741）
 */
let _siteNosChecked = false
async function ensureSiteNos() {
  if (_siteNosChecked) return
  _siteNosChecked = true

  try {
    const { data } = await db.collection(ACCOUNT_COLLECTION)
      .orderBy('createdAt', 'asc')
      .limit(1000)
      .get()

    for (let i = 0; i < data.length; i++) {
      if (data[i].site_no !== i + 1) {
        await db.collection(ACCOUNT_COLLECTION).doc(data[i]._id).update({
          data: { site_no: i + 1 }
        })
      }
    }
  } catch (e) {
    console.warn('[toolsManage] 编号校正失败', e)
  }
}

/** 下一个登记序号：当前最大编号 + 1，避免删除/并发导致重复 */
async function nextSiteNo() {
  const { data } = await db.collection(ACCOUNT_COLLECTION)
    .orderBy('site_no', 'desc')
    .limit(1)
    .get()
  const max = data.length && typeof data[0].site_no === 'number' ? data[0].site_no : 0
  return max + 1
}

/** 登记 / 更新展示资料：仅昵称与头像 */
async function saveAccount(openid, input) {
  const payload = {
    tool_key: String(input.tool_key || '').slice(0, 40),
    tb_nick: String(input.tb_nick || '').trim().slice(0, 40),
    avatar_url: String(input.avatar_url || '').trim().slice(0, 300),
    updatedAt: new Date().toISOString()
  }

  if (!payload.tb_nick) {
    return { success: false, error: 'NICK_REQUIRED' }
  }

  const existing = await getAccount(openid)
  if (existing) {
    await db.collection(ACCOUNT_COLLECTION).doc(existing._id).update({ data: payload })
    return {
      success: true,
      account: { ...existing, ...payload, owner_openid: openid }
    }
  }

  const site_no = await nextSiteNo()
  const created = {
    ...payload,
    site_no,
    owner_openid: openid,
    createdAt: payload.updatedAt
  }
  await db.collection(ACCOUNT_COLLECTION).add({ data: created })

  return { success: true, account: created }
}

/** 切换本人某模式的受助暂停（云端生效：暂停后口令不再进入抽取池） */
async function setHelpPause(openid, toolKey, mode, paused) {
  const field = mode === 'solo' ? 'paused_solo' : 'paused_team'
  const col = db.collection(ACCOUNT_COLLECTION)
  const existing = await getAccount(openid)
  if (!existing || existing.tool_key !== toolKey) {
    return { success: false, error: 'NOT_REGISTERED' }
  }
  await col.doc(existing._id).update({
    data: { [field]: !!paused, updatedAt: new Date().toISOString() }
  })
  return { success: true }
}

/** 设置本人某模式当天愿意接受的受助人数（云端生效，不超过工具上限） */
async function setHelpQuota(openid, toolKey, mode, quota) {
  const field = mode === 'solo' ? 'quota_solo' : 'quota_team'
  const limits = await getLimits(toolKey, mode)
  const n = Math.min(limits.receive, Math.max(1, parseInt(quota, 10) || limits.receive))
  const col = db.collection(ACCOUNT_COLLECTION)
  const existing = await getAccount(openid)
  if (!existing || existing.tool_key !== toolKey) {
    return { success: false, error: 'NOT_REGISTERED' }
  }
  await col.doc(existing._id).update({
    data: { [field]: n, updatedAt: new Date().toISOString() }
  })
  return { success: true, quota: n }
}

/**
 * 清除登记资料：删除本人登记文档与已上传头像
 * 仅清理展示资料；未决任务与必要历史记录不在本集合内，不受影响
 */
async function clearAccount(openid) {
  const existing = await getAccount(openid)
  if (!existing) {
    return { success: true, cleared: false }
  }

  const avatarUrl = existing.avatar_url || ''
  await db.collection(ACCOUNT_COLLECTION).doc(existing._id).remove()
  _siteNosChecked = false

  if (avatarUrl.indexOf('cloud://') === 0) {
    try {
      await cloud.deleteFile({ fileList: [avatarUrl] })
    } catch (e) {
      console.warn('[toolsManage] 头像文件删除失败', e)
    }
  }

  // 同时清除本人当天口令
  try {
    const { data } = await db.collection(COMMAND_COLLECTION)
      .where({ owner_openid: openid, date: todayKey() })
      .limit(100)
      .get()
    for (const doc of data) {
      await db.collection(COMMAND_COLLECTION).doc(doc._id).remove()
    }
  } catch (e) {
    console.warn('[toolsManage] 口令清除失败', e)
  }

  return { success: true, cleared: true }
}

/** 读取本人当天的助人次数（跨天自动归零，历史记录清理） */
async function getDailyStats(openid, toolKey) {
  const date = todayKey()
  const col = db.collection(DAILY_COLLECTION)

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()

  const doc = data[0] || {}

  try {
    const { data: stale } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date: db.command.neq(date)
    }).limit(100).get()
    for (const s of stale) {
      await col.doc(s._id).remove()
    }
  } catch (e) {
    console.warn('[toolsManage] 历史次数清理失败', e)
  }

  return {
    success: true,
    date,
    help_used: {
      solo: Number(doc.help_used_solo) || 0,
      team: Number(doc.help_used_team) || 0
    }
  }
}

/** 读当天次数文档（不存在返回 null） */
async function getDailyDoc(openid, toolKey, date) {
  const { data } = await db.collection(DAILY_COLLECTION).where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()
  return data[0] || null
}

/** 云端增减助人次数：唯一可写入口（前端不再传绝对值） */
async function bumpHelpUsed(openid, toolKey, mode, delta) {
  const date = todayKey()
  const field = mode === 'solo' ? 'help_used_solo' : 'help_used_team'
  const col = db.collection(DAILY_COLLECTION)
  const doc = await getDailyDoc(openid, toolKey, date)
  const now = new Date().toISOString()

  if (!doc) {
    if (delta <= 0) return 0
    try {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          date,
          help_used_solo: 0,
          help_used_team: 0,
          [field]: Math.max(0, delta),
          createdAt: now,
          updatedAt: now
        }
      })
    } catch (e) { console.warn('[toolsManage] 次数写入失败', e) }
    return Math.max(0, delta)
  }

  const next = Math.max(0, (Number(doc[field]) || 0) + delta)
  try {
    await col.doc(doc._id).update({ data: { [field]: next, updatedAt: now } })
  } catch (e) { console.warn('[toolsManage] 次数更新失败', e) }
  return next
}

/** 读工具某模式的当天助人/受助上限（个人赛 10/10，车队 PK 6/6 兜底） */
async function getLimits(toolKey, mode) {
  const isTeam = mode === 'team'
  const fallback = { help: isTeam ? 6 : 10, receive: isTeam ? 6 : 10 }
  const norm = (v, def) => (typeof v === 'number' && v > 0 ? v : def)
  try {
    const { data } = await db.collection(COLLECTION).where({ tool_key: toolKey }).limit(1).get()
    const doc = data[0] || {}
    const helpRaw = isTeam ? doc.daily_help_limit_team : doc.daily_help_limit_solo
    const recvRaw = isTeam ? doc.daily_receive_limit_team : doc.daily_receive_limit_solo
    return {
      help: norm(typeof helpRaw === 'number' ? helpRaw : doc.daily_help_limit, fallback.help),
      receive: norm(typeof recvRaw === 'number' ? recvRaw : doc.daily_receive_limit, fallback.receive),
      taskSeconds: norm(doc.task_seconds, 300)
    }
  } catch (e) {
    return { ...fallback, taskSeconds: 300 }
  }
}

/** 保存本人当天的助人次数（兼容旧版客户端；一律钳到上限内，防止刷次数） */
async function saveDailyStats(openid, toolKey, helpUsed) {
  const date = todayKey()
  const col = db.collection(DAILY_COLLECTION)
  const limitsSolo = await getLimits(toolKey, 'solo')
  const limitsTeam = await getLimits(toolKey, 'team')
  const payload = {
    help_used_solo: Math.min(limitsSolo.help, Math.max(0, Number(helpUsed && helpUsed.solo) || 0)),
    help_used_team: Math.min(limitsTeam.help, Math.max(0, Number(helpUsed && helpUsed.team) || 0)),
    updatedAt: new Date().toISOString()
  }

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(1).get()

  if (data.length) {
    await col.doc(data[0]._id).update({ data: payload })
  } else {
    await col.add({
      data: {
        owner_openid: openid,
        tool_key: toolKey,
        date,
        createdAt: new Date().toISOString(),
        ...payload
      }
    })
  }

  return { success: true, date, help_used: { solo: payload.help_used_solo, team: payload.help_used_team } }
}

/**
 * 读取本人今天的口令（两个模式各一条）
 * 非当天记录不返回，并在后台清理
 */
async function getCommands(openid, toolKey) {
  // 先结算超时未确认的待核对任务（受助次数此时才计入）
  await settleExpiredSubmitted(openid, toolKey)
  const date = todayKey()
  const col = db.collection(COMMAND_COLLECTION)

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    date
  }).limit(10).get()

  const commands = { solo: '', team: '' }
  data.forEach((doc) => {
    if (doc.mode === 'solo' || doc.mode === 'team') {
      commands[doc.mode] = doc.command || ''
    }
  })

  // 发布者当天已成功受助数（status=done 的口令数）= 「已安排」次数
  const receive_done = { solo: 0, team: 0 }
  try {
    const { data: doneDocs } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date,
      status: 'done'
    }).limit(100).get()
    doneDocs.forEach((doc) => {
      if (receive_done[doc.mode] !== undefined) receive_done[doc.mode]++
    })
  } catch (e) {
    console.warn('[toolsManage] 受助统计失败', e)
  }

  // 清理该用户该工具的历史口令（只保留当天）
  try {
    const { data: stale } = await col.where({
      owner_openid: openid,
      tool_key: toolKey,
      date: db.command.neq(date)
    }).limit(100).get()
    for (const doc of stale) {
      await col.doc(doc._id).remove()
    }
  } catch (e) {
    console.warn('[toolsManage] 历史口令清理失败', e)
  }

  // 受助机会余额（跨天结转，可为负）
  let quota = { solo: 0, team: 0 }
  try {
    quota = await getQuotaBalance(openid, toolKey)
  } catch (e) {
    console.warn('[toolsManage] 受助机会读取失败', e)
  }

  // 当天助人次数（云端保存，只当天有效）
  let help_used = { solo: 0, team: 0 }
  try {
    const stats = await getDailyStats(openid, toolKey)
    if (stats.success) help_used = stats.help_used
  } catch (e) {
    console.warn('[toolsManage] 次数读取失败', e)
  }

  return { success: true, date, commands, receive_done, help_used, quota }
}

/**
 * 更新今天的口令：存在则覆盖，不存在则新建；留空即删除（支持更新/撤回）
 */
async function saveCommand(openid, toolKey, mode, command) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }

  // 未登记不能发布口令（清空口令不受限）
  if (String(command || '').trim() && !(await isRegistered(openid, toolKey))) {
    return { success: false, error: 'NOT_REGISTERED' }
  }

  const date = todayKey()
  const value = String(command || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 200)
  const col = db.collection(COMMAND_COLLECTION)

  // 内容校验：太短视为无效口令，避免垃圾内容进池
  if (value && value.length < 5) {
    return { success: false, error: 'INVALID_COMMAND' }
  }

  const { data } = await col.where({
    owner_openid: openid,
    tool_key: toolKey,
    mode,
    date
  }).limit(1).get()

  if (!value) {
    if (data.length) await col.doc(data[0]._id).remove()
    return { success: true, date, mode, command: '' }
  }

  // 先助人、后发布：受助机会余额必须 >= 1（注册赠 1，助力 +1，被助力 -1，负数为亏欠）
  if (!data.length) {
    try {
      const quota = await getQuotaBalance(openid, toolKey)
      const balance = mode === 'solo' ? quota.solo : quota.team
      if (balance < 1) {
        return { success: false, error: 'NEED_HELP_FIRST', quota: balance }
      }
    } catch (e) {
      console.warn('[toolsManage] 发布门槛校验失败', e)
    }
  }

  if (data.length) {
    // 口令正被他人领取时不允许改写，避免在途任务信息错乱
    if (data[0].status === 'drawn') {
      return { success: false, error: 'BUSY' }
    }
    await col.doc(data[0]._id).update({
      data: {
        command: value,
        status: 'available', // 内容变更后重新进入口令池
        updatedAt: new Date().toISOString()
      }
    })
  } else {
    await col.add({
      data: {
        owner_openid: openid,
        tool_key: toolKey,
        mode,
        date,
        command: value,
        status: 'available',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    })
  }

  return { success: true, date, mode, command: value }
}

/** 已领取但未回报的任务超过该时长视为异常残留，允许重新进入口令池 */
const TASK_STALE_MS = 6 * 60 * 1000

/** 校验本人是否已登记资料（有昵称）——未登记不能参与口令互助 */
async function isRegistered(openid, toolKey) {
  try {
    const { data } = await db.collection(ACCOUNT_COLLECTION)
      .where({ owner_openid: openid, tool_key: toolKey })
      .limit(1).get()
    return !!(data.length && data[0].tb_nick)
  } catch (e) {
    console.warn('[toolsManage] 登记校验失败', e)
    return false
  }
}

/**
 * 领取口令：从当天同模式口令池随机抽一条非本人的口令
 * 口令状态：available 可抽 / drawn 被领取进行中 / done 已完成永久出池
 * exclude_nicks：前端黑名单 + 刚释放任务的昵称，避免重复抽到
 */
async function drawCommand(openid, toolKey, mode, excludeNicks) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }

  // 未登记不能领取；顺便取本人昵称用于发布者的受助记录
  let myNick = ''
  try {
    const { data: mine } = await db.collection(ACCOUNT_COLLECTION)
      .where({ owner_openid: openid, tool_key: toolKey })
      .limit(1).get()
    if (mine.length && mine[0].tb_nick) {
      myNick = mine[0].tb_nick
    }
  } catch (e) {
    console.warn('[toolsManage] 登记校验失败', e)
  }
  if (!myNick) {
    return { success: false, error: 'NOT_REGISTERED' }
  }

  const date = todayKey()
  const _ = db.command
  const col = db.collection(COMMAND_COLLECTION)

  // 助人次数云端校验（前端可被绕过，必须服务端把关）
  const limits = await getLimits(toolKey, mode)
  const dailyDoc = await getDailyDoc(openid, toolKey, date)
  const usedNow = Number(dailyDoc && (mode === 'solo' ? dailyDoc.help_used_solo : dailyDoc.help_used_team)) || 0
  if (usedNow >= limits.help) {
    return { success: false, error: 'LIMIT_REACHED' }
  }

  // 任务有效期按工具配置，残留回收时间比任务时长多 1 分钟缓冲
  const staleMs = Math.max(TASK_STALE_MS, (limits.taskSeconds || 300) * 1000 + 60 * 1000)
  const staleBefore = new Date(Date.now() - staleMs).toISOString()

  const base = {
    owner_openid: _.neq(openid),
    tool_key: toolKey,
    mode,
    date,
    // 同一人领取过的口令不再重复领取（退池后其他人仍可抽到）
    helped_openids: _.nin([openid])
  }
  const { data } = await col.where(_.or([
    { ...base, status: _.exists(false) },
    { ...base, status: 'available' },
    { ...base, status: 'drawn', drawn_at: _.lt(staleBefore) }
  ])).limit(50).get()

  if (!data.length) {
    return { success: true, matched: false }
  }

  // 发布者展示资料
  let byOpenid = {}
  try {
    const { data: accounts } = await db.collection(ACCOUNT_COLLECTION)
      .where({ tool_key: toolKey })
      .limit(200)
      .get()
    accounts.forEach((a) => { byOpenid[a.owner_openid] = a })
  } catch (e) {
    console.warn('[toolsManage] 发布者资料读取失败', e)
  }

  // 发布者当天已占用名额（已确认 + 待核对），满额的口令不再参与抽取
  const doneByOwner = {}
  try {
    const $ = db.command.aggregate
    const aggRes = await col.aggregate()
      .match({ tool_key: toolKey, mode, date, status: _.in(['done', 'submitted']) })
      .group({ _id: '$owner_openid', n: $.sum(1) })
      .end()
    ;(aggRes.list || []).forEach((r) => { doneByOwner[r._id] = r.n })
  } catch (e) {
    console.warn('[toolsManage] 受助统计失败', e)
  }

  const isTeamMode = mode === 'team'

  // 发布者受助机会（余额 < 1 即亏欠）→ 其口令不参与抽取，避免超支用户占池
  const quotaMap = {}
  try {
    const owners = [...new Set(data.map((d) => d.owner_openid).filter(Boolean))]
    if (owners.length) {
      const { data: qdocs } = await db.collection(QUOTA_COLLECTION)
        .where({ owner_openid: db.command.in(owners), tool_key: toolKey })
        .limit(100).get()
      const field = isTeamMode ? 'balance_team' : 'balance_solo'
      qdocs.forEach((q) => {
        // 余额原样读取（不按天补充）；无账本说明从未发布过口令，不会出现在候选里
        quotaMap[q.owner_openid] = (Number(q[field]) || 0)
      })
    }
  } catch (e) {
    console.warn('[toolsManage] 受助机会批量读取失败', e)
  }

  const exclude = new Set(Array.isArray(excludeNicks) ? excludeNicks : [])
  const candidates = data.filter((d) => {
    if (!d.command) return false
    const acc = byOpenid[d.owner_openid] || {}
    // 发布者已暂停该模式受助 → 口令不参与抽取
    if (isTeamMode ? acc.paused_team : acc.paused_solo) return false
    // 发布者受助机会不足（亏欠）→ 不参与抽取
    const q = quotaMap[d.owner_openid]
    if (q !== undefined && q < 1) return false
    // 受助名额：取「本人设置」与「工具上限」的较小值，两者都不可突破
    const ownQuota = isTeamMode ? acc.quota_team : acc.quota_solo
    const cap = Math.min(
      typeof ownQuota === 'number' && ownQuota > 0 ? ownQuota : limits.receive,
      limits.receive
    )
    if ((doneByOwner[d.owner_openid] || 0) >= cap) return false
    return !exclude.has(acc.tb_nick || '')
  })

  if (!candidates.length) {
    return { success: true, matched: false }
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)]

  // 这条口令是否从超时未回报的旧持有者手里回收
  const prevHolder = pick.holder_openid || ''
  const prevStale = pick.status === 'drawn' && !!pick.drawn_at && String(pick.drawn_at) < staleBefore

  // 标记占用：仅可占用未被领取/已回池/超时残留的口令
  // 已提交待核对（submitted）与已完成（done）的口令绝不能被二次领取
  const claim = await col.where(_.and([
    { _id: pick._id },
    _.or([
      { status: _.exists(false) },
      { status: 'available' },
      { status: 'drawn' }
    ])
  ])).update({
    data: {
      status: 'drawn',
      holder_openid: openid,
      drawn_at: new Date().toISOString(),
      helped_openids: _.push([openid])
    }
  })
  if (!claim.stats || claim.stats.updated === 0) {
    return { success: true, matched: false }
  }

  // 领取成功即扣 1 次助人（云端唯一扣减点）
  await bumpHelpUsed(openid, toolKey, mode, 1)
  // 回收超时任务时，旧持有者未回报的次数退回，避免次数被吞
  if (prevHolder && prevHolder !== openid && prevStale) {
    await bumpHelpUsed(prevHolder, toolKey, mode, -1)
    // 旧持有者的进行中记录也一并了结
    try {
      const recCol = db.collection(RECORD_COLLECTION)
      await recCol.where({ command_id: pick._id, type: 'help', status: 'ongoing' })
        .update({ data: { status: 'returned' } })
      await recCol.where({ command_id: pick._id, type: 'receive', status: 'ongoing' })
        .remove()
    } catch (e) { console.warn('[toolsManage] 旧任务记录清理失败', e) }
  }

  const acc = byOpenid[pick.owner_openid] || {}
  const now = new Date().toISOString()

  // 云端记录：助人（领取者）+ 受助（发布者），完成/退回时同步状态
  try {
    await ensureCollection(RECORD_COLLECTION)
    const recCol = db.collection(RECORD_COLLECTION)
    const base = {
      tool_key: toolKey,
      mode,
      date,
      command_id: pick._id,
      command: pick.command,
      status: 'ongoing',
      created_at: now
    }
    await recCol.add({ data: { ...base, owner_openid: openid, type: 'help', nick: acc.tb_nick || '淘友' } })
    await recCol.add({ data: { ...base, owner_openid: pick.owner_openid, type: 'receive', nick: myNick } })
  } catch (e) {
    console.warn('[toolsManage] 记录写入失败', e)
  }

  return {
    success: true,
    matched: true,
    task: {
      task_id: pick._id,
      command: pick.command,
      nick: acc.tb_nick || '淘友',
      avatar_url: acc.avatar_url || '',
      site_no: acc.site_no || 0
    }
  }
}

/** 待核对自动通过窗口：10 分钟未确认视为通过（防受助方赖着不确认） */
const CONFIRM_WINDOW_MS = 10 * 60 * 1000

/**
 * 受助机会账本（跨天结转，可为负）
 * 规则：注册即赠 1 次；成功助力他人 +1；被他人助力 -1
 * 不会按天自动补充，亏欠（负数）原样结转到次日，需靠继续助力补齐
 */
async function getQuotaBalance(openid, toolKey) {
  const col = db.collection(QUOTA_COLLECTION)
  const today = todayKey()
  let doc = null
  try {
    const { data } = await col.where({ owner_openid: openid, tool_key: toolKey }).limit(1).get()
    doc = data[0] || null
  } catch (e) {
    console.warn('[toolsManage] 受助机会读取失败', e)
  }

  // 首次建立账本 = 注册赠送 1 次；已有账本则余额原样保留（不按天补充）
  const solo = doc ? (Number(doc.balance_solo) || 0) : 1
  const team = doc ? (Number(doc.balance_team) || 0) : 1

  if (doc) {
    if (doc.last_date !== today) {
      try {
        await col.doc(doc._id).update({
          data: { last_date: today, updatedAt: new Date().toISOString() }
        })
      } catch (e) { /* 忽略 */ }
    }
  } else {
    try {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          balance_solo: solo,
          balance_team: team,
          last_date: today,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      })
    } catch (e) { /* 忽略 */ }
  }

  return { solo, team }
}

/** 增减受助机会余额 */
async function bumpQuota(openid, toolKey, mode, delta) {
  if (mode !== 'solo' && mode !== 'team') return 0
  const cur = await getQuotaBalance(openid, toolKey)
  const next = (mode === 'solo' ? cur.solo : cur.team) + delta
  const col = db.collection(QUOTA_COLLECTION)
  try {
    const { data } = await col.where({ owner_openid: openid, tool_key: toolKey }).limit(1).get()
    const field = mode === 'solo' ? 'balance_solo' : 'balance_team'
    if (data.length) {
      await col.doc(data[0]._id).update({
        data: { [field]: next, updatedAt: new Date().toISOString() }
      })
    } else {
      await col.add({
        data: {
          owner_openid: openid,
          tool_key: toolKey,
          balance_solo: mode === 'solo' ? next : 0,
          balance_team: mode === 'team' ? next : 0,
          last_date: todayKey(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      })
    }
  } catch (e) {
    console.warn('[toolsManage] 受助机会更新失败', e)
  }
  return next
}

/** 助力完成时的额度结算：助力方 +1（获得受助机会），发布方 -1（占用受助名额） */
async function applyQuotaOnDone(doc) {
  if (!doc || (doc.mode !== 'solo' && doc.mode !== 'team')) return
  if (doc.holder_openid) await bumpQuota(doc.holder_openid, doc.tool_key, doc.mode, 1)
  if (doc.owner_openid) await bumpQuota(doc.owner_openid, doc.tool_key, doc.mode, -1)
}

/**
 * 回报任务结果：
 * - submitted：助力方提交结果（车队必须带截图），等待受助方核对
 * - available：退回池中（失败/超时/换一个）
 * 助力方不能直接把状态改成 done，必须由受助方确认或超时自动通过
 */
async function setCommandStatus(openid, taskId, status, proofFileId) {
  if (status !== 'submitted' && status !== 'available') {
    return { success: false, error: 'INVALID_STATUS' }
  }

  const col = db.collection(COMMAND_COLLECTION)
  let doc = null
  try {
    const res = await col.doc(taskId).get()
    doc = res.data
  } catch (e) {
    return { success: false, error: 'NOT_FOUND' }
  }

  if (!doc || doc.holder_openid !== openid) {
    return { success: false, error: 'FORBIDDEN' }
  }

  // 已提交待核对的任务不能退回池中（已实际助力过，只能等核对/自动通过）
  if (status === 'available' && (doc.status === 'submitted' || doc.status === 'done')) {
    return { success: false, error: 'ALREADY_SUBMITTED' }
  }

  const data = { status, updatedAt: new Date().toISOString() }
  if (status === 'available') {
    data.holder_openid = ''
    data.drawn_at = ''
    // 退回即退次数（云端唯一退还点；重复调用会因 holder 已清空而 FORBIDDEN，不会多退）
    if (doc.status === 'drawn') {
      await bumpHelpUsed(openid, doc.tool_key, doc.mode, -1)
    }
  }
  if (status === 'submitted') {
    if (doc.status === 'submitted') {
      return { success: false, error: 'ALREADY_SUBMITTED' }
    }
    // 车队助力必须上传截图凭证
    const proof = String(proofFileId || '').trim().slice(0, 300)
    if (doc.mode === 'team' && !proof) {
      return { success: false, error: 'PROOF_REQUIRED' }
    }
    data.status = 'submitted'
    data.submitted_at = new Date().toISOString()
    if (proof) data.proof_file_id = proof
  }
  await col.doc(taskId).update({ data })

  // 同步互助记录：submitted → 两边置「待核对」；退回 → 助人记录标已放回、删除受助记录
  try {
    const recCol = db.collection(RECORD_COLLECTION)
    if (status === 'submitted') {
      const proof = String(proofFileId || '').trim().slice(0, 300)
      const recPatch = { status: 'pending' }
      if (proof) recPatch.proof_file_id = proof
      await recCol.where({ command_id: taskId, type: 'help', status: 'ongoing' })
        .update({ data: recPatch })
      await recCol.where({ command_id: taskId, type: 'receive', status: 'ongoing' })
        .update({ data: { status: 'pending' } })
    } else {
      await recCol.where({ command_id: taskId, type: 'help', status: 'ongoing' })
        .update({ data: { status: 'returned' } })
      await recCol.where({ command_id: taskId, type: 'receive', status: 'ongoing' })
        .remove()
    }
  } catch (e) {
    console.warn('[toolsManage] 记录状态同步失败', e)
  }

  return { success: true, status }
}

/** 受助方核对确认：submitted → done（受助次数由此计入） */
async function confirmReceive(openid, taskId) {
  const col = db.collection(COMMAND_COLLECTION)
  let doc = null
  try {
    const res = await col.doc(taskId).get()
    doc = res.data
  } catch (e) {
    return { success: false, error: 'NOT_FOUND' }
  }
  if (!doc || doc.owner_openid !== openid) {
    return { success: false, error: 'FORBIDDEN' }
  }
  if (doc.status !== 'submitted') {
    return { success: false, error: 'INVALID_STATUS' }
  }

  const now = new Date().toISOString()
  await col.doc(taskId).update({ data: { status: 'done', done_at: now, updatedAt: now } })

  // 额度结算：助力方 +1 受助机会，发布方 -1
  await applyQuotaOnDone(doc)

  try {
    const recCol = db.collection(RECORD_COLLECTION)
    await recCol.where({ command_id: taskId, type: 'help', status: 'pending' })
      .update({ data: { status: 'done' } })
    await recCol.where({ command_id: taskId, type: 'receive', status: 'pending' })
      .update({ data: { status: 'done' } })
  } catch (e) {
    console.warn('[toolsManage] 确认后记录同步失败', e)
  }

  return { success: true }
}

/**
 * 待核对超时自动通过：10 分钟内未确认则视为通过
 * 双方任意一方上线（查次数/查记录）都会触发，防止任何一方赖着不确认
 */
async function settleExpiredSubmitted(openid, toolKey) {
  try {
    const col = db.collection(COMMAND_COLLECTION)
    const _ = db.command
    const before = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString()
    const base = {
      tool_key: toolKey,
      status: 'submitted',
      submitted_at: _.lt(before)
    }
    // 本人发布的（受助方视角）+ 本人领取的（助力方视角）
    const [ownRes, heldRes] = await Promise.all([
      col.where({ ...base, owner_openid: openid }).limit(4).get(),
      col.where({ ...base, holder_openid: openid }).limit(4).get()
    ])
    const targets = [...(ownRes.data || []), ...(heldRes.data || [])]
    if (!targets.length) return

    const recCol = db.collection(RECORD_COLLECTION)
    const now = new Date().toISOString()
    const seen = new Set()
    for (const d of targets) {
      // 单次最多结算 5 条，控制云函数耗时；剩余的下次调用继续
      if (seen.size >= 5) break
      if (seen.has(d._id)) continue
      seen.add(d._id)
      try {
        await col.doc(d._id).update({ data: { status: 'done', done_at: now, updatedAt: now } })
        await applyQuotaOnDone(d)
        await recCol.where({ command_id: d._id, status: 'pending' })
          .update({ data: { status: 'done' } })
      } catch (e) { /* 单条失败不影响其它 */ }
    }
  } catch (e) {
    console.warn('[toolsManage] 待核对自动通过失败', e)
  }
}

/** 读取本人互助记录（助人/受助，跨天保留，最近 50 条） */
async function getRecords(openid, toolKey, mode, type) {
  if (mode !== 'solo' && mode !== 'team') {
    return { success: false, error: 'INVALID_MODE' }
  }
  if (type !== 'help' && type !== 'receive') {
    return { success: false, error: 'INVALID_TYPE' }
  }

  const recCol = db.collection(RECORD_COLLECTION)
  const _ = db.command

  // 先结算超时未确认的待核对任务（双方任意一方查看记录都会触发）
  await settleExpiredSubmitted(openid, toolKey)

  // 状态校正：任务有效期 5 分钟 + 6 分钟残留回池，超 12 分钟仍是进行中的必然已中断
  // （用户杀小程序/回报丢失）。助人记录标已放回；发布者的受助记录删除。
  try {
    const staleBefore = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    await recCol.where({
      owner_openid: openid, tool_key: toolKey, mode, type: 'help',
      status: 'ongoing', created_at: _.lt(staleBefore)
    }).update({ data: { status: 'returned' } })
    await recCol.where({
      owner_openid: openid, tool_key: toolKey, mode, type: 'receive',
      status: 'ongoing', created_at: _.lt(staleBefore)
    }).remove()
    // 顺带清理 30 天前的历史记录
    const oldBefore = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    await recCol.where({ owner_openid: openid, created_at: _.lt(oldBefore) }).remove()
  } catch (e) {
    console.warn('[toolsManage] 记录校正失败', e)
  }

  const { data } = await recCol
    .where({ owner_openid: openid, tool_key: toolKey, mode, type })
    .orderBy('created_at', 'desc')
    .limit(50)
    .get()

  return { success: true, records: data }
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

exports.main = async (event) => {
  const action = event.action || 'list'

  try {
    if (action === 'list') {
      const ready = await ensureCollection(COLLECTION)
      if (!ready) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }

      await ensureDefaultTools()

      const { data } = await db.collection(COLLECTION)
        .where({ status: 'online' })
        .orderBy('sort', 'asc')
        .limit(100)
        .get()

      // 彻底合并：decode 已并入 scan（扫一扫 · 解码），历史残留文档不下发
      const list = data.filter(doc => doc.tool_key !== 'decode')

      return {
        success: true,
        tools: list.map(pick),
        count: list.length
      }
    }

    if (action === 'getCommands' || action === 'saveCommand' || action === 'drawCommand' || action === 'updateCommandStatus' || action === 'saveDailyStats' || action === 'getRecords') {
      const wxContext = cloud.getWXContext()
      const openid = wxContext.OPENID
      if (!openid) {
        return { success: false, error: 'NO_OPENID' }
      }

      const ready = await ensureCollection(COMMAND_COLLECTION)
      if (!ready) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }
      await ensureCollection(RECORD_COLLECTION)
      await ensureCollection(QUOTA_COLLECTION)

      const toolKey = String(event.tool_key || '').slice(0, 40)

      if (action === 'getCommands') {
        return await getCommands(openid, toolKey)
      }

      if (action === 'drawCommand') {
        return await drawCommand(openid, toolKey, event.mode, event.exclude_nicks)
      }

      if (action === 'updateCommandStatus') {
        return await setCommandStatus(openid, event.task_id, event.status, event.proof_file_id)
      }

      if (action === 'confirmReceive') {
        return await confirmReceive(openid, event.task_id)
      }

      if (action === 'saveDailyStats') {
        const readyDaily = await ensureCollection(DAILY_COLLECTION)
        if (!readyDaily) {
          return { success: false, error: 'COLLECTION_UNAVAILABLE' }
        }
        return await saveDailyStats(openid, toolKey, event.help_used || {})
      }

      if (action === 'getRecords') {
        const readyRecords = await ensureCollection(RECORD_COLLECTION)
        if (!readyRecords) {
          return { success: false, error: 'COLLECTION_UNAVAILABLE' }
        }
        return await getRecords(openid, toolKey, event.mode, event.type)
      }

      return await saveCommand(openid, toolKey, event.mode, event.command)
    }

    if (action === 'getAccount' || action === 'saveAccount' || action === 'clearAccount' || action === 'setHelpPause' || action === 'setHelpQuota') {
      const wxContext = cloud.getWXContext()
      const openid = wxContext.OPENID
      if (!openid) {
        return { success: false, error: 'NO_OPENID' }
      }

      const ready = await ensureCollection(ACCOUNT_COLLECTION)
      if (!ready) {
        return { success: false, error: 'COLLECTION_UNAVAILABLE' }
      }

      // 兼容早期哈希编号：按登记顺序重排（只在实例内首次执行）
      await ensureSiteNos()

      if (action === 'getAccount') {
        const account = await getAccount(openid)
        return { success: true, account }
      }

      if (action === 'clearAccount') {
        return await clearAccount(openid)
      }

      if (action === 'setHelpPause') {
        return await setHelpPause(openid, toolKey, event.mode, !!event.paused)
      }

      if (action === 'setHelpQuota') {
        return await setHelpQuota(openid, toolKey, event.mode, event.quota)
      }

      return await saveAccount(openid, event.account || {})
    }

    return { success: false, error: 'UNKNOWN_ACTION' }
  } catch (e) {
    console.error('[toolsManage] 操作失败', action, e)
    return { success: false, error: e.message || 'FAILED' }
  }
}

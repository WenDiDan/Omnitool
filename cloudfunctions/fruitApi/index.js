/**
 * 多多水果互助（拼多多果园口令互换广场）
 *
 * 独立云函数：与 toolsManage 完全解耦，业务集合自建
 *   fruit_links  口令/链接广场（一人一条，重复发布即更新）
 *   fruit_helps  领取记录（openid + link_id 去重，含券码快照）
 *
 * 动作：
 *   publish { content }   发布口令（可多次发布，每人最多 5 条）
 *   mine                  查自己发布的口令列表（含领取状态）
 *   list   { offset }     广场分页（按更新时间倒序，仅待组队 active；附可用总数）
 *   help   { id }         领取（复制由前端完成；一码一人，原子抢占唯一名额）
 *   auto                  智能直达：自动领取最新可用邀请码并返回券码
 *   used                  我使用的记录（我领取过的券码，倒序）
 *   reset  { id }         发布者重置：领取者未完成组队时放回广场
 *   remove { id }         下架自己的邀请码
 *   ocr    { fileID }     相册识别：OCR 从海报图中提取邀请码
 */
const cloud = require('wx-server-sdk')
const https = require('https')
const { bjTime } = require('./_shared/time')
const { ensureCollection: ensureCollectionShared } = require('./_shared/db')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const LINK_COLLECTION = 'fruit_links'
const HELP_COLLECTION = 'fruit_helps'
const USERS_COLLECTION = 'users'

const MAX_CONTENT_LEN = 200
const PAGE_SIZE = 20
const MAX_LIST = 500
const MAX_LINKS_PER_USER = 5 // 每人最多同时发布的口令条数
const DAILY_HELP_LIMIT = 50 // 每人每日领取上限（help + auto 共用）
const OCR_FILE_PREFIX = 'fruit-ocr/' // OCR 仅允许读取本工具上传目录，防止借临时链接读取云存储任意文件

/** 管理后台同款黑名单域名，防止把导流口令发进广场 */
function isBlacklisted(text) { return /ujd6\.cn/i.test(text) }

// ===== 轻量限流（实例级内存窗口计数；多实例下不严格，足以拦截脚本滥用）=====
const rateMap = new Map()
function rateLimited(key, windowMs, max) {
  const nowTs = Date.now()
  const arr = (rateMap.get(key) || []).filter(t => nowTs - t < windowMs)
  const blocked = arr.length >= max
  if (!blocked) arr.push(nowTs)
  rateMap.set(key, arr)
  if (rateMap.size > 5000) {
    for (const [k, v] of rateMap) {
      if (!v.some(t => nowTs - t < windowMs)) rateMap.delete(k)
    }
  }
  return blocked
}

/** 每日领取次数（help/auto 共用额度），created_at 为北京时间字符串可直接字典序比较 */
async function dailyHelpCount(openid) {
  const today = bjTime(new Date().toISOString()).slice(0, 10)
  const res = await db.collection(HELP_COLLECTION)
    .where({ openid, created_at: _.gte(`${today} 00:00:00`) })
    .count()
  return res.total || 0
}

/** 后台封禁（role=blocked）判断：查不到或异常一律按未封禁处理 */
async function isBlockedUser(openid) {
  try {
    const { data } = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get()
    return !!(data[0] && data[0].role === 'blocked')
  } catch (e) {
    console.warn('[fruitApi] 封禁状态查询失败', e)
    return false
  }
}

/** 确保两个集合存在（首次调用时创建，幂等） */
async function ensureCollections() {
  await ensureCollectionShared(db, LINK_COLLECTION, 'fruitApi')
  await ensureCollectionShared(db, HELP_COLLECTION, 'fruitApi')
}

/** 校验邀请码：从粘贴文案中提取 8-9 位连续数字段（与前端同一规则，服务端兜底） */
function validateContent(raw) {
  const text = String(raw || '').trim()
  if (!text) return { error: '请粘贴 8-9 位数字邀请码' }
  if (text.length > MAX_CONTENT_LEN) return { error: `内容过长（最多 ${MAX_CONTENT_LEN} 字）` }
  if (isBlacklisted(text)) return { error: '内容包含被限制的域名，禁止发布' }

  const re = /\d+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[0].length >= 8 && m[0].length <= 9) return { content: m[0] }
  }
  return { error: '未识别到 8-9 位数字邀请码' }
}

/** 广场卡片展示用：openid 尾号作匿名标识 */
function ownerTagOf(openid) {
  return `果友#${String(openid || '').slice(-4)}`
}

/** 发布口令：支持多次发布，每次新增一条（同一口令不重复、总量有上限） */
async function handlePublish(openid, payload) {
  const check = validateContent(payload && payload.content)
  if (check.error) return { success: false, error: check.error }
  if (await isBlockedUser(openid)) return { success: false, error: '账号状态异常，无法发布' }
  if (rateLimited(`pub_${openid}`, 10000, 3)) return { success: false, error: '发布太频繁，请稍后再试' }

  await ensureCollections()
  const now = bjTime(new Date().toISOString())

  // 同一口令已在待组队状态：不重复占用名额
  const dup = await db.collection(LINK_COLLECTION)
    .where({ openid, content: check.content, status: 'active' })
    .limit(1)
    .get()
  if (dup.data.length) return { success: false, error: '这条口令已在广场中，无需重复发布' }

  // 发布总量上限，防止刷屏
  const cnt = await db.collection(LINK_COLLECTION).where({ openid }).count()
  if ((cnt.total || 0) >= MAX_LINKS_PER_USER) {
    return { success: false, error: `最多同时发布 ${MAX_LINKS_PER_USER} 条口令，请先下架部分` }
  }

  const added = await db.collection(LINK_COLLECTION).add({
    data: {
      openid,
      content: check.content,
      status: 'active',
      help_count: 0,
      created_at: now,
      updated_at: now,
      _v: 0
    }
  })
  return { success: true, data: { id: added._id, created: true } }
}

/** 查自己发布的口令（多条，含已领取状态，供展示与逐条重置/下架） */
async function handleMine(openid) {
  await ensureCollections()
  const { data } = await db.collection(LINK_COLLECTION)
    .where({ openid })
    .orderBy('created_at', 'desc')
    .limit(MAX_LINKS_PER_USER)
    .get()

  const items = (data || []).map(doc => ({
    id: doc._id,
    content: doc.content,
    status: doc.status || 'active',
    help_count: doc.help_count || 0,
    claimed_at: doc.claimed_at || '',
    updated_at: doc.updated_at || ''
  }))

  return { success: true, data: { items } }
}

/** 广场分页：按更新时间倒序，展示全部可用口令（自己的带标记）；附可用总数 */
async function handleList(openid, payload) {
  await ensureCollections()
  const offset = Math.max(0, parseInt((payload && payload.offset) || 0, 10) || 0)
  if (offset > MAX_LIST) return { success: true, data: { items: [], hasMore: false, total: 0 } }

  const cond = { status: 'active' }
  const { data } = await db.collection(LINK_COLLECTION)
    .where(cond)
    .orderBy('updated_at', 'desc')
    .skip(offset)
    .limit(PAGE_SIZE + 1)
    .get()

  // 可用总数：只在首页请求时统计，翻页不重复计数
  let total = 0
  if (offset === 0) {
    try {
      const cnt = await db.collection(LINK_COLLECTION).where(cond).count()
      total = cnt.total || 0
    } catch (e) {
      console.warn('[fruitApi] 统计可用数量失败', e)
      total = Math.min(data.length, PAGE_SIZE)
    }
  }

  const hasMore = data.length > PAGE_SIZE
  const items = data.slice(0, PAGE_SIZE).map(doc => ({
    id: doc._id,
    content: doc.content,
    help_count: doc.help_count || 0,
    updated_at: doc.updated_at || '',
    owner_tag: ownerTagOf(doc.openid),
    is_mine: doc.openid === openid
  }))

  return { success: true, data: { items, hasMore, total } }
}

/**
 * 去助力 = 抢占唯一名额（一码一人，组队完成后即失效）
 * 原子条件更新：仅当 status 仍为 active 时写入 claimed，天然防并发重复领取
 */
async function handleHelp(openid, payload) {
  const id = String((payload && payload.id) || '')
  if (!id) return { success: false, error: '缺少邀请码标识' }
  if (await isBlockedUser(openid)) return { success: false, error: '账号状态异常' }

  await ensureCollections()

  // 每日领取额度：防脚本刷光广场名额（help 与 auto 共用）
  const helpedToday = await dailyHelpCount(openid)
  if (helpedToday >= DAILY_HELP_LIMIT) {
    return { success: false, error: `今日领取已达上限（${DAILY_HELP_LIMIT} 次），明天再来` }
  }
  if (rateLimited(`help_${openid}`, 60000, 20)) {
    return { success: false, error: '操作太频繁，请稍后再试' }
  }

  const now = bjTime(new Date().toISOString())
  // openid neq(openid) 兜底：自己发布的口令不可被自己领取
  const res = await db.collection(LINK_COLLECTION)
    .where({ _id: id, status: 'active', openid: _.neq(openid) })
    .update({
      data: { status: 'claimed', claimed_by: openid, claimed_at: now, help_count: _.inc(1) }
    })

  if (res.stats && res.stats.updated > 0) {
    // 券码快照一律回读服务端文档，不信任客户端传值（防伪造记录内容）
    let snapshot = ''
    try {
      const { data } = await db.collection(LINK_COLLECTION).doc(id).get()
      snapshot = String((data && data.content) || '')
    } catch (e) { /* 回查失败留空，不影响领取 */ }
    // 领取记录（每码每人仅一条，_id 固定，失败忽略不影响领取）
    try {
      await db.collection(HELP_COLLECTION).add({
        data: { _id: `${id}_${openid}`, openid, link_id: id, content: snapshot.slice(0, MAX_CONTENT_LEN), created_at: now }
      })
    } catch (e) { /* 重复记录仅影响审计，不影响主流程 */ }
    return { success: true, data: { claimed: true } }
  }

  // 未抢到：查明现状给出精确提示
  const { data } = await db.collection(LINK_COLLECTION).doc(id).get().catch(() => ({ data: null }))
  if (!data) return { success: false, error: '该邀请码已下架' }
  if (data.openid === openid) {
    return { success: false, error: '不能领取自己发布的邀请码，请到「我的记录」查看' }
  }
  if (data.status === 'claimed' && data.claimed_by === openid) {
    return { success: true, data: { claimed: false, own: true, message: '你已领取过这条邀请码，去拼多多搜索即可' } }
  }
  if (data.status === 'claimed') return { success: false, error: '手慢了，这条邀请码已被其他果友领取' }
  return { success: false, error: '该邀请码已下架' }
}

/**
 * 智能直达：自动取最新可用邀请码并抢占名额
 * 并发下可能被他人抢先，最多重试 3 次换下一条，避免用户反复手点
 */
async function handleAuto(openid) {
  if (await isBlockedUser(openid)) return { success: false, error: '账号状态异常' }
  await ensureCollections()

  // 每日领取额度 + 频率限制（与 help 共用额度）
  const helpedToday = await dailyHelpCount(openid)
  if (helpedToday >= DAILY_HELP_LIMIT) {
    return { success: false, error: `今日领取已达上限（${DAILY_HELP_LIMIT} 次），明天再来` }
  }
  if (rateLimited(`help_${openid}`, 60000, 20)) {
    return { success: false, error: '操作太频繁，请稍后再试' }
  }

  for (let i = 0; i < 3; i++) {
    const { data } = await db.collection(LINK_COLLECTION)
      .where({ status: 'active', openid: _.neq(openid) })
      .orderBy('updated_at', 'desc')
      .limit(1)
      .get()

    const doc = data[0]
    if (!doc) {
      return { success: false, error: i === 0 ? '广场暂时没有可领取的邀请码，先发布自己的吧' : '手慢了，请刷新后重试' }
    }

    const now = bjTime(new Date().toISOString())
    const res = await db.collection(LINK_COLLECTION)
      .where({ _id: doc._id, status: 'active' })
      .update({
        data: { status: 'claimed', claimed_by: openid, claimed_at: now, help_count: _.inc(1) }
      })

    if (res.stats && res.stats.updated > 0) {
      try {
        await db.collection(HELP_COLLECTION).add({
          data: { _id: `${doc._id}_${openid}`, openid, link_id: doc._id, content: doc.content || '', created_at: now }
        })
      } catch (e) { /* 重复记录不影响领取 */ }
      return { success: true, data: { claimed: true, id: doc._id, content: doc.content || '' } }
    }
  }

  return { success: false, error: '手慢了，请刷新后重试' }
}

/** 我使用的：我领取过的邀请码记录（倒序，含券码快照） */
async function handleUsed(openid) {
  await ensureCollections()

  let records = []
  try {
    const { data } = await db.collection(HELP_COLLECTION)
      .where({ openid })
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()
    records = data || []
  } catch (e) {
    console.warn('[fruitApi] 读取领取记录失败', e)
    return { success: true, data: { items: [] } }
  }

  // 老记录没有券码快照：回查原链接补内容（链接可能已被下架，取不到就留空）
  const missing = records.filter(r => !r.content && r.link_id).map(r => r.link_id)
  const contentMap = {}
  if (missing.length) {
    try {
      const { data } = await db.collection(LINK_COLLECTION)
        .where({ _id: _.in(missing) })
        .limit(50)
        .get()
      ;(data || []).forEach(d => { contentMap[d._id] = d.content || '' })
    } catch (e) { /* 忽略回查失败 */ }
  }

  const items = records.map(r => ({
    id: r._id,
    link_id: r.link_id || '',
    content: r.content || contentMap[r.link_id] || '',
    created_at: r.created_at || ''
  }))

  return { success: true, data: { items } }
}

/** 发布者重置：领取者未完成组队时，把名额放回广场 */
async function handleReset(openid, payload) {
  const id = String((payload && payload.id) || '')
  if (!id) return { success: false, error: '缺少邀请码标识' }
  await ensureCollections()

  const { data } = await db.collection(LINK_COLLECTION).doc(id).get().catch(() => ({ data: null }))
  if (!data) return { success: false, error: '邀请码不存在或已下架' }
  if (data.openid !== openid) return { success: false, error: '只能重置自己的邀请码' }
  if (data.status !== 'claimed') return { success: false, error: '该邀请码不在待组队状态' }

  await db.collection(LINK_COLLECTION).doc(id).update({
    data: { status: 'active', claimed_by: _.remove(), claimed_at: _.remove(), updated_at: bjTime(new Date().toISOString()) }
  })
  return { success: true, data: { reseted: true } }
}

/** 下架自己的口令（硬删，可重新发布） */
async function handleRemove(openid, payload) {
  const id = String((payload && payload.id) || '')
  if (!id) return { success: false, error: '缺少口令标识' }
  await ensureCollections()

  const { data } = await db.collection(LINK_COLLECTION).doc(id).get().catch(() => ({ data: null }))
  if (!data) return { success: false, error: '口令不存在或已下架' }
  if (data.openid !== openid) return { success: false, error: '只能下架自己的口令' }

  await db.collection(LINK_COLLECTION).doc(id).remove()
  return { success: true, data: { removed: true } }
}

/** 下载图片为 Buffer（跟随重定向，云函数内不受小程序域名白名单限制） */
function downloadImage(url, depth = 0) {
  if (depth > 3) return Promise.reject(new Error('重定向次数过多'))
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const loc = res.headers.location
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        return downloadImage(loc, depth + 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

/** 从 OCR 返回结构中拼出全文 */
function ocrTextOf(ocrRes) {
  const out = (ocrRes && ocrRes.result) || ocrRes || {}
  const items = out.items || []
  return items.map(it => it && it.text).filter(Boolean).join(' ') || out.print_text || ''
}

/** 提取邀请码（恰好 8-9 位连续数字段） */
function pickCode(text) {
  const re = /\d+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[0].length >= 8 && m[0].length <= 9) return m[0]
  }
  return ''
}

/**
 * 相册识别：从分享海报图片中 OCR 识别 8-9 位邀请码
 * 优先 imgUrl 直调；失败（如 101003 图片获取异常）时降级为下载图片转 base64 直传
 */
async function handleOcr(openid, payload) {
  const fileID = String((payload && payload.fileID) || '')
  // 只接受本工具上传目录内的文件：防止借 getTempFileURL 读取云存储任意文件（他人头像等）
  if (!fileID || !new RegExp(`^cloud://[^/]+/([^/]+/)*${OCR_FILE_PREFIX}`).test(fileID)) {
    return { success: false, error: '缺少识别图片' }
  }
  if (await isBlockedUser(openid)) return { success: false, error: '账号状态异常' }
  // OCR 接口有平台配额，限流防刷（每分钟 5 次）
  if (rateLimited(`ocr_${openid}`, 60000, 5)) {
    return { success: false, error: '识别太频繁，请一分钟后再试' }
  }

  let url = ''
  try {
    const urlRes = await cloud.getTempFileURL({ fileList: [fileID] })
    url = urlRes && urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL
  } catch (e) {
    console.warn('[fruitApi] OCR 临时链接获取失败', e)
    return { success: false, error: `图片读取失败：${(e && (e.errMsg || e.message)) || '未知错误'}` }
  }
  if (!url) return { success: false, error: '图片读取失败，请重试' }

  let text = ''
  try {
    text = ocrTextOf(await cloud.openapi.ocr.printedText({ type: 'photo', imgUrl: url }))
  } catch (e1) {
    console.warn('[fruitApi] imgUrl 方式失败，降级 base64 重试', (e1 && (e1.errCode || e1.errMsg)) || e1)
    try {
      const buf = await downloadImage(url)
      if (!buf.length) return { success: false, error: '图片下载为空，请重试' }
      if (buf.length > 4 * 1024 * 1024) return { success: false, error: '图片过大，请截取关键区域后重试' }
      text = ocrTextOf(await cloud.openapi.ocr.printedText({ type: 'photo', img: buf.toString('base64') }))
    } catch (e2) {
      console.error('[fruitApi] OCR base64 方式仍失败', e2)
      const d = e2 || {}
      return { success: false, error: `识别失败：${d.errCode || ''} ${d.errMsg || d.message || '未知错误'}` }
    }
  }

  if (!text) {
    console.warn('[fruitApi] OCR 返回为空', url.slice(0, 80))
    return { success: false, error: '图中未发现文字，请换一张清晰的截图' }
  }

  const code = pickCode(text)
  return { success: true, data: { code, text: text.slice(0, MAX_CONTENT_LEN) } }
}

/** 统一入口：openid 缺失直接拒绝，动作分发 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { success: false, error: '未获取到用户身份，请重新进入小程序' }

  try {
    switch (event && event.action) {
      case 'publish': return await handlePublish(OPENID, event)
      case 'mine': return await handleMine(OPENID)
      case 'list': return await handleList(OPENID, event)
      case 'help': return await handleHelp(OPENID, event)
      case 'auto': return await handleAuto(OPENID)
      case 'used': return await handleUsed(OPENID)
      case 'reset': return await handleReset(OPENID, event)
      case 'remove': return await handleRemove(OPENID, event)
      case 'ocr': return await handleOcr(OPENID, event)
      default: return { success: false, error: `未知动作：${(event && event.action) || '(空)'}` }
    }
  } catch (e) {
    console.error('[fruitApi] 处理失败', event && event.action, e)
    return { success: false, error: '服务暂时不可用，请稍后重试' }
  }
}

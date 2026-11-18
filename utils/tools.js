/**
 * 工具清单数据层
 *
 * 数据源优先级：
 *   云端 tools 集合（经由 toolsManage 云函数） > 本地缓存（云端快照） > 内置兜底
 *
 * 目标：新增一个工具只需往云端 tools 集合插入一行，前端无需改代码、无需发版。
 * 云端不可用（未部署 / 无网络 / 超时）时自动回退，保证首页不白屏。
 *
 * 内置兜底（FALLBACK_TOOLS）只放「无云端配置也能独立运行」的固定工具（扫一扫、注册码、单位换算、文本、随机、日期）。
 * 依赖云函数/云端数据的线上工具（如多多水果互助 pdd_fruit）不放这里，仅在云端 tools 集合配置后下发。
 * 这些工具页面已打包进小程序，因此会与云端清单合并展示（mergeBuiltinTools），
 * 云端漏配（未播种 / 旧版云函数）时也不会从首页消失。
 * 互助类工具（tb_coin_pk 等）的规则/次数/文案完全由云端驱动，不内置：
 * 云端不可用时首页不展示它们，避免展示与云端不一致的旧规则。
 */

const CACHE_KEY = 'toolsCache'
const VERSION_CACHE_KEY = 'toolsVersionCache' // 云端清单版本号（配置变化自动刷新用）
const CACHE_TTL = 30 * 60 * 1000 // 本地缓存 30 分钟
const TIMEOUT = 6000
const MAX_ATTEMPTS = 2 // 云函数冷启动可能超过单次超时，失败后自动重试一次
const CLOUD_FUNCTION = 'toolsManage'
// 内置工具配置变更时递增，使旧缓存自动失效
const CACHE_VERSION = 17 // v17：图标路径迁移为 nav_* / ui_*，旧缓存需失效

let memoryCache = null
let memorySource = '' // 'cloud' 云端成功写入 | 'storage' 本地缓存恢复 | 'fallback' 内置兜底
let offlineKeysCache = [] // 最近一次云端下发的下线工具 key，供离线兜底使用
let _refreshPromise = null

/** 内置兜底清单：与云端首次播种的默认数据保持一致 */
const FALLBACK_TOOLS = [
  {
    tool_key: 'scan',
    name: '扫一扫 · 解码',
    desc: '相机扫码 / 相册识别 · 内容解析与编码转换',
    icon: '/images/nav_scan_white.png',
    iconBg: '#CB5F47',
    tag: '',
    url: '/pages/scan/scan',
    navType: 'navigateTo',
    featured: true,
    category: '扫码识别',
    sort: 1
  },
  {
    tool_key: 'regcode',
    name: '注册码',
    desc: '生成 / 解析 / 校验',
    icon: '/images/nav_settings_white.png',
    iconBg: '#A8452F',
    tag: 'VIP',
    url: '/pages/regcode/regcode',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    sort: 3
  },
  {
    tool_key: 'unit_convert',
    name: '单位换算',
    desc: '长度 / 重量 / 温度 / 面积 / 速度实时换算',
    icon: '',
    iconBg: '#F3E7D8',
    badge: '换',
    badgeColor: '#C0553D',
    tag: '',
    url: '/pages/unit-converter/unit-converter',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    sort: 5
  },
  {
    tool_key: 'text_tools',
    name: '文本工具箱',
    desc: '去重 / 去空行 / 排序 / 批量替换 / 标点转换',
    icon: '',
    iconBg: '#F7EDE2',
    badge: '文',
    badgeColor: '#2F6C60',
    tag: '',
    url: '/pages/text-tools/text-tools',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    sort: 6
  },
  {
    tool_key: 'date_tools',
    name: '日期工具',
    desc: '日期间隔 / 日期推算 / 时间戳 / 倒计时',
    icon: '',
    iconBg: '#F3E7D8',
    badge: '日',
    badgeColor: '#A8452F',
    tag: '',
    url: '/pages/date-tools/date-tools',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    sort: 8
  }
]

// 说明：互助类工具（如 tb_coin_pk）不内置到本地兜底清单
// 其规则、次数上限、文案完全由云端配置驱动，本地保留副本容易与云端不一致而误导用户，
// 因此仅在云端可用时展示；云端失效时首页只显示上面这些真正内置的工具。

/**
 * 内置工具路由表（以 tool_key 为准）
 * 云端配置的 url 只是「可编辑的展示项」，历史数据里可能残留已废弃路径（如分包合并前的
 * /package1/pages/xxx），导致点击静默失败。此处作为唯一可信来源，云端 url 仅兜底。
 */
const TOOL_ROUTES = {
  scan: '/pages/scan/scan',
  regcode: '/pages/regcode/regcode',
  settings: '/pages/scan/settings/settings',
  unit_convert: '/pages/unit-converter/unit-converter',
  text_tools: '/pages/text-tools/text-tools',
  date_tools: '/pages/date-tools/date-tools'
}

/**
 * 解析工具的跳转地址
 * @param {string} toolKey 工具标识
 * @param {string} url 云端配置的地址（兜底）
 * @returns {string} 可直接用于 navigateTo 的绝对路径，无法解析时返回空串
 */
function resolveRoute(toolKey, url) {
  if (toolKey && TOOL_ROUTES[toolKey]) return TOOL_ROUTES[toolKey]
  const raw = String(url || '').trim()
  if (!raw) return ''
  // 归一化：去掉分包/多余前缀，只保留 pages/ 之后的部分
  const idx = raw.indexOf('pages/')
  return idx >= 0 ? '/' + raw.slice(idx) : raw
}

/**
 * 旧图标路径迁移表
 * 全站图标已统一为 nav_* / ui_* 线稿，旧的实心图标文件已从 images/ 移除。
 * 云端 tools 集合里仍可能存着旧路径，直接下发会渲染成空白块，这里统一改写到新文件。
 */
const LEGACY_ICON_MAP = {
  '/images/icon_scan_white.png': '/images/nav_scan_white.png',
  '/images/icon_settings_white.png': '/images/nav_settings_white.png',
  '/images/icon_user_white.png': '/images/nav_user_white.png',
  '/images/icon_delete_white.png': '/images/ui_trash_white.png',
  '/images/icon_history_white.png': '/images/ui_clock_white.png',
  '/images/icon_camera_white.png': '/images/ui_camera_white.png',
  '/images/icon_album_white.png': '/images/ui_album_white.png',
  '/images/icon_close_white.png': '/images/ui_close_white.png',
  '/images/icon_edit_white.png': '/images/ui_edit_white.png',
  '/images/icon_info_white.png': '/images/ui_info_white.png',
  '/images/icon_scan.png': '/images/nav_scan.png',
  '/images/icon_close.png': '/images/ui_close.png',
  '/images/icon_info.png': '/images/ui_info.png'
}

function normalize(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(item => item && item.name && (item.url || item.navType === 'tool'))
    .map(item => ({
      tool_key: item.tool_key || item._id || item.name,
      name: item.name,
      app_name: item.app_name || '',
      desc: item.desc || item.summary || '',
      summary: item.summary || '',
      icon: LEGACY_ICON_MAP[item.icon] || item.icon || '/images/ui_info.png',
      iconBg: item.iconBg || '#F3E7D8',
      badge: item.badge || '',
      badgeColor: item.badgeColor || '#E8A44C',
      tag: item.tag || '',
      url: item.url || '',
      navType: item.navType === 'switchTab' ? 'switchTab'
        : item.navType === 'tool' ? 'tool' : 'navigateTo',
      activity_url: item.activity_url || '',
      modes: item.modes || '',
      mode_tabs: Array.isArray(item.mode_tabs) ? item.mode_tabs : [],
      board_notice: item.board_notice || '',
      daily_help_limit: typeof item.daily_help_limit === 'number' ? item.daily_help_limit : 0,
      daily_receive_limit: typeof item.daily_receive_limit === 'number' ? item.daily_receive_limit : 0,
      daily_help_limit_solo: typeof item.daily_help_limit_solo === 'number' ? item.daily_help_limit_solo : 0,
      daily_help_limit_team: typeof item.daily_help_limit_team === 'number' ? item.daily_help_limit_team : 0,
      daily_receive_limit_solo: typeof item.daily_receive_limit_solo === 'number' ? item.daily_receive_limit_solo : 0,
      daily_receive_limit_team: typeof item.daily_receive_limit_team === 'number' ? item.daily_receive_limit_team : 0,
      task_seconds: typeof item.task_seconds === 'number' && item.task_seconds >= 60 ? item.task_seconds : 300,
      quota_full_text: item.quota_full_text || '',
      claim_title: item.claim_title || '',
      claim_desc: item.claim_desc || '',
      detail_title: item.detail_title || '',
      detail_desc: item.detail_desc || '',
      detail_note: item.detail_note || '',
      arrange_text: item.arrange_text || '',
      result_note: item.result_note || '',
      rules_text: item.rules_text || '',
      proof_label: item.proof_label || '',
      proof_placeholder: item.proof_placeholder || '',
      need_min: typeof item.need_min === 'number' ? item.need_min : 1,
      need_max: typeof item.need_max === 'number' ? item.need_max : 30,
      point_default: typeof item.point_default === 'number' ? item.point_default : 1,
      source_note: item.source_note || '',
      featured: !!item.featured,
      category: item.category || '',
      sort: typeof item.sort === 'number' ? item.sort : 999
    }))
    .sort((a, b) => a.sort - b.sort)
}

/**
 * 合并「内置固定工具」：本地页面已经打包进小程序，只要工具页存在就应可用，
 * 不能因为云端（旧版本云函数 / 未播种 / 后台漏加）没下发就整条消失。
 * 云端已配置的同名工具优先（可在后台改名、改描述、改排序），只补缺不覆盖。
 */
/**
 * 合并「内置固定工具」：本地页面已经打包进小程序，只要工具页存在就应可用，
 * 不能因为云端（旧版本云函数 / 未播种 / 后台漏加）没下发就整条消失。
 * 云端已配置的同名工具优先（可在后台改名、改描述、改排序），只补缺不覆盖。
 * offlineKeys：云端明确下线的工具，即使属于内置清单也不再展示（后台下线立即生效）
 */
function mergeBuiltinTools(list, offlineKeys) {
  const merged = Array.isArray(list) ? list.slice() : []
  const keys = new Set(merged.map(t => t.tool_key))
  const offline = new Set(Array.isArray(offlineKeys) ? offlineKeys : [])
  normalize(FALLBACK_TOOLS).forEach(t => {
    if (keys.has(t.tool_key) || offline.has(t.tool_key)) return
    merged.push(t)
  })
  return merged.sort((a, b) => a.sort - b.sort)
}

/** 按 tool_key 查询单个工具（供工具详情页使用） */
function getTool(toolKey) {
  const list = getCachedTools()
  const hit = list.find(t => t.tool_key === toolKey)
  if (hit) return hit
  // 兜底：云端配置缺失/被下线时退回内置清单，保证互助类工具不因配置异常而无法进入
  const fb = normalize(FALLBACK_TOOLS).find(t => t.tool_key === toolKey)
  return fb || null
}

/**
 * 云端失效时可用于展示的清单
 * 返回完整内置兜底清单（可离线独立运行的工具）：
 * 云端失败/超时属于临时状态，内置工具是本地能力，优先保证可用；
 * 云端下线状态（offline_keys）只在云端成功路径生效。
 * 缓存里的云端工具一律不展示——互助类等线上工具（pdd_fruit / tb_coin_pk）的页面内容
 * 依赖云端配置渲染，云端不可用时进入只会看到空白或过期数据
 */
function offlineTools() {
  return mergeBuiltinTools([])
}

/** 同步读取：内存缓存 > 本地缓存 > 内置兜底，用于首屏立即渲染 */
function getCachedTools() {
  if (memoryCache && memoryCache.length) return memoryCache

  try {
    const raw = wx.getStorageSync(CACHE_KEY)
    if (raw && raw.version === CACHE_VERSION && Array.isArray(raw.list) && raw.list.length && (Date.now() - raw.at) < CACHE_TTL) {
      offlineKeysCache = Array.isArray(raw.offlineKeys) ? raw.offlineKeys : []
      memoryCache = mergeBuiltinTools(normalize(raw.list), offlineKeysCache)
      memorySource = 'storage' // 本地快照 ≠ 云端确认可用，refreshTools 不得据此短路
      return memoryCache
    }
  } catch (e) { /* 忽略缓存读取异常 */ }

  memorySource = 'fallback'
  return normalize(FALLBACK_TOOLS)
}

function saveToolsCache(list, offlineKeys, cloudVersion) {
  memoryCache = list
  memorySource = 'cloud'
  offlineKeysCache = Array.isArray(offlineKeys) ? offlineKeys : []
  if (typeof cloudVersion === 'number') saveLocalVersion(cloudVersion)
  try {
    wx.setStorageSync(CACHE_KEY, { list, offlineKeys: offlineKeysCache, at: Date.now(), version: CACHE_VERSION })
  } catch (e) { /* 忽略缓存写入异常 */ }
}

function localVersion() {
  try { return Number(wx.getStorageSync(VERSION_CACHE_KEY)) || 0 } catch (e) { return 0 }
}

function saveLocalVersion(v) {
  if (typeof v !== 'number' || v < 0) return
  try { wx.setStorageSync(VERSION_CACHE_KEY, v) } catch (e) { /* 忽略 */ }
}

/**
 * 版本比对同步：供首页 onShow 调用
 * 只发一次轻量 version 请求；版本与本地一致返回 null（零成本），变化则强制拉全量并返回最新清单
 */
function syncIfChanged() {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION,
      data: { action: 'version' },
      success: (res) => {
        const result = res && res.result
        if (!result || !result.success || typeof result.version !== 'number') return resolve(null)
        if (result.version === localVersion()) return resolve(null)
        refreshTools(true).then((r) => resolve(r.success ? r : null)).catch(() => resolve(null))
      },
      fail: () => resolve(null)
    })
  })
}

/**
 * 从云端刷新工具清单（带互斥锁、超时与自动重试保护）
 * 重试主要覆盖云函数冷启动：部署后首次调用可能超过单次超时，失败后立即重试一次
 * @param {boolean} force 忽略内存缓存强制请求
 * @returns {Promise<{ success: boolean, tools: Array, source: string, error?: string }>}
 */
function refreshTools(force) {
  if (_refreshPromise) return _refreshPromise

  // 内存短路仅限「本次会话中云端成功写入」的清单；
  // 从本地存储恢复的旧快照（可能是已失效云端的残留）必须真实请求，否则失效探测会被跳过
  if (!force && memorySource === 'cloud' && memoryCache && memoryCache.length) {
    return Promise.resolve({ success: true, tools: memoryCache, source: 'memory' })
  }

  _refreshPromise = new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      _refreshPromise = null
      resolve(result)
    }

    const handleResult = (result) => {
      if (result && result.success && Array.isArray(result.tools) && result.tools.length) {
        // 云端清单 + 内置固定工具合并：云端漏配（旧版云函数 / 未播种）时内置工具仍可进入
        const list = mergeBuiltinTools(normalize(result.tools), result.offline_keys)
        saveToolsCache(list, result.offline_keys, result.version)
        finish({ success: true, tools: list, source: 'cloud' })
      } else if (result && result.success && Array.isArray(result.tools)) {
        // 云端正常应答但无上线工具（管理员全部下线 / 集合为空）：确定性的空，
        // 页面据此清空计数与卡片（不能沿用缓存数量造成「02 个工具 + 暂无工具」）
        finish({ success: false, tools: [], source: 'empty', error: '云端暂无上线工具' })
      } else {
        // 云端异常应答（未部署 / 权限 / 数据格式变化）：按「云端不可用」回退本地清单，
        // 不能误判为「空」导致把可用工具清没
        finish({
          success: false,
          tools: offlineTools(),
          source: 'error',
          error: (result && result.error) || '云端返回异常'
        })
      }
    }

    const attemptOnce = (attempt) => {
      let timer = null
      let settled = false
      // 只让首个回调生效，防止超时定时器与响应回调竞争
      const wrap = (fn) => (...args) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(...args)
      }

      timer = setTimeout(wrap(() => {
        // 超时：多为云函数冷启动，自动重试一次
        if (attempt < MAX_ATTEMPTS) {
          attemptOnce(attempt + 1)
          return
        }
        finish({ success: false, tools: offlineTools(), source: 'timeout', error: '请求超时' })
      }), TIMEOUT)

      wx.cloud.callFunction({
        name: CLOUD_FUNCTION,
        data: { action: 'list' },
        success: wrap((res) => handleResult(res && res.result)),
        fail: wrap((err) => {
          // 网络失败：自动重试一次
          if (attempt < MAX_ATTEMPTS) {
            attemptOnce(attempt + 1)
            return
          }
          finish({
            success: false,
            tools: offlineTools(),
            source: 'error',
            error: (err && err.errMsg) || '云端读取失败'
          })
        })
      })
    }

    attemptOnce(1)
  })

  return _refreshPromise
}

module.exports = {
  FALLBACK_TOOLS,
  TOOL_ROUTES,
  CACHE_VERSION,
  resolveRoute,
  getCachedTools,
  offlineTools,
  refreshTools,
  syncIfChanged,
  getTool
}

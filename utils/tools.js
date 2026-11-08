/**
 * 工具清单数据层
 *
 * 数据源优先级：
 *   云端 tools 集合（经由 toolsManage 云函数） > 本地缓存 > 内置兜底
 *
 * 目标：新增一个工具只需往云端 tools 集合插入一行，前端无需改代码、无需发版。
 * 云端不可用（未部署 / 无网络 / 超时）时自动回退，保证首页不白屏。
 */

const CACHE_KEY = 'toolsCache'
const CACHE_TTL = 30 * 60 * 1000 // 本地缓存 30 分钟
const TIMEOUT = 6000
const CLOUD_FUNCTION = 'toolsManage'
// 内置工具配置变更时递增，使旧缓存自动失效
const CACHE_VERSION = 6

let memoryCache = null
let _refreshPromise = null

/** 内置兜底清单：与云端首次播种的默认数据保持一致 */
const FALLBACK_TOOLS = [
  {
    tool_key: 'scan',
    name: '扫一扫 · 解码',
    desc: '相机扫码 / 相册识别 · 内容解析与编码转换',
    icon: '/images/icon_scan_white.png',
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
    icon: '/images/icon_settings_white.png',
    iconBg: '#A8452F',
    tag: 'VIP',
    url: '/package1/pages/regcode/regcode',
    navType: 'navigateTo',
    featured: false,
    category: '效率工具',
    sort: 3
  },
  {
    tool_key: 'tb_coin_pk',
    name: '淘金币互助·赛车助力',
    app_name: '淘宝',
    desc: '个人赛车加能量 / 车队助力加里程 · 个人赛每日各 10 次，车队每日各 6 次',
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
      '【互助平台侧 · 领取与恢复】今日领取完成后，明天零点恢复领取机会。',
      '【互助平台侧 · 助力明细图】次数用完后可上传「今日助力明细图」；属自愿补充，不影响任务操作。',
      '【互助平台侧 · 结果认定】实际助力结果以淘宝明细为准，平台记录仅供参考。'
    ].join('\n'),
    proof_label: '助力明细图',
    proof_placeholder: '上传今日助力明细图，或粘贴助力链接 / 淘口令',
    need_min: 1,
    need_max: 5,
    point_default: 1,
    source_note: '平台侧规则依据互助界面截图整理；淘宝活动侧规则依据公开攻略整理。两类次数上限口径不同（平台 10 次 / 官方 6 次），均以各自页面实时显示为准。',
    featured: false,
    category: '淘金币互助',
    sort: 4
  }
]

/** 字段规整 + 过滤无效项 + 按 sort 排序 */
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
      icon: item.icon || '/images/icon_info.png',
      iconBg: item.iconBg || '#E6F7F5',
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

/** 按 tool_key 查询单个工具（供工具详情页使用） */
function getTool(toolKey) {
  const list = getCachedTools()
  return list.find(t => t.tool_key === toolKey) || null
}

/** 同步读取：内存缓存 > 本地缓存 > 内置兜底，用于首屏立即渲染 */
function getCachedTools() {
  if (memoryCache && memoryCache.length) return memoryCache

  try {
    const raw = wx.getStorageSync(CACHE_KEY)
    if (raw && raw.version === CACHE_VERSION && Array.isArray(raw.list) && raw.list.length && (Date.now() - raw.at) < CACHE_TTL) {
      memoryCache = normalize(raw.list)
      return memoryCache
    }
  } catch (e) { /* 忽略缓存读取异常 */ }

  return normalize(FALLBACK_TOOLS)
}

function saveCache(list) {
  memoryCache = list
  try {
    wx.setStorageSync(CACHE_KEY, { list, at: Date.now(), version: CACHE_VERSION })
  } catch (e) { /* 忽略缓存写入异常 */ }
}

/**
 * 从云端刷新工具清单（带互斥锁与超时保护）
 * @param {boolean} force 忽略内存缓存强制请求
 * @returns {Promise<{ success: boolean, tools: Array, source: string, error?: string }>}
 */
function refreshTools(force) {
  if (_refreshPromise) return _refreshPromise

  if (!force && memoryCache && memoryCache.length) {
    return Promise.resolve({ success: true, tools: memoryCache, source: 'memory' })
  }

  _refreshPromise = new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      _refreshPromise = null
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ success: false, tools: getCachedTools(), source: 'timeout', error: '请求超时' })
    }, TIMEOUT)

    wx.cloud.callFunction({
      name: CLOUD_FUNCTION,
      data: { action: 'list' },
      success: (res) => {
        const result = res && res.result
        if (result && result.success && Array.isArray(result.tools) && result.tools.length) {
          const list = normalize(result.tools)
          saveCache(list)
          finish({ success: true, tools: list, source: 'cloud' })
        } else {
          finish({
            success: false,
            tools: getCachedTools(),
            source: 'empty',
            error: (result && result.error) || '云端暂无工具'
          })
        }
      },
      fail: (err) => {
        finish({
          success: false,
          tools: getCachedTools(),
          source: 'error',
          error: (err && err.errMsg) || '云端读取失败'
        })
      }
    })
  })

  return _refreshPromise
}

module.exports = {
  FALLBACK_TOOLS,
  getCachedTools,
  refreshTools,
  getTool
}

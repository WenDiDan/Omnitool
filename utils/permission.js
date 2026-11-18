/**
 * 用户权限缓存模块
 * 
 * 策略：
 * - 本地缓存用户角色、等级等权限信息，页面调用无需等待网络
 * - 启动时先从本地缓存读取，立即可用
 * - 后台异步向云函数请求最新权限数据，对比后更新缓存
 * - 每次对比记录时间戳，避免频繁请求
 */

const STORAGE_KEY = 'userPermission'
const SYNC_INTERVAL = 30 * 60 * 1000 // 30分钟内不再重复同步

// 角色定义（与云函数保持一致）
const ROLES = {
  admin: { label: '管理员', level: 3 },
  vip: { label: 'VIP用户', level: 2 },
  user: { label: '普通用户', level: 1 },
  blocked: { label: '已封禁', level: 0 }
}

// 默认权限（未登录/未同步）
const DEFAULT_PERMISSION = {
  openid: '',
  role: 'user',
  roleLabel: '普通用户',
  level: 1,
  nickName: '',
  avatarUrl: '',
  avatarVersion: 1,
  createdAt: '',
  isBlocked: false,
  banReason: '',      // 封禁原因（未封禁为空）
  bannedAt: '',       // 封禁时间（北京时间字符串）
  vipExpiresAt: '',   // VIP到期时间（ISO字符串），空表示不限制
  historyRetentionDays: 3,  // 历史保留天数
  syncedAt: 0          // 最后同步时间戳
}

let cached = null
let _syncPromise = null // 互斥锁：防止并发同步

/**
 * 从本地存储加载权限缓存
 */
function loadCache() {
  if (cached) return cached

  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (raw && raw.openid) {
      cached = { ...DEFAULT_PERMISSION, ...raw }
      return cached
    }
  } catch (e) {
    console.error('[permission] 读取缓存失败', e)
  }

  cached = { ...DEFAULT_PERMISSION }
  return cached
}

/**
 * 保存权限到本地缓存
 */
function savePermissionCache(data) {
  cached = { ...cached, ...data, syncedAt: Date.now() }
  try {
    wx.setStorageSync(STORAGE_KEY, cached)
  } catch (e) {
    console.error('[permission] 写入缓存失败', e)
  }
  return cached
}

/**
 * 是否需要同步（首次启动 或 超过同步间隔）
 */
function needSync() {
  const data = loadCache()
  if (!data.syncedAt) return true  // 从未同步过
  return (Date.now() - data.syncedAt) > SYNC_INTERVAL
}

/**
 * 从云端获取权限并对比缓存，有变化则更新
 * 使用互斥锁防止并发调用（与 app.js autoLogin 共享同一云函数）
 */
function syncFromCloud() {
  // 如果已有正在进行的同步，复用同一个 Promise
  if (_syncPromise) {
    return _syncPromise
  }

  _syncPromise = new Promise((resolve) => {
    const old = loadCache()

    // 超时保护：8秒
    let done = false
    const timer = setTimeout(() => {
      done = true
      _syncPromise = null
      resolve(old)
    }, 8000)

    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'getInfo' },
      success: (res) => {
        if (done) return
        clearTimeout(timer)
        done = true
        _syncPromise = null

        if (res.result && res.result.success) {
          const cloud = res.result.user
          // 对比是否和本地一致
          const changed =
            cloud.role !== old.role ||
            cloud.level !== old.level ||
            cloud.nickName !== old.nickName ||
            cloud.avatarUrl !== old.avatarUrl ||
            cloud.avatarVersion !== old.avatarVersion ||
            cloud.isBlocked !== old.isBlocked ||
            cloud.banReason !== old.banReason ||
            cloud.bannedAt !== old.bannedAt ||
            // VIP 到期时间与保留天数同样影响权限展示，必须参与变更判断
            cloud.vipExpiresAt !== old.vipExpiresAt ||
            cloud.historyRetentionDays !== old.historyRetentionDays

          if (changed) {
            console.log('[permission] 云端权限变更:', {
              role: old.role + '→' + cloud.role,
              level: old.level + '→' + cloud.level
            })
            savePermissionCache(cloud)
            resolve({ ...old, ...cloud })
          } else {
            // 无变化也更新时间戳，避免下次立即再请求
            savePermissionCache(old)
            resolve(old)
          }
        } else {
          resolve(old)
        }
      },
      fail: (err) => {
        if (done) return
        clearTimeout(timer)
        done = true
        _syncPromise = null
        console.error('[permission] 云端同步失败，使用缓存', err)
        resolve(old)
      }
    })
  })

  return _syncPromise
}

/**
 * 获取当前权限数据（同步，不阻塞）
 */
function getData() {
  return loadCache()
}

/**
 * 获取当前角色
 */
function getRole() {
  return getData().role
}

/**
 * 获取当前等级
 */
function getLevel() {
  return getData().level
}

/**
 * 是否为管理员
 */
function isAdmin() {
  return getRole() === 'admin'
}

/**
 * 是否为VIP或更高（含管理员）
 * 本地判断时会检查过期时间，过期视为非VIP
 */
function isVip() {
  const data = getData()
  // 管理员天然拥有VIP权限
  if (data.level >= 3) return true
  // 非VIP角色
  if (data.role !== 'vip' || data.level < 2) return false
  // 没有过期时间 → 永久VIP
  if (!data.vipExpiresAt) return true
  // 检查是否过期
  return new Date(data.vipExpiresAt) > new Date()
}

/**
 * 获取VIP过期信息（用于页面展示）
 * 返回 { isVip, expiresAt, daysLeft, label }
 */
function getVipInfo() {
  const data = getData()
  // 管理员
  if (data.level >= 3) {
    return { isVip: true, expiresAt: '', daysLeft: -1, label: '管理员 · 永久' }
  }
  // 非VIP
  if (data.role !== 'vip') {
    return { isVip: false, expiresAt: '', daysLeft: 0, label: '' }
  }
  // 永久VIP
  if (!data.vipExpiresAt) {
    return { isVip: true, expiresAt: '', daysLeft: -1, label: 'VIP · 永久有效' }
  }
  // 有时限VIP
  const now = new Date()
  const expires = new Date(data.vipExpiresAt)
  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 0) {
    return { isVip: false, expiresAt: data.vipExpiresAt, daysLeft: 0, label: 'VIP已过期' }
  }
  const label = 'VIP'
  return { isVip: true, expiresAt: data.vipExpiresAt, daysLeft, label }
}

/**
 * 是否被封禁
 */
function isBlocked() {
  return getData().isBlocked
}

/**
 * 是否有指定等级的权限
 */
function hasLevel(requiredLevel) {
  return getLevel() >= requiredLevel
}

/**
 * 清除缓存（登出时调用）
 */
function clearCache() {
  cached = { ...DEFAULT_PERMISSION }
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) { /* 忽略 */ }
}

module.exports = {
  ROLES,
  loadCache,
  savePermissionCache,
  needSync,
  syncFromCloud,
  getData,
  getRole,
  getLevel,
  isAdmin,
  isVip,
  isBlocked,
  hasLevel,
  getVipInfo,
  clearCache
}

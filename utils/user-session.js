/**
 * 用户会话信息
 *
 * 职责边界：
 * - 权限缓存只由 utils/permission.js 写入，本模块不直接改权限；
 * - 本模块只负责把用户信息映射到 globalData 与旧版 Storage（兼容页面读取）；
 * - 头像解析通过回调注入，避免与会话逻辑耦合。
 */

const permission = require('./permission.js')

/** 当前时间（分钟精度），用于登录/活跃时间展示 */
function nowText() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 将用户信息应用到 globalData 与旧版 Storage
 * @param {object} globalData
 * @param {object} user 云端返回的用户信息（必须含 openid）
 * @param {Function} [resolveAvatarUrl] 头像地址解析器（cloud:// 转 https）
 */
function applyUserInfo(globalData, user, resolveAvatarUrl) {
  if (!user || !user.openid) return

  // 向后兼容：继续写入旧版 storage key
  if (user.nickName) {
    wx.setStorageSync('userNickName', user.nickName)
  }
  wx.setStorageSync('userOpenid', user.openid)
  wx.setStorageSync('lastActiveTime', nowText())

  // 头像单独处理，不阻塞主流程
  if (user.avatarUrl && typeof resolveAvatarUrl === 'function') {
    resolveAvatarUrl(user.avatarUrl)
      .then((url) => wx.setStorageSync('userAvatar', url))
      .catch(() => {})
  }

  globalData.userInfo = user
}

/**
 * 清除用户会话（登出）
 * @param {object} globalData
 */
function clearUserPermission(globalData) {
  permission.clearCache()
  globalData.userInfo = null
  wx.removeStorageSync('userNickName')
  wx.removeStorageSync('userOpenid')
  wx.removeStorageSync('userAvatar')
  wx.removeStorageSync('lastActiveTime')
  wx.removeStorageSync('isLoggedIn')
}

module.exports = {
  applyUserInfo,
  clearUserPermission,
  nowText
}

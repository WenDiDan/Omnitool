/**
 * 扫码设置存储
 *
 * 仅负责 globalData.settings 的合并与持久化；
 * 设置项含义与校验由设置页负责。
 */

/**
 * 保存设置（浅合并）
 * @param {object} globalData
 * @param {object} settings 需要更新的字段
 * @returns {object} 合并后的完整设置
 */
function saveSettings(globalData, settings) {
  globalData.settings = { ...(globalData.settings || {}), ...(settings || {}) }
  wx.setStorageSync('settings', globalData.settings)
  return globalData.settings
}

module.exports = {
  saveSettings
}

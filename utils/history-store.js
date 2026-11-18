/**
 * 扫码历史本地存储
 *
 * 约定：
 * - 所有对 globalData.scanHistory 的写操作必须走这里；
 * - 每次写入自增 scanHistoryVersion，统计面板据此判断缓存是否失效；
 * - 同一 code 只保留一条记录，重复扫码累加 count 并置顶。
 */

/** 自增历史版本号（写操作唯一出口） */
function bumpVersion(globalData) {
  globalData.scanHistoryVersion = (globalData.scanHistoryVersion || 0) + 1
}

// ==================== 累计扫码统计（独立于历史记录） ====================
// 每次扫码事件 +1；清空/删除历史不影响；按北京时间自然日翻转今日次数
const STATS_KEY = 'scanStats'

function todayKey() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

/** 读取统计并处理自然日翻转（昨日数据自动归零今日值） */
function getScanStats() {
  const stats = wx.getStorageSync(STATS_KEY) || {}
  const key = todayKey()
  if (stats.day !== key) {
    return { day: key, total: stats.total || 0, today: 0, migrated: stats.migrated }
  }
  return stats
}

function setScanStats(stats) {
  wx.setStorageSync(STATS_KEY, stats)
}

/** 扫码事件 +1 */
function bumpScanStats(globalData) {
  const stats = getScanStats()
  stats.total = (stats.total || 0) + 1
  stats.today = (stats.today || 0) + 1
  setScanStats(stats)
  if (globalData) globalData.scanStats = stats
  return stats
}

/**
 * 写入一条扫码记录
 * @param {object} globalData 小程序全局数据
 * @param {object} scanData { code, type, time, wxScanType, count, decodedInfo }
 * @returns {Array} 更新后的历史列表
 */
function saveScanHistory(globalData, scanData) {
  const history = globalData.scanHistory || []
  const maxLimit = (globalData.settings && globalData.settings.historyLimit) || 100
  const count = scanData.count || 1

  const existingIndex = history.findIndex((item) => item.code === scanData.code)
  if (existingIndex !== -1) {
    // 已存在：更新内容并置顶
    const item = history.splice(existingIndex, 1)[0]
    item.count = count
    item.time = scanData.time
    item.timestamp = Date.now()
    item.wxScanType = scanData.wxScanType
    item.decodedInfo = scanData.decodedInfo
    history.unshift(item)
  } else {
    history.unshift({ ...scanData, count, timestamp: Date.now() })
  }

  // 超出上限时截断尾部
  if (history.length > maxLimit) {
    history.length = maxLimit
  }

  globalData.scanHistory = history
  wx.setStorageSync('scanHistory', history)
  bumpVersion(globalData)
  // 累计统计：每次扫码事件 +1（与记录条数无关）
  bumpScanStats(globalData)
  return history
}

/**
 * 清空扫码历史（清空前由页面负责上传回收站）
 * 注意：scanStats 累计统计不随清空重置
 * @param {object} globalData
 */
function clearScanHistory(globalData) {
  globalData.scanHistory = []
  wx.setStorageSync('scanHistory', [])
  bumpVersion(globalData)
}

/**
 * 从回收站恢复记录到本地历史（恢复操作的唯一写出口）
 * - 已存在同 code：原地合并更新（不新增条数、不改变原位置）
 * - 不存在：插入到最前
 * - 全程遵守 settings.historyLimit 上限，超出时截断尾部
 * - 不计入 scanStats：恢复不是新的扫码事件，累计次数不因此上涨
 * @param {object} globalData
 * @param {Array} records 云端返回的待恢复记录
 * @returns {number} 实际保留在本地历史中的条数（受上限截断影响可能小于传入条数）
 */
function restoreRecords(globalData, records) {
  const history = globalData.scanHistory || []
  const maxLimit = (globalData.settings && globalData.settings.historyLimit) || 100
  const addedCodes = []

  for (const record of records || []) {
    if (!record || !record.code) continue
    const item = {
      code: record.code,
      type: record.type || '',
      time: record.time || '',
      count: record.count || 1,
      wxScanType: record.wxScanType || '',
      timestamp: Date.now()
    }
    const existIdx = history.findIndex(r => r.code === record.code)
    if (existIdx !== -1) {
      history[existIdx] = { ...history[existIdx], ...item }
    } else {
      history.unshift(item)
      addedCodes.push(record.code)
    }
  }

  // 上限截断：恢复不得使本地历史超出容量
  if (history.length > maxLimit) {
    history.length = maxLimit
  }

  // 返回值 = 截断后仍留在本地的新增条数（合并更新与被截断丢弃的不计）
  const kept = addedCodes.reduce((n, code) => history.some(r => r.code === code) ? n + 1 : n, 0)

  globalData.scanHistory = history
  wx.setStorageSync('scanHistory', history)
  bumpVersion(globalData)
  return kept
}

module.exports = {
  saveScanHistory,
  clearScanHistory,
  restoreRecords,
  getScanStats,
  setScanStats,
  todayKey
}

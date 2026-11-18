/**
 * 扫码工具公共工具集
 *
 * 设计约定：
 * 1. 上半部分为纯函数（日期、类型标签、结果合并），不依赖 wx / getApp，可直接单测；
 * 2. 下半部分为小程序运行时辅助（剪贴板、取消判断），调用方需保证运行在小程序环境；
 * 3. 所有函数对空值/非法输入返回安全默认值，避免页面因脏数据白屏。
 *
 * 使用范围：pages/scan 下的页面与 components 下的扫码/解码面板。
 */

const DAY_MS = 86400000

/** 两位补零 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 判断是否为有效 Date（排除 Invalid Date） */
function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime())
}

/**
 * 格式化为「YYYY-MM-DD HH:mm:ss」
 * @param {Date} [date] 默认当前时间
 * @returns {string} 非法日期返回空串
 */
function formatDateTime(date = new Date()) {
  if (!isValidDate(date)) return ''
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

/**
 * 格式化为「YYYY-MM-DD」
 * @param {Date} [date]
 * @returns {string}
 */
function formatDate(date = new Date()) {
  if (!isValidDate(date)) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/**
 * 解析时间文本为本地 Date
 * 支持「YYYY-MM-DD HH:mm:ss」「YYYY-MM-DD HH:mm」「YYYY/MM/DD ...」、ISO 字符串与时间戳。
 * 说明：统一本地解析，避免 iOS/Android 对「-」格式解析差异。
 * @param {string|number} input
 * @returns {Date|null}
 */
function parseDateTime(input) {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') {
    const byTs = new Date(input)
    return isValidDate(byTs) ? byTs : null
  }
  const str = String(input).trim()
  if (!str) return null
  const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
    return isValidDate(d) ? d : null
  }
  const iso = new Date(str)
  return isValidDate(iso) ? iso : null
}

/**
 * 今天的起止时间戳（左闭右开）
 * @param {Date} [now]
 * @returns {{ start: number, end: number }}
 */
function getTodayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return { start, end: start + DAY_MS }
}

/**
 * 本周起始时间戳（周日 00:00）
 * @param {Date} [now]
 * @returns {number}
 */
function getWeekStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime()
}

/**
 * 记录时间戳：优先 timestamp，其次 time 文本
 * @param {{ timestamp?: number, time?: string }} record
 * @returns {number} 无法解析返回 0
 */
function getRecordTs(record) {
  if (!record) return 0
  if (record.timestamp) return Number(record.timestamp) || 0
  const d = parseDateTime(record.time)
  return d ? d.getTime() : 0
}

/**
 * 条码类型 → 列表标签（EAN / QR / URL / WiFi / Card / TEL）
 * @param {string} type
 * @returns {string}
 */
function getTypeLabel(type) {
  const t = String(type || '').toLowerCase()
  if (t.includes('ean') || t.includes('isbn') || t.includes('upc') || t.includes('条形码') || t.includes('barcode')) return 'EAN'
  // WiFi 类型本身也带「二维码」字样，需先于 QR 判断，否则会被误标为 QR
  if (t.includes('wifi') || t.includes('wi-fi')) return 'WiFi'
  if (t.includes('qr') || t.includes('二维码')) return 'QR'
  if (t.includes('url') || t.includes('http') || t.includes('网址')) return 'URL'
  if (t.includes('vcard') || t.includes('联系人')) return 'Card'
  if (t.includes('tel') || t.includes('电话')) return 'TEL'
  if (t.includes('mail') || t.includes('邮箱')) return 'Mail'
  return String(type || '?').slice(0, 3).toUpperCase()
}

/**
 * 相对时间描述：刚刚 / N分钟前 / N小时前 / 昨天 / MM-DD
 * @param {string|number} input 时间戳或时间文本
 * @param {number} [now] 参考时间戳，便于测试
 * @returns {string} 无法解析返回空串
 */
function formatRelativeTime(input, now = Date.now()) {
  const d = typeof input === 'number' ? new Date(input) : parseDateTime(input)
  if (!isValidDate(d)) return ''
  const diff = now - d.getTime()
  if (diff < 0) return '刚刚' // 时钟误差或未来时间
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < DAY_MS) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 2 * DAY_MS) return '昨天'
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * 将自定义解码规则结果合并进解码对象（就地修改并返回）
 * @param {object} decoded barcode.decodeBarcode 的返回值
 * @param {Array} results 自定义规则匹配结果
 * @returns {object}
 */
function mergeCustomRuleResults(decoded, results) {
  const target = decoded || {}
  const list = Array.isArray(results) ? results : []
  if (list.length === 0) return target
  const first = list[0]
  if (first && first.value) {
    target.customData = first.value
    target.customLabel = first.label || '自定义'
  }
  target.customRuleResults = list
  return target
}

/**
 * 解码失败时的兜底结果，保证结果面板仍可展示原始内容
 * @param {string} code
 * @returns {object}
 */
function fallbackDecoded(code) {
  const text = String(code || '')
  return { type: '文本', data: text, length: text.length, valid: true }
}

/**
 * 判断扫码失败是否为用户主动取消（取消不提示）
 * @param {object} err
 * @returns {boolean}
 */
function isCancelError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /cancel/i.test(msg)
}

/**
 * 复制文本到剪贴板
 * @param {string} text
 * @param {string} [successText] 成功提示文案，传空串则不提示
 * @returns {Promise<boolean>} 是否复制成功
 */
function copyText(text, successText = '已复制') {
  return new Promise((resolve) => {
    if (!text) {
      resolve(false)
      return
    }
    wx.setClipboardData({
      data: String(text),
      success: () => {
        if (successText) {
          // 长文案用无图标 toast，避免自带图标时文字被截断
          const useIcon = String(successText).length <= 7
          wx.showToast({
            title: successText,
            icon: useIcon ? 'success' : 'none',
            duration: useIcon ? 1500 : 2000
          })
        }
        resolve(true)
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' })
        resolve(false)
      }
    })
  })
}

// 扫码提示音单实例：避免每次扫码创建/销毁音频上下文造成资源抖动
let beepAudio = null

/** 释放提示音实例 */
function disposeBeep() {
  if (!beepAudio) return
  try {
    beepAudio.destroy()
  } catch (e) {
    // 忽略销毁失败
  }
  beepAudio = null
}

/**
 * 播放扫码提示音（全局复用同一实例）
 * 页面/组件卸载时请调用 disposeBeep() 释放资源
 */
function playBeep() {
  try {
    if (!beepAudio) {
      beepAudio = wx.createInnerAudioContext()
      beepAudio.src = '/images/scan_beep.wav'
      beepAudio.onError(() => disposeBeep())
    }
    beepAudio.stop()
    beepAudio.play()
  } catch (e) {
    disposeBeep()
  }
}

module.exports = {
  DAY_MS,
  formatDateTime,
  formatDate,
  parseDateTime,
  getTodayRange,
  getWeekStart,
  getRecordTs,
  getTypeLabel,
  formatRelativeTime,
  mergeCustomRuleResults,
  fallbackDecoded,
  isCancelError,
  copyText,
  playBeep,
  disposeBeep
}

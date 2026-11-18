/**
 * 自定义解码规则引擎
 *
 * 职责：规则匹配、内容提取、日期代码转换（字母 ↔ 日期）
 * 设计：核心能力均为纯函数（映射表通过入参注入），模块内另存一份「当前生效映射表」
 *       供全局解码使用；「试算/预览」必须传临时映射表，不得调用 updateDateMapping，
 *       避免未保存的配置污染全局解码结果。
 * 说明：本模块不读写 Storage、不依赖 App 实例，便于单元测试
 */

/** 默认日期代码映射表（基准年 2020） */
const DEFAULT_MAPS = {
  // 字母 → 年份偏移
  letterToYear: {
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7,
    J: 8, K: 9, L: 10, M: 11, N: 12, P: 13, R: 14, S: 15,
    T: 16, U: 17, V: 18, W: 19, X: 20, Y: 21, Z: 22
  },
  // 字母 → 月份（数字 1-9 显示为 01-09）
  letterToMonth: { A: 10, B: 11, C: 12 },
  // 字母 → 日期（一个月最多 31 天，字母到 Y 为止）
  letterToDay: {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17,
    J: 18, K: 19, L: 20, M: 21, N: 22, P: 23, R: 24,
    S: 25, T: 26, U: 27, V: 28, W: 29, X: 30, Y: 31
  },
  baseYear: 2020
}

/**
 * 由自定义映射构造一份完整映射表（纯函数，不修改入参）
 * @param {object} custom { baseYear?, yearLetters?, monthLetters?, dayLetters? }
 * @returns {object} 新的映射表对象
 */
function buildMaps(custom) {
  const next = JSON.parse(JSON.stringify(DEFAULT_MAPS))
  if (!custom) return next
  if (custom.baseYear !== undefined) next.baseYear = custom.baseYear
  if (custom.yearLetters) next.letterToYear = { ...custom.yearLetters }
  if (custom.monthLetters) next.letterToMonth = { ...custom.monthLetters }
  if (custom.dayLetters) next.letterToDay = { ...custom.dayLetters }
  return next
}

/** 当前生效的映射表（仅由 updateDateMapping 整体替换） */
let maps = buildMaps()

/** 读取当前映射表（只读用途；调用方不要原地修改） */
function getMaps() {
  return maps
}

/** 恢复默认映射 */
function resetMaps() {
  maps = buildMaps()
}

/**
 * 更新全局生效映射（仅用于「已保存」的配置；试算请用 buildMaps 传参，勿调用本方法）
 * 语义：增量覆盖当前映射（未提供的键保持不变），整体替换为不可变新对象
 * @param {object} custom - { baseYear?, yearLetters?, monthLetters?, dayLetters? }
 */
function updateDateMapping(custom) {
  if (!custom) return
  const next = JSON.parse(JSON.stringify(maps))
  if (custom.baseYear !== undefined) next.baseYear = custom.baseYear
  if (custom.yearLetters) next.letterToYear = { ...custom.yearLetters }
  if (custom.monthLetters) next.letterToMonth = { ...custom.monthLetters }
  if (custom.dayLetters) next.letterToDay = { ...custom.dayLetters }
  maps = next
}

/**
 * 单项代码字符 → 数值（数字原样，字母按映射表转换）
 * @param {string} char
 * @param {object} [mapsOverride] 临时映射表（试算用），缺省用全局表
 * @returns {number|string} 无法识别时原样返回字符
 */
function convertLetterToDate(char, mapsOverride) {
  const m = mapsOverride || maps
  if (/^\d$/.test(char)) return parseInt(char, 10)
  const c = char.toUpperCase()
  if (m.letterToYear[c] !== undefined) return m.baseYear + m.letterToYear[c]
  if (m.letterToMonth[c] !== undefined) return m.letterToMonth[c]
  if (m.letterToDay[c] !== undefined) return m.letterToDay[c]
  return char
}

/**
 * 按规则的「提取方式」从原始内容中取值
 * @param {string} code 原始扫码内容
 * @param {object} rule 规则（读取 extract / startPos / endPos）
 * @returns {string} 提取结果（提取失败时返回原文）
 */
function extractValue(code, rule) {
  if (rule.extract === '提取位置' && rule.startPos && rule.endPos) {
    return code.substring(parseInt(rule.startPos, 10) - 1, parseInt(rule.endPos, 10))
  }
  if (rule.extract === '域名') {
    try {
      const url = new URL(code.startsWith('http') ? code : 'http://' + code)
      return url.hostname
    } catch (e) {
      return code
    }
  }
  if (rule.extract === '@后的域名') {
    const atIndex = code.indexOf('@')
    if (atIndex === -1) return code
    const afterAt = code.substring(atIndex + 1)
    const dotIndex = afterAt.indexOf('.')
    return dotIndex !== -1 ? afterAt.substring(0, dotIndex) : afterAt
  }
  // '匹配的全部' 及未指定方式：返回原文
  return code
}

/**
 * 按日期映射配置，从「原始条码」的指定位置解析出日期（YYYY / YYYY-MM / YYYY-MM-DD）
 * 位置始终基于原始 code，而非提取结果
 * @param {string} code 原始扫码内容
 * @param {object} mapping { enabled, yearPos, monthPos, dayPos }
 * @param {object} [mapsOverride] 临时映射表（试算/预览用），缺省用全局表
 * @returns {string} 日期字符串，无法解析时返回 ''
 */
function convertDateByMapping(code, mapping, mapsOverride) {
  if (!mapping || !mapping.enabled) return ''
  const m = mapsOverride || maps
  let result = ''

  const pick = (pos, table, baseOffset) => {
    if (!pos || pos <= 0 || pos > code.length) return null
    const ch = code[pos - 1]
    if (/\d/.test(ch)) return parseInt(ch, 10)
    const val = table[ch.toUpperCase()]
    if (val === undefined) return null
    return baseOffset ? m.baseYear + val : val
  }

  const year = pick(mapping.yearPos, m.letterToYear, true)
  if (year !== null) result = String(year)

  const month = pick(mapping.monthPos, m.letterToMonth, false)
  if (month !== null && result) {
    // 月份合法性：1-12
    if (month < 1 || month > 12) return ''
    result += '-' + String(month).padStart(2, '0')
  }

  const day = pick(mapping.dayPos, m.letterToDay, false)
  if (day !== null && result.indexOf('-') !== -1) {
    // 日期合法性：1-31 且不超过当月实际天数（如 2 月 30 无效）
    const parts = result.split('-')
    const y = parseInt(parts[0], 10)
    const mm = parseInt(parts[1], 10)
    if (day < 1 || day > 31) return ''
    const daysInMonth = new Date(y, mm, 0).getDate()
    if (day > daysInMonth) return ''
    result += '-' + String(day).padStart(2, '0')
  }

  return result.length >= 4 ? result : ''
}

/**
 * 用一组规则解码扫码内容（app 全局调用）
 * @param {string} code 原始扫码内容
 * @param {Array} rules 规则列表（内部会过滤 enabled）
 * @param {object} [options] { maps } 临时映射表；试算时传入可避免影响全局解码
 * @returns {Array<{label:string, rawValue:string, value:string, isDate?:boolean}>}
 */
function decodeWithRule(code, rules, options) {
  const mapsOverride = options && options.maps
  const results = []
  const list = (rules || []).filter(r => r.enabled)
  for (const rule of list) {
    try {
      if (!rule.pattern) continue

      // 长度约束
      if (rule.lengthEnabled) {
        const minLen = rule.minLength || 0
        const maxLen = rule.maxLength || Infinity
        if (code.length < minLen || code.length > maxLen) continue
      }

      let regex
      try {
        regex = new RegExp(rule.pattern)
      } catch (e) {
        console.warn('[decode-rules] 正则表达式无效:', rule.pattern, e.message)
        continue
      }
      if (!regex.test(code)) continue

      const extracted = extractValue(code, rule)
      const item = {
        label: rule.label || rule.name,
        rawValue: extracted,
        value: extracted
      }

      const dateText = convertDateByMapping(code, rule.dateMapping, mapsOverride)
      if (dateText) {
        item.value = dateText
        item.isDate = true
      }
      results.push(item)
    } catch (e) {
      console.error('[decode-rules] 规则匹配错误:', rule.name, e)
    }
  }
  return results
}

module.exports = {
  DEFAULT_MAPS,
  buildMaps,
  getMaps,
  resetMaps,
  updateDateMapping,
  convertLetterToDate,
  extractValue,
  convertDateByMapping,
  decodeWithRule
}

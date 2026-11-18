/**
 * 云函数公共时间工具（北京时间 UTC+8）
 *
 * 说明：云函数按目录独立部署，无法引用上级目录的模块。
 * 本文件由 scripts/sync-cloud-shared.js 复制到各函数的 _shared/ 目录，
 * 修改后请执行 `npm run sync:cloud`，不要直接改各函数下的副本。
 */

const BJ_OFFSET_MS = 8 * 3600 * 1000

/**
 * UTC ISO 字符串 → 北京时间字符串（YYYY-MM-DD HH:mm:ss）
 * 无法解析时原样返回，避免列表展示出现 Invalid Date。
 * @param {string|Date} iso
 * @returns {string}
 */
function bjTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return new Date(d.getTime() + BJ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * 当天日期键（北京时间，按自然日零点失效）
 * @returns {string} YYYY-MM-DD
 */
function todayKey() {
  const now = new Date(Date.now() + BJ_OFFSET_MS)
  return now.toISOString().slice(0, 10)
}

module.exports = {
  BJ_OFFSET_MS,
  bjTime,
  todayKey
}

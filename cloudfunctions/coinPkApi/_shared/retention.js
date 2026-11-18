/**
 * 用户历史保留天数（唯一实现）
 *
 * 规则：
 * - 管理员：historyRetentionDays || 365
 * - 永久 VIP（role=vip 且未设置到期时间）：36500（永久）
 * - VIP 未过期：max(基础天数, VIP 剩余天数)
 * - VIP 无到期时间之外的情况 / 已过期：基础天数
 * - 普通用户：historyRetentionDays || 3
 *
 * 由 scripts/sync-cloud-shared.js 复制到各云函数 _shared/ 目录，
 * 修改后执行 `npm run sync:cloud`。
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** 「永久」的保留天数（与后台 36500=永久 的约定一致） */
const PERMANENT_DAYS = 36500

/**
 * 计算用户有效保留天数
 * @param {object} user users 集合中的用户文档（可为空）
 * @param {number} [now] 当前时间戳，便于测试注入
 * @returns {number} 天数（至少 3）
 */
function calcRetentionDays(user, now = Date.now()) {
  if (!user) return 3

  const raw = Number(user.historyRetentionDays)
  const base = raw > 0 ? raw : 3
  const role = user.role || 'user'

  if (role === 'admin') {
    return raw > 0 ? raw : 365
  }

  if (role !== 'vip') return base

  // 永久 VIP：未设置到期时间 → 不过期，保留天数与「永久」一致
  // （此前实现把永久 VIP 误当普通用户，只给 3 天）
  if (!user.vipExpiresAt) return PERMANENT_DAYS

  const expire = new Date(user.vipExpiresAt).getTime()
  if (isNaN(expire) || expire <= now) return base

  const remainDays = Math.ceil((expire - now) / DAY_MS)
  return Math.max(base, remainDays)
}

module.exports = {
  DAY_MS,
  calcRetentionDays
}

/**
 * 云函数公共保留天数计算（cloudfunctions/_shared/retention.js）
 * 覆盖管理员/VIP/普通用户、到期与非法日期等边界。
 */

const { calcRetentionDays, DAY_MS } = require('../cloudfunctions/_shared/retention.js')

describe('calcRetentionDays', () => {
  test('空用户默认 3 天', () => {
    expect(calcRetentionDays(null)).toBe(3)
    expect(calcRetentionDays(undefined)).toBe(3)
  })

  test('普通用户：默认 3 天，可自定义', () => {
    expect(calcRetentionDays({ role: 'user' })).toBe(3)
    expect(calcRetentionDays({ role: 'user', historyRetentionDays: 7 })).toBe(7)
  })

  test('管理员：未设置默认 365 天，设置后取设置值', () => {
    expect(calcRetentionDays({ role: 'admin' })).toBe(365)
    expect(calcRetentionDays({ role: 'admin', historyRetentionDays: 30 })).toBe(30)
  })

  test('VIP 未过期：取基础天数与剩余天数较大值', () => {
    const now = Date.now()
    const vip = {
      role: 'vip',
      historyRetentionDays: 3,
      vipExpiresAt: new Date(now + 10 * DAY_MS).toISOString()
    }
    expect(calcRetentionDays(vip, now)).toBe(10)
  })

  test('VIP 剩余天数小于基础天数时取基础天数', () => {
    const now = Date.now()
    const vip = {
      role: 'vip',
      historyRetentionDays: 30,
      vipExpiresAt: new Date(now + 2 * DAY_MS).toISOString()
    }
    expect(calcRetentionDays(vip, now)).toBe(30)
  })

  test('VIP 已过期：按基础天数', () => {
    const now = Date.now()
    expect(calcRetentionDays({ role: 'vip', vipExpiresAt: new Date(now - DAY_MS).toISOString() }, now)).toBe(3)
  })

  test('永久 VIP（未设置到期时间）：36500 天（永久），不再误按基础天数', () => {
    expect(calcRetentionDays({ role: 'vip' })).toBe(36500)
    expect(calcRetentionDays({ role: 'vip', historyRetentionDays: 9 })).toBe(36500)
    expect(calcRetentionDays({ role: 'vip', vipExpiresAt: '' })).toBe(36500)
  })

  test('VIP 到期时间非法：按基础天数', () => {
    expect(calcRetentionDays({ role: 'vip', historyRetentionDays: 5, vipExpiresAt: 'bad-date' })).toBe(5)
  })
})

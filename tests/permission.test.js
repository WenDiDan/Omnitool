/**
 * utils/permission.js 单元测试
 * 覆盖：缓存读写/兜底、同步判断、角色与等级、VIP 判定与过期、
 *       封禁状态、清除缓存、云端同步（变更/无变更/失败/并发/超时）。
 */

const STORAGE_KEY = 'userPermission'

let permission

/** 每个用例重新加载模块，避免模块级 cached 互相污染 */
function loadModule() {
  jest.resetModules()
  return require('../utils/permission.js')
}

function mockWx(overrides = {}) {
  global.wx = {
    getStorageSync: jest.fn(() => ''),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
    cloud: { callFunction: jest.fn() },
    ...overrides
  }
}

beforeEach(() => {
  mockWx()
  permission = loadModule()
})

afterEach(() => {
  delete global.wx
})

describe('loadCache / savePermissionCache', () => {
  test('无缓存时返回默认权限', () => {
    const data = permission.loadCache()
    expect(data.role).toBe('user')
    expect(data.level).toBe(1)
    expect(data.isBlocked).toBe(false)
  })

  test('有 openid 的缓存会被合并', () => {
    global.wx.getStorageSync = jest.fn(() => ({ openid: 'o1', role: 'vip', level: 2 }))
    permission = loadModule()
    const data = permission.loadCache()
    expect(data.openid).toBe('o1')
    expect(data.role).toBe('vip')
    expect(data.historyRetentionDays).toBe(3)
  })

  test('缺少 openid 的缓存视为无效', () => {
    global.wx.getStorageSync = jest.fn(() => ({ role: 'admin' }))
    permission = loadModule()
    expect(permission.loadCache().role).toBe('user')
  })

  test('读取异常时降级为默认值', () => {
    global.wx.getStorageSync = jest.fn(() => {
      throw new Error('storage broken')
    })
    permission = loadModule()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(permission.loadCache().role).toBe('user')
    spy.mockRestore()
  })

  test('savePermissionCache 合并字段、写入时间戳并持久化', () => {
    permission.savePermissionCache({ openid: 'o2', nickname: 'x' })
    const data = permission.getData()
    expect(data.openid).toBe('o2')
    expect(data.syncedAt).toBeGreaterThan(0)
    expect(global.wx.setStorageSync).toHaveBeenCalledWith(STORAGE_KEY, expect.objectContaining({ openid: 'o2' }))
  })

  test('写入异常不影响内存缓存', () => {
    global.wx.setStorageSync = jest.fn(() => {
      throw new Error('quota')
    })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    permission.savePermissionCache({ openid: 'o3' })
    expect(permission.getData().openid).toBe('o3')
    spy.mockRestore()
  })
})

describe('needSync', () => {
  test('从未同步需要同步', () => {
    expect(permission.needSync()).toBe(true)
  })

  test('30 分钟内不需要同步', () => {
    permission.savePermissionCache({ openid: 'o1' })
    expect(permission.needSync()).toBe(false)
  })

  test('超过 30 分钟需要同步', () => {
    permission.savePermissionCache({ openid: 'o1' })
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now + 31 * 60 * 1000)
    expect(permission.needSync()).toBe(true)
    Date.now.mockRestore()
  })
})

describe('角色与等级', () => {
  test('getRole / getLevel / hasLevel', () => {
    permission.savePermissionCache({ role: 'admin', level: 3 })
    expect(permission.getRole()).toBe('admin')
    expect(permission.getLevel()).toBe(3)
    expect(permission.hasLevel(3)).toBe(true)
    expect(permission.hasLevel(4)).toBe(false)
  })

  test('isAdmin 仅管理员为 true', () => {
    expect(permission.isAdmin()).toBe(false)
    permission.savePermissionCache({ role: 'admin', level: 3 })
    expect(permission.isAdmin()).toBe(true)
  })

  test('isBlocked 跟随缓存', () => {
    expect(permission.isBlocked()).toBe(false)
    permission.savePermissionCache({ isBlocked: true })
    expect(permission.isBlocked()).toBe(true)
  })
})

describe('isVip', () => {
  test('管理员天然是 VIP', () => {
    permission.savePermissionCache({ role: 'admin', level: 3 })
    expect(permission.isVip()).toBe(true)
  })

  test('普通用户不是 VIP', () => {
    expect(permission.isVip()).toBe(false)
  })

  test('无到期时间为永久 VIP', () => {
    permission.savePermissionCache({ role: 'vip', level: 2, vipExpiresAt: '' })
    expect(permission.isVip()).toBe(true)
  })

  test('未过期 / 已过期', () => {
    permission.savePermissionCache({
      role: 'vip',
      level: 2,
      vipExpiresAt: new Date(Date.now() + 86400000).toISOString()
    })
    expect(permission.isVip()).toBe(true)

    permission.savePermissionCache({
      role: 'vip',
      level: 2,
      vipExpiresAt: new Date(Date.now() - 86400000).toISOString()
    })
    expect(permission.isVip()).toBe(false)
  })
})

describe('getVipInfo', () => {
  test('管理员', () => {
    permission.savePermissionCache({ role: 'admin', level: 3 })
    expect(permission.getVipInfo()).toEqual({
      isVip: true,
      expiresAt: '',
      daysLeft: -1,
      label: '管理员 · 永久'
    })
  })

  test('普通用户', () => {
    expect(permission.getVipInfo()).toEqual({ isVip: false, expiresAt: '', daysLeft: 0, label: '' })
  })

  test('永久 VIP', () => {
    permission.savePermissionCache({ role: 'vip', level: 2, vipExpiresAt: '' })
    expect(permission.getVipInfo().daysLeft).toBe(-1)
    expect(permission.getVipInfo().label).toContain('永久')
  })

  test('限时 VIP 计算剩余天数', () => {
    permission.savePermissionCache({
      role: 'vip',
      level: 2,
      vipExpiresAt: new Date(Date.now() + 3 * 86400000).toISOString()
    })
    const info = permission.getVipInfo()
    expect(info.isVip).toBe(true)
    expect(info.daysLeft).toBe(3)
    expect(info.label).toBe('VIP')
  })

  test('已过期 VIP', () => {
    permission.savePermissionCache({
      role: 'vip',
      level: 2,
      vipExpiresAt: new Date(Date.now() - 86400000).toISOString()
    })
    const info = permission.getVipInfo()
    expect(info.isVip).toBe(false)
    expect(info.label).toBe('VIP已过期')
  })
})

describe('clearCache', () => {
  test('恢复默认并移除存储', () => {
    permission.savePermissionCache({ openid: 'o1', role: 'admin', level: 3 })
    permission.clearCache()
    expect(permission.getRole()).toBe('user')
    expect(permission.getLevel()).toBe(1)
    expect(global.wx.removeStorageSync).toHaveBeenCalledWith(STORAGE_KEY)
  })
})

describe('syncFromCloud', () => {
  const cloudUser = {
    role: 'vip',
    level: 2,
    nickName: 'n',
    avatarUrl: '',
    avatarVersion: 1,
    isBlocked: false,
    banReason: '',
    bannedAt: '',
    vipExpiresAt: ''
  }

  test('云端有变更时更新缓存', async () => {
    global.wx.cloud.callFunction = ({ success }) =>
      success({ result: { success: true, user: cloudUser } })
    const data = await permission.syncFromCloud()
    expect(data.role).toBe('vip')
    expect(permission.getRole()).toBe('vip')
    expect(permission.getData().syncedAt).toBeGreaterThan(0)
  })

  test('云端无变更时刷新同步时间', async () => {
    global.wx.cloud.callFunction = ({ success }) =>
      success({
        result: {
          success: true,
          user: { role: 'user', level: 1, nickName: '', avatarUrl: '', avatarVersion: 1, isBlocked: false, banReason: '', bannedAt: '' }
        }
      })
    const data = await permission.syncFromCloud()
    expect(data.role).toBe('user')
    expect(permission.getData().syncedAt).toBeGreaterThan(0)
  })

  test('业务失败时使用本地缓存', async () => {
    permission.savePermissionCache({ openid: 'local' })
    global.wx.cloud.callFunction = ({ success }) => success({ result: { success: false } })
    const data = await permission.syncFromCloud()
    expect(data.openid).toBe('local')
  })

  test('调用异常时使用本地缓存', async () => {
    permission.savePermissionCache({ openid: 'local2' })
    global.wx.cloud.callFunction = ({ fail }) => fail({ errMsg: 'network' })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const data = await permission.syncFromCloud()
    expect(data.openid).toBe('local2')
    spy.mockRestore()
  })

  test('并发调用复用同一 Promise，并在超时后释放', async () => {
    jest.useFakeTimers()
    global.wx.cloud.callFunction = () => {} // 永不回调，触发超时
    const p1 = permission.syncFromCloud()
    const p2 = permission.syncFromCloud()
    expect(p1).toBe(p2)
    jest.advanceTimersByTime(8000)
    await expect(p1).resolves.toBeDefined()
    jest.useRealTimers()
  })
})

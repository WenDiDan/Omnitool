/**
 * utils/user-session.js 单元测试
 * 覆盖：用户信息映射、头像异步解析、缺省值保护、登出清理。
 */

let userSession
let permission

function mockWx() {
  global.wx = {
    getStorageSync: jest.fn(() => ''),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn()
  }
}

beforeEach(() => {
  jest.resetModules()
  mockWx()
  userSession = require('../utils/user-session.js')
  permission = require('../utils/permission.js')
})

afterEach(() => {
  delete global.wx
})

describe('applyUserInfo', () => {
  test('写入全局与兼容 Storage 字段', () => {
    const g = { userInfo: null }
    userSession.applyUserInfo(g, { openid: 'o1', nickName: '小明', role: 'user' })

    expect(g.userInfo.openid).toBe('o1')
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('userNickName', '小明')
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('userOpenid', 'o1')
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('lastActiveTime', expect.any(String))
  })

  test('头像通过注入的解析器异步写入，不阻塞主流程', async () => {
    const g = { userInfo: null }
    const resolver = jest.fn().mockResolvedValue('https://cdn/avatar.png')

    userSession.applyUserInfo(g, { openid: 'o1', avatarUrl: 'cloud://a.png' }, resolver)
    expect(resolver).toHaveBeenCalledWith('cloud://a.png')
    expect(g.userInfo.openid).toBe('o1')

    await Promise.resolve()
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('userAvatar', 'https://cdn/avatar.png')
  })

  test('头像解析失败不影响会话', async () => {
    const g = { userInfo: null }
    const resolver = jest.fn().mockRejectedValue(new Error('fail'))
    userSession.applyUserInfo(g, { openid: 'o1', avatarUrl: 'cloud://a.png' }, resolver)
    await Promise.resolve()
    expect(g.userInfo.openid).toBe('o1')
  })

  test('缺少 user 或 openid 时直接返回', () => {
    const g = { userInfo: null }
    userSession.applyUserInfo(g, null)
    userSession.applyUserInfo(g, { nickName: '无openid' })
    expect(g.userInfo).toBeNull()
    expect(global.wx.setStorageSync).not.toHaveBeenCalled()
  })
})

describe('clearUserPermission', () => {
  test('清理权限缓存、全局用户与兼容 Storage', () => {
    const g = { userInfo: { openid: 'o1' } }
    permission.savePermissionCache({ openid: 'o1', role: 'admin', level: 3 })

    userSession.clearUserPermission(g)

    expect(g.userInfo).toBeNull()
    expect(permission.getRole()).toBe('user')
    expect(global.wx.removeStorageSync).toHaveBeenCalledWith('userNickName')
    expect(global.wx.removeStorageSync).toHaveBeenCalledWith('isLoggedIn')
  })
})

describe('nowText', () => {
  test('返回 YYYY-MM-DD HH:mm 格式', () => {
    expect(userSession.nowText()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

/**
 * utils/settings-store.js 单元测试
 */

const store = require('../utils/settings-store.js')

beforeEach(() => {
  global.wx = { setStorageSync: jest.fn() }
})

afterEach(() => {
  delete global.wx
})

describe('saveSettings', () => {
  test('浅合并并持久化', () => {
    const g = { settings: { soundEnabled: true, historyLimit: 100 } }
    const merged = store.saveSettings(g, { autoCopy: true })

    expect(merged).toEqual({ soundEnabled: true, historyLimit: 100, autoCopy: true })
    expect(g.settings.autoCopy).toBe(true)
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('settings', merged)
  })

  test('空设置不破坏现有配置', () => {
    const g = { settings: { historyLimit: 50 } }
    const merged = store.saveSettings(g, {})
    expect(merged).toEqual({ historyLimit: 50 })
  })

  test('settings 缺失时安全初始化', () => {
    const g = {}
    expect(store.saveSettings(g, { soundEnabled: false })).toEqual({ soundEnabled: false })
  })
})

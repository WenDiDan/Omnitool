/**
 * 互助工具拆分模块的装配测试
 * 防止拆分后方法丢失、分发表错乱（页面运行时依赖这些方法存在）。
 */

// tdesign 组件未安装到根 node_modules，使用虚拟模块替身
jest.mock('tdesign-miniprogram/toast/index', () => ({ default: jest.fn() }), { virtual: true })
jest.mock('tdesign-miniprogram/dialog/index', () => ({
  default: { confirm: jest.fn(() => Promise.resolve()), alert: jest.fn() }
}), { virtual: true })

const modeConfig = require('../pages/tool/modules/mode-config.js')
const modeState = require('../pages/tool/modules/mode-state.js')
const records = require('../pages/tool/modules/records.js')
const account = require('../pages/tool/modules/account.js')
const helpSettings = require('../pages/tool/modules/help-settings.js')
const commandTask = require('../pages/tool/modules/command-task.js')

beforeEach(() => {
  global.wx = {
    getStorageSync: jest.fn(() => ''),
    setStorageSync: jest.fn(),
    cloud: {}
  }
})

afterEach(() => {
  delete global.wx
})

describe('模块导出完整性', () => {
  const cases = [
    [modeConfig, ['resolveLimits', 'createModeState']],
    [modeState, ['ensureSameDay', 'ensureModeStates', 'syncCurrent', 'updateMode', 'restoreModeStates', 'persistModeStates', 'modeStateKey', 'localDateKey', 'buildSettings']],
    [records, ['loadRecords', 'setRecordType', 'setRecordFilter', 'viewRecordDetail']],
    [account, ['loadAccount', 'applyAccount', 'saveAccount', 'chooseAvatar', 'uploadAvatarIfNeeded', 'handleBlocked', 'clearAccountCache']],
    [helpSettings, ['openHelpSettings', 'closeHelpSettings', 'onSettingAction', 'onInvite', 'onTeamInfo', 'promptRegister']],
    [commandTask, ['editCommand', 'drawCommand', 'startTaskTimer', 'stopTaskTimer', 'releaseTask', 'swapTask', 'blockTask', 'confirmReceive', 'copyTaskCommand', 'getBlockList', 'addBlockNick']]
  ]

  test.each(cases)('导出项齐全', (mod, names) => {
    for (const name of names) {
      expect(typeof mod[name]).toBe('function')
    }
  })

  test('模式规则为数组常量', () => {
    expect(Array.isArray(modeConfig.MODE_RULES)).toBe(true)
  })
})

describe('模块行为', () => {
  test('受助设置分发到对应方法', () => {
    const ctx = { adjustQuota: jest.fn(), togglePause: jest.fn() }
    helpSettings.onSettingAction.call(ctx, { currentTarget: { dataset: { action: 'adjustQuota' } } })
    expect(ctx.adjustQuota).toHaveBeenCalledTimes(1)
    expect(ctx.togglePause).not.toHaveBeenCalled()
  })

  test('记录类型切换会重置筛选并重新加载', () => {
    const ctx = {
      data: { recordType: 'help' },
      setData: jest.fn((patch, cb) => cb && cb()),
      loadRecords: jest.fn()
    }
    records.setRecordType.call(ctx, { currentTarget: { dataset: { t: 'receive' } } })
    expect(ctx.setData.mock.calls[0][0]).toMatchObject({ recordType: 'receive', recordFilter: 'all' })
    expect(ctx.loadRecords).toHaveBeenCalled()
  })

  test('黑名单按工具隔离存取', () => {
    const store = {}
    global.wx.getStorageSync = jest.fn((k) => store[k] || '')
    global.wx.setStorageSync = jest.fn((k, v) => { store[k] = v })
    const ctx = { modeStateKey: () => 'tool-a' }

    commandTask.addBlockNick.call(ctx, '小明')
    commandTask.addBlockNick.call(ctx, '小明') // 去重
    expect(commandTask.getBlockList.call(ctx)).toEqual(['小明'])

    // 其他工具互不影响
    expect(commandTask.getBlockList.call({ modeStateKey: () => 'tool-b' })).toEqual([])
  })

describe('account.clearAccountCache', () => {
  test('清空缓存条目并保留版本号', () => {
    const store = {
      toolAccountCache: {
        version: 2,
        default: { tb_nick: '旧昵称', avatar_url: 'cloud://x' },
        other: { tb_nick: 'B' }
      }
    }
    global.wx = {
      getStorageSync: jest.fn((k) => store[k]),
      setStorageSync: jest.fn((k, v) => { store[k] = v })
    }
    account.clearAccountCache.call({})
    const saved = store.toolAccountCache
    expect(saved.default).toBeUndefined()
    expect(saved.other).toBeUndefined()
    expect(saved.version).toBe(2)
  })
})
})

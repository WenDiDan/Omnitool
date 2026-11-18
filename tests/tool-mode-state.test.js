/**
 * 互助工具模式状态拆分后的单元测试
 * 覆盖：模式配置（上限/初始状态）与状态方法（跨天、渲染派生、缓存恢复/持久化）。
 */

const {
  MODE_RULES,
  resolveLimits,
  createModeState
} = require('../pages/tool/modules/mode-config.js')
const modeState = require('../pages/tool/modules/mode-state.js')

function makeCtx(overrides = {}) {
  const ctx = {
    data: { activeMode: 0, settingsMode: 0, modes: [{}, {}], tool: { tool_key: 't1' } },
    _modeStates: [createModeState(0, null), createModeState(1, null)],
    setData: jest.fn(function (patch) {
      Object.assign(ctx.data, patch)
    }),
    syncCurrent: jest.fn(),
    persistModeStates: jest.fn(),
    stopTaskTimer: jest.fn(),
    modeStateKey: jest.fn(() => 't1'),
    buildSettings: modeState.buildSettings,
    ...overrides
  }
  return ctx
}

beforeEach(() => {
  global.wx = {
    getStorageSync: jest.fn(() => ''),
    setStorageSync: jest.fn()
  }
})

afterEach(() => {
  delete global.wx
})

describe('mode-config', () => {
  test('个人赛/车队默认上限分别为 10、6', () => {
    expect(resolveLimits(0, null)).toEqual({ helpLimit: 10, receiveLimit: 10 })
    expect(resolveLimits(1, null)).toEqual({ helpLimit: 6, receiveLimit: 6 })
  })

  test('工具配置可覆盖默认上限', () => {
    const tool = { daily_help_limit_team: 8, daily_receive_limit_team: 9 }
    expect(resolveLimits(1, tool)).toEqual({ helpLimit: 8, receiveLimit: 9 })
  })

  test('createModeState 生成对应模式的初始状态', () => {
    const solo = createModeState(0, null)
    const team = createModeState(1, null)
    expect(solo.key).toBe('solo')
    expect(team.key).toBe('team')
    expect(solo.helpLimit).toBe(10)
    expect(team.helpLimit).toBe(6)
    expect(solo.command).toBe('')
    expect(solo.task).toBeNull()
  })

  test('MODE_RULES 覆盖两个模式', () => {
    expect(MODE_RULES).toHaveLength(2)
    expect(MODE_RULES[0].key).toBe('solo')
    expect(MODE_RULES[1].rows.length).toBeGreaterThan(MODE_RULES[0].rows.length)
  })
})

describe('mode-state', () => {
  test('跨天后清零次数与任务', () => {
    const ctx = makeCtx()
    ctx._stateDay = '1999-01-01'
    ctx._modeStates[0].helpUsed = 3
    ctx._modeStates[1].receiveUsed = 2
    ctx._modeStates[0].task = { id: 'x' }

    modeState.ensureSameDay.call(ctx)

    expect(ctx._modeStates[0].helpUsed).toBe(0)
    expect(ctx._modeStates[1].receiveUsed).toBe(0)
    expect(ctx._modeStates[0].task).toBeNull()
    expect(ctx.syncCurrent).toHaveBeenCalled()
    expect(ctx.persistModeStates).toHaveBeenCalled()
  })

  test('同一天不重复清理', () => {
    const ctx = makeCtx()
    ctx._stateDay = new Date().toDateString()
    ctx._modeStates[0].helpUsed = 3

    modeState.ensureSameDay.call(ctx)

    expect(ctx._modeStates[0].helpUsed).toBe(3)
    expect(ctx.syncCurrent).not.toHaveBeenCalled()
  })

  test('syncCurrent 派生剩余次数、百分比与弹窗规则', () => {
    const ctx = makeCtx()
    ctx._modeStates[0].helpUsed = 3
    ctx._modeStates[0].receiveUsed = 4

    modeState.syncCurrent.call(ctx)

    expect(ctx.data.current.helpLeft).toBe(7)
    expect(ctx.data.current.receiveLeft).toBe(6)
    expect(ctx.data.current.helpPercent).toBe(30)
    expect(ctx.data.current.receivePercent).toBe(40)
    expect(ctx.data.settings.rows.length).toBeGreaterThan(0)
  })

  test('updateMode 合并字段并触发同步与持久化', () => {
    const ctx = makeCtx()
    modeState.updateMode.call(ctx, { paused: true, helpQuota: 3 }, 1)

    expect(ctx._modeStates[1].paused).toBe(true)
    expect(ctx._modeStates[1].helpQuota).toBe(3)
    expect(ctx.syncCurrent).toHaveBeenCalled()
    expect(ctx.persistModeStates).toHaveBeenCalled()
  })

  test('modeStateKey 缺失工具时回退 default', () => {
    const ctx = makeCtx({ data: { tool: null } })
    expect(modeState.modeStateKey.call(ctx)).toBe('default')
  })

  test('restoreModeStates 恢复当天次数、忽略旧上限与口令', () => {
    const today = new Date().toDateString()
    global.wx.getStorageSync = jest.fn(() => ({
      t1: {
        date: today,
        states: [
          { helpUsed: 2, receiveUsed: 1, helpLimit: 99, command: 'leak', task: { id: 't' } },
          { helpUsed: 5, helpLimit: 99 }
        ]
      }
    }))
    const ctx = makeCtx()

    modeState.restoreModeStates.call(ctx, 't1')

    expect(ctx._modeStates[0].helpUsed).toBe(2)
    expect(ctx._modeStates[1].helpUsed).toBe(5)
    expect(ctx._modeStates[0].helpLimit).toBe(10) // 上限以配置为准
    expect(ctx._modeStates[1].helpLimit).toBe(6)
    expect(ctx._modeStates[0].command).toBe('')
    expect(ctx._modeStates[0].task).toBeNull()
    expect(ctx.syncCurrent).toHaveBeenCalled()
  })

  test('persistModeStates 不落盘口令与任务', () => {
    const ctx = makeCtx()
    ctx._modeStates[0].command = 'secret'
    ctx._modeStates[0].task = { id: 'x' }

    modeState.persistModeStates.call(ctx)

    const saved = global.wx.setStorageSync.mock.calls[0][1]
    expect(saved.t1.states[0].command).toBe('')
    expect(saved.t1.states[0].task).toBeNull()
    expect(saved.t1.date).toBe(new Date().toDateString())
  })
})

/**
 * utils/history-store.js 单元测试
 * 覆盖：新增/去重置顶/数量上限/版本号自增/清空/默认上限。
 */

const store = require('../utils/history-store.js')

function makeGlobal(overrides = {}) {
  return {
    scanHistory: [],
    scanHistoryVersion: 0,
    settings: { historyLimit: 100 },
    ...overrides
  }
}

beforeEach(() => {
  global.wx = {
    setStorageSync: jest.fn(),
    getStorageSync: jest.fn(() => ({}))
  }
})

afterEach(() => {
  delete global.wx
})

describe('saveScanHistory', () => {
  test('新增记录置顶并写入存储', () => {
    const g = makeGlobal()
    store.saveScanHistory(g, { code: 'A1', type: '文本', time: '2026-11-11 10:00:00' })

    expect(g.scanHistory).toHaveLength(1)
    expect(g.scanHistory[0]).toMatchObject({ code: 'A1', count: 1, type: '文本' })
    expect(g.scanHistory[0].timestamp).toBeGreaterThan(0)
    expect(g.scanHistoryVersion).toBe(1)
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('scanHistory', g.scanHistory)
  })

  test('重复扫码累加次数并移到开头', () => {
    const g = makeGlobal()
    store.saveScanHistory(g, { code: 'A', time: 't1' })
    store.saveScanHistory(g, { code: 'B', time: 't2' })
    store.saveScanHistory(g, { code: 'A', time: 't3', count: 3 })

    expect(g.scanHistory).toHaveLength(2)
    expect(g.scanHistory[0].code).toBe('A')
    expect(g.scanHistory[0].count).toBe(3)
    expect(g.scanHistory[0].time).toBe('t3')
    expect(g.scanHistoryVersion).toBe(3)
  })

  test('超过上限截断尾部，保留最新记录', () => {
    const g = makeGlobal({ settings: { historyLimit: 2 } })
    store.saveScanHistory(g, { code: '1' })
    store.saveScanHistory(g, { code: '2' })
    store.saveScanHistory(g, { code: '3' })

    expect(g.scanHistory.map((i) => i.code)).toEqual(['3', '2'])
  })

  test('未配置时使用默认上限 100', () => {
    const g = makeGlobal({ settings: undefined })
    for (let i = 0; i < 105; i++) store.saveScanHistory(g, { code: 'c' + i })
    expect(g.scanHistory).toHaveLength(100)
  })

  test('历史数组缺失时安全初始化', () => {
    const g = makeGlobal({ scanHistory: undefined })
    store.saveScanHistory(g, { code: 'X' })
    expect(g.scanHistory[0].code).toBe('X')
  })
})

describe('clearScanHistory', () => {
  test('清空历史、写入存储并自增版本号', () => {
    const g = makeGlobal({ scanHistory: [{ code: 'A' }], scanHistoryVersion: 4 })
    store.clearScanHistory(g)

    expect(g.scanHistory).toEqual([])
    expect(g.scanHistoryVersion).toBe(5)
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('scanHistory', [])
  })

  test('清空历史不重置累计扫码统计', () => {
    const g = makeGlobal()
    store.saveScanHistory(g, { code: 'A' })
    const statsAfterScan = g.scanStats
    expect(statsAfterScan.total).toBe(1)

    store.clearScanHistory(g)
    // 统计对象保持不变（未被清零）
    expect(g.scanStats).toEqual(statsAfterScan)
    expect(g.scanStats.total).toBe(1)
  })
})

describe('getScanStats 自然日翻转', () => {
  test('跨天后今日次数归零、累计保留', () => {
    global.wx = {
      setStorageSync: jest.fn(),
      getStorageSync: jest.fn(() => ({ day: '2026-11-10', total: 20, today: 5 }))
    }
    const stats = store.getScanStats()
    expect(stats.today).toBe(0)
    expect(stats.total).toBe(20)
    expect(stats.day).toBe(store.todayKey())
  })

})

describe('restoreRecords（回收站恢复唯一写出口）', () => {
  function makeWx2(kv) {
    global.wx = {
      getStorageSync: jest.fn((k) => kv[k]),
      setStorageSync: jest.fn((k, v) => { kv[k] = v })
    }
  }

  test('恢复不存在的记录插入最前，已存在的原地合并不新增条数', () => {
    const kv = {}
    makeWx2(kv)
    const g = makeGlobal({ scanHistory: [{ code: 'A', type: 'QR', count: 1 }], settings: { historyLimit: 100 } })
    const kept = store.restoreRecords(g, [
      { code: 'B', type: 'EAN', time: 't2', count: 2 },
      { code: 'A', type: 'QR', time: 't1', count: 5 }
    ])
    expect(kept).toBe(1) // 只有 B 是新增
    expect(g.scanHistory.length).toBe(2)
    expect(g.scanHistory[0].code).toBe('B')
    const a = g.scanHistory.find(r => r.code === 'A')
    expect(a.count).toBe(5)
    expect(a.time).toBe('t1')
  })

  test('恢复受 historyLimit 上限截断：截断只发生在尾部旧记录', () => {
    const kv = {}
    makeWx2(kv)
    const existing = Array.from({ length: 100 }, (_, i) => ({ code: 'X' + i, count: 1 }))
    const g = makeGlobal({ scanHistory: existing, settings: { historyLimit: 100 } })
    const kept = store.restoreRecords(g, [
      { code: 'N1', count: 1 },
      { code: 'N2', count: 1 },
      { code: 'N3', count: 1 }
    ])
    expect(g.scanHistory.length).toBe(100) // 100 + 3 = 103 → 截断 3 条尾部旧记录
    expect(kept).toBe(3) // 新记录在头部，不会被尾部截断
    expect(g.scanHistory[0].code).toBe('N3')
    expect(g.scanHistory.find(r => r.code === 'X97')).toBeUndefined() // 尾部 3 条旧记录被截
    expect(g.scanHistory.find(r => r.code === 'X96')).toBeTruthy() // X96 及之前保留
  })

  test('恢复接近上限时只截断尾部旧记录，新增全部保留', () => {
    const kv = {}
    makeWx2(kv)
    const existing = Array.from({ length: 99 }, (_, i) => ({ code: 'X' + i, count: 1 }))
    const g = makeGlobal({ scanHistory: existing, settings: { historyLimit: 100 } })
    const kept = store.restoreRecords(g, [
      { code: 'N1', count: 1 },
      { code: 'N2', count: 1 },
      { code: 'N3', count: 1 }
    ])
    expect(g.scanHistory.length).toBe(100) // 99 + 3 = 102 → 截断 2 条尾部旧记录
    expect(kept).toBe(3) // 新增全部保留
    expect(g.scanHistory[0].code).toBe('N3') // 最后恢复的在最前
    expect(g.scanHistory.find(r => r.code === 'X97')).toBeUndefined() // 尾部旧记录被截
    expect(g.scanHistory.find(r => r.code === 'X96')).toBeTruthy()
  })

  test('恢复自增版本号，但不计入累计扫码统计', () => {
    const kv = {}
    makeWx2(kv)
    const g = makeGlobal({ scanHistory: [], scanHistoryVersion: 3, settings: { historyLimit: 100 } })
    store.restoreRecords(g, [{ code: 'B', count: 1 }])
    expect(g.scanHistoryVersion).toBe(4) // bumpVersion 生效
    expect(g.scanStats).toBeUndefined() // 恢复不是扫码事件，scanStats 不动
    expect(global.wx.setStorageSync).not.toHaveBeenCalledWith('scanStats', expect.anything())
  })

  test('无 code 的脏记录被跳过', () => {
    const kv = {}
    makeWx2(kv)
    const g = makeGlobal({ scanHistory: [], settings: { historyLimit: 100 } })
    const kept = store.restoreRecords(g, [{ type: 'QR' }, null, { code: 'C', count: 1 }])
    expect(kept).toBe(1)
    expect(g.scanHistory.length).toBe(1)
  })
})

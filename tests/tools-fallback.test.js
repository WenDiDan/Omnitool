/**
 * 工具清单云端失效兜底测试
 * 覆盖四种数据源结果：云端成功 / 云端返回空 / 云函数失败 / 请求超时
 * 重点断言：失效时一定回退到本地清单（不白屏），并给出正确的 source 供页面提示
 */

let tools

/** 每个用例重新加载模块，避免内存缓存与互斥 Promise 相互污染 */
function loadModule(callFunctionImpl) {
  jest.resetModules()
  global.wx = {
    getStorageSync: jest.fn(() => null),
    setStorageSync: jest.fn(),
    cloud: { callFunction: jest.fn(callFunctionImpl) }
  }
  tools = require('../utils/tools.js')
  return tools
}

describe('refreshTools 云端成功', () => {
  test('正常返回工具清单 → source=cloud 且写入缓存', async () => {
    loadModule(({ success }) => success({
      result: { success: true, tools: [{ tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan' }] }
    }))

    const res = await tools.refreshTools(true)

    expect(res.success).toBe(true)
    expect(res.source).toBe('cloud')
    expect(res.tools.find((t) => t.tool_key === 'scan')).toBeTruthy()
    expect(wx.setStorageSync).toHaveBeenCalled()
  })

  test('云端漏配内置工具 → 仍补齐本地内置清单（不依赖云函数部署）', async () => {
    // 模拟旧版云函数：只下发 scan / regcode，新增工具未入库
    loadModule(({ success }) => success({
      result: {
        success: true,
        tools: [
          { tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan', sort: 1 },
          { tool_key: 'regcode', name: '注册码', url: '/pages/regcode/regcode', sort: 3 }
        ]
      }
    }))

    const res = await tools.refreshTools(true)
    const keys = res.tools.map((t) => t.tool_key)

    expect(keys).toEqual(expect.arrayContaining([
      'scan', 'regcode', 'unit_convert', 'text_tools', 'date_tools'
    ]))
    // 合并后仍按 sort 升序
    expect(keys.indexOf('scan')).toBeLessThan(keys.indexOf('regcode'))
    expect(keys.indexOf('regcode')).toBeLessThan(keys.indexOf('unit_convert'))
  })

  test('云端已配置同名工具时以云端配置为准（不被内置覆盖）', async () => {
    loadModule(({ success }) => success({
      result: {
        success: true,
        tools: [{ tool_key: 'unit_convert', name: '单位换算器', url: '/pages/unit-converter/unit-converter', sort: 2 }]
      }
    }))

    const res = await tools.refreshTools(true)
    const hit = res.tools.filter((t) => t.tool_key === 'unit_convert')

    expect(hit).toHaveLength(1)
    expect(hit[0].name).toBe('单位换算器')
  })
})

describe('refreshTools 云端失效', () => {
  test('云函数调用失败 → source=error 且回退到内置清单', async () => {
    loadModule(({ fail }) => fail({ errMsg: 'cloud.callFunction:fail' }))

    const res = await tools.refreshTools(true)

    expect(res.success).toBe(false)
    expect(res.source).toBe('error')
    expect(res.tools.length).toBeGreaterThan(0) // 内置兜底清单
    expect(res.tools.find((t) => t.tool_key === 'scan')).toBeTruthy()
  })

  test('云端正常应答但清单为空 → source=empty 且返回空数组（页面据此清空计数）', async () => {
    loadModule(({ success }) => success({ result: { success: true, tools: [] } }))

    const res = await tools.refreshTools(true)

    expect(res.success).toBe(false)
    expect(res.source).toBe('empty')
    expect(res.tools).toHaveLength(0) // 确定性的空：不再混入本地清单，避免计数与列表不一致
  })

  test('云端返回业务失败（集合不存在等）→ source=error 并回退本地清单', async () => {
    loadModule(({ success }) => success({ result: { success: false, error: '集合不存在' } }))

    const res = await tools.refreshTools(true)

    // 业务失败 ≠ 确定性空：可能只是云端临时异常，回退本地清单而不是清空页面
    expect(res.source).toBe('error')
    expect(res.error).toBe('集合不存在')
    expect(res.tools.length).toBeGreaterThan(0)
  })

  test('请求超时（6 秒无响应）→ 自动重试后仍超时 → source=timeout', async () => {
    jest.useFakeTimers()
    loadModule(() => { /* 永不回调，模拟挂起 */ })

    const p = tools.refreshTools(true)
    // 第一轮超时触发自动重试（冷启动保护），第二轮仍超时才判定 timeout
    jest.advanceTimersByTime(6000)
    jest.advanceTimersByTime(6000)
    const res = await p

    expect(res.source).toBe('timeout')
    expect(res.tools.length).toBeGreaterThan(0)
    jest.useRealTimers()
  })
})

describe('云端失效后的页面可操作性', () => {
  test('兜底清单里 scan 与 regcode 的跳转地址可解析', async () => {
    loadModule(({ fail }) => fail({ errMsg: 'offline' }))
    await tools.refreshTools(true)

    expect(tools.resolveRoute('scan', '')).toBe('/pages/scan/scan')
    expect(tools.resolveRoute('regcode', '')).toBe('/pages/regcode/regcode')
  })

  test('互助类工具不在本地兜底清单（仅云端可用时展示）', async () => {
    loadModule(({ fail }) => fail({ errMsg: 'offline' }))
    const res = await tools.refreshTools(true)

    // 兜底清单只含固定内置工具
    expect(res.tools.find((t) => t.tool_key === 'tb_coin_pk')).toBeUndefined()
    expect(res.tools.map((t) => t.tool_key)).toEqual(expect.arrayContaining(['scan', 'regcode']))
    // 云端失效时取不到互助工具（页面走 notFound 提示）
    expect(tools.getTool('tb_coin_pk')).toBeNull()
  })

  test('缓存里有互助工具但云端失效 → 列表不含互助工具', async () => {
    jest.resetModules()
    // 本地缓存里存着上次云端成功时的完整清单（含互助工具）
    global.wx = {
      getStorageSync: jest.fn(() => ({
        version: require('../utils/tools.js').CACHE_VERSION || 8,
        at: Date.now(),
        list: [
          { tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan', navType: 'navigateTo' },
          { tool_key: 'tb_coin_pk', name: '淘金币互助', navType: 'navigateTo', url: '/pages/tool/tool?key=tb_coin_pk', sort: 4 },
          { tool_key: 'pdd_fruit', name: '多多水果互助', navType: 'navigateTo', url: '/pages/fruit/fruit', sort: 9 }
        ]
      })),
      setStorageSync: jest.fn(),
      cloud: { callFunction: jest.fn(({ fail }) => fail({ errMsg: 'offline' })) }
    }
    // CACHE_VERSION 内部常量不导出，这里直接构造带正确版本的缓存
    const mod = require('../utils/tools.js')
    const res = await mod.refreshTools(true)

    expect(res.source).toBe('error')
    // 云端失效 → 只显示内置工具，缓存中的线上工具（互助类）全部隐藏
    expect(res.tools.find((t) => t.tool_key === 'tb_coin_pk')).toBeUndefined()
    expect(res.tools.find((t) => t.tool_key === 'pdd_fruit')).toBeUndefined()
    expect(res.tools.find((t) => t.tool_key === 'scan')).toBeTruthy()
  })

  test('云端正常时互助工具由云端下发', async () => {
    loadModule(({ success }) => success({
      result: {
        success: true,
        tools: [
          { tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan' },
          { tool_key: 'tb_coin_pk', name: '淘金币互助', navType: 'tool', sort: 4 }
        ]
      }
    }))

    const res = await tools.refreshTools(true)

    expect(res.tools.find((t) => t.tool_key === 'tb_coin_pk')).toBeTruthy()
    expect(tools.getTool('tb_coin_pk').navType).toBe('tool')
  })

  test('云端下线的内置工具不再被内置清单补回（offline_keys 生效）', async () => {
    loadModule(({ success }) => success({
      result: {
        success: true,
        tools: [
          { tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan' }
        ],
        // 后台把 unit_convert 下线了：云端不下发，但必须通过 offline_keys 明示
        offline_keys: ['unit_convert']
      }
    }))

    const res = await tools.refreshTools(true)

    expect(res.tools.find((t) => t.tool_key === 'unit_convert')).toBeUndefined()
    // 其他内置工具仍正常补回
    expect(res.tools.find((t) => t.tool_key === 'regcode')).toBeTruthy()
    expect(res.tools.find((t) => t.tool_key === 'scan')).toBeTruthy()
  })

  test('云端失效时回退完整内置清单（本地能力优先可用，不受下线状态影响）', async () => {
    jest.resetModules()
    global.wx = {
      getStorageSync: jest.fn(() => null),
      setStorageSync: jest.fn(),
      cloud: { callFunction: jest.fn(({ fail }) => fail({ errMsg: 'offline' })) }
    }
    const mod = require('../utils/tools.js')
    const res = await mod.refreshTools(true)

    expect(res.source).toBe('error')
    // 内置清单全量展示（含云端已下线的内置工具）
    expect(res.tools.find((t) => t.tool_key === 'unit_convert')).toBeTruthy()
    expect(res.tools.find((t) => t.tool_key === 'date_tools')).toBeTruthy()
    // 线上工具（互助类）不出现
    expect(res.tools.find((t) => t.tool_key === 'tb_coin_pk')).toBeUndefined()
    expect(res.tools.find((t) => t.tool_key === 'pdd_fruit')).toBeUndefined()
  })

  test('本地缓存恢复后非强制刷新失败 → 不被内存缓存短路，仍回退内置清单', async () => {
    // 复现首页真实时序：onLoad 先 getCachedTools()（恢复旧云端快照）再 refreshTools()（非 force）
    jest.resetModules()
    global.wx = {
      getStorageSync: jest.fn(() => ({
        version: require('../utils/tools.js').CACHE_VERSION,
        at: Date.now(),
        list: [
          { tool_key: 'scan', name: '扫一扫', url: '/pages/scan/scan', navType: 'navigateTo' },
          { tool_key: 'tb_coin_pk', name: '淘金币互助', navType: 'tool', url: '', sort: 4 },
          { tool_key: 'pdd_fruit', name: '多多水果互助', navType: 'navigateTo', url: '/pages/fruit/fruit', sort: 9 }
        ]
      })),
      setStorageSync: jest.fn(),
      cloud: { callFunction: jest.fn(({ fail }) => fail({ errMsg: 'offline' })) }
    }
    const mod = require('../utils/tools.js')
    mod.getCachedTools() // 首屏渲染：填入从本地存储恢复的缓存
    const res = await mod.refreshTools() // 不带 force，验证不会被恢复的缓存短路

    expect(res.source).toBe('error')
    expect(res.tools.find((t) => t.tool_key === 'tb_coin_pk')).toBeUndefined()
    expect(res.tools.find((t) => t.tool_key === 'pdd_fruit')).toBeUndefined()
    expect(res.tools.find((t) => t.tool_key === 'scan')).toBeTruthy()
  })
})

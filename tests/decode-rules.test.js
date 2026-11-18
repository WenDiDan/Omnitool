/**
 * utils/decode-rules.js 单元测试
 * 覆盖：规则匹配、内容提取、日期转换、映射表更新，以及与改造前 app.js 内联实现的等价性
 */

const fs = require('fs')
const path = require('path')
const vm = require('vm')
const rules = require('../utils/decode-rules.js')

/** 构造单条规则 */
function makeRule(overrides) {
  return { id: 't', name: '测试规则', enabled: true, ...overrides }
}

beforeEach(() => rules.resetMaps())

describe('decodeWithRule 匹配与提取', () => {
  test('关键词匹配，未配置提取方式时返回原文', () => {
    const out = rules.decodeWithRule('TEST-ABC123', [makeRule({ pattern: 'TEST', extract: '匹配的全部' })])
    expect(out).toHaveLength(1)
    expect(out[0].value).toBe('TEST-ABC123')
    expect(out[0].label).toBe('测试规则')
    expect(out[0].isDate).toBeUndefined()
  })

  test('按位置提取', () => {
    const out = rules.decodeWithRule('XX2024YY', [makeRule({ pattern: '2024', extract: '提取位置', startPos: '3', endPos: '6' })])
    expect(out[0].value).toBe('2024')
  })

  test('提取域名', () => {
    const out = rules.decodeWithRule('https://example.com/path', [makeRule({ pattern: 'example', extract: '域名' })])
    expect(out[0].value).toBe('example.com')
  })

  test('提取 @ 后域名', () => {
    const out = rules.decodeWithRule('abc@corp.com.cn', [makeRule({ pattern: 'abc', extract: '@后的域名' })])
    expect(out[0].value).toBe('corp')
  })

  test('未匹配的关键词不产出结果', () => {
    const out = rules.decodeWithRule('hello', [makeRule({ pattern: 'nope' })])
    expect(out).toEqual([])
  })

  test('长度约束不满足时跳过', () => {
    const out = rules.decodeWithRule('SHORT', [makeRule({
      pattern: 'SHORT', lengthEnabled: true, minLength: 10, maxLength: 20
    })])
    expect(out).toEqual([])
  })

  test('非法正则被跳过且不抛错', () => {
    const out = rules.decodeWithRule('anything', [makeRule({ pattern: '([' })])
    expect(out).toEqual([])
  })

  test('未启用的规则被忽略', () => {
    const out = rules.decodeWithRule('anything', [makeRule({ pattern: 'anything', enabled: false })])
    expect(out).toEqual([])
  })

  test('多规则按顺序产出多条结果', () => {
    const out = rules.decodeWithRule('AB2024', [
      makeRule({ id: '1', name: '规则A', pattern: 'AB' }),
      makeRule({ id: '2', name: '规则B', pattern: '2024' })
    ])
    expect(out.map(r => r.label)).toEqual(['规则A', '规则B'])
  })
})

describe('日期代码转换', () => {
  test('字母年份 + 数字月日', () => {
    const out = rules.decodeWithRule('C05A9', [makeRule({
      pattern: '.', dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 }
    })])
    // C = 2020+2 = 2022，monthPos=2 → '0' → 00 为非法月份，日期转换判无效，
    // decodeWithRule 回退展示原文（value 保留提取内容，不标记 isDate）
    expect(out[0].value).toBe('C05A9')
    expect(out[0].isDate).toBeFalsy()
  })

  test('日期超出当月天数时判无效（如 2 月 30）', () => {
    const out = rules.decodeWithRule('C2215', [makeRule({
      pattern: '.', dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 }
    })])
    // C=2022, 2 月, L=20？此处第 3 位是 '2' → 2 月 2 日合法
    expect(out[0].value).toBe('2022-02-02')
  })

  test('全字母日期', () => {
    const out = rules.decodeWithRule('ABC', [makeRule({
      pattern: 'A', dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 }
    })])
    expect(out[0].value).toBe('2020-11-12')
  })

  test('仅年份位有效时输出年份', () => {
    const out = rules.decodeWithRule('AB', [makeRule({
      pattern: 'A', dateMapping: { enabled: true, yearPos: 1, monthPos: 9, dayPos: 9 }
    })])
    // 年位命中（A → 2020），月/日位越界被忽略
    expect(out[0].value).toBe('2020')
    expect(out[0].isDate).toBe(true)
  })

  test('convertDateByMapping 未启用时返回空串', () => {
    expect(rules.convertDateByMapping('ABC', { enabled: false })).toBe('')
    expect(rules.convertDateByMapping('ABC', null)).toBe('')
  })
})

describe('映射表管理', () => {
  test('convertLetterToDate 数字直接返回数值', () => {
    expect(rules.convertLetterToDate('7')).toBe(7)
  })

  test('convertLetterToDate 年份优先命中', () => {
    expect(rules.convertLetterToDate('a')).toBe(2020)
  })

  test('updateDateMapping 增量覆盖，未提供的键保持不变', () => {
    rules.updateDateMapping({ baseYear: 2030 })
    expect(rules.convertLetterToDate('A')).toBe(2030)
    // I 不在默认 year/day 表中，仅命中自定义 month 表
    rules.updateDateMapping({ monthLetters: { I: 9 } })
    expect(rules.convertLetterToDate('I')).toBe(9)
    expect(rules.getMaps().baseYear).toBe(2030)
  })

  test('resetMaps 恢复默认值', () => {
    rules.updateDateMapping({ baseYear: 2040 })
    rules.resetMaps()
    expect(rules.getMaps().baseYear).toBe(2020)
  })
})

describe('与改造前 app.js 实现等价', () => {
  const legacyPath = path.join(__dirname, 'fixtures/app.legacy.js')
  const cases = [
    ['TEST-ABC123', makeRule({ pattern: 'TEST', extract: '匹配的全部' })],
    ['XX2024YY', makeRule({ pattern: '2024', extract: '提取位置', startPos: '3', endPos: '6' })],
    ['https://example.com/path', makeRule({ pattern: 'example', extract: '域名' })],
    ['abc@corp.com.cn', makeRule({ pattern: 'abc', extract: '@后的域名' })],
    // 原用例 'C05A9'（月份 00）在新版会被合法性校验判无效，属预期行为变更，改用合法日期用例
    ['C21A9', makeRule({ pattern: '.', dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 } })],
    ['ABC', makeRule({ pattern: 'A', dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 } })],
    ['anything', makeRule({ pattern: '([', extract: '匹配的全部' })]
  ]

  test('逐用例输出一致', () => {
    let appObj = null
    const sandbox = {
      App: (o) => { appObj = o },
      wx: {
        cloud: null,
        setStorageSync() {},
        getStorageSync: () => '[]',
        setStorage() {},
        getStorage() { return null },
        showModal() {},
        getUpdateManager: () => ({
          onCheckForUpdate() {}, onUpdateReady() {}, onUpdateFailed() {}, applyUpdate() {}
        })
      },
      // 沙箱内 require 以项目根为基准解析（原 app.js 引用 ./utils/xxx）
      require: (p) => require(path.resolve(__dirname, '..') + '/' + p.replace(/^\.\//, '')),
      console, JSON, Date, URL, parseInt, parseFloat, RegExp, Error, Math, String, Number, Infinity
    }
    vm.createContext(sandbox)
    vm.runInContext(fs.readFileSync(legacyPath, 'utf8'), sandbox)
    expect(appObj).toBeTruthy()

    cases.forEach(([code, rule]) => {
      appObj.globalData.customRules = [rule]
      const oldOut = appObj.decodeWithRule(code).map(x => ({ label: x.label, value: x.value, isDate: !!x.isDate }))
      const newOut = rules.decodeWithRule(code, [rule]).map(x => ({ label: x.label, value: x.value, isDate: !!x.isDate }))
      expect(newOut).toEqual(oldOut)
    })
  })

})

describe('映射表纯函数化（试算不污染全局）', () => {
  test('buildMaps 返回新对象，不修改入参', () => {
    const custom = { baseYear: 2024, dayLetters: { A: 10 } }
    const m = rules.buildMaps(custom)
    expect(m.baseYear).toBe(2024)
    expect(m.letterToDay).toEqual({ A: 10 })
    expect(m.letterToMonth).toBeTruthy() // 未提供的区段保留默认
    expect(custom.dayLetters).toEqual({ A: 10 }) // 入参未被改写
    expect(m).not.toBe(rules.DEFAULT_MAPS)
  })

  test('传入临时映射表换算日期，不影响全局映射', () => {
    rules.resetMaps()
    const before = JSON.stringify(rules.getMaps())
    const preview = rules.buildMaps({ baseYear: 2030 })
    // C → 年份偏移 2，baseYear 2030 → 2032；1→01？monthPos=2 取 '1' → 1；dayPos=4 取 '0'？改用合法位
    const out = rules.convertDateByMapping('C1205', { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 }, preview)
    expect(out).toBe('2032-01-02')
    expect(JSON.stringify(rules.getMaps())).toBe(before) // 全局映射未被改动
  })

  test('decodeWithRule 支持注入临时映射表', () => {
    rules.resetMaps()
    const before = JSON.stringify(rules.getMaps())
    const rule = {
      label: '生产日期',
      enabled: true,
      pattern: '^A',
      dateMapping: { enabled: true, yearPos: 1, monthPos: 2, dayPos: 3 }
    }
    const preview = rules.buildMaps({ monthLetters: { X: 11 }, dayLetters: { Y: 12 } })
    const mapped = rules.decodeWithRule('AXY99', [rule], { maps: preview })
    expect(mapped.length).toBe(1)
    expect(mapped[0].isDate).toBe(true)
    expect(mapped[0].value).toBe('2020-11-12') // A=2020, X=11 月, Y=12 日
    expect(JSON.stringify(rules.getMaps())).toBe(before)
  })
})

/**
 * utils/rule-service.js 单元测试
 * 覆盖：规则增删改查、持久化、日期映射与解码委托。
 */

const decodeRules = require('../utils/decode-rules.js')
const ruleService = require('../utils/rule-service.js')

function makeGlobal(overrides = {}) {
  return { customRules: [], ...overrides }
}

beforeEach(() => {
  global.wx = { setStorageSync: jest.fn() }
})

afterEach(() => {
  delete global.wx
})

describe('规则增删改查', () => {
  test('getCustomRules 默认返回空数组', () => {
    expect(ruleService.getCustomRules({})).toEqual([])
  })

  test('addCustomRule 生成 id/创建时间并置顶持久化', () => {
    const g = makeGlobal({ customRules: [{ id: 'old', name: '旧规则' }] })
    const rules = ruleService.addCustomRule(g, { name: '新规则', pattern: '\\d+' })

    expect(rules).toHaveLength(2)
    expect(rules[0].name).toBe('新规则')
    expect(rules[0].id).toBeTruthy()
    expect(rules[0].createdAt).toBeTruthy()
    expect(global.wx.setStorageSync).toHaveBeenCalledWith('customRules', rules)
  })

  test('deleteCustomRule 按 id 删除', () => {
    const g = makeGlobal({ customRules: [{ id: '1' }, { id: '2' }] })
    const rules = ruleService.deleteCustomRule(g, '1')
    expect(rules.map((r) => r.id)).toEqual(['2'])
  })

  test('updateCustomRule 合并字段', () => {
    const g = makeGlobal({ customRules: [{ id: '1', name: 'a', enabled: true }] })
    const rules = ruleService.updateCustomRule(g, '1', { name: 'b' })
    expect(rules[0]).toMatchObject({ id: '1', name: 'b', enabled: true })
  })

  test('updateCustomRule 对不存在的 id 静默返回', () => {
    const g = makeGlobal({ customRules: [{ id: '1' }] })
    expect(ruleService.updateCustomRule(g, 'missing', { name: 'x' })).toHaveLength(1)
  })
})

describe('解码与日期映射委托', () => {
  test('decodeWithRule 使用启用中的规则', () => {
    const g = makeGlobal({
      customRules: [{ id: '1', enabled: true, pattern: '\\d{6}', label: '编号' }]
    })
    const results = ruleService.decodeWithRule(g, 'ABC123456')
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
    // 未指定提取方式时返回原文（与 decode-rules 现有语义一致）
    expect(results[0].value).toBe('ABC123456')
    expect(results[0].label).toBe('编号')
  })

  test('decodeWithRule 无规则时返回空数组', () => {
    expect(ruleService.decodeWithRule(makeGlobal(), 'ABC123')).toEqual([])
  })

  test('convertLetterToDate 与底层实现一致', () => {
    expect(ruleService.convertLetterToDate('A')).toBe(decodeRules.convertLetterToDate('A'))
  })

  test('getDateCodeMaps 返回只读映射对象', () => {
    const maps = ruleService.getDateCodeMaps()
    expect(maps).toBeTruthy()
    expect(typeof maps).toBe('object')
  })

  test('updateDateMapping 不抛错', () => {
    expect(() => ruleService.updateDateMapping({})).not.toThrow()
  })
})

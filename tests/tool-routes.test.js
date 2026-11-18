/**
 * utils/tools.js 路由解析测试
 * 覆盖：本地路由表优先、云端 url 归一化（含分包旧路径 / 缺失前导斜杠）、空值兜底
 */

const toolsService = require('../utils/tools.js')

describe('resolveRoute 本地路由表优先', () => {
  test('regcode 使用内置路径（忽略云端旧路径）', () => {
    expect(toolsService.resolveRoute('regcode', '/package1/pages/regcode/regcode'))
      .toBe('/pages/regcode/regcode')
  })

  test('scan 使用内置路径', () => {
    expect(toolsService.resolveRoute('scan', '')).toBe('/pages/scan/scan')
  })

  test('云端 url 完全错误时仍走内置路径', () => {
    expect(toolsService.resolveRoute('regcode', '/whatever/broken'))
      .toBe('/pages/regcode/regcode')
  })
})

describe('resolveRoute 云端 url 归一化（未内置的工具）', () => {
  test('标准主包路径原样返回', () => {
    expect(toolsService.resolveRoute('custom', '/pages/some/some')).toBe('/pages/some/some')
  })

  test('分包旧路径归一化为主包路径', () => {
    expect(toolsService.resolveRoute('custom', '/package1/pages/some/some'))
      .toBe('/pages/some/some')
  })

  test('缺少前导斜杠也能修正', () => {
    expect(toolsService.resolveRoute('custom', 'package1/pages/some/some'))
      .toBe('/pages/some/some')
  })

  test('带查询参数保持完整', () => {
    expect(toolsService.resolveRoute('custom', '/pages/some/some?id=1'))
      .toBe('/pages/some/some?id=1')
  })

  test('空值返回空串', () => {
    expect(toolsService.resolveRoute('custom', '')).toBe('')
    expect(toolsService.resolveRoute('custom', '   ')).toBe('')
    expect(toolsService.resolveRoute('custom', null)).toBe('')
  })
})

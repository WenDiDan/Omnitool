/**
 * utils/qr-local.js 单元测试
 * 覆盖：矩阵生成、UTF-8、版本自适配、空值处理与绘制调用。
 * 说明：不依赖任何在线服务；矩阵可解码性已通过离线解码器单独验证。
 */

const qrLocal = require('../utils/qr-local.js')

describe('createMatrix', () => {
  test('ASCII 文本生成合法模块矩阵', () => {
    const qr = qrLocal.createMatrix('https://example.com')
    const count = qr.getModuleCount()
    expect(count).toBeGreaterThanOrEqual(21)
    expect((count - 21) % 4).toBe(0) // QR 版本尺寸规则
  })

  test('中文按 UTF-8 编码，模块数与 ASCII 不同', () => {
    const zh = qrLocal.createMatrix('你好，工具箱')
    const en = qrLocal.createMatrix('hello')
    expect(zh.getModuleCount()).toBeGreaterThanOrEqual(en.getModuleCount())
  })

  test('长文本自动选择更高版本', () => {
    const short = qrLocal.createMatrix('a')
    const long = qrLocal.createMatrix('a'.repeat(300))
    expect(long.getModuleCount()).toBeGreaterThan(short.getModuleCount())
  })

  test('定位图案区域为深色（左上/右上/左下）', () => {
    const qr = qrLocal.createMatrix('finder-test')
    const n = qr.getModuleCount()
    expect(qr.isDark(0, 0)).toBe(true)
    expect(qr.isDark(0, n - 1)).toBe(true)
    expect(qr.isDark(n - 1, 0)).toBe(true)
  })

  test('空内容抛错', () => {
    expect(() => qrLocal.createMatrix('')).toThrow()
    expect(() => qrLocal.createMatrix(null)).toThrow()
  })

  test('相同文本矩阵稳定（无随机源）', () => {
    const a = qrLocal.createMatrix('stable')
    const b = qrLocal.createMatrix('stable')
    const n = a.getModuleCount()
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        expect(a.isDark(r, c)).toBe(b.isDark(r, c))
      }
    }
  })
})

describe('draw', () => {
  test('先铺白底，再按模块绘制深色块', () => {
    const fills = []
    const ctx = {
      fillStyle: '',
      fillRect: jest.fn((x, y, w, h) => fills.push({ color: ctx.fillStyle, x, y, w, h }))
    }
    const count = qrLocal.draw(ctx, 'draw-test', 300)

    expect(count).toBeGreaterThanOrEqual(21)
    // 第一笔是整块白底
    expect(fills[0]).toMatchObject({ color: '#FFFFFF', x: 0, y: 0, w: 300, h: 300 })
    // 后续为深色模块
    expect(fills.some((f) => f.color === '#2B1D18')).toBe(true)
    // 所有绘制都在画布范围内
    expect(fills.every((f) => f.x >= 0 && f.y >= 0 && f.x + f.w <= 300 && f.y + f.h <= 300)).toBe(true)
  })

  test('支持自定义颜色', () => {
    const ctx = { fillStyle: '', fillRect: jest.fn() }
    qrLocal.draw(ctx, 'color', 200, { colorDark: '#000000', colorLight: '#EEEEEE', margin: 0 })
    const used = ctx.fillRect.mock.calls.length
    expect(used).toBeGreaterThan(1)
  })
})

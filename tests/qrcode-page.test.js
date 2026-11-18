/**
 * 二维码创建页：输入防抖与卸载清理（第 7 项回归）
 */

let pageDef

global.Page = (def) => { pageDef = def }
global.getApp = () => ({ globalData: {} })
global.wx = {}

require('../pages/scan/qrcode/qrcode.js')

function makeCtx() {
  const ctx = {
    data: { inputText: '', canGenerate: false },
    setData: jest.fn(function (patch) { Object.assign(ctx.data, patch) })
  }
  return ctx
}

describe('qrcode page input debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('输入后 150ms 才更新 canGenerate，定时器不挂在 data 上', () => {
    const ctx = makeCtx()
    pageDef.onInput.call(ctx, { detail: { value: 'abc' } })

    expect(ctx._inputTimer).toBeTruthy()
    expect(ctx.data._inputTimer).toBeUndefined()
    expect(ctx.setData).toHaveBeenCalledWith({ inputText: 'abc' })

    jest.advanceTimersByTime(150)
    expect(ctx.setData).toHaveBeenCalledWith({ canGenerate: true })
  })

  test('连续输入会取消上一个定时器', () => {
    const ctx = makeCtx()
    pageDef.onInput.call(ctx, { detail: { value: 'a' } })
    const first = ctx._inputTimer
    pageDef.onInput.call(ctx, { detail: { value: 'ab' } })

    expect(ctx._inputTimer).not.toBe(first)
    jest.advanceTimersByTime(150)
    // 只有最后一次的 canGenerate 生效
    expect(ctx.setData).toHaveBeenLastCalledWith({ canGenerate: true })
    expect(jest.getTimerCount()).toBe(0)
  })

  test('onUnload 清理未执行的定时器', () => {
    const ctx = makeCtx()
    pageDef.onInput.call(ctx, { detail: { value: 'abc' } })
    expect(jest.getTimerCount()).toBe(1)

    pageDef.onUnload.call(ctx)

    expect(ctx._inputTimer).toBeNull()
    expect(jest.getTimerCount()).toBe(0)
    expect(ctx.setData).not.toHaveBeenCalledWith({ canGenerate: true })
  })
})

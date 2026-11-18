/**
 * pages/scan/utils/scan-utils.js 单元测试
 * 覆盖：时间格式化/解析、日界与周界、记录时间戳、类型标签、
 *       相对时间、自定义规则合并、解码兜底、复制文本。
 */

const utils = require('../pages/scan/utils/scan-utils.js')

describe('formatDateTime / formatDate', () => {
  test('格式化为 YYYY-MM-DD HH:mm:ss', () => {
    expect(utils.formatDateTime(new Date(2026, 10, 11, 9, 5, 3))).toBe('2026-11-11 09:05:03')
  })

  test('非法 Date 返回空串', () => {
    expect(utils.formatDateTime(new Date('bad'))).toBe('')
    expect(utils.formatDate(new Date('bad'))).toBe('')
  })

  test('formatDate 输出日期', () => {
    expect(utils.formatDate(new Date(2026, 0, 2))).toBe('2026-01-02')
  })
})

describe('parseDateTime', () => {
  test('解析标准时间文本', () => {
    const d = utils.parseDateTime('2026-11-11 10:20:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(10)
    expect(d.getDate()).toBe(11)
    expect(d.getHours()).toBe(10)
    expect(d.getMinutes()).toBe(20)
    expect(d.getSeconds()).toBe(30)
  })

  test('支持斜杠与缺省秒', () => {
    const d = utils.parseDateTime('2026/01/02 03:04')
    expect(d.getMonth()).toBe(0)
    expect(d.getSeconds()).toBe(0)
  })

  test('支持时间戳输入', () => {
    expect(utils.parseDateTime(0).getTime()).toBe(0)
  })

  test('空值与非法文本返回 null', () => {
    expect(utils.parseDateTime('')).toBeNull()
    expect(utils.parseDateTime(null)).toBeNull()
    expect(utils.parseDateTime('not-a-date')).toBeNull()
  })
})

describe('getTodayRange / getWeekStart', () => {
  test('今日区间为左闭右开的一天', () => {
    const { start, end } = utils.getTodayRange(new Date(2026, 10, 11, 15, 0, 0))
    expect(end - start).toBe(utils.DAY_MS)
    expect(start).toBe(new Date(2026, 10, 11).getTime())
  })

  test('周界为周日 00:00（2026-11-11 周三）', () => {
    const weekStart = utils.getWeekStart(new Date(2026, 10, 11, 15, 0, 0))
    expect(weekStart).toBe(new Date(2026, 10, 8).getTime())
  })
})

describe('getRecordTs', () => {
  test('优先使用 timestamp', () => {
    expect(utils.getRecordTs({ timestamp: 123, time: '2026-11-11 00:00:00' })).toBe(123)
  })

  test('无 timestamp 时解析 time', () => {
    const ts = utils.getRecordTs({ time: '2026-11-11 08:00:00' })
    expect(ts).toBe(new Date(2026, 10, 11, 8, 0, 0).getTime())
  })

  test('脏数据返回 0', () => {
    expect(utils.getRecordTs(null)).toBe(0)
    expect(utils.getRecordTs({})).toBe(0)
    expect(utils.getRecordTs({ time: 'x' })).toBe(0)
  })
})

describe('getTypeLabel', () => {
  test('常见类型映射', () => {
    expect(utils.getTypeLabel('EAN-13')).toBe('EAN')
    expect(utils.getTypeLabel('二维码')).toBe('QR')
    expect(utils.getTypeLabel('URL')).toBe('URL')
    expect(utils.getTypeLabel('WiFi二维码')).toBe('WiFi')
    expect(utils.getTypeLabel('vCard名片')).toBe('Card')
    expect(utils.getTypeLabel('电话')).toBe('TEL')
    expect(utils.getTypeLabel('邮箱')).toBe('Mail')
  })

  test('未知类型取前三位大写，空值兜底', () => {
    expect(utils.getTypeLabel('pdf417')).toBe('PDF')
    expect(utils.getTypeLabel('')).toBe('?')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 10, 11, 12, 0, 0).getTime()

  test('一分钟内为刚刚', () => {
    expect(utils.formatRelativeTime(now - 30 * 1000, now)).toBe('刚刚')
  })

  test('未来时间按刚刚处理', () => {
    expect(utils.formatRelativeTime(now + 5000, now)).toBe('刚刚')
  })

  test('分钟/小时/昨天/日期', () => {
    expect(utils.formatRelativeTime(now - 5 * 60000, now)).toBe('5分钟前')
    expect(utils.formatRelativeTime(now - 3 * 3600000, now)).toBe('3小时前')
    expect(utils.formatRelativeTime(now - 30 * 3600000, now)).toBe('昨天')
    expect(utils.formatRelativeTime(now - 5 * 86400000, now)).toBe('11-06')
  })

  test('支持时间文本，非法返回空串', () => {
    expect(utils.formatRelativeTime('2026-11-11 11:30:00', now)).toBe('30分钟前')
    expect(utils.formatRelativeTime('bad', now)).toBe('')
  })
})

describe('mergeCustomRuleResults', () => {
  test('合并首条命中结果', () => {
    const decoded = { type: '文本' }
    const merged = utils.mergeCustomRuleResults(decoded, [{ value: '2026-01-01', label: '生产日期' }])
    expect(merged.customData).toBe('2026-01-01')
    expect(merged.customLabel).toBe('生产日期')
    expect(merged.customRuleResults).toHaveLength(1)
  })

  test('无 label 时使用默认文案', () => {
    const merged = utils.mergeCustomRuleResults({}, [{ value: 'x' }])
    expect(merged.customLabel).toBe('自定义')
  })

  test('空结果不修改对象', () => {
    const decoded = { type: '文本' }
    expect(utils.mergeCustomRuleResults(decoded, [])).toBe(decoded)
    expect(decoded.customData).toBeUndefined()
  })

  test('入参缺失时安全返回', () => {
    expect(utils.mergeCustomRuleResults(null, null)).toEqual({})
  })
})

describe('fallbackDecoded / isCancelError', () => {
  test('兜底结果保留原文', () => {
    const r = utils.fallbackDecoded('ABC')
    expect(r.type).toBe('文本')
    expect(r.data).toBe('ABC')
    expect(r.length).toBe(3)
  })

  test('空值兜底为空文本', () => {
    expect(utils.fallbackDecoded(null).data).toBe('')
  })

  test('识别取消错误', () => {
    expect(utils.isCancelError({ errMsg: 'scanCode:fail cancel' })).toBe(true)
    expect(utils.isCancelError({ message: 'user cancel' })).toBe(true)
    expect(utils.isCancelError({ errMsg: 'scanCode:fail' })).toBe(false)
    expect(utils.isCancelError(null)).toBe(false)
  })
})

describe('copyText', () => {
  afterEach(() => {
    delete global.wx
  })

  test('空内容直接返回 false', async () => {
    global.wx = { setClipboardData: jest.fn() }
    await expect(utils.copyText('')).resolves.toBe(false)
    expect(global.wx.setClipboardData).not.toHaveBeenCalled()
  })

  test('复制成功返回 true 并提示', async () => {
    global.wx = {
      setClipboardData: ({ success }) => success(),
      showToast: jest.fn()
    }
    await expect(utils.copyText('abc', '已复制')).resolves.toBe(true)
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '已复制', icon: 'success', duration: 1500 })
  })

  test('长文案使用无图标提示，避免截断', async () => {
    global.wx = {
      setClipboardData: ({ success }) => success(),
      showToast: jest.fn()
    }
    await utils.copyText('https://a.com', '链接已复制，请到浏览器打开')
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: '链接已复制，请到浏览器打开',
      icon: 'none',
      duration: 2000
    })
  })

  test('成功文案为空时不提示', async () => {
    global.wx = {
      setClipboardData: ({ success }) => success(),
      showToast: jest.fn()
    }
    await utils.copyText('abc', '')
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test('复制失败返回 false 并提示失败', async () => {
    global.wx = {
      setClipboardData: ({ fail }) => fail(),
      showToast: jest.fn()
    }
    await expect(utils.copyText('abc')).resolves.toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: '复制失败', icon: 'none' })
  })
})

describe('playBeep / disposeBeep', () => {
  afterEach(() => {
    utils.disposeBeep()
    delete global.wx
  })

  test('复用同一音频实例', () => {
    const audio = {
      src: '',
      stop: jest.fn(),
      play: jest.fn(),
      destroy: jest.fn(),
      onError: jest.fn()
    }
    global.wx = { createInnerAudioContext: jest.fn(() => audio) }

    utils.playBeep()
    utils.playBeep()

    expect(global.wx.createInnerAudioContext).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe('/images/scan_beep.wav')
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  test('dispose 后销毁实例，再次播放会重建', () => {
    const audio = {
      src: '',
      stop: jest.fn(),
      play: jest.fn(),
      destroy: jest.fn(),
      onError: jest.fn()
    }
    global.wx = { createInnerAudioContext: jest.fn(() => audio) }

    utils.playBeep()
    utils.disposeBeep()
    expect(audio.destroy).toHaveBeenCalledTimes(1)

    utils.playBeep()
    expect(global.wx.createInnerAudioContext).toHaveBeenCalledTimes(2)
  })

  test('创建音频异常时不抛出', () => {
    global.wx = {
      createInnerAudioContext: () => {
        throw new Error('audio unavailable')
      }
    }
    expect(() => utils.playBeep()).not.toThrow()
  })
})

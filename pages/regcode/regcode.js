Page({
  data: {
    mode: 'generate',
    deviceCode: '',
    dateStr: '',
    codes: [],
    randomNums: [],
    hexNums: [],
    randomNumsText: '',
    hexNumsText: '',
    showParams: false,
    showParamsDetail: false,
    deviceCodeError: '',
    // 解析模式
    parseBatchInput: '',
    parseDateStr: '',
    parseResult: null,
    // 权限
    hasPermission: false,
    permissionChecking: true
  },

  onLoad() {
    this.checkPermission()
  },

  // 检查 VIP 权限（level >= 2 即 VIP 或 admin）
  checkPermission() {
    const isLoggedIn = wx.getStorageSync('isLoggedIn')
    if (!isLoggedIn) {
      this.setData({ hasPermission: false, permissionChecking: false })
      return
    }
    wx.cloud.callFunction({
      name: 'userManage',
      data: { action: 'checkPermission', requiredLevel: 2 },
      success: (res) => {
        const has = res.result && res.result.success && res.result.hasPermission
        this.setData({ hasPermission: !!has, permissionChecking: false })
      },
      fail: () => {
        this.setData({ hasPermission: false, permissionChecking: false })
      }
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ mode })
  },

  // ===== 生成模式 =====
  onDeviceCodeInput(e) {
    const deviceCode = e.detail.value
    let deviceCodeError = ''
    if (deviceCode.length > 0 && (deviceCode.length < 4 || !/^\d+$/.test(deviceCode))) {
      deviceCodeError = '设备编码需要至少4位数字'
    }
    this.setData({ deviceCode, deviceCodeError })
  },

  clearDeviceCode() {
    this.setData({ deviceCode: '', deviceCodeError: '' })
  },

  onDateChange(e) {
    this.setData({ dateStr: e.detail.value })
  },

  setToday() {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    this.setData({ dateStr: `${y}-${m}-${d}` })
  },

  toggleParams() {
    this.setData({ showParamsDetail: !this.data.showParamsDetail })
  },

  generate() {
    const { deviceCode, dateStr } = this.data
    if (!deviceCode || deviceCode.length < 4 || !/^\d+$/.test(deviceCode)) {
      this.setData({ deviceCodeError: '设备编码需要至少4位数字' })
      return
    }
    if (!dateStr) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }

    const randomNums = this.generateRandomNums()
    if (!randomNums) {
      wx.showToast({ title: '随机数生成失败，请重试', icon: 'none' })
      return
    }

    const hexNums = randomNums.map(n => n.toString(16).toUpperCase().padStart(4, '0'))
    const parts = dateStr.split('-')
    const yearStr = parts[0]
    const monthStr = parts[1]
    const dayStr = parts[2]
    const deviceLast4 = parseInt(deviceCode.slice(-4))

    const codes = new Array(7)
    codes[0] = parseInt(String(randomNums[0]) + dayStr[1])
    codes[2] = parseInt(String(randomNums[1]) + dayStr[0])
    codes[3] = parseInt(String(randomNums[2]) + monthStr[1])
    codes[4] = parseInt(String(randomNums[3]) + monthStr[0])
    codes[5] = parseInt(String(randomNums[4]) + yearStr[3])
    codes[6] = parseInt(String(randomNums[5]) + yearStr[2])

    let xorValue = 0
    for (let i = 0; i < 7; i++) {
      if (i !== 1) xorValue ^= codes[i]
    }
    codes[1] = xorValue ^ deviceLast4

    this.setData({
      codes,
      randomNums,
      hexNums,
      // WXML 不支持 join()，文本在 JS 侧拼好
      randomNumsText: randomNums.join(', '),
      hexNumsText: hexNums.join(', '),
      showParams: true,
      showParamsDetail: false
    })
    wx.vibrateShort()
  },

  generateRandomNums() {
    const nums = []
    let attempts = 0
    while (nums.length < 6 && attempts < 10000) {
      attempts++
      const num = Math.floor(Math.random() * 1900) + 100
      const numStr = String(num)
      if (numStr.includes('00')) continue
      let adjacentDiffOne = false
      for (let i = 0; i < numStr.length - 1; i++) {
        if (Math.abs(parseInt(numStr[i]) - parseInt(numStr[i + 1])) === 1) {
          adjacentDiffOne = true
          break
        }
      }
      if (adjacentDiffOne) continue
      nums.push(num)
    }
    return nums.length === 6 ? nums : null
  },

  copyCode(e) {
    const code = e.currentTarget.dataset.code
    const index = e.currentTarget.dataset.index
    wx.setClipboardData({
      data: String(code),
      success: () => { wx.showToast({ title: `注册码${index + 1}已复制`, icon: 'success' }) },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  },

  copyAll() {
    const text = this.data.codes.map((c, i) => `注册码${i + 1}: ${c}`).join('\n')
    wx.setClipboardData({
      data: text,
      success: () => { wx.showToast({ title: '已全部复制', icon: 'success' }) },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  },

  // ===== 解析模式 =====
  onParseBatchInput(e) {
    this.setData({ parseBatchInput: e.detail.value, parseResult: null })
  },

  onParseDateChange(e) {
    this.setData({ parseDateStr: e.detail.value })
  },

  pasteParseInput() {
    wx.getClipboardData({
      success: (res) => {
        if (res.data) {
          this.setData({ parseBatchInput: res.data, parseResult: null })
        }
      },
      fail: () => { wx.showToast({ title: '剪切板读取失败', icon: 'none' }) }
    })
  },

  clearParseInput() {
    this.setData({ parseBatchInput: '', parseResult: null })
  },

  parseCodes() {
    const { parseBatchInput, parseDateStr } = this.data

    const lines = parseBatchInput.split('\n')
    const codes = []
    for (const line of lines) {
      const colonMatch = line.match(/[:：]\s*(-?\d+)/)
      if (colonMatch) {
        codes.push(parseInt(colonMatch[1]))
      } else {
        const nums = line.match(/-?\d+/g)
        if (nums) {
          nums.forEach(n => codes.push(parseInt(n)))
        }
      }
    }

    if (codes.length < 7) {
      wx.showToast({ title: '请输入至少7个注册码', icon: 'none' })
      return
    }

    if (codes.some(c => isNaN(c))) {
      wx.showToast({ title: '注册码格式不正确', icon: 'none' })
      return
    }

    const dayOnes = codes[0] % 10
    const dayTens = codes[2] % 10
    const day = String(dayTens) + String(dayOnes)

    const monthOnes = codes[3] % 10
    const monthTens = codes[4] % 10
    const month = String(monthTens) + String(monthOnes)

    const yearOnes = codes[5] % 10
    const yearTens = codes[6] % 10
    const yearPartial = String(yearTens) + String(yearOnes)

    const randomNums = [
      Math.floor(codes[0] / 10),
      Math.floor(codes[2] / 10),
      Math.floor(codes[3] / 10),
      Math.floor(codes[4] / 10),
      Math.floor(codes[5] / 10),
      Math.floor(codes[6] / 10)
    ].map(v => ({
      hex: v.toString(16).toUpperCase().padStart(4, '0'),
      dec: v
    }))

    let xorAll = 0
    for (let i = 0; i < 7; i++) {
      if (i !== 1) xorAll ^= codes[i]
    }
    // codes[1] 由 xor 关系推导而来，无法自行证明真伪；
    // 这里只校验结构（日/月范围），UI 文案应展示为「结构校验」
    const deviceLast4 = codes[1] ^ xorAll
    const dayNum = parseInt(day, 10)
    const monthNum = parseInt(month, 10)
    const valid = dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12

    let dateMatch = null
    let extractedDate = `20${yearPartial}-${month}-${day}`
    if (parseDateStr) {
      const parts = parseDateStr.split('-')
      const y = parts[0], m = parts[1], d = parts[2]
      dateMatch = (d === day && m === month && y[2] === String(yearTens) && y[3] === String(yearOnes))
      extractedDate = parseDateStr
    }

    const parseResult = {
      rawCodes: codes.slice(0, 7),
      valid,
      deviceLast4,
      day,
      month,
      yearTens,
      yearOnes,
      yearPartial,
      extractedDate,
      dateMatch,
      randomNums
    }

    this.setData({ parseResult })
    wx.vibrateShort()
  },

  copyParseResult() {
    const r = this.data.parseResult
    if (!r) return
    const lines = [
      `结构校验: ${r.valid ? '通过' : '不通过'}`,
      `设备编码后4位: ${r.deviceLast4}`,
      `日期: ${r.extractedDate}`,
      `日: ${r.day}, 月: ${r.month}, 年(后2位): ${r.yearPartial}`,
      `随机数: ${r.randomNums.map(n => n.dec).join(', ')}`,
    ]
    if (r.dateMatch !== null) {
      lines.push(`日期验证: ${r.dateMatch ? '匹配' : '不匹配'}`)
    }
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }) },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  }
})

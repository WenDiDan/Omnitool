const barcode = require('../../utils/barcode.js')
const qrcode = require('../../utils/qrcode.js')
const { computeAllEncodeResults, encodeResultsToList } = require('../../utils/encode-utils.js')
const app = getApp()

Component({
  options: { addGlobalClass: true },
  lifetimes: {
    attached() { this.onLoad && this.onLoad({}); },
    detached() { this.onUnload && this.onUnload(); }
  },
  pageLifetimes: {
    show() { this.onShow && this.onShow(); },
    hide() { this.onHide && this.onHide(); }
  },
  data: {
    inputCode: '',
    decodedResult: null,
    detectType: '',
    typeIconLabel: '?',
    typeIconClass: '',
    showEncodeTools: false,
    encodeResults: {},
    qrImagePath: '',
    showQrCode: false,
    // 统计看板
    showStats: true,
    statsToday: 0,
    statsWeek: 0,
    statsTopTypes: [],
    statsTrend: [],
    // 登录弹窗
    showLoginModal: false,
    showProfileModal: false,
    editAvatarUrl: '',
    editNickName: '',
    isFirstLogin: false,
    hasShownProfilePrompt: false,
    isLoggedIn: true,
    pendingDecodeAction: null  // 待处理的解密操作
  },

  methods: {
  onLoad(options) {
    this.checkLoginStatus()
    if (options.code) {
      this.setData({ inputCode: decodeURIComponent(options.code) })
      this.decode()
    }
  },

  onShow() {
    // 检查登录状态（仅用于UI展示，不阻止使用）
    const isLoggedIn = wx.getStorageSync('isLoggedIn')
    this.setData({ isLoggedIn: !!isLoggedIn })
    // 计算统计数据
    this.computeStats()
  },

  // 检查登录状态（自动登录，无需弹窗）
  checkLoginStatus() {
    const isLoggedIn = wx.getStorageSync('isLoggedIn')
    const hasShown = wx.getStorageSync('hasShownProfilePrompt')
    this.setData({
      isLoggedIn: !!isLoggedIn,
      hasShownProfilePrompt: !!hasShown
    })
  },

  onInput(e) {
    const inputCode = e.detail.value
    const detectType = inputCode.trim() ? barcode.identifyBarcodeType(inputCode.trim()) : ''
    this.setData({ inputCode, decodedResult: null, detectType, encodeResults: {}, showEncodeTools: false })
  },

  // 粘贴
  pasteFromClipboard() {
    wx.getClipboardData({
      success: (res) => {
        if (res.data) {
          this.setData({ inputCode: res.data })
          this.decode()
        }
      },
      fail: () => { wx.showToast({ title: '读取剪贴板失败', icon: 'none' }); }
    })
  },

  // 清空
  clearInput() {
    this.setData({ inputCode: '', decodedResult: null, detectType: '', encodeResults: {}, showEncodeTools: false, qrImagePath: '' })
  },

  // 解码
  decode() {
    const code = this.data.inputCode.trim()
    if (!code) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }

    // 检查是否被封禁
    const userInfo = app.globalData.userInfo
    if (userInfo?.isBlocked) {
      wx.showModal({
        title: '无法使用',
        content: '您的账号已被封禁，无法使用解密功能',
        showCancel: false
      })
      return
    }

    const result = barcode.decodeBarcode(code)
    const detectType = barcode.identifyBarcodeType(code)

    // 自动计算编码转换
    const encodeResults = computeAllEncodeResults(code)

    // 计算是否有详情
    const r = result
    const hasDetails = !!(r.country || r.isbn || r.manufacturerCode || r.productCode || r.checkDigit || r.domain || r.ssid || r.vcardName || r.email || r.phone || r.smsPhone)

    // 编码列表（用于 wxml 循环）
    const encodeList = encodeResultsToList(encodeResults)

    // 计算类型图标缩写和样式类
    const typeIconInfo = this.getTypeIconInfo(detectType)

    this.setData({
      decodedResult: result,
      detectType,
      encodeResults,
      encodeList,
      hasDetails,
      qrImagePath: '',
      typeIconLabel: typeIconInfo.label,
      typeIconClass: typeIconInfo.cls
    })
  },

  // 根据类型返回图标缩写和 CSS 类
  getTypeIconInfo(detectType) {
    const t = (detectType || '').toLowerCase()
    if (t.includes('ean') || t.includes('isbn') || t.includes('条形码') || t.includes('barcode') || t.includes('upc')) {
      return { label: 'EAN', cls: 'type-ean' }
    }
    if (t.includes('二维码') || t.includes('qr')) {
      return { label: 'QR', cls: 'type-qr' }
    }
    if (t.includes('url') || t.includes('网址') || t.includes('http')) {
      return { label: 'URL', cls: 'type-url' }
    }
    if (t.includes('wifi') || t.includes('wi-fi')) {
      return { label: 'WiFi', cls: 'type-wifi' }
    }
    if (t.includes('vcard') || t.includes('联系人')) {
      return { label: 'Card', cls: 'type-vcard' }
    }
    if (t.includes('tel') || t.includes('电话') || t.includes('phone')) {
      return { label: 'TEL', cls: 'type-tel' }
    }
    if (t.includes('email') || t.includes('邮箱') || t.includes('mail')) {
      return { label: 'Mail', cls: 'type-email' }
    }
    // 默认：取前3个字符大写
    const label = (detectType || '?').slice(0, 3).toUpperCase()
    return { label, cls: '' }
  },

  // 切换编码工具展开
  toggleEncodeTools() {
    this.setData({ showEncodeTools: !this.data.showEncodeTools })
  },

  // 切换统计看板展开/收起
  toggleStats() {
    this.setData({ showStats: !this.data.showStats })
  },

  // 计算统计数据
  computeStats() {
    const history = app.globalData.scanHistory || []
    if (history.length === 0) {
      this.setData({
        statsToday: 0,
        statsWeek: 0,
        statsTopTypes: [],
        statsTrend: []
      })
      return
    }

    const now = new Date()
    const todayStr = this.formatDateStr(now)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay()) // 本周日始
    weekStart.setHours(0, 0, 0, 0)

    // 今日/本周计数
    let todayCount = 0
    let weekCount = 0
    const typeCount = {}
    const trendMap = {} // key: YYYY-MM-DD

    for (const item of history) {
      const itemDate = this.parseTimeStr(item.time)
      if (!itemDate) continue

      const itemStr = this.formatDateStr(itemDate)
      const itemDayStart = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate())

      // 今日
      if (itemStr === todayStr) {
        todayCount += (item.count || 1)
      }

      // 本周
      if (itemDayStart >= weekStart) {
        weekCount += (item.count || 1)
      }

      // 类型统计
      const t = this.normalizeType(item.type)
      typeCount[t] = (typeCount[t] || 0) + (item.count || 1)

      // 7日趋势
      const dayKey = itemStr
      trendMap[dayKey] = (trendMap[dayKey] || 0) + (item.count || 1)
    }

    // TOP 3 类型
    const topTypes = Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }))

    // 7日趋势（最近7天，含今天）
    const trend = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const key = this.formatDateStr(d)
      trend.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        count: trendMap[key] || 0
      })
    }

    this.setData({
      statsToday: todayCount,
      statsWeek: weekCount,
      statsTopTypes: topTypes,
      statsTrend: trend
    })

    // 绘制趋势图
    this.drawTrendChart(trend)
  },

  // 绘制7日趋势柱状图
  drawTrendChart(trend) {
    const query = wx.createSelectorQuery()
    query.select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const width = res[0].width
        const height = res[0].height
        // 画布尺寸无效则跳过绘制
        if (!width || !height || width <= 0 || height <= 30) return
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)

        const maxCount = Math.max(...trend.map(t => t.count), 1)
        const barWidth = (width - 60) / 7
        const chartHeight = height - 30

        trend.forEach((item, i) => {
          const x = 10 + i * barWidth + barWidth * 0.2
          const barH = maxCount > 0 ? (item.count / maxCount) * (chartHeight - 20) : 0
          const y = chartHeight - barH

          // 柱状（手绘圆角矩形，兼容微信 Canvas 2D）
          ctx.fillStyle = item.count > 0 ? '#5B7FFF' : '#E0E0E0'
          ctx.beginPath()
          const bw = barWidth * 0.6
          const r = Math.min(4, bw / 2, barH / 2)
          ctx.moveTo(x + r, y)
          ctx.lineTo(x + bw - r, y)
          ctx.arcTo(x + bw, y, x + bw, y + r, r)
          ctx.lineTo(x + bw, y + barH - r)
          ctx.arcTo(x + bw, y + barH, x + bw - r, y + barH, r)
          ctx.lineTo(x + r, y + barH)
          ctx.arcTo(x, y + barH, x, y + barH - r, r)
          ctx.lineTo(x, y + r)
          ctx.arcTo(x, y, x + r, y, r)
          ctx.closePath()
          ctx.fill()

          // 日期标签
          ctx.fillStyle = '#999'
          ctx.font = '10px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(item.date, x + barWidth * 0.3, chartHeight + 14)

          // 数值
          if (item.count > 0) {
            ctx.fillStyle = '#333'
            ctx.font = '10px sans-serif'
            ctx.fillText(item.count, x + barWidth * 0.3, y - 4)
          }
        })
      })
  },

  // 将 "2024-01-01 12:00:00" 解析为 Date
  parseTimeStr(str) {
    if (!str) return null
    // 支持 "2024-01-01 12:00:00" 或 "2024/01/01 12:00:00"
    const m = str.match(/(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    }
    return null
  },

  // 格式化为 YYYY-MM-DD
  formatDateStr(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  // 规范化类型名
  normalizeType(type) {
    const t = (type || '').toLowerCase()
    if (t.includes('ean') || t.includes('条形码') || t.includes('barcode') || t.includes('isbn') || t.includes('upc')) return 'EAN'
    if (t.includes('qr') || t.includes('二维码')) return 'QR'
    if (t.includes('url') || t.includes('网址') || t.includes('http')) return 'URL'
    if (t.includes('wifi') || t.includes('wi-fi')) return 'WiFi'
    if (t.includes('vcard') || t.includes('联系人')) return 'Card'
    if (t.includes('tel') || t.includes('电话')) return 'TEL'
    if (t.includes('email') || t.includes('邮箱') || t.includes('mail')) return 'Mail'
    return (type || '?').slice(0, 3).toUpperCase()
  },

  // 复制编码结果
  copyEncodeResult(e) {
    const key = e.currentTarget.dataset.key
    const value = this.data.encodeResults[key]
    if (value) {
      wx.setClipboardData({
        data: value,
        success: () => { wx.showToast({ title: '已复制', icon: 'success' }) },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
      })
    }
  },

  // ===== 快捷操作 =====

  openUrl() {
    const url = this.data.inputCode.trim()
    if (/^https?:\/\//i.test(url)) {
      wx.navigateTo({
        url: `/package1/pages/browser/browser?url=${encodeURIComponent(url)}`
      })
    }
  },

  copyWifiPassword() {
    const pwd = this.data.decodedResult.password
    if (pwd) {
      wx.setClipboardData({
        data: pwd,
        success: () => { wx.showToast({ title: '密码已复制', icon: 'success' }) },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
      })
    }
  },

  callPhone() {
    const phone = this.data.decodedResult.phone || this.data.inputCode.replace(/^tel:/i, '')
    if (phone) {
      wx.makePhoneCall({
        phoneNumber: phone,
        fail: () => { wx.showToast({ title: '拨号失败', icon: 'none' }) }
      })
    }
  },

  copyEmail() {
    const email = this.data.decodedResult.email || this.data.inputCode.replace(/^mailto:/i, '')
    if (email) {
      wx.setClipboardData({
        data: email,
        success: () => { wx.showToast({ title: '邮箱已复制', icon: 'success' }) },
        fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
      })
    }
  },

  saveContact() {
    const r = this.data.decodedResult
    if (!r || !r.vcardName) return
    wx.addPhoneContact({
      firstName: r.vcardName,
      mobilePhoneNumber: r.vcardPhone || '',
      email: r.vcardEmail || '',
      organization: r.vcardOrg || '',
      fail: () => {}
    })
  },

  copyResult() {
    wx.setClipboardData({
      data: this.data.inputCode.trim(),
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }) },
      fail: () => { wx.showToast({ title: '复制失败', icon: 'none' }) }
    })
  },

  // ===== 生成二维码 =====

  generateQrCode() {
    const code = this.data.inputCode.trim()
    if (!code) return

    wx.showLoading({ title: '生成中...' })

    const query = wx.createSelectorQuery()
    query.select('#qrCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
          wx.hideLoading()
          wx.showToast({ title: 'Canvas初始化失败', icon: 'none' })
          return
        }

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        canvas.width = 200 * dpr
        canvas.height = 200 * dpr
        ctx.scale(dpr, dpr)

        qrcode.makeQrCode({
          text: code,
          width: 200,
          canvasNode: canvas,
          ctx: ctx,
          colorDark: '#0D1B2A',
          colorLight: '#FFFFFF',
          callback: (res) => {
            wx.hideLoading()
            if (res.tempFilePath) {
              this.setData({ qrImagePath: res.tempFilePath, showQrCode: true })
            } else {
              wx.showToast({ title: '生成失败', icon: 'none' })
            }
          }
        })
      })
  },

  saveQrCode() {
    if (!this.data.qrImagePath) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.qrImagePath,
      success: () => { wx.showToast({ title: '已保存到相册', icon: 'success' }) },
      fail: (err) => {
        if (err.errMsg.indexOf('auth deny') !== -1) {
          wx.showModal({
            title: '提示',
            content: '需要授权保存图片到相册',
            confirmText: '去设置',
            success: (res) => { if (res.confirm) wx.openSetting() }
          })
        }
      }
    })
  },

  closeQrCode() {
    this.setData({ showQrCode: false })
  },

  goRegCode() {
    wx.navigateTo({ url: '/package1/pages/regcode/regcode' })
  },


  // 选择头像
  onEditChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    this.setData({ editAvatarUrl: avatarUrl })
  },

  // 输入昵称
  onEditNickInput(e) {
    this.setData({ editNickName: e.detail.value })
  },

  // 保存资料
  confirmProfile() {
    const { editAvatarUrl, editNickName } = this.data
    const avatarUrl = editAvatarUrl || '/images/icon_user_white.png'
    const nickName = editNickName.trim() || '微信用户'

    wx.showLoading({ title: '保存中...', mask: true })
    wx.cloud.callFunction({
      name: 'userManage',
      data: {
        action: 'updateInfo',
        avatarUrl: avatarUrl,
        nickName: nickName
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result.success) {
          // 更新本地缓存
          wx.setStorageSync('userAvatar', avatarUrl)
          wx.setStorageSync('userNickName', nickName)
          wx.setStorageSync('hasShownProfilePrompt', true)
          
          this.setData({
            showProfileModal: false,
            isFirstLogin: false,
            hasShownProfilePrompt: true
          })

          wx.showToast({ title: '保存成功', icon: 'success' })
          // 执行待处理的解密操作
          this.executePendingDecodeAction()
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  // 跳过设置
  skipProfile() {
    this.setData({
      showProfileModal: false,
      isFirstLogin: false,
      hasShownProfilePrompt: true
    })
    wx.setStorageSync('hasShownProfilePrompt', true)
    // 执行待处理的解密操作
    this.executePendingDecodeAction()
  },

  // 格式化时间
  formatDateTime(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const h = String(date.getHours()).padStart(2, '0')
    const mi = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${y}-${m}-${d} ${h}:${mi}:${s}`
  }
  }
})

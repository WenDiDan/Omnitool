const barcode = require('../../../../utils/barcode.js')
const qrLocal = require('../../../../utils/qr-local.js')
const { computeAllEncodeResults, encodeResultsToList } = require('../../../../utils/encode-utils.js')
const scanUtils = require('../../utils/scan-utils.js')
const app = getApp()

Component({
  options: { addGlobalClass: true },
  properties: {
    // 父页面 Tab 是否激活：解码 Tab 切过来时趋势画布才有真实尺寸，此时补画
    active: {
      type: Boolean,
      value: false,
      observer(val) {
        if (val && this._trend && this._trend.length && !this._trendDrawn) {
          this.drawTrendChart(this._trend)
        }
      }
    }
  },
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
    statsHasData: false,
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

  onUnload() {
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
    this._lastCode = ''
    this.setData({ inputCode, decodedResult: null, detectType, encodeResults: {}, encodeList: [], showEncodeTools: false })
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
    this._lastCode = ''
    this.setData({ inputCode: '', decodedResult: null, detectType: '', encodeResults: {}, encodeList: [], showEncodeTools: false, qrImagePath: '' })
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

    let result
    try {
      result = barcode.decodeBarcode(code)
    } catch (err) {
      // 解码异常时降级为原文展示，保证功能可用
      console.error('[解码] 解析失败', err)
      result = scanUtils.fallbackDecoded(code)
      wx.showToast({ title: '解析失败，已展示原文', icon: 'none' })
    }
    // decodeBarcode 内部已做类型识别，直接复用，避免重复正则匹配
    const detectType = result.type

    // 自定义解码规则：与扫码页/历史页走同一条链路（此前漏调用，规则在解码页完全不生效）
    let customRuleResults = []
    try {
      customRuleResults = app.decodeWithRule ? (app.decodeWithRule(code) || []) : []
    } catch (err) {
      console.error('[解码] 规则执行失败', err)
    }
    scanUtils.mergeCustomRuleResults(result, customRuleResults)

    // 编码转换结果按需计算：默认收起，首次展开时再算（见 toggleEncodeTools）
    this._lastCode = code

    // 计算是否有详情（规则命中也算，保证只有规则结果时详情卡也能展开）
    const r = result
    const hasDetails = !!(r.country || r.isbn || r.manufacturerCode || r.productCode || r.checkDigit || r.domain || r.ssid || r.vcardName || r.email || r.phone || r.smsPhone || r.customData)

    // 计算类型图标缩写和样式类
    const typeIconInfo = this.getTypeIconInfo(detectType)

    this.setData({
      decodedResult: result,
      detectType,
      encodeResults: {},
      encodeList: [],
      showEncodeTools: false,
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

  // 切换编码工具展开（首次展开时才计算编码结果，避免每次解码都做多组转换）
  toggleEncodeTools() {
    const next = !this.data.showEncodeTools
    if (next && this._lastCode && this.data.encodeList.length === 0) {
      const encodeResults = computeAllEncodeResults(this._lastCode)
      this.setData({
        showEncodeTools: true,
        encodeResults,
        encodeList: encodeResultsToList(encodeResults)
      })
      return
    }
    this.setData({ showEncodeTools: next })
  },

  // 阻止弹窗内容区点击冒泡到遮罩（catchtap 需要一个处理函数）
  stopTap() {},

  // 切换统计看板展开/收起（重新展开时补画趋势图）
  toggleStats() {
    const next = !this.data.showStats
    this.setData({ showStats: next }, () => {
      if (next && this._trend) this.drawTrendChart(this._trend)
    })
  },

  // 计算统计数据（历史版本未变化时直接复用上次结果）
  computeStats() {
    const version = app.globalData.scanHistoryVersion || 0
    if (this._statsVersion === version) return
    this._statsVersion = version

    const history = app.globalData.scanHistory || []
    if (history.length === 0) {
      this._trend = []
      this.setData({
        statsToday: 0,
        statsWeek: 0,
        statsTopTypes: [],
        statsTrend: [],
        statsHasData: false
      })
      return
    }

    const now = new Date()
    const { start: todayStart, end: todayEnd } = scanUtils.getTodayRange(now)
    const weekStart = scanUtils.getWeekStart(now) // 本周日始
    const trendStart = todayStart - 6 * scanUtils.DAY_MS

    // 今日/本周计数
    let todayCount = 0
    let weekCount = 0
    const typeCount = {}
    const trendMap = {} // key: YYYY-MM-DD

    for (const item of history) {
      const itemDate = scanUtils.parseDateTime(item.time)
      if (!itemDate) continue

      const ts = itemDate.getTime()
      const n = item.count || 1

      // 今日 / 本周：数值比较，省去逐条格式化日期字符串
      if (ts >= todayStart && ts < todayEnd) todayCount += n
      if (ts >= weekStart) weekCount += n

      // 类型统计：与「本周累计」同窗口，保证各分项之和 ≤ 本周数（旧版本是全量累计，和本周对不上）
      if (ts >= weekStart) {
        const t = scanUtils.getTypeLabel(item.type)
        typeCount[t] = (typeCount[t] || 0) + n
      }

      // 7日趋势：超出窗口的记录不再计算日期键
      if (ts >= trendStart && ts < todayEnd) {
        const dayKey = scanUtils.formatDate(itemDate)
        trendMap[dayKey] = (trendMap[dayKey] || 0) + n
      }
    }

    // TOP 3 类型（附带占比，用于横向比例条；仅做展示换算，不新增指标）
    const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1])
    const maxTypeCount = sortedTypes.length ? sortedTypes[0][1] : 0
    const topTypes = sortedTypes.slice(0, 3).map(([type, count]) => ({
      type,
      count,
      percent: maxTypeCount ? Math.round((count / maxTypeCount) * 100) : 0
    }))

    // 7日趋势（最近7天，含今天）
    const trend = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(now.getDate() - i)
      const key = scanUtils.formatDate(d)
      trend.push({
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        count: trendMap[key] || 0
      })
    }

    this._trend = trend
    this._trendDrawn = false // 新数据待绘制，等画布可见时补画
    this.setData({
      statsToday: todayCount,
      statsWeek: weekCount,
      statsTopTypes: topTypes,
      statsTrend: trend,
      statsHasData: trend.some((t) => t.count > 0)
    })

    // 绘制趋势图（等渲染完成再取画布；看板收起时由 toggleStats 展开后补画）
    if (this.data.showStats) wx.nextTick(() => this.drawTrendChart(trend))
  },

  // 绘制 7 日趋势柱状图（带刻度、基线、日期轴与单位）
  // 真机上 wx:if 刚插入的 canvas 可能未完成布局（宽高为 0），自动重试直到就绪
  drawTrendChart(trend, attempt = 0) {
    const data = Array.isArray(trend) ? trend : []
    if (data.length === 0) return

    // 组件内节点必须用 this.createSelectorQuery()，全局查询只能命中页面节点
    this.createSelectorQuery()
      .select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        const ready = info && info.node && info.width > 0 && info.height > 60
        if (!ready) {
          // 未就绪：最多重试 6 次（约 0.9s），仍失败则放弃（下次展开看板会重画）
          if (attempt < 6) setTimeout(() => this.drawTrendChart(trend, attempt + 1), 150)
          return
        }
        const canvas = info.node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        const width = info.width
        const height = info.height
        this._trendDrawn = true
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)

        const pad = { top: 20, right: 10, bottom: 24, left: 34 }
        const chartW = width - pad.left - pad.right
        const chartH = height - pad.top - pad.bottom
        const baseY = pad.top + chartH

        // 刻度上限取整到 1/2/5 × 10^n，避免出现 7、13 这类难读刻度
        const rawMax = Math.max(...data.map((d) => d.count || 0), 0)
        let niceMax
        if (rawMax <= 4) {
          niceMax = 4
        } else {
          const exp = Math.pow(10, Math.floor(Math.log10(rawMax)))
          const base = rawMax / exp
          const step = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10
          niceMax = step * exp
        }
        const yOf = (v) => baseY - (v / niceMax) * chartH

        // 横向刻度线 + 刻度值
        ctx.lineWidth = 1
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ;[0, niceMax / 2, niceMax].forEach((tick) => {
          const y = yOf(tick)
          ctx.strokeStyle = tick === 0 ? '#D9C6B4' : '#F0E4D6'
          ctx.beginPath()
          ctx.moveTo(pad.left, y)
          ctx.lineTo(width - pad.right, y)
          ctx.stroke()
          ctx.fillStyle = '#9A877C'
          ctx.font = '10px Menlo, Consolas, monospace'
          ctx.fillText(String(Math.round(tick)), pad.left - 6, y)
        })

        const now = new Date()
        const todayKey = `${now.getMonth() + 1}/${now.getDate()}`
        const slot = chartW / data.length
        const barW = Math.max(6, Math.min(18, slot * 0.44))

        data.forEach((item, i) => {
          const value = item.count || 0
          const x = pad.left + slot * i + (slot - barW) / 2
          const y = yOf(value)
          const isToday = item.date === todayKey

          if (value > 0) {
            const h = baseY - y
            const r = Math.min(4, barW / 2, h / 2)
            ctx.fillStyle = isToday ? '#C0553D' : '#E8A44C'
            ctx.beginPath()
            ctx.moveTo(x, baseY)
            ctx.lineTo(x, y + r)
            ctx.arcTo(x, y, x + r, y, r)
            ctx.lineTo(x + barW - r, y)
            ctx.arcTo(x + barW, y, x + barW, y + r, r)
            ctx.lineTo(x + barW, baseY)
            ctx.closePath()
            ctx.fill()

            // 数值标注
            ctx.fillStyle = isToday ? '#A8452F' : '#6B5448'
            ctx.font = '10px Menlo, Consolas, monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(String(value), x + barW / 2, y - 4)
          } else {
            // 零值保留浅色短柱，避免整列视觉缺失
            ctx.fillStyle = '#EFE3D5'
            ctx.fillRect(x, baseY - 2, barW, 2)
          }

          // 日期轴
          ctx.fillStyle = isToday ? '#C0553D' : '#8A766C'
          ctx.font = '10px PingFang SC, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(item.date, x + barW / 2, baseY + 7)
        })
      })
  },

  // 复制编码结果
  copyEncodeResult(e) {
    const key = e.currentTarget.dataset.key
    const value = this.data.encodeResults[key]
    if (value) scanUtils.copyText(value, '已复制')
  },

  // ===== 快捷操作 =====

  // 复制链接（小程序内不内置网页浏览，交由系统浏览器打开）
  copyUrl() {
    const url = this.data.inputCode.trim()
    if (!/^https?:\/\//i.test(url)) return
    scanUtils.copyText(url, '链接已复制，请到浏览器打开')
  },

  copyWifiPassword() {
    const pwd = this.data.decodedResult.password
    if (pwd) scanUtils.copyText(pwd, '密码已复制')
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
    if (email) scanUtils.copyText(email, '邮箱已复制')
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

  /** 本地生成二维码（不依赖云函数 / 外部接口），绘制后导出临时图片 */
  generateQrCode() {
    const code = this.data.inputCode.trim()
    if (!code) return

    wx.showLoading({ title: '生成中...' })

    // 组件内节点必须用 this.createSelectorQuery()
    this.createSelectorQuery()
      .select('#qrCanvas')
      .fields({ node: true, size: true })
      .exec(async (res) => {
        try {
          if (!res[0] || !res[0].node) throw new Error('canvas not ready')

          const canvas = res[0].node
          const size = Math.min(res[0].width || 200, res[0].height || 200) || 200
          const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2

          canvas.width = size * dpr
          canvas.height = size * dpr
          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)

          qrLocal.draw(ctx, code, size, { colorDark: '#0D1B2A', colorLight: '#FFFFFF' })
          const path = await qrLocal.exportTempFilePath(canvas)

          wx.hideLoading()
          this.setData({ qrImagePath: path, showQrCode: true })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '生成失败，请重试', icon: 'none' })
          console.error('[decode] 本地二维码生成失败', e)
        }
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
    wx.navigateTo({ url: '/pages/regcode/regcode' })
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
    const avatarUrl = editAvatarUrl || '/images/nav_user_white.png'
    const nickName = editNickName.trim() || '微信用户'

    wx.showLoading({ title: '保存中...', mask: true })
    wx.cloud.callFunction({
      name: 'userManage',
      data: {
        action: 'updateProfile',
        avatarUrl: avatarUrl,
        nickName: nickName
      },
      success: (res) => {
        const result = res && res.result
        wx.hideLoading()
        if (result && result.success) {
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
